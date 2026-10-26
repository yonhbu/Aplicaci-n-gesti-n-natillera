begin;
create extension if not exists pgtap;
select no_plan();
set local natillera.civil_today='2026-10-20';
insert into auth.users(id,aud,role,email,created_at,updated_at)
values('a5000000-0000-4000-8000-000000000001','authenticated','authenticated','fin-recon-edna@example.test',now(),now());
insert into public.workspaces(id,name) values('a5000000-0000-4000-8000-000000000002','Synthetic completion');
insert into public.workspace_users(workspace_id,user_id,role)
values('a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version)
values('a5000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000002',2026,'Synthetic completion','2026-01-01','2026-12-05','active','fin03-2026');
insert into public.members(id,workspace_id,display_name)
values('a5000000-0000-4000-8000-000000000004','a5000000-0000-4000-8000-000000000002','Completion synthetic');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla)
values('a5000000-0000-4000-8000-000000000005','a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000004',70000,true);
set local request.jwt.claim.sub='a5000000-0000-4000-8000-000000000001';
select public.create_bank_account('a5000000-0000-4000-8000-000000000003','Synthetic completion bank','','');
select public.register_savings_contribution('a5000000-0000-4000-8000-000000000005','completion-saving',1000000,'2026-01-01',2026,1,'cash','manual');


-- Synthetic analogue only. Ten players fund eight actual awards in Jan-Apr; no games May-Oct.
do $$declare i int;month int;mid uuid;cm uuid;activity uuid;winner uuid;begin
 for i in 1..9 loop
  insert into public.members(workspace_id,display_name)values('a5000000-0000-4000-8000-000000000002','Synthetic player '||i)returning id into mid;
  insert into public.cycle_members(workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_savings,participates_in_loan_profit)
   values('a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000003',mid,10000,true,false,false)returning id into cm;
 end loop;
 for month in 1..4 loop
  select id into activity from public.create_polla_activity('a5000000-0000-4000-8000-000000000003',2026,month,'Synthetic game '||month);
  for cm in select id from public.cycle_members where cycle_id='a5000000-0000-4000-8000-000000000003' order by (id='a5000000-0000-4000-8000-000000000005')desc,id limit 5 loop
   perform public.register_polla_contribution(activity,cm,'game-'||month||'-'||cm,10000,make_date(2026,month,5));
  end loop;
  if month<=3 then winner:='a5000000-0000-4000-8000-000000000005';else select id into winner from public.cycle_members where cycle_id='a5000000-0000-4000-8000-000000000003'and id<>'a5000000-0000-4000-8000-000000000005'order by id limit 1;end if;
  perform public.award_polla_prize_to_capital(activity,winner,'synthetic-award-'||month||'-1',50000,make_date(2026,month,10));
  select id into activity from public.create_polla_activity('a5000000-0000-4000-8000-000000000003',2026,month,'Synthetic second game '||month);
  for cm in select id from public.cycle_members where cycle_id='a5000000-0000-4000-8000-000000000003' order by (id='a5000000-0000-4000-8000-000000000005')desc,id limit 5 loop
   perform public.register_polla_contribution(activity,cm,'second-game-'||month||'-'||cm,10000,make_date(2026,month,5));
  end loop;
  select id into winner from public.cycle_members where cycle_id='a5000000-0000-4000-8000-000000000003'and id<>winner and id<>'a5000000-0000-4000-8000-000000000005'order by id limit 1;
  perform public.award_polla_prize_to_capital(activity,winner,'synthetic-award-'||month||'-2',50000,make_date(2026,month,10));
 end loop;
 for month in 5..10 loop perform public.create_polla_activity('a5000000-0000-4000-8000-000000000003',2026,month,'Synthetic unplayed '||month);end loop;
end $$;
select public.locate_unknown_liquidity('a5000000-0000-4000-8000-000000000003','synthetic-saving-location','2026-01-01','cash',null,1000000,'Synthetic received savings');
create temp table p005 as select id from public.create_loan_contract('a5000000-0000-4000-8000-000000000003','synthetic-p005','a5000000-0000-4000-8000-000000000004',null,null,549506,'amortized','EA',0.12,6,'2026-07-01');
create temp table p013 as select id from public.create_loan_contract('a5000000-0000-4000-8000-000000000003','synthetic-p013','a5000000-0000-4000-8000-000000000004',null,null,500000,'fixed_interest','MONTHLY_FIXED',0.05,3,'2026-10-08');
select public.set_loan_settlement_agreement((select id from p013),'P013_FIRST_MONTH');
select public.confirm_loan_disbursement((select id from p005),'synthetic-p005-disbursement','2026-07-01');
select public.confirm_loan_disbursement((select id from p013),'synthetic-p013-disbursement','2026-10-08');
-- Synthetic consolidated loan: original principal and accepted previous capital; no dated cash payment is invented.
update public.loan_contracts set principal=1500000,legacy_paid_capital_amount=950494 where id=(select id from p005);
select public.record_bank_interest_received('a5000000-0000-4000-8000-000000000003',(select id from public.bank_accounts where workspace_id='a5000000-0000-4000-8000-000000000002'),'synthetic-bank-yield','2026-10-01',94387.20,0,0,'Synthetic received yield');
grant select on p005,p013 to authenticated;
set local role authenticated;
create temp table original_quote as select public.preview_member_settlement('a5000000-0000-4000-8000-000000000005','2026-10-20',0,0,0)q;
select is((select(q->>'annual_admin_fee')::numeric from original_quote),20000::numeric,'Edna analogue retains approved administration');
select is((select(q->>'penalty')::numeric from original_quote),50000::numeric,'Edna analogue retains early withdrawal penalty');
select is((select count(*)from public.member_capital_credits where cycle_member_id='a5000000-0000-4000-8000-000000000005'and source_type='polla_prize'),3::bigint,'three prizes actually accredited');
select is((select sum(admin_commission)from public.polla_prizes where cycle_id='a5000000-0000-4000-8000-000000000003'),40000::numeric,'eight real awards create eight commissions once');
select is((select count(*)from public.polla_prizes pp join public.polla_activities a on a.id=pp.activity_id where a.cycle_id='a5000000-0000-4000-8000-000000000003'and a.period_month between 5 and 10),0::bigint,'unplayed months create no awards');
select is((public.quote_loan_prepayment((select id from p013),'2026-10-20')->>'interest_due')::numeric,25000::numeric,'P013 agreed first month stays intact');
select ok((select(q->>'net')::numeric<0 from original_quote),'two loans and approved discounts produce an actual shortfall');
select throws_ok($$select public.confirm_member_settlement('a5000000-0000-4000-8000-000000000005','synthetic-edna-too-early','2026-10-20',0,0,0,(select q->>'preview_hash'from original_quote))$$,null,null,'negative confirmation remains blocked');
select public.record_settlement_completion('a5000000-0000-4000-8000-000000000005','synthetic-edna-completion','2026-10-20',100,(select id from public.bank_accounts where display_name='Synthetic completion bank'),'Synthetic actual cash received','2026-10-20',0,0,0,(select q->>'preview_hash'from original_quote));
create temp table covered_quote as select public.preview_member_settlement('a5000000-0000-4000-8000-000000000005','2026-10-20',0,0,0)q;
select is((select(q->>'net')::numeric from covered_quote),32.72::numeric,'overpayment retains the exact cents for the member');
select lives_ok($$select public.confirm_member_settlement('a5000000-0000-4000-8000-000000000005','synthetic-edna-final','2026-10-20',0,0,0,(select q->>'preview_hash'from covered_quote))$$,'covered Edna analogue confirms');
select is((select sum(amount)from public.ledger_entries where cycle_id='a5000000-0000-4000-8000-000000000003'and account='loans_receivable'),0::numeric,'both loans compensated exactly once');
select is((select sum(principal_amount)from public.member_settlement_debt_applications where cycle_id='a5000000-0000-4000-8000-000000000003'),1049506::numeric,'each loan compensation has an individual application');
select is((select count(*)from public.loan_contracts where id in(select id from p005 union all select id from p013)and status='paid'),2::bigint,'consolidated principal plus compensation closes both contracts');
select is((select count(*)from public.loan_payments where loan_id in(select id from p005 union all select id from p013)),0::bigint,'compensation does not manufacture loan cash payments');
select is((select sum(amount)from public.ledger_entries where cycle_id='a5000000-0000-4000-8000-000000000003'and account='settlement_completion_liability'),0::numeric,'completion obligation consumed once');
select is((select count(*)from(select operation_id from public.ledger_entries where cycle_id='a5000000-0000-4000-8000-000000000003'group by operation_id having sum(amount)<>0)t),0::bigint,'entire analogue ledger balances');

select is((select(q->>'net')::numeric from original_quote),-67.28::numeric,'precise negative shortfall before verified receipt');
select is(public.loan_remaining_principal_at((select id from p005),'2026-10-19'),549506::numeric,'historical cut retains capital before settlement');
select is(public.loan_remaining_principal_at((select id from p005),'2026-10-20'),0::numeric,'consolidated loan individual principal is zero');
select is(public.loan_remaining_principal_at((select id from p013),'2026-10-20'),0::numeric,'P013 individual principal is zero');
select is((select sum(principal_amount)from public.loan_settlement_effects where loan_id in(select id from p005 union all select id from p013)),1049506::numeric,'read effects match original applications without another ledger entry');
select is((select count(*)from public.loan_schedule_progress where loan_id in(select id from p005 union all select id from p013)and status='projected'),0::bigint,'no future instalments remain collectible');
select is((select count(*)from public.loan_schedule_progress where loan_id in(select id from p005 union all select id from p013)and closed_by_settlement and status='cancelled'),9::bigint,'unpaid schedules are extinguished rather than fake interest payments');
select is((select sum(interest_paid)from public.loan_schedule_progress where loan_id in(select id from p005 union all select id from p013)),0::numeric,'no scheduled interest is manufactured');
select lives_ok($$select public.confirm_member_settlement('a5000000-0000-4000-8000-000000000005','synthetic-edna-final','2026-10-20',0,0,0,(select q->>'preview_hash'from covered_quote))$$,'confirmation exact retry after retirement stays idempotent');
select is((select count(*)from public.member_settlement_debt_applications where cycle_id='a5000000-0000-4000-8000-000000000003'),2::bigint,'retry cannot duplicate either debt application');
select throws_ok($$select public.quote_loan_payment((select id from p005),'2026-10-20',1)$$,null,null,'paid compensated loan cannot quote another receipt');
select throws_ok($$select public.quote_loan_prepayment((select id from p005),'2026-10-20')$$,null,null,'paid compensated loan cannot quote another full payment');
savepoint stale_contract;
reset role;
update public.loan_contracts set status='active'where id=(select id from p005);
set local role authenticated;
select throws_ok($$select public.record_loan_payment((select id from p005),'stale-paid-receipt','2026-10-20',1,0,1,'regular')$$,'P0001','El prestamo tiene una compensacion de liquidacion; no se puede cobrar otra vez.','server guard blocks duplicate receipt even under stale active state');
rollback to stale_contract;
create temp table bank_before_payout as select public.cash_available_at('a5000000-0000-4000-8000-000000000003','2026-10-20','bank',(select id from bank_accounts where display_name='Synthetic completion bank'))amount;
select lives_ok($$select public.pay_member_settlement((select id from public.member_settlements where idempotency_key='synthetic-edna-final'),'synthetic-cent-payout','2026-10-20','bank',(select id from bank_accounts where display_name='Synthetic completion bank'),'Synthetic verified payout')$$,'pay only the final 32.72 from bank');
select is(public.cash_available_at('a5000000-0000-4000-8000-000000000003','2026-10-20','bank',(select id from bank_accounts where display_name='Synthetic completion bank')),(select amount-32.72 from bank_before_payout),'payment reduces bank by net only, never by compensated principal');
select lives_ok($$select public.pay_member_settlement((select id from public.member_settlements where idempotency_key='synthetic-edna-final'),'synthetic-cent-payout','2026-10-20','bank',(select id from bank_accounts where display_name='Synthetic completion bank'),'Synthetic verified payout')$$,'payout exact retry remains idempotent');
select is((select count(*)from public.member_settlement_payments where cycle_id='a5000000-0000-4000-8000-000000000003'),1::bigint,'one payment including cents persists');
savepoint payout_annul;
select lives_ok($$select public.reverse_financial_operation((select paid_operation_id from public.member_settlements where idempotency_key='synthetic-edna-final'),'synthetic-cent-payout-undo','2026-10-20','Synthetic mistaken payout')$$,'annulling payout reopens only the obligation');
select is((select status from public.member_settlements where idempotency_key='synthetic-edna-final'),'confirmed','payout annulment leaves final account confirmed');
select is((select count(*)from public.loan_contracts where id in(select id from p005 union all select id from p013)and status='paid'),2::bigint,'payout annulment does not reopen compensated loans');
select is(public.cash_available_at('a5000000-0000-4000-8000-000000000003','2026-10-20','bank',(select id from bank_accounts where display_name='Synthetic completion bank')),(select amount from bank_before_payout),'annulling payout restores exactly 32.72');
rollback to payout_annul;
select is((select count(*)from(select operation_id from public.ledger_entries where cycle_id='a5000000-0000-4000-8000-000000000003'group by operation_id having sum(amount)<>0)t),0::bigint,'all new confirmed paid operations balance');
select ok(not has_table_privilege('anon','public.loan_settlement_effects','select'),'anonymous cannot read settlement effects');
set local request.jwt.claim.sub='a5000000-0000-4000-8000-000000000099';
select is((select count(*)from public.loan_settlement_effects),0::bigint,'unrelated identity cannot read settlement applications');
select is(public.loan_remaining_principal_at((select id from p005),'2026-10-20'),null::numeric,'principal helper follows RLS rather than exposing another workspace');

select * from finish();rollback;
