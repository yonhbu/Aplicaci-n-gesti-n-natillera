-- TEST regression proved that fin03_recognize_settlement_admin_fee ALREADY recognizes
-- admin_penalty_recognized once. Remove the redundant new trigger before any operational use.
-- Keep the applied migration history; no settlements or entries are rewritten.
drop trigger if exists fin_recon_withdrawal_penalty on public.member_settlements;
drop function if exists public.fin_recon_recognize_withdrawal_penalty();
notify pgrst,'reload schema';
