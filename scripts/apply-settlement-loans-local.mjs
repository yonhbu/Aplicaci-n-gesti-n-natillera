// Local-only, atomic, financial-row fingerprints; DEV backup encrypted in memory.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {join} from 'node:path';
const mode=process.argv[2],dry=process.argv.includes('--dry-run');
if(!['--test','--dev'].includes(mode))throw Error('Use --test o --dev local.');
const container='supabase_db_natillera-manager'+(mode==='--test'?'-test':''),port=mode==='--test'?'55422':'44122';
const binding=JSON.parse(execFileSync('docker',['inspect','--format','{{json .HostConfig.PortBindings}}',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(!binding['5432/tcp']?.some(p=>p.HostPort===port))throw Error('Puerto local inesperado.');
const query=input=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:8e6});
const version='20261107000100',name='settlement_loan_consistency';
if(query(`select count(*) from supabase_migrations.schema_migrations where version='${version}';`).trim()!=='0'){console.log('Correccion ya instalada; sin cambios.');process.exit(0);}
const folder='incoming/settlement-loans-2026-10-21';mkdirSync(folder,{recursive:true});
if(mode==='--dev'&&!dry){
 const backupFolder='incoming/local-private-backups/settlement-loans-2026-10-21';mkdirSync(backupFolder,{recursive:true});
 const dump=execFileSync('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--schema=public','--schema=auth','--schema=storage','--schema=supabase_migrations'],{stdio:['ignore','pipe','pipe'],windowsHide:true,maxBuffer:128e6});
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(dump),cipher.final()]);
 const ps="Add-Type -AssemblyName System.Security; $plain=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $sealed=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sealed)); [Array]::Clear($plain,0,$plain.Length)";
 const sealed=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{input:key.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true}).trim();
 const unseal="Add-Type -AssemblyName System.Security; $sealed=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $plain=[Security.Cryptography.ProtectedData]::Unprotect($sealed,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($plain)); [Array]::Clear($plain,0,$plain.Length)";
 const recoveredKey=Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',unseal],{input:sealed,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true}).trim(),'base64');
 if(!recoveredKey.equals(key))throw Error('La clave cifrada no supera la comprobacion de recuperacion.');
 const decipher=createDecipheriv('aes-256-gcm',recoveredKey,iv);decipher.setAuthTag(cipher.getAuthTag());
 const recoveredDump=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
 if(!recoveredDump.equals(dump))throw Error('El respaldo cifrado no coincide con la fuente.');
 recoveredKey.fill(0);recoveredDump.fill(0);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 writeFileSync(join(backupFolder,stamp+'.pgdump.aes256gcm'),Buffer.concat([Buffer.from('NATSET01'),iv,cipher.getAuthTag(),ciphertext]));
 writeFileSync(join(backupFolder,stamp+'.key.dpapi'),sealed);
 writeFileSync(join(backupFolder,stamp+'.manifest.json'),JSON.stringify({encryption:'AES-256-GCM; key sealed Windows DPAPI CurrentUser',plainSha256:createHash('sha256').update(dump).digest('hex'),bytes:dump.length,container},null,2));
 key.fill(0);dump.fill(0);console.log('Respaldo DEV cifrado creado; clave protegida por Windows.');
}
const source=readFileSync('supabase/migrations/'+version+'_'+name+'.sql','utf8');
const q=value=>"'"+value.replaceAll("'","''")+"'";
const sql=`begin;set local lock_timeout='15s';
 lock table public.financial_operations,public.ledger_entries,public.loan_contracts,public.member_settlements,public.loan_payments,public.member_settlement_debt_applications in share row exclusive mode;
 create temp table preserved_tables(name text,hash text);
 do $$declare t record;h text;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename<>'loan_contracts' loop
 execute format('select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,''[]'')) from public.%I r',t.tablename)into h;
 insert into preserved_tables values(t.tablename,h);end loop;end $$;
 create temp table preserved_loan_values as select id,to_jsonb(l)-'status'-'cancelled_at'-'updated_at' economic_values from public.loan_contracts l;
 create temp table prior_loans as select id,status,cancelled_at from public.loan_contracts;
 ${source}
 do $$declare t record;h text;begin
 for t in select * from preserved_tables loop
 execute format('select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,''[]'')) from public.%I r',t.name)into h;
 if h is distinct from t.hash then raise exception 'Cambios inesperados en %',t.name;end if;end loop;
 if exists(select 1 from public.loan_contracts l full join preserved_loan_values p using(id)where p.id is null or l.id is null or to_jsonb(l)-'status'-'cancelled_at'-'updated_at' is distinct from p.economic_values)then raise exception 'Se modificaron valores economicos de prestamos.';end if;
 if exists(select 1 from public.loan_contracts l join prior_loans p using(id)where l.status is distinct from p.status and(l.status<>'paid' or p.status<>'active' or public.loan_remaining_principal_at(l.id,l.cancelled_at)<>0))then raise exception 'Cierre no sustentado.';end if;
 end $$;
 select jsonb_build_object('mode',${q(mode)},'dryRun',${dry},'financialTablesUnchanged',(select count(*)from preserved_tables),'loanEconomicValuesUnchanged',true,'closuresRepaired',(select count(*)from public.loan_contracts l join prior_loans p using(id)where l.status is distinct from p.status),'bank',(select coalesce(sum(amount),0)from public.ledger_entries where account='cash'and liquidity_location='bank'),'principal',(select coalesce(sum(amount),0)from public.ledger_entries where account='loans_receivable'));
 insert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','${name}',array[${q(source)}]);
 ${dry?'rollback':'commit'};`;
try{const output=query(sql).trim();writeFileSync(join(folder,(mode==='--dev'?'dev':'test')+(dry?'-dry-run':'-applied')+'.json'),output+'\n');
 const report=JSON.parse(output);console.log(JSON.stringify({mode,dryRun:dry,financialTablesUnchanged:report.financialTablesUnchanged,closuresRepaired:report.closuresRepaired,loanEconomicValuesUnchanged:true}));}
catch(error){console.error(String(error.stderr??'Error SQL local; salida omitida.').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[redacted]').slice(-1800));process.exit(1);}
