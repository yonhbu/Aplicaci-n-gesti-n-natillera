# UX-03 - Semantica Financiera del Dashboard

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-13

## Principio

El dashboard no declara `saldo disponible`. Esa etiqueta seria enganosa porque los indicadores mezclan activos, obligaciones, fondos restringidos y montos descriptivos. La UI separa estos grupos para reducir interpretaciones incorrectas.

## Indicadores

| Indicador | Fuente/calculo | Significado | Corte | Relacion | Estados y cautelas |
| --- | --- | --- | --- | --- | --- |
| Socios ciclo | `cycleMembers.length` | Participaciones visibles para el usuario en el ciclo activo | No aplica corte ledger | Base para expectativa de ahorro | Si es 0 se muestra aviso operativo, no se infiere importacion faltante |
| Ahorro recibido | Suma de `contributions.amount` | Aportes registrados en el ciclo visible | No filtra por fecha de corte en UX-03; conserva comportamiento previo | Compara contra cuotas esperadas | Si hay datos incompletos, representa solo lo visible |
| Cuotas esperadas ciclo | `monthly_quota * meses activos` por socio | Expectativa descriptiva de cuotas del ciclo | No aplica corte ledger | Referencia para pendiente descriptivo | No es por si sola una deuda exigible |
| Pendiente descriptivo | `max(cuotas esperadas - ahorro recibido, 0)` | Brecha descriptiva frente a expectativa | No aplica corte ledger | Deriva de los dos indicadores anteriores | No equivale a mora legal ni saldo de cobro |
| Caja reconstruida | Suma ledger `cash` con operacion `effective_date <= corte` | Caja reconstruida desde partidas publicadas | Si | Activo liquido contable reconstruido | No se interpreta como disponible libre |
| Cartera | Suma ledger `loans_receivable` con operacion `effective_date <= corte` | Capital pendiente reconstruido | Si | Activo financiero | Depende de operaciones publicadas |
| Ahorro por pagar | `0 - savings_liability` al corte | Obligacion de ahorro frente a socios | Si | Pasivo/obligacion | Se presenta separado de activos |
| Bolsa polla | `0 - polla_pool` al corte | Fondo restringido de polla | Si | Fondo restringido | No es caja disponible |
| Premios pendientes | `0 - prizes_payable` al corte | Premios reconocidos aun no pagados | Si | Obligacion | No se mezcla con ahorro por pagar |
| Fondo utilidad prestamos | `0 - member_loan_profit_fund` al corte | Fondo de utilidad pendiente de reglas de reparto/pago | Si | Fondo/obligacion segun politica | No se infiere distribucion automatica |
| Administracion por pagar | `0 - admin_payable` al corte | Obligacion administrativa registrada | Si | Obligacion | Se mantiene como informacion complementaria |

## Loading, error, empty e incertidumbre

- Loading y errores globales se mantienen en los flujos existentes de la app.
- Empty state confirmado: sin socios del ciclo se muestra aviso de advertencia.
- Incertidumbre operativa: si existe reporte de migracion dry-run, se informa como lectura sin publicacion de datos.
- No se agrego un estado de precision contable total; seria falso sin conciliacion/restauracion revisada.

## Deuda registrada

- La fecha civil sigue fuera de UX-03. El input puede reflejar formato del navegador; no se corrigio la fuente `todayCivilDate()`.
- El dataset visual necesita movimientos sinteticos mas representativos para validar escenarios no cero.
