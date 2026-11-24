import seed from './seed-polla-audit.mjs';
import {auditSql} from './lib/audit-test-runtime.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const f=await seed(),id=f.ids,a=f.activities;
const award=(key,winner,token,gross=100000)=>`select public.award_polla_prize_to_capital('${a[key]}','${id[winner]}','${token}',${gross},'2026-11-20')`;
const prize=token=>`(select id from public.polla_prizes where cycle_id='${f.cycleId}' and idempotency_key='${token}')`;
let assertions=[];
function equal(sql,expected,label){assertions.push(`select is((${sql}),${expected},'${label}');`);}
function fails(sql,label){assertions.push(`select throws_ok($test$${sql}$test$,'P0001',null,'${label}');`);}
function works(sql,label){assertions.push(`select lives_ok($test$${sql}$test$,'${label}');`);}
equal(`select count(*) from public.polla_activities where id in ('${a.marzoA}','${a.marzoB}') and period_month=3`,'2::bigint','Dos UUID independientes de marzo');
for(const key of ['marzoA','marzoB','mayo','octubre']){
 equal(`select sum(amount) from public.polla_contributions where activity_id='${a[key]}' and status='posted'`,'100000::numeric',key+' recauda cien mil');
 equal(`select count(distinct operation_id) from public.polla_contributions where activity_id='${a[key]}' and status='posted'`,'10::bigint',key+' tiene diez operaciones distintas');
}
fails(`select public.register_polla_contribution('${a.octubre}','${id[0]}','sql-duplicate-oct',10000,'2026-10-20')`,'Rechazo correcto del aporte duplicado');
equal(`select count(*) from public.financial_operations where cycle_id='${f.cycleId}' and idempotency_key='sql-duplicate-oct'`,'0::bigint','Duplicado no crea operación');
fails(award('parcial',12,'sql-partial-winner',10000),'Aporte parcial no permite ganar');
fails(`select public.register_polla_contribution('${a.noviembre}','${id[1]}','sql-retired-new',10000,'2026-11-20')`,'Retirada no recibe obligación nueva posterior');
works(award('mayo',0,'sql-valid-award'),'Asignación válida se acredita atómicamente');
equal(`select count(*) from public.polla_prizes where activity_id='${a.mayo}'`,'1::bigint','Un solo premio');
equal(`select sum(admin_commission) from public.polla_prizes where activity_id='${a.mayo}'`,'5000::numeric','Comisión exacta');
equal(`select sum(amount) from public.member_capital_credits where prize_id=${prize('sql-valid-award')}`,'95000::numeric','Capital neto exacto');
equal(`select sum(amount) from public.ledger_entries where cycle_id='${f.cycleId}' and account='polla_pool' and polla_activity_id='${a.mayo}'`,'0::numeric','Bolsa de mayo conciliada');
works(award('mayo',0,'sql-valid-award'),'Reintento idéntico devuelve el premio');
equal(`select count(*) from public.polla_prizes where activity_id='${a.mayo}'`,'1::bigint','Reintento no duplica premio');
fails(award('mayo',3,'sql-valid-award'),'La misma clave no cambia ganador');
fails(award('mayo',3,'sql-new-key-duplicate'),'Otra clave no duplica una actividad premiada');
works(award('marzoA',1,'sql-retired-award'),'Retirada mantiene derecho de marzo');
equal(`select status from public.polla_prizes where id=${prize('sql-retired-award')}`,"'pending_payment'::text",'Premio no reabre capital liquidado');
equal(`select count(*) from public.member_capital_credits where prize_id=${prize('sql-retired-award')}`,'0::bigint','No hay crédito al ahorro cerrado');
works(`select public.pay_polla_prize(${prize('sql-retired-award')},'sql-retired-delivery','2026-11-21','bank','${f.bankId}')`,'Entrega posterior autorizada separada');
equal(`select sum(amount) from public.polla_prize_payments where prize_id=${prize('sql-retired-award')} and status='posted'`,'95000::numeric','Una entrega neta exacta');
fails(`select public.pay_polla_prize(${prize('sql-retired-award')},'sql-retired-delivery-duplicate','2026-11-21','bank','${f.bankId}')`,'No se duplica el pago posterior');
fails(`select public.reverse_polla_prize(${prize('sql-retired-award')},'sql-invalid-reverse','2026-11-22','Ensayo sintético')`,'Liquidación dependiente bloquea reverso separado');
works(`select public.reverse_polla_prize(${prize('sql-valid-award')},'sql-prize-reverse','2026-11-22','Corrección sintética')`,'Reverso válido restaura bolsa y crédito');
equal(`select sum(amount) from public.ledger_entries where cycle_id='${f.cycleId}' and account='polla_pool' and polla_activity_id='${a.mayo}'`,'-100000::numeric','Bolsa restaurada');
equal(`select count(*) from public.member_capital_credits where prize_id=${prize('sql-valid-award')} and reversed_at is not null`,'1::bigint','Crédito conserva su traza de reverso');
fails(`select public.register_polla_contribution('${a.cancelada}','${id[0]}','sql-cancelled',10000,'2026-11-20')`,'Actividad cancelada rechaza nuevos aportes');
equal(`select count(*) from public.polla_activities where id='${a.cancelada}' and cancelled_at is not null`,'1::bigint','Cancelada permanece registrada');
equal(`select count(*) from (select operation_id from public.ledger_entries where cycle_id='${f.cycleId}' group by operation_id having sum(amount)<>0) x`,'0::bigint','Todas las operaciones equilibradas');
const sql=`begin;create extension if not exists pgtap;select plan(${assertions.length});set local role authenticated;select set_config('request.jwt.claim.sub','${f.adminId}',true);${assertions.join('\n')}
 select * from finish();rollback;`;
const output=auditSql(sql),lines=output.split(/\r?\n/),checks=lines.filter(l=>/^(?:not )?ok \d+/.test(l));
mkdirSync('incoming/polla-audit',{recursive:true});writeFileSync('incoming/polla-audit/sql-results.txt',output);
const pass=checks.length===assertions.length&&!checks.some(l=>l.startsWith('not ok'));
console.log(`Polla SQL: ${checks.filter(l=>l.startsWith('ok ')).length}/${assertions.length} aserciones; transacción revertida.`);
if(!pass){console.error(lines.filter(l=>l.startsWith('not ok')||l.startsWith('#')).join('\n'));process.exitCode=1;}
// Inspect undefined gross/pool policy under rollback; this is not an acceptance assertion.
const probe=auditSql(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${f.adminId}',true);
 ${award('marzoB',0,'sql-policy-probe',200000)};
 select json_build_object('policy_probe','gross_above_activity_receipts','gross',200000,'collected',100000,'pool_after',(select sum(amount) from public.ledger_entries where cycle_id='${f.cycleId}' and polla_activity_id='${a.marzoB}' and account='polla_pool'));
 rollback;`);
const result=probe.split('\n').find(l=>l.startsWith('{')&&l.includes('policy_probe'));writeFileSync('incoming/polla-audit/policy-probe.json',result??'{}');
