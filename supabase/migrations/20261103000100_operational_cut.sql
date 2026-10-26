-- Corte inicial confirmado por el administrador. Los importes ya pagados no se recobran.
-- Los hashes prueban que se consolida el mismo lote, no una segunda importacion.
alter table public.cycles add column operational_baseline jsonb;

create function public.preview_operational_cut(p_cycle_id uuid,p_json_sha256 text,p_csv_sha256 text,p_cut_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; b public.legacy_operational_import_batches%rowtype; snapshot jsonb; prizes jsonb; loans jsonb;
begin
  select * into c from public.cycles where id=p_cycle_id;
  if c.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if auth.uid() is null or not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or not isfinite(p_cut_date) or p_cut_date<c.starts_on or p_cut_date>c.closes_on or p_cut_date>public.fin_civil_today() then raise exception 'Fecha de corte invalida.'; end if;
  select * into b from public.legacy_operational_import_batches where cycle_id=c.id and workspace_id=c.workspace_id
    and json_sha256=p_json_sha256 and csv_sha256=p_csv_sha256 and status='imported';
  if b.id is null then raise exception 'Los archivos no corresponden al lote registrado en este ciclo.'; end if;
  if exists(select 1 from public.legacy_operational_import_mappings m join public.polla_prizes p on p.id=m.target_id
    where m.batch_id=b.id and m.source_type='prize' and m.target_table='polla_prizes'
      and (p.legacy_id is distinct from m.source_id or not (m.payload ? 'grossAmount') or p.gross_amount is distinct from (m.payload->>'grossAmount')::numeric)) then
    raise exception 'Un premio no coincide con el importe y codigo de la fuente.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'source_id',m.source_id,'member',p.winner_cycle_member_id,
    'status',p.status,'payment_status',p.legacy_payment_status,'net',p.net_amount,'credit',cc.id,'credited_amount',cc.amount,'credited_date',cc.effective_date) order by m.source_id),'[]')
    into prizes from public.legacy_operational_import_mappings m join public.polla_prizes p on p.id=m.target_id
    left join public.member_capital_credits cc on cc.prize_id=p.id and cc.reversed_at is null
    where m.batch_id=b.id and m.source_type='prize' and m.target_table='polla_prizes';
  if jsonb_array_length(prizes)<>coalesce((b.counts->>'prizes')::integer,-1) then raise exception 'El inventario de premios no coincide con el corte.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'capital_paid',l.legacy_paid_capital_amount,'interest_paid',l.legacy_paid_interest_amount,
    'paid_installments',(select count(*) from public.loan_schedules where loan_id=l.id and legacy_declared_paid)) order by l.id),'[]')
    into loans from public.legacy_operational_import_mappings m join public.loan_contracts l on l.id=m.target_id
    where m.batch_id=b.id and m.target_table='loan_contracts';
  if jsonb_array_length(loans)<>coalesce((b.counts->>'loans')::integer,-1) then raise exception 'El inventario de prestamos no coincide con el corte.'; end if;
  snapshot:=jsonb_build_object('cycle_id',c.id,'batch_id',b.id,'cut_date',p_cut_date,'json_sha256',p_json_sha256,'csv_sha256',p_csv_sha256,
    'source_counts',b.counts,'source_totals',b.totals,'prizes',prizes,'loans',loans,
    'credit_to_add',(select coalesce(sum((x->>'net')::numeric),0) from jsonb_array_elements(prizes) x where x->>'status'='pending_payment' and x->>'credit' is null),
    'credits_preserved',(select coalesce(sum((x->>'credited_amount')::numeric),0) from jsonb_array_elements(prizes) x where x->>'credit' is not null));
  return snapshot||jsonb_build_object('preview_hash',md5(snapshot::text));
end $$;

create function public.confirm_operational_cut(p_cycle_id uuid,p_json_sha256 text,p_csv_sha256 text,p_cut_date date,p_preview_hash text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; snapshot jsonb; item jsonb; p public.polla_prizes%rowtype; recorded jsonb;
begin
  select * into c from public.cycles where id=p_cycle_id for update;
  if c.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if auth.uid() is null or not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if c.operational_baseline is not null then
    if c.operational_baseline->>'json_sha256'=p_json_sha256 and c.operational_baseline->>'csv_sha256'=p_csv_sha256
       and c.operational_baseline->>'cut_date'=p_cut_date::text and c.operational_baseline->>'preview_hash'=p_preview_hash and c.operational_baseline->>'reason'=trim(p_reason) then return c.operational_baseline; end if;
    raise exception 'Este ciclo ya tiene otro corte inicial confirmado.';
  end if;
  if c.status<>'active' then raise exception 'El ciclo debe estar activo para consolidar.'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'El corte requiere motivo.'; end if;
  snapshot:=public.preview_operational_cut(c.id,p_json_sha256,p_csv_sha256,p_cut_date);
  if p_preview_hash is null or p_preview_hash<>snapshot->>'preview_hash' then raise exception 'El corte cambio; vuelva a calcular antes de confirmar.'; end if;
  for item in select * from jsonb_array_elements(snapshot->'prizes') loop
    select * into p from public.polla_prizes where id=(item->>'id')::uuid for update;
    if p.status='reversed' then raise exception 'Hay premios revertidos: no se restauran desde el corte inicial.'; end if;
    if item->>'credit' is not null then
      if (item->>'credited_amount')::numeric<>p.net_amount then raise exception 'Un premio tiene un abono de importe distinto.'; end if;
      -- Preservar fecha, importe y operacion de los abonos ya registrados.
      update public.polla_prizes set legacy_payment_status='paid_verified' where id=p.id;
    elsif p.status='pending_payment' then
      if exists(select 1 from public.member_settlements where cycle_member_id=p.winner_cycle_member_id and status<>'reversed') then
        raise exception 'El corte afectaria una liquidacion confirmada; requiere conciliacion especifica.';
      end if;
      update public.polla_prizes set legacy_payment_status='pending_payment' where id=p.id;
      perform public.credit_polla_prize_to_capital(p.id,'operational-cut:'||c.id::text||':'||p.id::text,p_cut_date);
      update public.polla_prizes set legacy_payment_status='paid_verified' where id=p.id;
    elsif p.status='paid' then
      -- Un pago efectivo vigente no se convierte en otro abono al capital.
      update public.polla_prizes set legacy_payment_status='paid_verified' where id=p.id;
    else raise exception 'Un premio no tiene pago ni abono que sustente su estado.';
    end if;
  end loop;
  recorded:=snapshot||jsonb_build_object('version','operational-cut-v1','confirmed_at',now(),'confirmed_by',auth.uid(),'reason',trim(p_reason));
  update public.cycles set operational_baseline=recorded where id=c.id;
  return recorded;
end $$;
revoke all on function public.preview_operational_cut(uuid,text,text,date),public.confirm_operational_cut(uuid,text,text,date,text,text) from public,anon;
grant execute on function public.preview_operational_cut(uuid,text,text,date),public.confirm_operational_cut(uuid,text,text,date,text,text) to authenticated;
