// Authorized local DEV correction: no reset, source reimport, personal income, or settlement confirmation.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const container='supabase_db_natillera-manager',port='44122',version='20261105000100';
const mode=process.argv[2];
if(!['--plan','--apply','--backup-only'].includes(mode))throw Error('Use --plan, --apply or --backup-only, exclusively on local DEV.');
const out=path.join(root,'incoming','local-private-backups','Natillera-privado','money-control-2026-10-20');
mkdirSync(out,{recursive:true});
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value).digest('hex');
function run(args,input){
  try{return execFileSync('docker',args,{input,stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:128e6});}
  catch(error){throw Error(String(error.stderr??'Local database command failed').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g,'[redacted]'));}
}
const binding=JSON.parse(run(['inspect','--format','{{json .HostConfig.PortBindings}}',container]));
if(!binding['5432/tcp']?.some(item=>item.HostPort===port))throw Error('DEV must be bound only to the expected local database port.');
const health=await fetch('http://127.0.0.1:44121/auth/v1/health');
if(!health.ok)throw Error('Local DEV authentication is not responding.');
const sql=text=>run(['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],text).toString().trim();
const json=text=>JSON.parse(sql(text).split(/\r?\n/).find(line=>line.startsWith('{')||line.startsWith('[')));
const identity=json("select jsonb_build_object('cycles',(select jsonb_agg(to_jsonb(c))from public.cycles c where year=2026),'admins',(select jsonb_agg(to_jsonb(u))from public.workspace_users u where role='admin'),'banks',(select jsonb_agg(to_jsonb(b))from public.bank_accounts b where status='active'));");
if(identity.cycles?.length!==1)throw Error('Choose the DEV cycle explicitly before using this one-cycle procedure.');
const cycle=identity.cycles[0],admin=identity.admins?.find(item=>item.workspace_id===cycle.workspace_id);
const banks=identity.banks?.filter(item=>item.workspace_id===cycle.workspace_id&&/pibank/i.test(item.display_name+' '+item.institution_name))??[];
if(!admin||banks.length!==1||cycle.status!=='active')throw Error('One active cycle, an existing administrator and one identified Pibank account are required.');
const bank=banks[0],tables=JSON.parse(sql('select to_jsonb(public.natillera_backup_tables());'));
if(!tables.every(table=>/^[a-z_]+$/.test(table)))throw Error('Invalid recovery inventory.');
const snapshotQuery=table=>"select coalesce(jsonb_agg(to_jsonb(r)order by to_jsonb(r)::text),'[]')from public."+table+" r";
const prefix="set local request.jwt.claim.sub="+quote(admin.user_id)+";set local role authenticated;";
function backup(tag){
  const basename=path.join(out,'dev-'+tag+'-'+Date.now());
  const dump=run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--format=custom']);
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(dump),cipher.final()]);
  const powershell=path.join(process.env.SystemRoot??'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  if(!existsSync(powershell))throw Error('DPAPI helper is unavailable.');
  function protect(value,undo=false){
    return Buffer.from(execFileSync(powershell,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',
      'Add-Type -AssemblyName System.Security;$v=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::'+(undo?'Unprotect':'Protect')+'($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)));'],
      {input:value.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true}).trim(),'base64');
  }
  const protectedKey=protect(key);
  const metadata={format:'natillera-local-pg.aes256gcm.v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),sha256:hash(dump),container,port};
  writeFileSync(basename+'.aes',encrypted,{flag:'wx'});
  writeFileSync(basename+'.key.dpapi',protectedKey,{flag:'wx'});
  writeFileSync(basename+'.json',JSON.stringify(metadata,null,2),{flag:'wx'});
  const decipher=createDecipheriv('aes-256-gcm',protect(readFileSync(basename+'.key.dpapi'),true),iv);decipher.setAuthTag(cipher.getAuthTag());
  const verified=Buffer.concat([decipher.update(readFileSync(basename+'.aes')),decipher.final()]);
  if(hash(verified)!==hash(dump))throw Error('Backup content verification failed.');
  run(['exec','-i',container,'pg_restore','--list'],verified);
  return{path:basename+'.aes',verified:true};
}
const beforeHashes=json("select jsonb_object_agg(t,h)from("+tables.map(table=>"select "+quote(table)+"t,md5(("+snapshotQuery(table)+")::text)h").join(' union all ')+")x;");
if(mode==='--backup-only'){console.log(JSON.stringify(backup('before')));process.exit(0);}
let beforeBackup;
if(mode==='--apply')beforeBackup=backup('before');
const migrations=[
  [version,'settlement_completion_and_cash_location'],
  ['20261105000200','loan_receipt_destination']
].map(([id,name])=>({id,name,source:readFileSync(path.join(root,'supabase/migrations/'+id+'_'+name+'.sql'),'utf8'),
  installed:sql("select exists(select 1 from supabase_migrations.schema_migrations where version="+quote(id)+");")==='t'}));
const migration=migrations.map(item=>item.source).join('\n');
let statement="begin;set local lock_timeout='15s';lock table "+tables.map(table=>'public.'+table).join(',')+" in share row exclusive mode;";
statement+="create temp table money_control_before(name text,data jsonb);";
statement+=tables.map(table=>"insert into money_control_before select "+quote(table)+",("+snapshotQuery(table)+");").join('\n');
for(const item of migrations)if(!item.installed)statement+=item.source+"\ninsert into supabase_migrations.schema_migrations(version,name,statements)values("+quote(item.id)+","+quote(item.name)+",array["+quote(item.source)+"]);";
statement+=prefix;
statement+="do $correction$declare source record;begin for source in select o.id from public.financial_operations o where o.cycle_id="+quote(cycle.id)+"and o.operation_type in('loan_payment','loan_prepayment')and o.effective_date<=public.fin_civil_today()and exists(select 1 from public.ledger_entries e where e.operation_id=o.id and e.account='cash'and e.liquidity_location='cash')and not exists(select 1 from public.financial_operations c where c.operation_type='cash_location_corrected'and c.payload->>'root_operation_id'=o.id::text and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=c.id))order by o.effective_date,o.created_at loop perform public.correct_cash_loan_location(source.id,"+quote(bank.id)+",'money-control-20261020:'||source.id::text,'Juan confirma que no habia efectivo al 15, 16 y 20 de octubre; cobros ubicados directamente en Pibank, conservando anulaciones y fechas.');end loop;end $correction$;";
statement+="reset role;do $verify$declare row record;actual jsonb;begin ";
statement+=tables.filter(table=>!['financial_operations','ledger_entries','audit_events'].includes(table)).map(table=>"if ("+snapshotQuery(table)+")is distinct from(select data from money_control_before where name="+quote(table)+")then raise exception 'Source collection changed: "+table+"';end if;").join('\n');
statement+=['financial_operations','ledger_entries','audit_events'].map(table=>"if exists(select 1 from jsonb_array_elements((select data from money_control_before where name="+quote(table)+"))original where not exists(select 1 from public."+table+" existing where to_jsonb(existing)=original))then raise exception 'Original rows changed: "+table+"';end if;").join('\n');
statement+="if exists(select 1 from public.ledger_entries group by operation_id having sum(amount)<>0)then raise exception 'Unbalanced operation';end if;";
statement+="if exists(select 1 from(select r->>'account'account,sum((r->>'amount')::numeric)amount from jsonb_array_elements((select data from money_control_before where name='ledger_entries'))r group by r->>'account')b full join(select account,sum(amount)amount from public.ledger_entries group by account)a on a.account=b.account where a.amount is distinct from b.amount)then raise exception 'Location correction changed a financial account total';end if;";
statement+="if exists(select 1 from(values('2026-10-15'::date),('2026-10-16'::date),('2026-10-20'::date))d(day)where coalesce((select sum(e.amount)from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id where e.cycle_id="+quote(cycle.id)+"and e.account='cash'and e.liquidity_location='cash'and o.effective_date<=d.day),0)<>0)then raise exception 'Cash is not zero at all confirmed dates';end if;end $verify$;";
// Independent check of this consolidated dataset against domain records, not the bank card.
statement+="create temp table domain_cash_check as select "
 +"coalesce((select sum(amount)from public.savings_contributions where cycle_id="+quote(cycle.id)+"and status='posted'),0)"
 +"+coalesce((select sum(amount)from public.polla_contributions where cycle_id="+quote(cycle.id)+"and status='posted'),0)"
 +"-coalesce((select sum(principal)from public.loan_contracts where cycle_id="+quote(cycle.id)+"and status in('active','paid')),0)"
 +"+coalesce((select sum(legacy_paid_capital_amount+legacy_paid_interest_amount)from public.loan_contracts where cycle_id="+quote(cycle.id)+"and status in('active','paid')),0)"
 +"+coalesce((select sum(amount)from public.loan_payments where cycle_id="+quote(cycle.id)+"and status='posted'),0)"
 +"+coalesce((select sum((payload->>'amount')::numeric)from public.financial_operations o where o.cycle_id="+quote(cycle.id)+"and(o.operation_type='admin_fine_received'or(o.operation_type='manual_income'and lower(o.payload->>'category')='multa'))and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id)),0)"
 +"+coalesce((select sum(net_amount)from public.bank_yield_receipts where cycle_id="+quote(cycle.id)+"),0) as expected;";
statement+="do $domain$begin if(select expected from domain_cash_check)is distinct from(select coalesce(sum(amount),0)from public.ledger_entries where cycle_id="+quote(cycle.id)+"and account='cash')then raise exception 'Domain-based cash calculation requires reviewing additional money flows before applying this dataset correction';end if;end $domain$;";
statement+="select jsonb_build_object('target','DEV44121','bank',(select sum(e.amount)from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id where e.cycle_id="+quote(cycle.id)+"and e.account='cash'and e.bank_account_id="+quote(bank.id)+"and o.effective_date<=public.fin_civil_today()),'cash',(select sum(e.amount)from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id where e.cycle_id="+quote(cycle.id)+"and e.account='cash'and e.liquidity_location='cash'and o.effective_date<=public.fin_civil_today()),'corrections',(select count(*)from public.financial_operations where cycle_id="+quote(cycle.id)+"and operation_type='cash_location_corrected'),'bank_yield',(select sum(net_amount)from public.bank_yield_receipts where cycle_id="+quote(cycle.id)+"),'independent_expected_cash',(select expected from domain_cash_check),'original_collections_preserved',true,'all_account_totals_unchanged',true);";
statement+=mode==='--apply'?'commit;':'rollback;';
const result=json(statement);
if(mode==='--plan'){
 const afterHashes=json("select jsonb_object_agg(t,h)from("+tables.map(table=>"select "+quote(table)+"t,md5(("+snapshotQuery(table)+")::text)h").join(' union all ')+")x;");
 if(JSON.stringify(beforeHashes)!==JSON.stringify(afterHashes))throw Error('Dry-run did not roll back exactly.');
}
const afterBackup=mode==='--apply'?backup('after'):undefined;
const evidence=JSON.stringify({mode,migrationSha256:hash(migration),beforeHashes,result,beforeBackup,afterBackup,statementHistory:'Preserved; no external balance or personal transaction invented'},null,2);
writeFileSync(path.join(out,(mode==='--apply'?'applied-':'plan-')+Date.now()+'.json'),evidence,{flag:'wx'});
writeFileSync(path.join(out,mode==='--apply'?'applied.json':'plan.json'),evidence);
console.log(JSON.stringify({...result,committed:mode==='--apply',evidence:out}));
