# Entrega Bloque B - NAT-HU-002 y NAT-HU-003

Estado: `READY_FOR_REVIEW`.

Fecha local de cierre tecnico: 2026-10-07.

## Alcance implementado

- Registro financiero minimo con `financial_operations` y `ledger_entries` balanceadas por operacion.
- Prestamos: contrato, desembolso idempotente, cobro con aplicacion explicita a capital/interes y resumen de cartera/interes cobrado.
- Pollas: actividad por periodo, aporte a bolsa de polla, premio bruto, comision fija, neto pendiente y pago neto separado.
- UI local para crear socio ficticio, aporte, prestamo, cobro, actividad de polla, aporte de polla, premio y pago.
- RLS por workspace y RPC transaccionales para operaciones monetarias.

## Limites no implementados en B

- No hay despliegue productivo.
- No hay importacion real de CSV/JSON legacy.
- No hay banco real, conciliacion bancaria, liquidacion real ni reparto final de utilidad.
- No hay gestion operativa completa de reversos desde UI; las correcciones monetarias quedan para HUs posteriores.
- No se declara HU-001 como `DONE`; solo Juan puede aceptar.

## Migracion

- `supabase/migrations/20261007000200_block_b_finance_loans_polla.sql`

Tablas principales:

- `financial_operations`
- `ledger_entries`
- `loan_contracts`
- `loan_schedules`
- `loan_payments`
- `polla_activities`
- `polla_participants`
- `polla_contributions`
- `polla_prizes`
- `polla_prize_payments`

RPC principales:

- `create_loan_contract`
- `confirm_loan_disbursement`
- `record_loan_payment`
- `register_polla_contribution`
- `award_polla_prize`
- `pay_polla_prize`
- `link_existing_savings_contribution_to_ledger`

## Recorrido manual esperado

1. Ingresar con OTP en TEST/DEV local.
2. Crear socio ficticio.
3. Registrar aporte de ahorro ficticio.
4. Crear prestamo fijo de $500.000, tasa 5% mensual, plazo 1 mes, y confirmar desembolso.
5. Registrar cobro de $25.000 aplicado a interes y $0 a capital.
6. Ver cartera pendiente de $500.000 e interes cobrado de $25.000 para ese prestamo.
7. Ver administracion por pagar y fondo de utilidad de prestamos reconstruidos desde ledger.
8. Crear actividad de polla, registrar aporte de $10.000.
9. Asignar premio bruto de $40.000, ver neto de $35.000.
10. Pagar el neto y comprobar que el premio queda `paid`.

## Verificaciones ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Aprobado |
| `npm run test` | Aprobado: 8 archivos, 26 pruebas |
| `npm run build` | Aprobado |
| `npm run check:secrets` | Aprobado |
| `npm run test:infra:start` | Aprobado; salida con llaves locales redactadas |
| `npm run test:infra:reset` | Aprobado; aplico migraciones hasta Bloque B |
| `npm run test:rls` | Aprobado: 2 archivos SQL, 47 pruebas |
| `npm run test:e2e` | Aprobado: Chromium y mobile, 2 pruebas |

## Observaciones criticas

- El E2E habia fallado inicialmente por un error real de PostgREST: la relacion `loan_contracts -> members` era ambigua entre deudor y referido. Se corrigio usando el FK explicito en la consulta.
- El lector OTP de E2E ahora ignora correos previos y espera el mensaje nuevo, para evitar codigos viejos de Mailpit.
- Las pruebas SQL son la evidencia principal del reparto 10/90: interes cobrado $25.000 produce $2.500 administracion y $22.500 fondo de socios.
- Los archivos reales entregados por Juan permanecen fuera de Git bajo `incoming/` local ignorado.
