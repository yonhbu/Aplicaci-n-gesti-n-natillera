// Two genuinely concurrent TEST transactions. No credentials or dotenv files.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const container='supabase_db_natillera-manager-test';
const binding=JSON.parse(execFileSync('docker',['inspect','--format','{{json .HostConfig.PortBindings}}',container],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(!binding['5432/tcp']?.some(item=>item.HostPort==='55422'))throw Error('Concurrency tests require isolated TEST55422.');
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'];
const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true});
const prefix=crypto.randomUUID().slice(0,8),member=prefix+'-0000-4000-8000-000000000005',cycle=prefix+'-0000-4000-8000-000000000003';
const base=readFileSync('supabase/tests/database/settlement_completion_test.sql','utf8').split('create temp table first_quote')[0].replace('select no_plan();','').replaceAll('a2000000',prefix).replaceAll('completion-unit@example.test','concurrency-'+prefix+'@example.test').replaceAll('Synthetic completion','Concurrency '+prefix);
sql(base+'commit;');
const pre="begin;set local request.jwt.claim.sub='"+prefix+"-0000-4000-8000-000000000001';set local role authenticated;";

function concurrent(text){return new Promise(resolve=>{const child=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',v=>output+=v);child.on('close',code=>resolve({code,output:output.trim()}));child.stdin.end(text);});}
const bank=sql("select id from public.bank_accounts where workspace_id='"+prefix+"-0000-4000-8000-000000000002';").trim();
const receive=pre+"select(public.record_personal_funds('"+cycle+"','"+bank+"','personal-concurrent-in','2026-10-20',100,'in','Synthetic concurrent personal in','Synthetic evidence',true)).id;commit;";
const received=await Promise.all([concurrent(receive),concurrent(receive)]);
if(received.some(r=>r.code!==0)||received[0].output!==received[1].output)throw Error('Concurrent personal retry failed.');
const out=key=>pre+"select(public.record_personal_funds('"+cycle+"','"+bank+"','"+key+"','2026-10-20',80,'out','"+key+"','Synthetic evidence',true)).id;commit;";
const withdrawals=await Promise.all([concurrent(out('personal-concurrent-out-a')),concurrent(out('personal-concurrent-out-b'))]);
if(withdrawals.filter(r=>r.code===0).length!==1)throw Error('Concurrent excess withdrawal guard failed.');
const balance=sql("select sum(amount) from public.ledger_entries where cycle_id='"+cycle+"'and account='personal_bank_cash';").trim();
const count=sql("select count(*) from public.financial_operations where cycle_id='"+cycle+"'and operation_type='personal_funds_received';").trim();
if(Number(balance)!==20||count!=='1')throw Error('Concurrent personal funds duplicated or overdrew.');
console.log(JSON.stringify({target:'TEST55422',parallelIdenticalReceipts:2,receiptsPersisted:1,parallelWithdrawals:2,withdrawalsPersisted:1,remainingPersonal:20}));
