# Entrega Bloque B - NAT-HU-002 y NAT-HU-003

Estado: `READY_FOR_REVIEW`.

Fecha local de correccion: 2026-10-09.

## Alcance implementado

- Registro financiero minimo con `financial_operations` y `ledger_entries` balanceadas por operacion.
- Aportes de ahorro enlazados al ledger en la misma transaccion y transicion idempotente para aportes existentes.
- Prestamos: contrato borrador, desembolso idempotente, cronograma persistido, cobro con aplicacion explicita a capital/interes, cotizacion/confirmacion de prepago y bloqueo de sobrecobros.
- Pollas: actividad por RPC, aporte a bolsa de polla, premio bruto, comision fija, neto pendiente, pago neto separado y fechas civiles visibles.
- Reverso financiero minimo por RPC con motivo, partidas inversas y bloqueo de dependencias evidentes.
- UI local para crear socio ficticio, aporte, contrato, desembolso, cobro, prepago, actividad de polla, aporte de polla, premio y pago.
- RLS por workspace y RPC transaccionales para operaciones monetarias.

## Limites no implementados en B

- No hay despliegue productivo.
- No hay importacion real de CSV/JSON legacy.
- No hay banco real, conciliacion bancaria, liquidacion real ni reparto final de utilidad.
- No hay pantalla completa de administracion de reversos; existe RPC base y pruebas de invariantes, pero una operacion real debe revisarse antes de usarla en DEV.
- No se declara HU-001 como `DONE`; solo Juan puede aceptar.

## Migracion

- `supabase/migrations/20261007000200_block_b_finance_loans_polla.sql`
- `supabase/migrations/20261009000100_correct_block_b_finance_invariants.sql`

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
- `create_polla_activity`
- `quote_loan_prepayment`
- `confirm_loan_prepayment`
- `record_manual_cash_movement`
- `withdraw_admin_payable`
- `reverse_financial_operation`

## Matriz requisito/evidencia

| Requisito correctivo | Evidencia |
| --- | --- |
| Aporte nuevo escribe caja y obligacion de ahorro una vez | `block_b_corrections_test.sql`: aporte $1.000.000, caja +$1.000.000, reintento sin duplicar |
| Cronograma amortizado usa interes sobre saldo | `block_b_corrections_test.sql` y `loanFinance.test.ts`: intereses $25.000, $17.069,79, $8.743,06 |
| EA ACT/365F conectado a SQL | `block_b_corrections_test.sql`: contrato EA $500.000/24%/30 dias produce $8.918,81 |
| No se cobra prestamo en borrador ni sobrecapital | `block_b_corrections_test.sql`: rechazos explicitos |
| Capital positivo no fuerza prepago | `block_b_corrections_test.sql`: cobro regular con capital queda `regular` |
| Idempotencia payload distinto | `block_b_corrections_test.sql`: cobro y polla con misma clave/datos distintos se rechazan sin efecto |
| Ciclos correctos en polla | `block_b_corrections_test.sql`: participante de 2027 rechazado en actividad 2026 |
| Escrituras directas peligrosas | `block_b_corrections_test.sql`: insert directo de polla rechazado |
| Prepago con/sin interes previo | `block_b_corrections_test.sql`: $525.000 sin previo, $500.000 con interes previo real |
| UI recorrido B | `npm run test:e2e`: Chromium y mobile pasan |

## Recorrido manual esperado

1. Ingresar con OTP en TEST/DEV local.
2. Crear socio ficticio.
3. Registrar aporte de ahorro ficticio.
4. Crear contrato fijo de $500.000, tasa 5% mensual, plazo 1 mes.
5. Confirmar desembolso del contrato creado.
6. Registrar cobro de $25.000 aplicado a interes y $0 a capital.
7. Ver cartera pendiente de $500.000 e interes cobrado de $25.000 para ese prestamo.
8. Cotizar prepago si aplica y comprobar que el capital/interes vienen del servidor.
9. Ver administracion por pagar y fondo de utilidad de prestamos reconstruidos desde ledger.
10. Crear actividad de polla, registrar aporte de $10.000 con fecha visible.
11. Asignar premio bruto de $40.000, ver neto de $35.000.
12. Pagar el neto y comprobar que el premio queda `paid`.

## Verificaciones ejecutadas

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Aprobado |
| `npm run test` | Aprobado: 8 archivos, 27 pruebas |
| `npm run build` | Aprobado |
| `npm run check:secrets` | Aprobado |
| `npm run test:infra:start` | Aprobado; salida con llaves locales redactadas |
| `npm run test:infra:reset` | Aprobado; aplico migraciones hasta correccion B 2026-10-09 |
| `npm run test:rls` | Aprobado: 3 archivos SQL, 77 pruebas |
| `npm run test:e2e` | Aprobado: Chromium y mobile, 2 pruebas |

## Observaciones criticas

- El E2E habia fallado inicialmente por un error real de PostgREST: la relacion `loan_contracts -> members` era ambigua entre deudor y referido. Se corrigio usando el FK explicito en la consulta.
- El lector OTP de E2E ahora ignora correos previos y espera el mensaje nuevo, para evitar codigos viejos de Mailpit.
- Las pruebas SQL son la evidencia principal del reparto 10/90: interes cobrado $25.000 produce $2.500 administracion y $22.500 fondo de socios.
- La revision posterior de B encontro defectos reales: ahorro sin ledger, cronogramas incorrectos, sobrecobros, ciclos cruzados e idempotencia incompleta. Quedaron cubiertos por la migracion correctiva y por `block_b_corrections_test.sql`.
- La exportacion ahora es `natillera-manager.ab.v1`; sigue sin ser respaldo legacy completo ni prueba de comprobantes privados.
- Los archivos reales entregados por Juan permanecen fuera de Git bajo `incoming/` local ignorado.

## Pendientes concretos fuera de B

- Banco real, conciliacion, reservas y liquidez pertenecen a C.
- Liquidacion atomica, compensacion de deudas y reparto neto pertenecen a C.
- Migracion del JSON vigente, comprobantes privados y cambio de app pertenecen a D.
- Reversos complejos con cascadas dependientes requieren revision operativa antes de usarse con datos reales.
