// Isolated synthetic fixtures. Never opens dotenv or modifies DEV.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Solo TEST55421.');
const binding=JSON.parse(execFileSync('docker',['inspect','--format','{{json .HostConfig.PortBindings}}','supabase_db_natillera-manager-test'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(!binding['5432/tcp']?.some(p=>p.HostPort==='55422'))throw Error('La base no corresponde a TEST55422.');
const prefix=crypto.randomUUID().slice(0,8);
const cycleId=prefix+'-0000-4000-8000-000000000003',workspaceId=prefix+'-0000-4000-8000-000000000002',memberId=prefix+'-0000-4000-8000-000000000005';
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_natillera-manager-test','psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true});
const setup=readFileSync('supabase/tests/database/settlement_completion_test.sql','utf8').split('create temp table first_quote')[0].replace('select no_plan();','').replaceAll('a2000000',prefix).replaceAll('completion-unit@example.test','completion-fixture-'+prefix+'@example.test').replaceAll('Synthetic completion','Synthetic completion '+prefix);
sql(setup
  +"select public.locate_unknown_liquidity('"+cycleId+"','fin-recon-source-location','2026-10-01','cash',null,69932.72,'Synthetic savings location verified');"
  +"select public.record_internal_liquidity_transfer('"+cycleId+"','fin-recon-source-transfer','2026-10-01','cash',null,'bank',(select id from public.bank_accounts where workspace_id='"+workspaceId+"'),1000,'Synthetic transfer of received savings');"
  +"create temporary table browser_loan as select id from public.create_loan_contract('"+cycleId+"','browser-location-loan',null,'Synthetic bank destination',null,1000,'fixed_interest','MONTHLY_FIXED',0.01,2,'2026-10-01'); select public.confirm_loan_disbursement((select id from browser_loan),'browser-location-disbursement','2026-10-01');commit;");
const admin=createClient(status.API_URL,status.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email='qa-fin-recon-'+prefix+'@example.test';
const result=await admin.auth.admin.createUser({email,password:crypto.randomUUID(),email_confirm:true});
if(result.error)throw Error('No se pudo aprovisionar el acceso sintetico.');
sql("insert into public.workspace_users(workspace_id,user_id,role)values('"+workspaceId+"','"+result.data.user.id+"','admin');");
mkdirSync('incoming/fin-recon-2026-10-20',{recursive:true});
writeFileSync('incoming/fin-recon-2026-10-20/fixture.json',JSON.stringify({cycleId,workspaceId,memberId,email},null,2));
console.log('TEST55421: fixture sintetico de cuenta final preparado.');
