// Separate synthetic workspace, guarded TEST API and database. No dotenv, reset or DEV writes.
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Solo TEST55421.');
const container='supabase_db_natillera-manager-test',binding=JSON.parse(execFileSync('docker',['inspect','--format','{{json .HostConfig.PortBindings}}',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
if(!binding['5432/tcp']?.some(p=>p.HostPort==='55422'))throw Error('Solo TEST55422.');
const prefix=crypto.randomUUID().slice(0,8);
const id=(kind,n=1)=>prefix+'-0000-4000-8'+kind+'00-'+String(n).padStart(12,'0');
const cycleId=id(2),workspaceId=id(1),memberId=id(4),email='qa-ux16-'+prefix+'@example.test';
const run=input=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true});
let setup=readFileSync('supabase/tests/database/fin05_loan_profit_periods_test.sql','utf8').split('select is(')[0].replace('select plan(22);','');
for(const[kind,group]of ['09500000','19500000','29500000','39500000','49500000'].entries())setup=setup.replaceAll(group+'-0000-0000-0000-',prefix+'-0000-4000-8'+kind+'00-');
setup=setup.replaceAll('fin05-admin@example.test','seed-ux16-'+prefix+'@example.test').replaceAll('Ciclo FIN05','Natillera UX16 sintética').replace("'fin05-s3', 1000000, '2026-02-05', 2026, 2","'fin05-s3', 1000000, '2026-08-05', 2026, 8");
// Set participation BEFORE collecting; the template's B member is only an isolated scenario.
setup=setup.replace("set local role authenticated;",`update public.cycle_members set participation_start_month=7 where id='${id(4,3)}';
set local role authenticated;`);
const extra=`
select public.confirm_member_settlement('${id(4)}','ux16-retire-annie','2026-09-15',0,0,0,public.preview_member_settlement('${id(4)}','2026-09-15',0,0,0)->>'preview_hash');
select public.record_loan_payment((select id from public.loan_contracts where cycle_id='${cycleId}'),'ux16-later-interest','2026-10-01',50000,0,50000,'regular');
select public.register_savings_contribution('${id(4,2)}','ux16-advance',100000,'2026-10-05',2026,12,'cash','manual');
select public.create_bank_account('${cycleId}','Pibank sintético UX16','Pibank','');
select public.record_bank_interest_received('${cycleId}',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'ux16-bank','2026-10-10',1000,0,0,'Synthetic bank receipt');
commit;`;
try{run(setup+extra)}catch(e){console.error(String(e.stderr??'Error TEST').slice(-1200));process.exit(1)}
const admin=createClient(status.API_URL,status.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const result=await admin.auth.admin.createUser({email,password:crypto.randomUUID(),email_confirm:true});if(result.error)throw Error('No se pudo crear acceso sintetico.');
run(`insert into public.workspace_users(workspace_id,user_id,role)values('${workspaceId}','${result.data.user.id}','admin');`);
mkdirSync('incoming/ux16/scenarios',{recursive:true});writeFileSync('incoming/ux16/scenarios/fixture.json',JSON.stringify({cycleId,workspaceId,memberId,email,fixedMemberId:id(4,3),activeMemberId:id(4,2)},null,2));
console.log('UX16: workspace adicional sintetico creado en TEST55422.');
