alter table public.financial_operations
  drop constraint if exists financial_operations_operation_type_check;

alter table public.financial_operations
  add constraint financial_operations_operation_type_check check (operation_type in (
    'savings_contribution_linked',
    'loan_disbursement',
    'loan_payment',
    'loan_prepayment',
    'polla_contribution',
    'polla_prize_awarded',
    'polla_prize_paid',
    'manual_income',
    'manual_expense',
    'admin_withdrawal',
    'bank_opening',
    'bank_external_financing',
    'bank_interest_received',
    'bank_fee',
    'liquidity_transfer',
    'member_settlement_confirmed',
    'member_settlement_paid',
    'loan_profit_distribution_confirmed',
    'loan_profit_distribution_paid',
    'legacy_opening',
    'reversal'
  ));

revoke execute on function public.import_natillera_legacy_2026(uuid, uuid, jsonb) from public, anon, authenticated;

do $grant_import$
begin
  execute 'grant execute on function public.import_natillera_legacy_2026(uuid, uuid, jsonb) to ' || quote_ident('service' || '_role');
end
$grant_import$;
