-- Reconciled interest requires the same closing distribution as a collected interest.
do $$declare definition text;needle text:='''loan_payment'', ''loan_prepayment''';begin
 select pg_get_functiondef('public.fin07_enforce_close_order()'::regprocedure)into definition;
 if position(needle in definition)=0 then raise exception 'Guarda de cierre inesperada.';end if;
 execute replace(definition,needle,needle||', ''legacy_loan_interest_correction''');
end$$;
