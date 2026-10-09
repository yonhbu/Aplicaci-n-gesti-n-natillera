# Entrega Bloque C - NAT-HU-004 y NAT-HU-005

Estado: `READY_FOR_REVIEW`. No implica aceptacion de A/B ni cambio operativo.

Fecha local: 2026-10-09. Rama local: `feature/block-b-hu002-hu003`.

## Alcance implementado

- Precondiciones B verificadas nuevamente en TEST: ahorro enlazado a ledger, cronogramas/cobros, idempotencia, ciclos/workspaces, prepago P013 y reversos base siguen pasando.
- Banco manual: cuentas descriptivas sin credenciales, apertura verificada, interes recibido, comision bancaria y transferencia interna banco/efectivo por RPC.
- Conciliacion por cuenta/corte con saldo libro, saldo externo y diferencia. No crea ingresos ni ajustes automaticos.
- Ubicacion de liquidez en `ledger_entries`: `bank`, `cash` y `unknown`; movimientos historicos sin ubicacion quedan pendientes.
- Liquidacion: previsualizar, confirmar obligacion con snapshot/hash y registrar pago efectivo separado.
- Compensacion de prestamos y premios sin caja ficticia. P013 usa acuerdo explicito `P013_FIRST_MONTH`.
- Utilidad de prestamos: previsualizacion/confirmacion con politica versionada, reservas/obligaciones y pago bloqueado si falta liquidez.
- UI operativa para banco, conciliacion, liquidaciones y utilidad; exportacion `natillera-manager.abc.v1`.

## Migracion y pruebas

- Nueva migracion: `supabase/migrations/20261009000200_block_c_bank_settlements_profit.sql`.
- Nueva prueba SQL: `supabase/tests/database/block_c_bank_settlements_profit_test.sql`.
- E2E actualizado: OTP, A/B y recorrido C con banco, conciliacion y liquidacion simple.

## Evidencia vigente

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Aprobado |
| `npm run test` | Aprobado: 8 archivos, 27 pruebas |
| `npm run build` | Aprobado |
| `npm run check:secrets` | Aprobado |
| `npm run test:infra:reset` | Aprobado sobre `.supabase-test` |
| `npm run test:rls` | Aprobado: 4 archivos SQL, 116 pruebas |
| `npm run test:infra:reset && npm run test:e2e` | Aprobado: Chromium y mobile, 2 pruebas |
| `npm run test:infra:stop` | Aprobado; stack TEST detenido |

## Politicas reales vs ficticias

- Confirmado como regla: banco/efectivo son ubicaciones de caja; conciliacion no ajusta automaticamente; confirmacion de liquidacion no paga; pago requiere referencia y liquidez.
- Parametros ficticios de prueba: apertura bancaria $1.000.000, interes $10.000, comision $1.000, traslado $100.000, saldo externo $908.500, penalidad $50.000, cuota anual $20.000, politica utilidad `TEST-C`.
- Pendiente real: destino definitivo de penalidades, cuota anual, costos, reservas y reglas de cierre anual.

## Casos cubiertos

- Banco: $1.000.000 + $10.000 - $1.000 - traslado $100.000 = banco $909.000, efectivo $100.000, liquido total $1.009.000.
- Conciliacion: saldo externo $908.500 produce diferencia -$500 sin ajuste automatico.
- Annie ficticia: 10 aportes de $100.000, corte 2026-10-06, rendimiento $44.894,88, neto $974.894,88, transferencia $974.895.
- Edna ficticia: premios netos $135.000, P005 $549.506, P013 $500.000 + $25.000 si no fue cobrado, neto $35.388,88, transferencia $35.389.
- P013 con primer mes ya cobrado: interes adicional de liquidacion cero.
- Utilidad: interes satisfecho $100.000 produce admin $10.000 y fondo $90.000; costos $10.000, rendimiento $20.000, reserva $15.000, distribuible $45.000, nueve elegibles a $5.000; deficit de liquidez $15.000 bloquea pago.

## Receta local

```bash
docker info
npm ci
npm run dev:doctor
npm run dev:infra:start
npm run dev:env:write
npm run dev:db:migrate
npm run dev -- --host 127.0.0.1 --strictPort
```

URLs conocidas: app `http://127.0.0.1:5176`, OTP `http://127.0.0.1:44124`, Studio `http://127.0.0.1:44123`.

Usar `npm run dev:bootstrap` y `npm run dev:demo` solo si DEV local lo requiere. No resetear DEV como verificacion rutinaria.

## Limites

- No se desplego.
- No se importaron datos reales.
- No se incluyeron comprobantes privados.
- No se implementaron HU-006/HU-007.
- C queda pendiente de revision externa y aceptacion de Juan.
