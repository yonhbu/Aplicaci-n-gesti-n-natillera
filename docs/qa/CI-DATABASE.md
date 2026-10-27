# CI database: aislamiento TEST y ejecución E2E

Estado de entrega: `READY_FOR_REVIEW`. Rama `codex/fix-ci-test-e2e`, base `5d166c6`. No se ejecutan despliegues ni operaciones sobre DEV/producción. Los resultados de ejecución se cierran al final de este documento.

## Causa del mensaje reportado

Se contrastó el workflow y la cadena de ejecución del commit `f5f6671`, cuya configuración produce el mensaje reportado, con la revisión local posterior `5d166c6`.

1. El trabajo `web` hace comprobaciones de fuentes/build y no arranca Supabase. Su éxito no demuestra que el servidor E2E seleccione TEST.
2. `database` prepara `.supabase-test` mediante `test:infra:start`, reconstruye TEST con `test:infra:reset`, ejecuta `test:rls` y luego `test:e2e`.
3. En la versión reportada, `write-test-env.mjs` escribía `.env.test.local`; `bootstrap-test.mjs` cargaba esas variables en su subproceso. Escribir ese archivo no selecciona la infraestructura del proceso siguiente.
4. Playwright cargaba dotenv y ejecutaba `npm run dev -- --mode test --host 127.0.0.1 --port 5176`, con `SUPABASE_ENV=test`.
5. `npm run dev` llama `start-local-safe.mjs`. Ese script decidía exclusivamente con `process.argv.includes('--test')`; no interpretaba `--mode test` ni `SUPABASE_ENV` para seleccionar infraestructura.
6. Por tanto consultaba `supabase status` en la raíz DEV, esperaba API `44121` y producía «Supabase DEV no está disponible». Si DEV hubiera estado disponible, el mismo desacuerdo podía seleccionar sus claves y servidor. No se ensayó esa escritura peligrosa.
7. Vite usa `createServer` por API: los argumentos CLI pasados a un script Node no configuran Vite automáticamente. Además, `envDir: false` impide que Vite lea `.env.test.local`. No bastaba con generar el archivo ni agregar `--mode test` al comando externo.

La revisión `5d166c6` ya corregía el argumento a `--test`. Sin embargo, su entrada general aún descubría suites históricas sin preparar todos sus fixtures; algunas dependían de identidades fijas y archivos de evidencia no versionados. Por eso se revisa también la ejecución desde un checkout limpio, sin declarar resuelto todo CI por cambiar un argumento.

## Cadena corregida

- El workflow declara únicamente endpoints públicos TEST; no incorpora secretos alojados ni `continue-on-error`.
- `test:infra:start` y `test:infra:reset` trabajan en `.supabase-test`, con proyecto `natillera-manager-test`. Ya no generan archivos de entorno como efecto secundario. El comando explícito `test:env:write` conserva esa opción local para compatibilidad.
- `test:rls` comprueba el contenedor TEST y su puerto antes de ejecutar cada archivo pgTAP; valida también el plan completo, sin ocultar aserciones fallidas.
- `test:e2e` usa `run-e2e.mjs`: valida overrides, topología Docker y disponibilidad HTTP, obtiene credenciales del CLI en memoria y prepara datos sintéticos antes de que Playwright descubra los archivos.
- `bootstrap-test.mjs` ya no invoca el bootstrap DEV ni `loadLocalEnv`: provisiona exclusivamente una identidad/workspace sintéticos en TEST.
- `playwright.config.ts` conserva el descubrimiento completo y los proyectos escritorio/móvil. Arranca `start-local-safe.mjs --test`, exige el puerto `5198`, deshabilita service workers y retira credenciales elevadas del entorno del hijo Vite.
- Cada proyecto ejecuta la colección completa con preparación independiente: el abono/cancelación de P011 en escritorio no se reutiliza como estado inicial de móvil. Un proyecto fallido no convierte el siguiente en omitido y el código de salida agregado sigue siendo fallido.
- Los procesos largos se esperan asíncronamente, sin bloquear el mantenimiento de conexiones HTTP del orquestador. Se liberan los cuerpos HTTP del preflight; los fallos de preparación conservan estado/tipo/mensaje seguro y aparecen como errores del conjunto, aunque ya haya terminado otro proyecto.
- Las comparaciones financieras UX en CI usan un oráculo SQL congelado antes de interactuar con el navegador. No se fabrica una evidencia «before» a partir de la UI actual. Los runners locales históricos mantienen sus rutas de comparación originales cuando no se usa ese oráculo.
- El arranque rechaza explícitamente los argumentos antiguos ambiguos. Para TEST verifica la misma topología que el runner y crea Vite con `mode: 'test'`, `envDir: false`, URL y clave pública obtenidas de TEST. DEV conserva su comando y modo `development`.
- Las suites comparten una protección de red. Los handlers de mocks continúan mediante `fallback` para que la guarda se aplique también después de un interceptor propio. `page.request` y el fixture `request` se validan por separado y no siguen redirecciones automáticamente.
- La protección incluye contextos creados manualmente mediante `browser.newContext`, WebSocket y bloqueo de service workers; no depende solamente del fixture `page` predeterminado.
- La instalación de Chrome en Ubuntu incluye sus dependencias de sistema. Un resumen del resultado queda como artefacto de Actions; no se suben archivos privados ni trazas crudas.

## Endpoints verificados

| Superficie | Destino permitido en CI | Verificación |
|---|---|---|
| Frontend | `http://127.0.0.1:5198` | Puerto estricto, sin reutilizar otro servidor, módulo Vite con `MODE=test` |
| Supabase API/PostgREST | `http://127.0.0.1:55421/rest/v1` | Estado CLI, HTTP y `PGRST_DB_URI` interno |
| Auth | `http://127.0.0.1:55421/auth/v1` | Health HTTP y `GOTRUE_DB_DATABASE_URL` interno |
| PostgreSQL | Host `127.0.0.1:55422`; contenedor `supabase_db_natillera-manager-test` | Binding Docker; Auth y REST deben apuntar al mismo contenedor |
| Correo OTP | `http://127.0.0.1:55424` | API de buzón sintético |

Las conexiones internas y credenciales no se imprimen. Fuera de app/API/correo se admiten exclusivamente recursos de fuentes Google en el navegador; no se admite ninguna API Supabase hospedada. Las guardas rechazan URLs DEV, alojadas, con credenciales o con origen parecido pero distinto antes de enviar peticiones. El test negativo usa el dominio reservado `production.invalid`, sin contactar producción.

La inspección local confirmó volúmenes distintos: `supabase_db_natillera-manager-test` para TEST y `supabase_db_natillera-manager` para DEV. No se detuvo ni reconstruyó DEV.

## Adaptaciones de regresión sin ocultar fallos

- Se conservan todos los casos existentes y se agrega el caso de aislamiento, en ambos proyectos: 250 casos totales en 18 archivos. Ocho son comprobaciones estáticas de integración COP; los otros 242 usan navegador.
- Los fixtures históricos QA se reconstruyen con RPC y contratos de las pruebas SQL versionadas: dos derechos nuevos por 100, retiro reconocido de 4.900, cuota EA de 30.000 y prepago de 30.694,63. Se mantiene el caso explícito de un recibo legacy sin derechos individuales, exclusivamente sintético.
- El resumen de Socios ahora muestra total aportado y última fecha. HU001 verifica ambos y consulta además el mes aplicado y el importe persistidos, en lugar de exigir el texto retirado «Octubre … 50.000».
- Se actualizan etiquetas de navegación/traslado y localizadores accesibles. Las cuentas finales verifican «Cálculo confirmado», pago persistido y estado «Pagada», en lugar de una notificación retirada.
- La navegación legacy de importación ya no es una ruta activa. La prueba comprueba su ausencia, conserva la revisión pura de un JSON sintético con `buildMigrationDryRun` y verifica recarga/historial por rutas actuales. No se vuelve a habilitar importación desde el cliente para satisfacer una prueba obsoleta.
- El respaldo esperado es `workspace.v3` con tablas SQL, en lugar del formato antiguo `abcd-fin.v2`. Se conservan comprobaciones de contenido y restricciones de restauración.
- La prueba de pago futuro calcula mañana desde `fin_civil_today`; el 17/oct no sigue siendo futuro después de esa fecha. No se cambia el reloj del servidor. Los importes 130.000, descuentos 20.000/50.000, pago único y balance de partidas permanecen exigidos.
- Los importes mal formados se prueban mediante pegado nativo, conservando su texto y exigiendo cero llamadas de previsualización. `fill` representa edición y puede reagrupar puntos válidamente; no se cambia `CopInput` para imponerle el comportamiento de pegado.
- Los cortes históricos sin prueba de estado exigen «No verificable» o «Fuera del periodo» según corresponda; el estado actual «Retirado» se comprueba al día civil SQL. El teclado recorre filtros, alta y acciones en su orden real, sin saltarlos en la expectativa.
- La traza de navegación UX14 ahora se sanea también al fallar y se adjunta dentro de la salida del test; deja de exportar un ZIP crudo con cabeceras de autenticación.
- HU001 deja de agrupar tres recorridos independientes como seriales y falla explícitamente si faltan credenciales TEST. Así un fallo inicial no oculta navegación y responsive ni permite dar el conjunto por aprobado con pruebas omitidas.

La corrida diagnóstica inicial se interrumpió después de confirmar las dependencias ausentes y expectativas antiguas. No se cuenta como resultado aprobado; se conserva su log. Las correcciones dirigidas preceden a la reconstrucción y corrida completa final.

## Reproducción local

```powershell
npm run test:e2e:guards
npm run test:infra:start
npm run test:infra:reset
npm run test:rls
npx playwright install --with-deps chrome
npm run test:e2e
node scripts/summarize-e2e.mjs
```

El reset elimina únicamente fixtures TEST. No usar `dev:db:migrate`, resets DEV, `--linked` ni claves de Supabase alojado para esta revisión. Los fixtures y resultados locales viven en `incoming/ci-database/` y están ignorados por Git.

## Evidencia y estado de ejecución

- Reconstrucción de TEST: 41 migraciones aplicadas desde cero, sin editar migraciones.
- Guardas: 11/11 pruebas Node aprobadas, incluida la espera asíncrona de subprocesos.
- SQL/RLS: 27/27 archivos, 686 aserciones aprobadas.
- Regresión unitaria: 29 archivos, 160 pruebas aprobadas; configuración sin dotenv.
- TypeScript y revisión de secretos: aprobados.
- Descubrimiento completo: 250 pruebas en 18 archivos, sin filtrar suites históricas.
- Ejecución completa E2E: **250/250 aprobadas**, 125 escritorio y 125 móvil, **0 fallidas, 0 omitidas y 0 flaky**. Código de salida de `npm run test:e2e`: 0. Ambos proyectos prepararon sus datos correctamente, sin DEV ni dotenv.
- Las 16 verificaciones dirigidas de los ocho casos UX corregidos también pasaron, sin omisiones, antes de repetir la colección completa.
- Revisión final de artefactos: **280 ZIP, 83.766 entradas, PASS**, sin JWT/claves elevadas detectadas ni trazas crudas. La secuencia local guardas → inicio TEST → reset local → SQL/RLS → E2E completo → artefactos terminó con código 0.

Evidencia local ignorada por Git: `incoming/ci-database-verified.log`, `ci-database-verified-guards.log`, `ci-database-verified-start.log`, `ci-database-verified-reset.log`, `ci-database-verified-rls.log`; informes `incoming/ci-database/chromium-results.json`, `mobile-results.json`, `results.json` y `summary.md`. `ci-database-verified-artifacts.log` registra la revisión de ZIP. Las salidas por proyecto son los informes JSON canónicos de Playwright; `results.json` agrega ambos sin eliminar fallos ni omisiones.

Los primeros fallos reproducidos en suites históricas son respuestas Auth 422 para una identidad sin seed versionado (`qa-audit-2026@example.test`); el servidor ya está conectado a TEST y no repite el preflight DEV. No se reducen expectativas para ocultar ese fallo.

La API GitHub accesible desde esta sesión devolvió 404 para el repositorio configurado y no hay GitHub CLI instalado como alternativa. La evidencia de ejecución obtenida aquí es local; no se afirma que Actions remoto esté verde ni se dispara un despliegue para verificarlo. Los cambios permanecen locales, sin commit, push ni incorporación a `main`, para revisión de Juan.

## Archivos de esta corrección

41 archivos de CI, scripts, pruebas y documentación. No se modifican `src/` ni migraciones SQL. Se conservan documentos locales preexistentes ajenos al cambio.

- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- [README.md](../../README.md)
- [docs/LOCAL_SETUP.md](../../docs/LOCAL_SETUP.md)
- [docs/qa/CI-DATABASE.md](../../docs/qa/CI-DATABASE.md)
- [e2e/audit-regressions.spec.ts](../../e2e/audit-regressions.spec.ts)
- [e2e/fin-qa-fixes.spec.ts](../../e2e/fin-qa-fixes.spec.ts)
- [e2e/fin-recon.spec.ts](../../e2e/fin-recon.spec.ts)
- [e2e/functional-audit.spec.ts](../../e2e/functional-audit.spec.ts)
- [e2e/functional-modules.spec.ts](../../e2e/functional-modules.spec.ts)
- [e2e/functional-money.spec.ts](../../e2e/functional-money.spec.ts)
- [e2e/functional-publications.spec.ts](../../e2e/functional-publications.spec.ts)
- [e2e/functional-zz-close.spec.ts](../../e2e/functional-zz-close.spec.ts)
- [e2e/hu001.spec.ts](../../e2e/hu001.spec.ts)
- [e2e/money-control.spec.ts](../../e2e/money-control.spec.ts)
- [e2e/reconciliation.spec.ts](../../e2e/reconciliation.spec.ts)
- [e2e/settlement-loans.spec.ts](../../e2e/settlement-loans.spec.ts)
- [e2e/test-fixtures.ts](../../e2e/test-fixtures.ts)
- [e2e/test-isolation.spec.ts](../../e2e/test-isolation.spec.ts)
- [e2e/ui-boundaries.spec.ts](../../e2e/ui-boundaries.spec.ts)
- [e2e/ux13.spec.ts](../../e2e/ux13.spec.ts)
- [e2e/ux14.spec.ts](../../e2e/ux14.spec.ts)
- [e2e/ux15.spec.ts](../../e2e/ux15.spec.ts)
- [e2e/ux16.spec.ts](../../e2e/ux16.spec.ts)
- [package.json](../../package.json)
- [playwright.config.ts](../../playwright.config.ts)
- [scripts/bootstrap-test.mjs](../../scripts/bootstrap-test.mjs)
- [scripts/check-audit-artifacts.mjs](../../scripts/check-audit-artifacts.mjs)
- [scripts/lib/async-command.mjs](../../scripts/lib/async-command.mjs)
- [scripts/lib/audit-test-runtime.mjs](../../scripts/lib/audit-test-runtime.mjs)
- [scripts/lib/test-target.d.mts](../../scripts/lib/test-target.d.mts)
- [scripts/lib/test-target.mjs](../../scripts/lib/test-target.mjs)
- [scripts/prepare-test-supabase.mjs](../../scripts/prepare-test-supabase.mjs)
- [scripts/run-e2e.mjs](../../scripts/run-e2e.mjs)
- [scripts/seed-audit-extended.mjs](../../scripts/seed-audit-extended.mjs)
- [scripts/seed-e2e-invariants.mjs](../../scripts/seed-e2e-invariants.mjs)
- [scripts/seed-regression-test.mjs](../../scripts/seed-regression-test.mjs)
- [scripts/start-local-safe.mjs](../../scripts/start-local-safe.mjs)
- [scripts/summarize-e2e.mjs](../../scripts/summarize-e2e.mjs)
- [scripts/test-e2e-guards.mjs](../../scripts/test-e2e-guards.mjs)
- [scripts/test-supabase.mjs](../../scripts/test-supabase.mjs)
- [scripts/write-test-env.mjs](../../scripts/write-test-env.mjs)
