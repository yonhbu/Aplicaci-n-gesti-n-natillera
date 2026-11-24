import {createClient} from '@supabase/supabase-js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {auditRuntime,auditSql} from './lib/audit-test-runtime.mjs';

// Only synthetic workspaces, guarded TEST; no dotenv or source data imports.
export default async function seedPollaAudit(){
 const runtime=auditRuntime(),admin=createClient(runtime.API_URL,runtime.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const suffix=crypto.randomUUID().slice(0,8),email=`polla-audit-${suffix}@example.test`,outsiderEmail=`polla-outsider-${suffix}@example.test`;
 const {data,error}=await admin.auth.admin.createUser({email,email_confirm:true});if(error)throw Error('No se pudo preparar el administrador sintético TEST.');
 const outsider=await admin.auth.admin.createUser({email:outsiderEmail,email_confirm:true});if(outsider.error)throw Error('No se pudo preparar identidad sintética sin membresía.');
 const workspaceId=crypto.randomUUID(),cycleId=crypto.randomUUID(),ids=Array.from({length:16},()=>crypto.randomUUID()),members=ids.map(()=>crypto.randomUUID());
 const names=['Activa Ana','Retirada Junio','Retirada Mayo','Activa Dora','Activo Elio','Activa Fabi','Activo Gabo','Activa Hana','Activo Ivo','Activa Julia','Activo Kiro','Activa Luna','Retirada Parcial','Ahorro B','Retiro sin fecha','Ingreso Septiembre'];
 const activities=Object.fromEntries(['marzoA','marzoB','mayo','octubre','noviembre','parcial','cancelada','colectiva'].map(k=>[k,crypto.randomUUID()]));
 const activityRows=[['marzoA',3,'Marzo A'],['marzoB',3,'Marzo B'],['mayo',5,'Mayo'],['octubre',10,'Octubre'],['noviembre',11,'Noviembre'],['parcial',3,'Marzo pendiente'],['cancelada',3,'Marzo cancelada'],['colectiva',3,'Marzo colectivo']];
 let sql=`begin;insert into public.workspaces(id,name) values('${workspaceId}','Polla sintética ${suffix}');
 insert into public.workspace_users(workspace_id,user_id,role) values('${workspaceId}','${data.user.id}','admin');
 insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values('${cycleId}','${workspaceId}',2026,'Polla auditoría sintética','2026-01-01','2026-12-05','active','fin03-2026');`;
 for(let i=0;i<ids.length;i++)sql+=`insert into public.members(id,workspace_id,display_name)values('${members[i]}','${workspaceId}','${names[i]}');
 insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit,participation_start_month) values('${ids[i]}','${workspaceId}','${cycleId}','${members[i]}',100000,${i!==13&&i!==15},${i!==13&&i!==15},${i===15?9:1});`;
 for(const [key,month,name] of activityRows)sql+=`insert into public.polla_activities(id,workspace_id,cycle_id,period_year,period_month,name)values('${activities[key]}','${workspaceId}','${cycleId}',2026,${month},'${name}');`;
 sql+=`set local role authenticated;select set_config('request.jwt.claim.sub','${data.user.id}',true);
 select public.create_bank_account('${cycleId}','Pibank Polla sintético','Pibank','TEST_ONLY');
 select public.record_bank_opening('${cycleId}',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'polla-opening','2026-01-01',1000000,'Fondeo sintético');`;
 for(const i of [1,2,12])sql+=`select public.register_savings_contribution('${ids[i]}','polla-savings-${i}',100000,'2026-02-01',2026,2,'cash','manual');`;
 // Activity creation itself goes through the administrator RPC in browser scenarios.
 for(const key of ['marzoA','marzoB','mayo','octubre'])for(const i of key==='octubre'?[0,3,4,5,6,7,8,9,10,11]:[0,1,2,3,4,5,6,7,8,9]){
  const date=key.startsWith('marzo')?'2026-03-10':key==='mayo'?'2026-05-10':'2026-10-10';
  sql+=`select public.register_polla_contribution('${activities[key]}','${ids[i]}','seed-${key}-${i}',10000,'${date}');`;
 }
 sql+=`select public.register_polla_contribution('${activities.parcial}','${ids[12]}','seed-partial',5000,'2026-03-10');`;
 for(const [i,date] of [[1,'2026-06-15'],[2,'2026-05-15'],[12,'2026-06-15']])sql+=`select public.confirm_member_settlement('${ids[i]}','seed-retire-${i}','${date}',0,0,0,public.preview_member_settlement('${ids[i]}','${date}',0,0,0)->>'preview_hash');`;
 sql+=`select public.pay_member_settlement((select id from public.member_settlements where cycle_member_id='${ids[1]}'),'seed-paid-retire','2026-06-16','bank',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'Pago sintético de liquidación');
 select public.cancel_polla_activity('${activities.cancelada}','seed-cancel-activity','Cancelación sintética sin movimientos');
 reset role;
 create temporary table collective_op as select id from public.create_b_operation('${workspaceId}','${cycleId}','seed-collective','polla_contribution','2026-03-10','polla_activities','${activities.colectiva}',jsonb_build_object('synthetic',true),jsonb_build_array(jsonb_build_object('account','cash','amount',100000,'polla_activity_id','${activities.colectiva}'),jsonb_build_object('account','polla_pool','amount',-100000,'polla_activity_id','${activities.colectiva}')));
 reset role;
 insert into public.polla_contributions(workspace_id,cycle_id,activity_id,cycle_member_id,operation_id,idempotency_key,amount,paid_date,legacy_collective,legacy_id)values('${workspaceId}','${cycleId}','${activities.colectiva}',null,(select id from collective_op),'seed-collective',100000,'2026-03-10',true,'TEST_ONLY_COLLECTIVE');
 update public.cycle_members set savings_status='withdrawn' where id='${ids[14]}';
 commit;`;
 auditSql(sql);
 const fixture={workspaceId,cycleId,email,outsiderEmail,adminId:data.user.id,outsiderId:outsider.data.user.id,ids,members,names,activities,today:auditSql('select public.fin_civil_today();'),bankId:auditSql(`select id from public.bank_accounts where workspace_id='${workspaceId}';`)};
 mkdirSync('incoming/polla-audit',{recursive:true});writeFileSync('incoming/polla-audit/fixture.json',JSON.stringify(fixture,null,2));
 console.log('Polla: escenarios sintéticos creados exclusivamente en TEST55421/55422.');return fixture;
}
if(process.argv[1]?.endsWith('seed-polla-audit.mjs'))await seedPollaAudit();
