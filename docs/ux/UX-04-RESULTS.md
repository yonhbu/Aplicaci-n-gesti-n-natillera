# UX-04 - Resultados

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-14

## Resumen

Se redisenio `Ahorros` como una pantalla operativa organizada: resumen, registro de aporte, gestion de socios, detalle por socio e historial. No se modificaron reglas financieras, SQL, RPC, RLS, modelos ni persistencia.

## Cambios implementados

- `SavingsWorkspace` organiza la pantalla completa de Ahorros.
- `ContributionForm` agrega contexto, errores junto a campos principales, `inputMode` monetario y conserva idempotencia.
- `MemberForm` queda en un bloque separado de gestion.
- `MembersTable` agrega busqueda local, tarjetas de lectura y conserva tabla para E2E/trazabilidad.
- `SavingsContributionHistory` muestra aportes recientes con fecha efectiva, mes aplicado, metodo y fuente.
- Dashboard de Inicio reubica acciones frecuentes y neutraliza el tono visual de `Pendiente descriptivo`.
- Baseline UX-04 agrega dataset sintetico ampliado y `savings-snapshot.json`.

## Evidencia visual

- Before: `docs/ux/baseline/ux-04/before/`
- After: `docs/ux/baseline/ux-04/after/`
- Viewports: 320, 375, 390, 768, 1024, 1440
- Rutas: `#/home`, `#/savings`, `#/more/movements`

Dataset sintetico UX-04:

- 4 participaciones de ciclo.
- Rangos distintos: enero-diciembre, febrero-noviembre, junio-agosto.
- Aportes completos, parciales y monto grande.
- Nombre e identificador legacy largo.
- 7 aportes en historial.

Comparacion automatizada:

| Revision | Before | After |
| --- | ---: | ---: |
| Overflow global | 0 | 0 |
| Socios capturados | 4 | 4 |
| Aportes capturados como historial estructurado | 0 | 7 |
| Metricas de ahorro estructuradas | 0 | 4 |

Metricas after en 320 px:

- Socios ciclo: `4`
- Ahorro recibido: `$ 4.310.000`
- Cuotas esperadas ciclo: `$ 5.670.000`
- Pendiente descriptivo: `$ 1.360.000`

## Pruebas ejecutadas

- `npm run typecheck`: PASS.
- `npm run test`: PASS, 10 archivos y 34 pruebas.
- `npm run build`: PASS.
- `npm run check:secrets`: PASS.
- `npm run ux:baseline -- --suite ux-04 --phase before --port 5186`: PASS.
- `npm run ux:baseline -- --suite ux-04 --phase after --port 5186`: PASS.
- `npm run test:infra:start`: PASS sobre TEST descartable.
- `npm run test:infra:reset`: PASS sobre TEST descartable.
- `PLAYWRIGHT_PORT=5187 npm run test:e2e`: PASS, 6 pruebas.
- `npm run test:infra:stop`: PASS.

## Incidencias encontradas y corregidas

- E2E fallo inicialmente porque el nombre del socio aparecia como celda en dos tablas. Se corrigio el historial usando `th scope="row"` para evitar ambiguedad accesible.
- El primer intento de seed UX-04 asumio constraint unico `workspace_id, legacy_id`; se reemplazo por busqueda explicita + insert porque el modelo no lo garantiza.

## Pruebas no ejecutadas

- Lector de pantalla manual.
- Auditoria WCAG completa.
- Prueba en dispositivo movil fisico.

## Riesgos residuales

- No se valida cumplimiento/mora porque no existe definicion aprobada.
- No se corrigio fecha civil.
- La pantalla sigue usando componentes locales en `App.tsx`; una extraccion mayor queda fuera del alcance de UX-04.

## Estado final

`READY_FOR_REVIEW`. No hacer merge ni deploy. Detenerse antes de UX-05.
