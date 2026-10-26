// No dotenv, no embedded amounts. Financial input and evidence stay outside the repo.
import {readFileSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateBankInterestInput} from './lib/bank-interest-input.mjs';
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const root=realpathSync(process.cwd());
function external(file){const resolved=realpathSync(file);const rel=path.relative(root,resolved);if(!rel.startsWith('..')&&!path.isAbsolute(rel))throw Error('Los datos financieros deben estar fuera del repositorio.');return resolved;}
const source=option('--input'),through=option('--confirmed-through')??option('--completed-through');
let reportTarget;
if(option('--out')){reportTarget=path.join(realpathSync(path.dirname(path.resolve(option('--out')))),path.basename(option('--out')));const rel=path.relative(root,reportTarget);if(!rel.startsWith('..')&&!path.isAbsolute(rel))throw Error('El reporte debe quedar fuera del repositorio.');}
if(!source)throw Error('Use --input archivo-externo.json --confirmed-through YYYY-MM-DD [--apply].');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const data=validateBankInterestInput(JSON.parse(readFileSync(external(source),'utf8')),through,today);
const runtime=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(runtime.API_URL!=='http://127.0.0.1:55421')throw Error('Solo TEST55421.');
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=query=>execFileSync('docker',['exec','-i','supabase_db_natillera-manager-test','psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const actor=sql(`select user_id from workspace_users where workspace_id=(select workspace_id from cycles where id=${quote(data.cycleId)})and role='admin' order by user_id limit 1;`);
if(!/^[0-9a-f-]{36}$/.test(actor))throw Error('TEST no tiene administrador para este ciclo.');
const calls=data.receipts.map(r=>{
 const key='bank-interest:'+createHash('sha256').update(JSON.stringify({cycle:data.cycleId,bank:data.bankId,date:r.date})).digest('hex');
 const existing=`o.cycle_id=${quote(data.cycleId)} and o.operation_type='bank_interest_received' and o.effective_date=${quote(r.date)}::date and o.payload->>'bank_account_id'=${quote(data.bankId)} and not exists(select 1 from financial_operations rev where rev.reverses_operation_id=o.id)`;
 return `do $$begin
 if exists(select 1 from financial_operations o where ${existing})then
   if(select count(*)=1 and bool_and((payload->>'gross')::numeric=${quote(r.amount)}::numeric and (payload->>'withholding')::numeric=0 and(payload->>'fee')::numeric=0)from financial_operations o where ${existing})then insert into phasea_bank_import values('preserved');
   else raise exception 'Ya existe un abono distinto en esa fecha; no se duplica ni se sustituye.';end if;
 else perform public.record_bank_interest_received(${quote(data.cycleId)},${quote(data.bankId)},${quote(key)},${quote(r.date)},${quote(r.amount)}::numeric,0,0,'Abono bancario confirmado');insert into phasea_bank_import values('created');end if;
 end$$;`;
});
if(!process.argv.includes('--apply')){console.log(JSON.stringify({mode:'preview',receipts:calls.length,total:data.total,confirmedThrough:through,target:'TEST55421',writes:false}));process.exit(0);}
const raw=sql(`begin;set local request.jwt.claim.sub=${quote(actor)};set local role authenticated;create temporary table phasea_bank_import(state text);${calls.join('\n')}select jsonb_build_object('created',count(*)filter(where state='created'),'preserved',count(*)filter(where state='preserved'))from phasea_bank_import;commit;`);
const counts=JSON.parse(raw.split('\n').find(line=>line.startsWith('{')));
const report={mode:'applied',receipts:calls.length,total:data.total,...counts,target:'TEST55421',confirmedThrough:through};
if(reportTarget)writeFileSync(reportTarget,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
