begin;
create extension if not exists pgtap;
select plan(8);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('f0040000-0000-4000-8000-000000000001','authenticated','authenticated','fin-qa004@example.test','',now(),now(),now());
insert into public.workspaces(id,name) values('f0040000-0000-4000-8000-000000000002','QA004 two cycles export');
insert into public.workspace_users(workspace_id,user_id,role) values('f0040000-0000-4000-8000-000000000002','f0040000-0000-4000-8000-000000000001','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status) values
('f0040000-0000-4000-8000-000000000003','f0040000-0000-4000-8000-000000000002',2025,'QA old cycle','2025-01-01','2025-12-05','archived'),
('f0040000-0000-4000-8000-000000000004','f0040000-0000-4000-8000-000000000002',2026,'QA current cycle','2026-01-01','2026-12-05','active');
insert into public.members(id,workspace_id,display_name) values
('f0040000-0000-4000-8000-000000000005','f0040000-0000-4000-8000-000000000002','QA current member'),
('f0040000-0000-4000-8000-000000000006','f0040000-0000-4000-8000-000000000002','QA member outside current UI');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota) values
('f0040000-0000-4000-8000-000000000007','f0040000-0000-4000-8000-000000000002','f0040000-0000-4000-8000-000000000004','f0040000-0000-4000-8000-000000000005',100000);
select is(array_length(public.natillera_backup_tables(),1),44,'recovery inventory includes reconciliation and statement comparisons');
select is(has_function_privilege('authenticated','public.restore_natillera_workspace(jsonb)','execute'),false,'browser role cannot execute privileged restore');
set local role authenticated;
set local request.jwt.claim.sub='f0040000-0000-4000-8000-000000000001';
create temporary table qa004_export as select public.export_natillera_backup('f0040000-0000-4000-8000-000000000002') b;
select is((select jsonb_array_length(b->'tables'->'cycles') from qa004_export),2,'snapshot exports both cycles, not only active UI cycle');
select is((select jsonb_array_length(b->'tables'->'members') from qa004_export),2,'member without current cycle membership is not lost');
select is((select jsonb_array_length(b->'tables'->'cycle_members') from qa004_export),1,'members and cycle memberships remain separate entities');
select is((select b ? 'auth' from qa004_export),false,'browser backup does not contain Auth credentials');
select throws_ok($$select public.export_natillera_backup('ffffffff-0000-4000-8000-000000000099')$$,'P0001','No tiene permiso sobre este workspace.','export is scoped to administered workspace');
reset role;
create table public.qa004_unregistered_test_table(id uuid);
set local role authenticated;
select throws_ok($$select public.export_natillera_backup('f0040000-0000-4000-8000-000000000002')$$,'P0001','Hay tablas nuevas fuera del inventario de recuperacion. Actualice el respaldo antes de descargar.','new table fails closed instead of silently omitting data');
select * from finish();
rollback;
