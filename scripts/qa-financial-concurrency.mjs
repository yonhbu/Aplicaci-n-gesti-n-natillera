// Deterministic synthetic concurrency proof. Never loads dotenv or touches another stack.
import {execFileSync,spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const container='supabase_db_natillera-manager-test';
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const sql=query=>execFileSync('docker',args,{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir','.supabase-test','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only isolated TEST 55421 is supported.');
const id=n=>'fc190000-0000-4000-8000-'+String(n).padStart(12,'0');
if(sql(`select count(*) from public.workspaces where id='${id(2)}'`)!=='0')throw Error('Proof already exists; refusing to duplicate fixtures. Inspect saved results.');
sql(`begin;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values('${id(1)}','authenticated','authenticated','qa-fin-concurrency-19@example.test','',now(),now(),now());
insert into public.workspaces(id,name) values('${id(2)}','QA FIN concurrency TEST 19');
insert into public.workspace_users(workspace_id,user_id,role) values('${id(2)}','${id(1)}','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values('${id(3)}','${id(2)}',2026,'QA concurrency','2026-01-01','2026-12-05','active','fin03-2026'),('${id(8)}','${id(2)}',2027,'QA receipt race','2027-01-01','2027-12-05','active','fin03-2026');
insert into public.members(id,workspace_id,display_name) values('${id(4)}','${id(2)}','QA concurrency borrower'),('${id(9)}','${id(2)}','QA receipt race');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values('${id(5)}','${id(2)}','${id(3)}','${id(4)}',100000,true,true),('${id(10)}','${id(2)}','${id(8)}','${id(9)}',100000,true,true);
set local role authenticated;set local request.jwt.claim.sub='${id(1)}';set local natillera.civil_today='2026-10-16';
select public.create_bank_account('${id(3)}','QA concurrent bank','','');
select public.record_bank_opening('${id(3)}',(select id from public.bank_accounts where workspace_id='${id(2)}' and display_name='QA concurrent bank'),'qa-concurrent-open','2026-08-01',1000000,'synthetic concurrency funding');
select public.record_internal_liquidity_transfer('${id(3)}','qa-concurrent-cash','2026-08-01','bank',(select id from public.bank_accounts where workspace_id='${id(2)}' and display_name='QA concurrent bank'),'cash',null,1000000,'synthetic concurrency cash');
select public.create_loan_contract('${id(3)}','qa-concurrent-loan','${id(4)}',null,null,60000,'amortized','EA',0.12,2,'2026-09-01');
select public.confirm_loan_disbursement((select id from public.loan_contracts where cycle_id='${id(3)}'),'qa-concurrent-disburse','2026-09-01');
select public.create_bank_account('${id(8)}','QA race bank','','');commit;`);
const loan=sql(`select id from public.loan_contracts where cycle_id='${id(3)}'`);
const prefix=`begin;set local role authenticated;set local request.jwt.claim.sub='${id(1)}';set local natillera.civil_today='2026-10-16';`;
function run(query){return new Promise(resolve=>{let stdout='',stderr='';const proc=spawn('docker',args,{stdio:['pipe','pipe','pipe']});proc.stdout.on('data',x=>stdout+=x);proc.stderr.on('data',x=>stderr+=x);proc.on('close',code=>resolve({code,stdout:stdout.trim(),error:stderr.split('\n').find(x=>x.startsWith('ERROR:'))??null}));proc.stdin.end(query);});}
const overlap=async(first,second)=>{const a=run(prefix+first+';select pg_sleep(0.8);commit;');await new Promise(resolve=>setTimeout(resolve,180));return Promise.all([a,run(prefix+second+';commit;')]);};
const payment=`select (public.record_loan_payment('${loan}','qa-concurrent-pay','2026-10-01',30000,29438.51,561.49,'regular')).id`;
const samePayment=await overlap(payment,payment);
if(samePayment.some(x=>x.code!==0)||sql(`select count(*) from public.loan_payments where workspace_id='${id(2)}' and idempotency_key='qa-concurrent-pay'`)!=='1')throw Error('Concurrent payment retry failed');
const withdraw=(key,amount)=>`select (public.withdraw_admin_payable('${id(3)}','${key}','2026-10-15',${amount},'synthetic concurrent withdrawal','cash',null)).id`;
const sameWithdrawal=await overlap(withdraw('qa-concurrent-withdraw',20),withdraw('qa-concurrent-withdraw',20));
if(sameWithdrawal.some(x=>x.code!==0)||sql(`select count(*) from public.financial_operations where workspace_id='${id(2)}' and idempotency_key='qa-concurrent-withdraw'`)!=='1')throw Error('Concurrent withdrawal retry failed');
const competingWithdrawals=await overlap(withdraw('qa-concurrent-race-a',25),withdraw('qa-concurrent-race-b',25));
if(competingWithdrawals.filter(x=>x.code===0).length!==1||!competingWithdrawals.some(x=>x.error?.includes('saldo libre')))throw Error('Concurrent withdrawals overdrew available fund');
const bank=sql(`select id from public.bank_accounts where workspace_id='${id(2)}' and display_name='QA race bank'`);
// First lock the cycle in the receipt transaction; a competing mode update must validate AFTER this commits.
const receiptRace=await overlap(`select 1 from public.cycles where id='${id(8)}' for update;select public.record_bank_interest_received('${id(8)}','${bank}','qa-concurrent-receipt','2027-01-02',1000,0,0,'synthetic receipt race')`,`select public.save_cycle_member('${id(2)}','${id(8)}','${id(9)}','${id(10)}','QA receipt race',null,100000,1,12,false,false)`);
if(receiptRace[0].code!==0||!receiptRace[1].error?.includes('La modalidad no se puede cambiar despues del primer abono Pibank'))throw Error('Member mode changed concurrently with frozen receipt');
const invariants=JSON.parse(sql(prefix+`select jsonb_build_object('payment_rows',(select count(*) from public.loan_payments where workspace_id='${id(2)}' and idempotency_key='qa-concurrent-pay'),'payment_applications',(select sum(capital_amount+interest_amount) from public.loan_payment_applications where loan_id='${loan}'),'admin_balance',(public.preview_admin_withdrawal('${id(3)}','2026-10-15')->>'admin_balance')::numeric,'frozen_rights',(select sum(amount) from public.bank_yield_rights where cycle_id='${id(8)}'),'member_mode',(select economic_mode from public.cycle_members where id='${id(10)}'),'unbalanced_operations',(select count(*) from (select operation_id from public.ledger_entries where workspace_id='${id(2)}' group by operation_id having sum(amount)<>0) x));commit;`).split('\n').find(line=>line.startsWith('{')));
if(invariants.admin_balance!==11.15||invariants.frozen_rights!==1000||invariants.payment_applications!==30000||invariants.unbalanced_operations!==0)throw Error('Concurrency invariant failure');
const compact=rows=>rows.map(({code,error})=>({code,error}));
const result={result:'PASS',sourceApi:status.API_URL,samePayment:compact(samePayment),sameWithdrawal:compact(sameWithdrawal),competingWithdrawals:compact(competingWithdrawals),receiptModeRace:compact(receiptRace),invariants};
writeFileSync('incoming/fin-qa-2026-10-16/concurrency-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));






