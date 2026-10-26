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
const hash=sql(pre+"select public.preview_member_settlement('"+member+"','2026-10-20',0,0,0)->>'preview_hash';rollback;").trim();
const receipt=pre+"select(public.record_settlement_completion('"+member+"','concurrent-same-key','2026-10-20',10,(select id from public.bank_accounts where workspace_id='"+prefix+"-0000-4000-8000-000000000002'),'Synthetic concurrent receipt','2026-10-20',0,0,0,'"+hash+"')).id;commit;";
function concurrent(text){return new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';
  child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
  child.on('error',reject);child.on('close',code=>code===0?resolve(stdout.trim()):reject(Error(stderr)));
  child.stdin.end(text);
});}
const results=await Promise.all([concurrent(receipt),concurrent(receipt)]);
if(results[0]!==results[1])throw Error('Concurrent retry returned different operations.');
const count=Number(sql("select count(*)from public.financial_operations where cycle_id='"+cycle+"'and operation_type='member_settlement_completion';").trim());
if(count!==1)throw Error('Concurrent retry duplicated receipt.');
const balanced=sql("select count(*)from(select operation_id from public.ledger_entries where cycle_id='"+cycle+"'group by operation_id having sum(amount)<>0)t;").trim();
if(balanced!=='0')throw Error('Concurrent receipt unbalanced.');
console.log(JSON.stringify({target:'TEST55422',concurrentRequests:2,sameOperation:true,receipts:count,unbalancedOperations:0}));
