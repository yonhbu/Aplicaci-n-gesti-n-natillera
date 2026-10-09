# Entrega Correcciones ABC

Fecha: 2026-10-09

Estado: `READY_FOR_REVIEW`

## Alcance

Se ejecuto la orden de cierre de invariantes ABC sobre el proyecto actual. No se importaron datos reales, no se desplego, no se genero ZIP en esta entrega y no se marco ninguna HU como `DONE`.

## Matriz de hallazgos

| Hallazgo | Correccion | Prueba |
| --- | --- | --- |
| Liquidacion aceptaba `preview_hash = NULL` | Validacion explicita de hash nulo/vacio y comparacion nula-segura | `abc_financial_invariants_regression_test.sql` |
| Deuda al corte restaba cobros posteriores | Previsualizacion reconstruye cobros por fecha efectiva y reversos al corte | `abc_financial_invariants_regression_test.sql` |
| Confirmacion retroactiva podia pisar historia posterior | Confirmacion rechaza cobros posteriores sin politica explicita | `abc_financial_invariants_regression_test.sql` |
| Reintentos fallaban por validar estado mutado antes de idempotencia | Liquidacion, pagos, reparto y traslado resuelven clave/payload antes de validar estado/saldo | `abc_financial_invariants_regression_test.sql` |
| Pago de liquidacion podia reintentarse con referencia distinta | Comparacion idempotente incluye ubicacion, cuenta y referencia | `abc_financial_invariants_regression_test.sql` |
| Reverso de pago de liquidacion dejaba entidad en `paid` | Reverso marca pago como `reversed` y reabre obligacion | `abc_financial_invariants_regression_test.sql` |
| Reverso de desembolso con cobros dejaba prestamo inconsistente | Reverso de desembolso bloquea cobros y compensaciones dependientes | `abc_financial_invariants_regression_test.sql` |
| Reparto de $0,02 entre tres prometia $0,03 | Asignacion usa piso por centavo y residual no negativo | `abc_financial_invariants_regression_test.sql` |
| Politica libre autorizaba reparto | Se agrego entidad de politica aprobada por ciclo | `block_c_bank_settlements_profit_test.sql`, `abc_financial_invariants_regression_test.sql` |
| Apertura bancaria podia repetirse como financiacion | Apertura unica por cuenta/ciclo y RPC separada de financiacion externa ficticia/documentada | `block_c_bank_settlements_profit_test.sql`, `abc_financial_invariants_regression_test.sql` |
| UI B/C generaba claves nuevas por click | Persistencia local de operacion financiera pendiente por accion/scope/payload | `pendingFinancialOperationStorage.test.ts` |
| UI no capturaba referido de deudor externo | Campo `Referido por` enviado a la RPC de contrato | `npm run typecheck` |

## Cambios principales

- Nueva migracion incremental `20261009000300_close_abc_financial_invariants.sql`.
- Nuevas tablas de politica y asignaciones de reparto de utilidad.
- Estados `reversed` para pagos de liquidacion/reparto y aportes de ahorro enlazados.
- RPC de financiacion bancaria externa separada de apertura.
- UI con claves idempotentes persistentes para prestamos, cobros, polla, banco, liquidaciones y utilidad.
- Documentos actualizados para reflejar A+B+C en `READY_FOR_REVIEW`.

## Evidencia ejecutada

| Comando | Resultado |
| --- | --- |
| `npm run test:infra:start` | Exit code 0 |
| `npm run test:infra:reset` | Exit code 0; migraciones aplicadas hasta `20261009000300_close_abc_financial_invariants.sql` |
| `npm run test:rls` | Exit code 0; 5 archivos SQL, 144 pruebas |
| `npm run typecheck` | Exit code 0 |
| `npm run test` | Exit code 0; 9 archivos, 31 pruebas |
| `npm run check:secrets` | Exit code 0 |
| `npm run build` | Exit code 0 |
| `PLAYWRIGHT_PORT=5177 npm run test:e2e` | Exit code 0; 2 pruebas, Chromium y mobile |

Nota: `npm run test:e2e` sin puerto alterno encontro `127.0.0.1:5176` ocupado. No se detuvo el servidor local existente; se ejecuto la misma prueba en puerto TEST alterno `5177`.

## Limites

- No hay importacion productiva D.
- No hay conexion bancaria externa ni transferencias reales.
- Politicas reales de costos, reservas, cuota anual, penalidad y cierre de ciclo siguen pendientes de aprobacion operativa.
- Concurrencia real con barreras independientes queda limitada por el stack local; las pruebas agregadas cubren reintentos deterministas y reversos, no certifican carga concurrente productiva.
