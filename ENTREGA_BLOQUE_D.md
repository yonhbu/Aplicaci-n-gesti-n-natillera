# Entrega Bloque D - NAT-HU-006

Fecha: 2026-10-09

Estado: `READY_FOR_REVIEW`. No implica migracion productiva, despliegue ni cambio de la natillera operativa.

## Alcance implementado

- Dry-run de migracion D con inventario JSON/CSV, hash SHA-256, mapeos, incidencias, conciliacion y matriz de precondiciones ABC.
- Staging SQL para lotes, mapeos, incidencias, procedencia protegida y exportes ABC+D, con RLS por workspace.
- Scripts CLI `block-d:*` con guardas: las escrituras se niegan fuera de TEST local `http://127.0.0.1:55421`.
- UI local para prevalidar fuentes sin escrituras y descargar reporte D.
- Exportacion versionada `natillera-manager.abcd.v1`.
- Restauracion desde export en destino vacio de archivos y en segundo workspace vacio dentro de TEST.

## Destino aislado usado

- Supabase TEST local: API `http://127.0.0.1:55421`, DB `127.0.0.1:55422`, Studio `http://127.0.0.1:55423`.
- Workspace de ensayo bootstrap: `Natillera E2E sintetica`.
- Segundo destino restaurado: workspace vacio TEST creado por script de restauracion.
- DEV operativo no fue reseteado ni modificado como parte de D. No hubo despliegue.

## Fuentes examinadas

No se recibio JSON vigente real ni bytes reales de comprobantes en este hilo. Para demostrar el flujo se uso fixture sintetico local ignorado por Git:

- JSON fixture: `incoming/block-d/fixtures/migration-d-fixture.json`.
- CSV auxiliar fixture: `incoming/block-d/fixtures/migration-d-fixture.csv`.
- Hash de fuente fixture: `f0b1058f39ccd3bceb3f8020b9af7cc3ba20583394b7bdd5eb21957473187f30`.
- Dry-run local: `incoming/block-d/reports/dry-run-f0b1058f39cc.json`.

Incidencias del fixture: 7 totales. Incluyen pago booleano sin fecha/aplicacion, P013 pendiente de evidencia, liquidacion/politica pendiente, cuota incompleta y comprobante referido sin bytes. Correcto: no se publicaron como hechos financieros.

## Matriz ABC

| Requisito | Evidencia | Resultado |
| --- | --- | --- |
| Hash nulo/obsoleto rechazado | `npm run test:rls`, `abc_financial_invariants_regression_test.sql` | Aprobado |
| Idempotencia antes de estado mutado | `npm run test:rls`, regresiones ABC | Aprobado |
| Ledger balanceado | `block_d_migration_staging_test.sql` y ensayo D: 2 operaciones / 4 partidas | Aprobado |
| Ubicacion de dinero | Aportes D publicados con `cash` en `unknown`, no banco inventado | Aprobado |
| Politicas no inventadas | Liquidaciones/utilidad quedan como incidencias/staging | Aprobado |
| Comprobantes privados | Referencias sin bytes no se declaran migradas | Aprobado |

## Conciliacion y restauracion

Dry-run fixture: 10 mapeos. Publicables: 2 socios y 2 aportes verificables. Staging/no publicados: prestamos, movimientos banco/caja candidatos, premios, pago booleano, liquidacion y comprobantes sin bytes.

Ensayo publicado en TEST con `--allow-partial`:

- Socios: 2.
- Aportes: 2.
- Operaciones financieras: 2.
- Partidas ledger: 4.
- Suma ledger: balanceada.

Export ABC+D:

- Archivo local: `incoming/block-d/exports/natillera-abcd-f3d8b9d791d5.json`.
- Hash export: `f3d8b9d791d573d0cc75dd4d12cf85a9d0ef47c3eb33fbeffa0b8665d3ea4ec1`.

Restauracion:

- Archivo de verificacion: `incoming/block-d/restore-target/restore-check-f3d8b9d791d5.json`.
- Segundo workspace TEST restaurado: 2 participaciones, 2 aportes, 2 operaciones, 4 partidas.
- Adjuntos restaurados: 0 bytes, porque no habia bytes reales; se conserva faltante como faltante.

## Como ensayar

```bash
npm ci
npm run test:infra:start
npm run test:infra:reset
node scripts/bootstrap-test.mjs
npm run block-d:fixture
npm run block-d:dry-run -- --json incoming/block-d/fixtures/migration-d-fixture.json --csv incoming/block-d/fixtures/migration-d-fixture.csv
npm run block-d:stage -- --report incoming/block-d/reports/dry-run-f0b1058f39cc.json
npm run block-d:publish-trial -- --report incoming/block-d/reports/dry-run-f0b1058f39cc.json --allow-partial
npm run block-d:export -- --report incoming/block-d/reports/dry-run-f0b1058f39cc.json
npm run block-d:restore-check -- --export incoming/block-d/exports/natillera-abcd-f3d8b9d791d5.json --to-test-db
```

Para datos reales: exportar primero JSON vigente desde el navegador operativo, conservar el original fuera de Git, ubicar comprobantes si existen y ejecutar solo dry-run/stage en TEST. No usar `--allow-partial` para llamar completo un lote con bloqueantes.

## Evidencia ejecutada

| Comando | Resultado |
| --- | --- |
| `npm run block-d:fixture` | Exit code 0 |
| `npm run block-d:dry-run -- --json ... --csv ...` | Exit code 0; 10 mapeos, 7 incidencias |
| `npm run test:infra:start` | Exit code 0 |
| `npm run test:infra:reset` | Exit code 0; migraciones hasta `20261009000400_block_d_migration_staging.sql` |
| `node scripts/bootstrap-test.mjs` | Exit code 0 |
| `npm run block-d:stage -- --report ...` | Exit code 0; lote `blocked` por incidencias |
| `npm run block-d:publish-trial -- --allow-partial` | Exit code 0; 2 socios, 2 aportes |
| `npm run block-d:export -- --report ...` | Exit code 0 |
| `npm run block-d:restore-check -- --to-test-db` | Exit code 0 |
| `npm run typecheck` | Exit code 0 |
| `npm run test` | Exit code 0; 10 archivos, 34 pruebas |
| `npm run test:rls` | Exit code 0; 6 archivos SQL, 158 pruebas |
| `npm run check:secrets` | Exit code 0 |
| `npm run build` | Exit code 0 |
| `npm run test:e2e` | Fallo por puerto 5176 ocupado; no se detuvo servidor existente |
| `PLAYWRIGHT_PORT=5177 npm run test:e2e` | Exit code 0; 2 pruebas |
| `npm run test:infra:stop` | Exit code 0; stack TEST detenido |

## Plan de transicion

1. Juan exporta JSON vigente final desde la natillera operativa y congela originales/comprobantes.
2. Ejecutar dry-run D en TEST y revisar incidencias sin datos personales en reportes publicos.
3. Resolver decisiones: pagos booleanos, P013, premios, saldos de apertura, politicas de liquidacion/utilidad y comprobantes faltantes.
4. Repetir ensayo aislado con lote aprobado y restauracion en segundo destino.
5. Preparar destino productivo separado y validacion poscambio.
6. Solo despues de aprobar conciliacion/restauracion concreta, decidir corte operativo. Si ya hubo operaciones nuevas en la app migrada, volver requiere conciliarlas; no basta cambiar URL.

## Limites

- No hubo JSON real vigente ni comprobantes reales en esta entrega.
- No se importaron datos reales productivos.
- No se desplego, no se hizo push, no se cambio DEV operativo.
- HU-007 sigue fuera de alcance.
