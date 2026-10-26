begin;
create extension if not exists pgtap;
select no_plan();
set local natillera.civil_today='2026-10-20';
insert into auth.users(id,aud,role,email,created_at,updated_at)
values('a3000000-0000-4000-8000-000000000001','authenticated','authenticated','fin-recon-unit@example.test',now(),now());
insert into public.workspaces(id,name) values('a3000000-0000-4000-8000-000000000002','Synthetic completion');
insert into public.workspace_users(workspace_id,user_id,role)
values('a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version)
values('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000002',2026,'Synthetic completion','2026-01-01','2026-12-05','active','fin03-2026');
insert into public.members(id,workspace_id,display_name)
values('a3000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000002','Completion synthetic');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla)
values('a3000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000004',70000,true);
set local request.jwt.claim.sub='a3000000-0000-4000-8000-000000000001';
select public.create_bank_account('a3000000-0000-4000-8000-000000000003','Synthetic completion bank','','');
select public.register_savings_contribution('a3000000-0000-4000-8000-000000000005','completion-saving',69932.72,'2026-10-01',2026,10,'cash','manual');
set local role authenticated;
select lives_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-in','2026-10-01',320.45,'in','personal-in','Synthetic documented movement',true)$$,'documented personal receipt succeeds');
select is((select sum(amount)from public.ledger_entries where cycle_id='a3000000-0000-4000-8000-000000000003'and account='personal_bank_cash'),320.45::numeric,'personal asset tracked separately');
select is(public.cash_available_at('a3000000-0000-4000-8000-000000000003','2026-10-20','bank',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002')),0::numeric,'personal money never funds collective spending');
select lives_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-in','2026-10-01',320.45,'in','personal-in','Synthetic documented movement',true)$$,'exact idempotent personal retry');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-in','2026-10-01',321,'in','personal-in','Synthetic documented movement',true)$$,null,null,'changed retry rejected');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-second-key','2026-10-01',320.45,'in','personal-in','Synthetic documented movement',true)$$,null,null,'same reference cannot be entered under another key');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-unverified','2026-10-01',1,'in','personal-unverified','Synthetic documented movement',false)$$,null,null,'unverified movement rejected');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-subcent','2026-10-01',0.001,'in','personal-subcent','Synthetic documented movement',true)$$,null,null,'subcent rejected');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-future','2026-10-21',1,'in','personal-future','Synthetic documented movement',true)$$,null,null,'future movement rejected');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-too-early','2026-09-30',1,'out','personal-too-early','Synthetic documented movement',true)$$,null,null,'cannot return personal money before its receipt');
select lives_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-out','2026-10-15',100.20,'out','personal-out','Synthetic documented movement',true)$$,'documented partial personal return');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-excess','2026-10-20',221,'out','personal-excess','Synthetic documented movement',true)$$,null,null,'excess return blocked without touching collective money');
select is((select sum(amount)from public.ledger_entries where cycle_id='a3000000-0000-4000-8000-000000000003'and account='personal_bank_cash'),220.25::numeric,'failed return creates no partial entries');
select throws_ok($$select public.reverse_financial_operation((select id from public.financial_operations where idempotency_key='personal-in'and cycle_id='a3000000-0000-4000-8000-000000000003'),'personal-in-undo','2026-10-20','Synthetic correction')$$,null,null,'receipt undo blocked when later return depends on it');
select lives_ok($$select public.reverse_financial_operation((select id from public.financial_operations where idempotency_key='personal-out'and cycle_id='a3000000-0000-4000-8000-000000000003'),'personal-out-undo','2026-10-20','Synthetic correction')$$,'personal return can be annulled atomically');
select lives_ok($$select public.reverse_financial_operation((select id from public.financial_operations where idempotency_key='personal-in'and cycle_id='a3000000-0000-4000-8000-000000000003'),'personal-in-undo','2026-10-20','Synthetic correction')$$,'receipt can be annulled after dependent return is undone');
select is((select sum(amount)from public.ledger_entries where cycle_id='a3000000-0000-4000-8000-000000000003'and account='personal_bank_cash'),0::numeric,'personal pair and undo restore zero');
select is((select count(*)from public.ledger_entries where cycle_id='a3000000-0000-4000-8000-000000000003'and account in('common_income','admin_payable','member_loan_profit_fund')),0::bigint,'no personal gains recognized');
create temp table q as select public.preview_member_settlement('a3000000-0000-4000-8000-000000000005','2026-10-20',0,0,0)q;
select lives_ok($$select public.record_settlement_completion('a3000000-0000-4000-8000-000000000005','cash-completion','2026-10-20',67.28,null,'Synthetic physical cash','2026-10-20',0,0,0,(select q->>'preview_hash'from q))$$,'completion can be received as physical cash');
select is((select sum(e.amount)from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id where o.cycle_id='a3000000-0000-4000-8000-000000000003'and o.idempotency_key='cash-completion'and e.account='cash'and e.liquidity_location='cash'),67.28::numeric,'completion enters exactly once in cash');
select is((public.preview_member_settlement('a3000000-0000-4000-8000-000000000005','2026-10-20',0,0,0)->>'net')::numeric,0::numeric,'exact cash receipt covers shortfall');
create temp table confirm_quote as select public.preview_member_settlement('a3000000-0000-4000-8000-000000000005','2026-10-20',0,0,0)q;
select lives_ok($$select public.confirm_member_settlement('a3000000-0000-4000-8000-000000000005','cash-completion-confirm','2026-10-20',0,0,0,(select q->>'preview_hash'from confirm_quote))$$,'covered settlement confirms');
select is((select sum(amount)from public.ledger_entries where cycle_id='a3000000-0000-4000-8000-000000000003'and account='admin_payable'),-70000::numeric,'annual fee and withdrawal penalty belong to administrator');
select is((select count(*)from public.financial_operations where cycle_id='a3000000-0000-4000-8000-000000000003'and operation_type='admin_penalty_recognized'),1::bigint,'withdrawal penalty recognized once');
select lives_ok($$select public.confirm_member_settlement('a3000000-0000-4000-8000-000000000005','cash-completion-confirm','2026-10-20',0,0,0,(select q->>'preview_hash'from confirm_quote))$$,'confirmation retry preserves existing rules');
select is((select count(*)from public.financial_operations where cycle_id='a3000000-0000-4000-8000-000000000003'and operation_type='admin_penalty_recognized'),1::bigint,'confirmation retry does not duplicate penalty');
select is((select count(*)from(select operation_id from public.ledger_entries where cycle_id='a3000000-0000-4000-8000-000000000003'group by operation_id having sum(amount)<>0)t),0::bigint,'all operations remain balanced');

select ok(not has_function_privilege('anon','public.record_personal_funds(uuid,uuid,text,date,numeric,text,text,text,boolean)','EXECUTE'),'anonymous cannot execute personal RPC');
select ok(not has_function_privilege('authenticated','public.assert_personal_funds_nonnegative(uuid,uuid,text)','EXECUTE'),'personal balance helper is not a client RPC');
select ok(not has_function_privilege('authenticated','public.create_b_operation(uuid,uuid,text,text,date,text,uuid,jsonb,jsonb)','EXECUTE'),'client cannot bypass personal controls with ledger helper');
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003','ffffffff-0000-4000-8000-000000000001','personal-foreign-bank','2026-10-20',1,'in','Synthetic foreign bank','Synthetic evidence',true)$$,null,null,'foreign or missing bank is rejected');
select set_config('request.jwt.claim.sub','ffffffff-0000-4000-8000-000000000002',true);
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',null,'personal-outsider','2026-10-20',1,'in','Synthetic outsider','Synthetic evidence',true)$$,null,null,'authenticated outsider cannot post personal funds');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',null,'personal-no-session','2026-10-20',1,'in','Synthetic anonymous','Synthetic evidence',true)$$,null,null,'missing session rejected inside function');
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000001',true);
reset role;update public.cycles set status='closed'where id='a3000000-0000-4000-8000-000000000003';set local role authenticated;
select throws_ok($$select public.record_personal_funds('a3000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a3000000-0000-4000-8000-000000000002'),'personal-closed-cycle','2026-10-20',1,'in','Synthetic closed','Synthetic evidence',true)$$,null,null,'closed cycle rejects new personal movements');

select * from finish();rollback;
