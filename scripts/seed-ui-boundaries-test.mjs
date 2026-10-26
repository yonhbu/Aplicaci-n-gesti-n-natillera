// Synthetic UI boundary fixtures, in isolated local TEST only. Does not load dotenv.
import {execFileSync} from 'node:child_process';
const runtime=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(runtime.API_URL!=='http://127.0.0.1:55421')throw Error('Only TEST55421');
const sql=query=>{try{return execFileSync('docker',['exec','-i','supabase_db_natillera-manager-test','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}catch(e){throw Error(String(e.stderr).split('\n').filter(x=>x.startsWith('ERROR:')).join('\n'));}};
function provisionFixtureIdentity(userId,email){
  sql(`begin;update auth.users set instance_id='00000000-0000-0000-0000-000000000000',raw_app_meta_data='{"provider":"email","providers":["email"]}',raw_user_meta_data='{}',confirmation_token='',recovery_token='',email_change_token_new='',email_change='',email_change_token_current='',reauthentication_token='',phone_change='',phone_change_token='',is_sso_user=false,is_anonymous=false where id='${userId}' and email='${email}';
    insert into auth.identities(user_id,provider_id,identity_data,provider,created_at,updated_at) values('${userId}','${userId}',jsonb_build_object('sub','${userId}','email','${email}','email_verified',true),'email',now(),now()) on conflict(provider_id,provider) do nothing;commit;`);
}
function provisionPaymentSubjects(id){
  sql(`begin;update public.members set display_name=case id when '${id(104)}' then 'QA Pago desktop' else 'QA Pago mobile' end where id in ('${id(104)}','${id(105)}');
    set local role authenticated;set local request.jwt.claim.sub='${id(1)}';
    select public.register_savings_contribution('${id(204)}','qa-ux-saving-pay-desktop',200000,'2026-09-01',2026,9,'bank_transfer','manual') where not exists(select 1 from public.savings_contributions where workspace_id='${id(2)}' and idempotency_key='qa-ux-saving-pay-desktop');
    select public.register_savings_contribution('${id(205)}','qa-ux-saving-pay-mobile',200000,'2026-09-01',2026,9,'bank_transfer','manual') where not exists(select 1 from public.savings_contributions where workspace_id='${id(2)}' and idempotency_key='qa-ux-saving-pay-mobile');
    select public.create_bank_account('${id(3)}','QA Sin saldo','','') where not exists(select 1 from public.bank_accounts where workspace_id='${id(2)}' and display_name='QA Sin saldo');
    commit;`);
}
for(const [prefix,kind,email] of [['f4160000','automatic','qa-ux-cortes@example.test'],['f4170000','manual','qa-ux-manual@example.test']]){
  const id=n=>prefix+'-0000-4000-8000-'+String(n).padStart(12,'0');
  if(sql(`select count(*) from public.workspaces where id='${id(2)}'`)==='1'){provisionFixtureIdentity(id(1),email);provisionPaymentSubjects(id);console.log('Existing synthetic boundary fixture: '+kind);continue;}
  let q=`begin;
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values('${id(1)}','authenticated','authenticated','${email}','',now(),now(),now());
    insert into public.workspaces(id,name) values('${id(2)}','QA UX boundaries ${kind}');
    insert into public.workspace_users(workspace_id,user_id,role) values('${id(2)}','${id(1)}','admin');
    insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values('${id(3)}','${id(2)}',2026,'QA cortes 2026','2026-01-01','2026-12-05','active',${kind==='automatic'?"'fin03-2026'":'null'});`;
  for(let n=0;n<14;n++){
    const name=['QA Liquidación detallada','QA Neto positivo','QA Sin aportes','QA Solo ahorro'][n]??'QA Participante '+n;
    q+=`insert into public.members(id,workspace_id,display_name) values('${id(100+n)}','${id(2)}','${name}');
      insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values('${id(200+n)}','${id(2)}','${id(3)}','${id(100+n)}',100000,${n!==3},${n!==3});`;
  }
  q+=`set local role authenticated;set local request.jwt.claim.sub='${id(1)}';
    select public.create_bank_account('${id(3)}','QA Cuenta principal','','');
    select public.record_bank_opening('${id(3)}',(select id from public.bank_accounts where workspace_id='${id(2)}'),'qa-ux-opening','2026-01-01',4000000,'Synthetic boundary funding');
    select public.record_internal_liquidity_transfer('${id(3)}','qa-ux-fund-cash','2026-01-01','bank',(select id from public.bank_accounts where workspace_id='${id(2)}'),'cash',null,2000000,'Synthetic boundary cash');
    select public.register_savings_contribution('${id(200)}','qa-ux-saving-a',1000000,'2026-09-01',2026,9,'bank_transfer','manual');
    select public.register_savings_contribution('${id(201)}','qa-ux-saving-b',200000,'2026-09-01',2026,9,'bank_transfer','manual');
    select public.register_savings_contribution('${id(203)}','qa-ux-saving-fixed',100000,'2026-09-01',2026,9,'bank_transfer','manual');
    select public.create_loan_contract('${id(3)}','qa-ux-loan-p013','${id(100)}',null,null,500000,'fixed_interest','MONTHLY_FIXED',0.05,3,'2026-09-06');
    select public.set_loan_settlement_agreement((select id from public.loan_contracts where workspace_id='${id(2)}' and idempotency_key='qa-ux-loan-p013'),'P013_FIRST_MONTH');
    select public.confirm_loan_disbursement((select id from public.loan_contracts where workspace_id='${id(2)}' and idempotency_key='qa-ux-loan-p013'),'qa-ux-disburse-p013','2026-09-06');
    select public.create_loan_contract('${id(3)}','qa-ux-loan-other','${id(100)}',null,null,549506,'fixed_interest','MONTHLY_FIXED',0,1,'2026-09-06');
    select public.confirm_loan_disbursement((select id from public.loan_contracts where workspace_id='${id(2)}' and idempotency_key='qa-ux-loan-other'),'qa-ux-disburse-other','2026-09-06');
    select public.create_loan_contract('${id(3)}','qa-ux-loan-draft',null,'QA Borrador',null,100000,'fixed_interest','MONTHLY_FIXED',0,1,'2026-10-01');`;
  // 13 collective participants, $130.000 per activity. Two prizes credited on adjacent days total $135.000.
  for(const [month,name,winner,gross,day,capital] of [[7,'QA Premio septiembre',200,105000,'2026-10-10',true],[8,'QA Premio octubre',200,40000,'2026-10-11',true],[9,'QA Premio pendiente',201,50000,'2026-10-12',false]]){
    q+=`select public.create_polla_activity('${id(3)}',2026,${month},'${name}');`;
    for(let n=0;n<14;n++)if(n!==3)q+=`select public.register_polla_contribution((select id from public.polla_activities where cycle_id='${id(3)}' and name='${name}'),'${id(200+n)}','qa-ux-polla-${month}-${n}',10000,'2026-${String(month).padStart(2,'0')}-05');`;
    q+=`select public.${capital?'award_polla_prize_to_capital':'award_polla_prize'}((select id from public.polla_activities where cycle_id='${id(3)}' and name='${name}'),'${id(winner)}','qa-ux-award-${month}',${gross},'${day}');`;
  }
  q+=`reset role;
    update public.loan_contracts set legacy_id=case idempotency_key when 'qa-ux-loan-p013' then 'QA-P013' when 'qa-ux-loan-other' then 'QA-P005' else 'QA-DRAFT' end,legacy_note='Contrato sintético de límites' where workspace_id='${id(2)}';
    commit;`;
  sql(q);provisionFixtureIdentity(id(1),email);provisionPaymentSubjects(id);console.log('Created synthetic boundary fixture: '+kind+' / '+email);
}
