// Exact monetary shape supplied by the administrator, with new synthetic identities only.
import seed from './seed-polla-audit.mjs';
import {auditSql} from './lib/audit-test-runtime.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
const f=await seed(),w=crypto.randomUUID(),c=crypto.randomUUID();
const members=Array.from({length:10},()=>({id:crypto.randomUUID(),member:crypto.randomUUID()}));
const activities=Object.fromEntries([5,6,7,8,9,10,11].map(m=>[m,crypto.randomUUID()])),cancelled=crypto.randomUUID();
let sql=`begin;create extension if not exists pgtap;select plan(9);
insert into public.workspaces(id,name) values('${w}','Matriz Polla TEST sintética');
insert into public.workspace_users(workspace_id,user_id,role) values('${w}','${f.adminId}','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values('${c}','${w}',2026,'Matriz sintética 2026','2026-01-01','2026-12-05','active','fin03-2026');
select set_config('request.jwt.claim.sub','${f.adminId}',true);`;
for(const [i,m] of members.entries())sql+=`insert into public.members(id,workspace_id,display_name)values('${m.member}','${w}','Participante sintético ${i}');insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla)values('${m.id}','${w}','${c}','${m.member}',100000,true);`;
for(const [month,id] of Object.entries(activities))sql+=`insert into public.polla_activities(id,workspace_id,cycle_id,period_year,period_month,name)values('${id}','${w}','${c}',2026,${month},'Actividad sintética ${month}');`;
for(const month of [5,6,7,8,9]){
 const a=activities[month],key='matrix-collective-'+month;
 sql+=`insert into public.polla_contributions(workspace_id,cycle_id,activity_id,operation_id,idempotency_key,cycle_member_id,amount,paid_date,legacy_collective)
 select '${w}','${c}','${a}',id,'${key}',null,100000,'2026-0${month}-10',true from public.create_b_operation('${w}','${c}','${key}','polla_contribution','2026-0${month}-10','polla_activities','${a}','{}',jsonb_build_array(jsonb_build_object('account','cash','amount',100000,'polla_activity_id','${a}'),jsonb_build_object('account','polla_pool','amount',-100000,'polla_activity_id','${a}')));`;
}
sql+=`insert into public.polla_activities(id,workspace_id,cycle_id,period_year,period_month,name)values('${cancelled}','${w}','${c}',2026,5,'Cancelada sintética');set local role authenticated;`;
for(const month of [10,11])for(const [i,m] of members.slice(0,month===10?10:8).entries())sql+=`select public.register_polla_contribution('${activities[month]}','${m.id}','matrix-individual-${month}-${i}',10000,'2026-${month}-01');`;
sql+=`select public.cancel_polla_activity('${cancelled}','matrix-cancelled','Cancelación sintética sin movimientos');
select public.award_polla_prize_to_capital('${activities[11]}','${members[0].id}','matrix-november-prize',50000,'2026-11-20');
select is((select sum(amount) from public.polla_contributions where cycle_id='${c}' and status='posted'),680000::numeric,'Recaudo sintético total 680000');
select is((select sum(gross_amount) from public.polla_prizes where cycle_id='${c}'),50000::numeric,'Premio noviembre 50000');
select is((public.polla_reconciliation_matrix('${c}')->>'cycle_ledger_pool')::numeric,630000::numeric,'Bolsa 630000 comprobada contra ledger TEST');
select is((public.polla_reconciliation_matrix('${c}')->>'unassigned_or_other_year_pool')::numeric,0::numeric,'Sin bolsas no identificadas en el modelo sintético');
select ok(not exists(select 1 from public.polla_activities where cycle_id='${c}' and period_month in(1,2,3,4,12)),'No fabrica enero-abril ni diciembre');
create temporary table matrix_before as select (select jsonb_agg(to_jsonb(l) order by id)from public.ledger_entries l where cycle_id='${c}') ledger,(select jsonb_agg(to_jsonb(p) order by id)from public.polla_prizes p where cycle_id='${c}') prizes;`;
for(const month of [5,6,7,8,9]){
 const a=activities[month];
 const rows=JSON.stringify(members.map(m=>({cycle_member_id:m.id,contribution_id:null,amount:10000,eligible_on:`2026-0${month}-10`,evidence:'Respaldo sintético por persona '+m.id})));
 sql+=`select public.confirm_polla_historical_rights('${a}',q.rows,public.preview_polla_historical_rights('${a}',q.rows)->>'preview_hash','matrix-rights-${month}') from (select jsonb_agg(x||jsonb_build_object('contribution_id',(select id from public.polla_contributions where activity_id='${a}'))) rows from jsonb_array_elements('${rows}'::jsonb)x)q;`;
}
sql+=`select is((select count(*)from public.polla_historical_rights where workspace_id='${w}'),50::bigint,'Cinco colectivos atribuyen cincuenta derechos sin nuevos aportes');
select ok((select jsonb_agg(to_jsonb(l) order by id)from public.ledger_entries l where cycle_id='${c}')=(select ledger from matrix_before),'Libro entero idéntico después de atribuir');
select ok((select jsonb_agg(to_jsonb(p) order by id)from public.polla_prizes p where cycle_id='${c}')=(select prizes from matrix_before),'Premio noviembre idéntico');
select is((public.polla_reconciliation_matrix('${c}')->>'cycle_ledger_pool')::numeric,630000::numeric,'Bolsa permanece 630000');
select * from finish();rollback;`;
const output=auditSql(sql);mkdirSync('incoming/polla-history',{recursive:true});writeFileSync('incoming/polla-history/matrix-test.txt',output);
if(output.includes('not ok')||output.split('\n').filter(x=>/^ok \d+/.test(x)).length!==9)throw Error('Falló matriz monetaria sintética; revisar evidencia TEST.');
console.log('PASS: 9 controles del modelo sintético 680000 - 50000 = 630000; rollback completo. No es una consulta productiva.');
