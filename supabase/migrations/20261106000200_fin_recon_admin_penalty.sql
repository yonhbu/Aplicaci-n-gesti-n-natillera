-- The approved early-withdrawal penalty belongs to the administrator.
-- Applies only when confirming a NEW FIN-03 settlement; existing snapshots and balances stay intact.
create function public.fin_recon_recognize_withdrawal_penalty() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare penalty numeric;
begin
 if new.status='reversed' or new.snapshot->>'fee_policy' is distinct from 'fin03-2026' then return new;end if;
 penalty:=coalesce((new.snapshot->>'penalty')::numeric,0);
 if penalty>0 then
  perform public.create_b_operation(new.workspace_id,new.cycle_id,new.idempotency_key||':withdrawal-penalty','admin_fee_recognized',new.cut_date,'member_settlements',new.id,
   jsonb_build_object('settlement_id',new.id,'amount',penalty,'kind','withdrawal_penalty'),
   jsonb_build_array(jsonb_build_object('account','settlement_policy_pending','amount',penalty,'member_id',new.member_id),
    jsonb_build_object('account','admin_payable','amount',-penalty,'member_id',new.member_id)));
 end if;
 return new;
end $$;
revoke all on function public.fin_recon_recognize_withdrawal_penalty()from public,anon,authenticated;
create trigger fin_recon_withdrawal_penalty after insert on public.member_settlements
 for each row execute function public.fin_recon_recognize_withdrawal_penalty();
notify pgrst,'reload schema';
