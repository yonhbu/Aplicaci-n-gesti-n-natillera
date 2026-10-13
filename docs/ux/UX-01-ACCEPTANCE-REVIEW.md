# UX-01 - Acceptance Review

Fecha: 2026-10-13  
Estado: READY_FOR_REVIEW  
Reviewer: Senior Frontend Reviewer / UX Quality Engineer  
Harness: UX Engineering Harness v0.1

## Resultado

Recomendacion: APPROVE_WITH_CONDITIONS

UX-01 es aprobable como cambio de shell responsive y navegacion si se aisla del resto del arbol de trabajo antes de confirmar en `main`. No recomiendo aprobar ni commitear el working tree completo como UX-01 porque contiene cambios preexistentes de A+B+C+D / Bloque D que no pertenecen al alcance.

Condiciones de aprobacion:

1. Staging selectivo de los cambios de UX-01, sin incluir dominio financiero, Supabase, migraciones, importaciones legacy ni documentacion operativa ajena.
2. Revision humana de las capturas versionadas, especialmente las vistas moviles con tablas largas, porque la data sintetica no quedo identica entre before y after.
3. Aceptacion explicita de producto sobre mantener navegacion superior sticky en mobile para UX-01.
4. Mantener la correccion de fecha civil fuera de UX-01 como deuda tecnica separada.

## Base y diff real

Comprobacion | Estado | Evidencia
--- | --- | ---
Rama actual | Confirmada | `main`
Commit base observado | Confirmada | `4933e8939e875327de28a87d0fe922c2021ff86c`
Rama de implementacion original | Confirmada | `codex/ux-01-responsive-shell` partio del mismo commit observado; no hay commit propio de UX-01 encima de ese SHA.
No asumir `main` como base | Confirmada | Se valido que `main`, `codex/ux-01-responsive-shell` y `HEAD` apuntaban al mismo commit antes de cambiar el trabajo a `main`.
Cambios sin commit | Confirmada | Existen cambios modificados y archivos no rastreados.
Cambios mezclados | Confirmada | El working tree mezcla UX-01 con cambios previos de A+B+C+D / Bloque D.

## Inventario del working tree

Archivos modificados rastreados:

- `AGENTS.md`
- `README.md`
- `docs/BACKLOG.md`
- `docs/BUSINESS_RULES.md`
- `docs/DECISIONS.md`
- `docs/LOCAL_SETUP.md`
- `docs/PROJECT_STATE.md`
- `e2e/hu001.spec.ts`
- `package.json`
- `src/data/blockC.ts`
- `src/data/export.ts`
- `src/lib/types.ts`
- `src/styles.css`
- `src/ui/App.tsx`

Archivos no rastreados:

- `ENTREGA_BLOQUE_D.md`
- `GUIA_PRUEBA_LOCAL.md`
- `docs/ux/`
- `scripts/block-d-trial.ts`
- `scripts/import-legacy-2026.ts`
- `src/domain/migrationD.test.ts`
- `src/domain/migrationD.ts`
- `supabase/migrations/20261009000400_block_d_migration_staging.sql`
- `supabase/migrations/20261010000100_import_legacy_2026_operational.sql`
- `supabase/migrations/20261010000200_fix_legacy_import_operation_types.sql`
- `supabase/tests/database/block_d_migration_staging_test.sql`

Clasificacion:

Tipo | Archivos | Estado
--- | --- | ---
UX-01 claro | `docs/ux/discovery/*`, `docs/ux/UX-01-STORY.md`, `docs/ux/UX-01-RESULTS.md`, `docs/ux/baseline/*`, partes de `src/styles.css`, partes de `src/ui/App.tsx`, partes de `e2e/hu001.spec.ts` | Confirmado
Mixto, requiere staging por hunks | `src/ui/App.tsx`, `e2e/hu001.spec.ts` | Confirmado
Probablemente ajeno a UX-01 | `src/data/*`, `src/lib/types.ts`, `package.json`, docs de reglas/estado/backlog, scripts legacy, migraciones Supabase, pruebas SQL, dominio `migrationD` | Confirmado como fuera de alcance salvo aprobacion separada

## Procedimiento seguro para aislar UX-01

No ejecutar `reset`, `rebase`, `cherry-pick`, sobrescrituras ni limpieza destructiva. Procedimiento recomendado:

1. No hacer `git add .`.
2. Revisar `git diff` por archivo y separar hunks de UX-01 en `src/ui/App.tsx`, `src/styles.css` y `e2e/hu001.spec.ts`.
3. Usar `git add -p` para esos archivos mixtos.
4. Agregar explicitamente `docs/ux/discovery/*`, `docs/ux/UX-01-STORY.md`, `docs/ux/UX-01-RESULTS.md`, `docs/ux/UX-01-ACCEPTANCE-REVIEW.md` y `docs/ux/baseline/*`.
5. Excluir migraciones, scripts legacy, dominio financiero, datos, contratos, reglas financieras y documentacion operativa no perteneciente a UX-01.
6. Antes del commit, validar `git diff --cached --name-status` y `git diff --cached` para comprobar que el staged diff solo contiene shell responsive, navegacion, foco, pruebas E2E de navegacion y evidencia UX.

## Revisión visual

Evidencia revisada:

- Se verifico la existencia de 23 archivos before y 23 archivos after en `docs/ux/baseline/`.
- Se inspeccionaron capturas criticas mobile y desktop, incluyendo login, inicio, ahorros, movimientos y vistas largas.
- Se comparo especialmente `03-ahorros-390.png`: before muestra la barra inferior fija invadiendo contenido; after elimina ese solapamiento al usar barra superior sticky.
- Se inspecciono `02-inicio-1440.png`: la navegacion lateral desktop se mantiene estable.
- Se observo en capturas full-page de listas largas que la barra sticky puede repetirse visualmente por la forma en que Playwright compone capturas de pagina completa. Eso no prueba duplicacion real en viewport, pero debe anotarse como limitacion de evidencia.

Criterio visual | Estado | Resultado
--- | --- | ---
Navegacion mobile sticky vs barra inferior anterior | Confirmada | La barra superior sticky elimina el defecto reproducido de interceptacion/solapamiento de la barra inferior.
Espacio ocupado por encabezado | Confirmada con condicion | Ocupa mas espacio superior en mobile, pero evita cubrir formularios y controles. Requiere aceptacion de producto.
Legibilidad e interaccion | Confirmada | Los botones de navegacion conservan nombres y presentan hit targets mas accionables.
Solapamientos y overflow | Confirmada | No se reprodujo solapamiento de nav inferior despues del cambio. `body` limita overflow horizontal.
Viewports 320, 375, 390, 768, 1024, 1440 | Confirmada | Cubiertos por prueba E2E responsive.
Persistencia de navegacion e historial | Confirmada | Cubierto por prueba E2E con navegacion, recarga, atras y adelante.
Foco visible | Confirmada parcialmente | CSS global `:focus-visible` y skip link implementados. No se ejecuto auditoria manual exhaustiva con lector de pantalla.
Comparacion exacta before/after | Pendiente de reproduccion | La data sintetica acumulada hizo crecer algunas tablas after, por lo que la comparacion pixel a pixel no es limpia.

## Verificación funcional

Criterio | Estado | Evidencia
--- | --- | ---
Preservar 10 hashes existentes | Confirmada | Se conservan `#/home`, `#/savings`, `#/loans`, `#/polla`, `#/more/bank`, `#/more/movements`, `#/more/settlements`, `#/more/profit`, `#/more/exports`, `#/more/migration`.
Preservar funcionalidades existentes | Confirmada parcialmente | Typecheck, unit tests, build y E2E pasaron. La revision del working tree completo no puede aprobarse porque incluye cambios fuera de UX-01.
Estados financieros visibles | Confirmada | Las capturas y E2E mantienen vistas financieras visibles sin modificar reglas de calculo dentro del alcance UX-01.
Navegacion al recargar | Confirmada | Cubierta por E2E.
Controles y botones originales | Confirmada | UX-01 no elimina operaciones; cambia el contenedor de navegacion y el comportamiento responsive.
Permisos y logica de negocio | Confirmada para UX-01, no verificada para cambios mixtos | UX-01 no toca Supabase, SQL, RPC, RLS ni persistencia. El working tree si contiene archivos ajenos que deben excluirse.
No usar datos reales | Confirmada | Evidencia generada con TEST y datos sinteticos.

## Evaluación de navegación

La barra superior sticky se eligio por una causa tecnica reproducida: al quitar `force: true` de Playwright, la barra inferior fija en mobile no era confiablemente accionable porque contenido del `main`, incluyendo controles nativos, podia interceptar clicks normales. Mantener un test con click forzado ocultaba un defecto real de hit testing.

Desde UX, la barra superior sticky tiene estas ventajas para UX-01:

- Mantiene la navegacion visible sin tapar formularios, tablas, selects ni acciones inferiores.
- Reduce riesgo con safe-area y teclados moviles.
- Funciona mejor con scroll, recarga e historial sin crear una capa flotante sobre contenido financiero.
- Conserva los destinos y nombres actuales, evitando introducir la arquitectura de informacion futura.

Una barra inferior correctamente implementada podria ser viable si se rediseña en UX-02 con padding inferior consistente, safe-area dedicada, hit testing validado, jerarquia de acciones revisada y pruebas de teclado/controles nativos. Para UX-01 no conviene mantener la barra inferior porque ya fallo al ejecutar clicks normales y generaba deuda en pruebas.

Recomendacion: mantener barra superior sticky para UX-01. Reabrir la comparacion con barra inferior solo como decision de diseño posterior, no como correccion dentro de este alcance.

## Pruebas ejecutadas

Prueba | Estado
--- | ---
`npm run typecheck` | Confirmada, paso
`npm run test` | Confirmada, paso
`npm run build` | Confirmada, paso
`npm run check:secrets` | Confirmada, paso
`PLAYWRIGHT_PORT=5177 npm run test:e2e` | Confirmada, paso
E2E mobile especifico | Confirmada, paso
TEST infra reset/start/stop | Confirmada, ejecutado sobre entorno TEST descartable
Auditoria manual completa con lector de pantalla | No verificada
Comparacion visual pixel-perfect | No verificada

## Defectos confirmados

1. Before de UX-01 tenia defecto real de navegacion mobile: la barra inferior fija podia solaparse con contenido y no era accionable con click normal en Playwright.
2. El working tree actual no es un diff aceptable como UX-01 completo porque mezcla cambios de shell con trabajo previo de A+B+C+D / Bloque D.
3. Las capturas after de listas largas no son perfectamente comparables con before por acumulacion de datos sinteticos durante las corridas.

## Riesgos pendientes

- Si se commitea todo el working tree como UX-01, se mezclaran cambios de dominio, migracion, documentacion operativa y posiblemente Supabase fuera de alcance.
- `src/ui/App.tsx` tiene un diff grande contra `HEAD`, por lo que requiere staging por hunks o revision archivo por archivo antes de commit.
- La barra superior sticky es tecnicamente mejor para UX-01, pero cambia la ergonomia mobile frente a la barra inferior anterior; producto debe aceptar ese tradeoff.
- No se ejecuto auditoria formal con lector de pantalla.

## Decisión final

APPROVE_WITH_CONDITIONS.

UX-01 cumple el objetivo tecnico y de UX de mejorar shell responsive, accionabilidad, foco visible y navegacion sin cambiar contratos ni logica financiera dentro del alcance revisado. No debe aprobarse como commit global hasta aislar los hunks y archivos propios de UX-01. El estado queda en READY_FOR_REVIEW, sin merge y sin deploy.
