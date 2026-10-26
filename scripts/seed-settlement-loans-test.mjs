// Independent synthetic analogue. No dotenv, DEV or private inputs.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const runtime=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(runtime.API_URL!=='http://127.0.0.1:55421')throw Error('Solo TEST55421.');
const container='supabase_db_natillera-manager-test';
const ports=JSON.parse(execFileSync('docker',['inspect','--format','{{json .HostConfig.PortBindings}}',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(!ports['5432/tcp']?.some(p=>p.HostPort==='55422'))throw Error('Solo TEST55422.');
const prefix=crypto.randomUUID().slice(0,8),id=n=>prefix+'-0000-4000-8000-'+String(n).padStart(12,'0');
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:3e6}).trim();
let fixture=readFileSync('supabase/tests/database/settlement_loan_consistency_test.sql','utf8').split('grant select on p005,p013')[0]
 .replace('select no_plan();','').replaceAll('a5000000',prefix).replaceAll('fin-recon-edna@example.test','settlement-fixture-'+prefix+'@example.test').replaceAll('Synthetic completion','Synthetic completion '+prefix);
fixture+=`update public.members set display_name='Socio Sintético Liquidación'where id='${id(4)}';
update public.loan_contracts set legacy_id='SYN-C005',legacy_note='Préstamo consolidado sintético' where id=(select id from p005);
update public.loan_contracts set legacy_id='SYN-C013' where id=(select id from p013);
update public.bank_accounts set display_name='Pibank sintético',institution_name='Pibank'where workspace_id='${id(2)}';commit;`;
sql(fixture);
const email='qa-settlement-'+prefix+'@example.test';
const admin=createClient(runtime.API_URL,runtime.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const user=await admin.auth.admin.createUser({email,password:crypto.randomUUID(),email_confirm:true});
if(user.error)throw Error('No se pudo crear acceso sintetico.');
sql(`insert into public.workspace_users(workspace_id,user_id,role)values('${id(2)}','${user.data.user.id}','admin');`);
const loans=JSON.parse(sql(`select jsonb_object_agg(legacy_id,id)from public.loan_contracts where cycle_id='${id(3)}';`));
const bankId=sql(`select id from public.bank_accounts where workspace_id='${id(2)}';`);
mkdirSync('incoming/settlement-loans-2026-10-21',{recursive:true});
writeFileSync('incoming/settlement-loans-2026-10-21/fixture.json',JSON.stringify({email,workspaceId:id(2),cycleId:id(3),memberId:id(5),bankId,loans},null,2));
console.log('Fixture nuevo de liquidacion preparado solo en TEST55421/55422.');
