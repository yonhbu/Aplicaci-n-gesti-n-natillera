# Natillera Manager

Aplicacion privada para gestionar la base de Natillera con React, TypeScript, Vite y Supabase.

Auditoría funcional 2026-10-26: correcciones locales y evidencia en [docs/qa/INFORME-AUDITORIA.md](docs/qa/INFORME-AUDITORIA.md), estado `READY_FOR_REVIEW`. Consulta [reglas vigentes](docs/BUSINESS_RULES.md) y [setup de auditoría sin dotenv](docs/LOCAL_SETUP.md). Los alcances A/B/C/D descritos abajo son antecedentes; no representan por sí solos el estado posterior de FIN, conciliaciones, reversos y respaldo `natillera-manager.workspace.v3`.

Comandos de esta entrega: `npm run qa:functional:unit`, `npm run qa:functional:all`, `npm run qa:functional:build` y `npm run test:rls`. `qa:functional:e2e` limita la ejecución a escenarios nuevos. `npm run test:e2e` prepara fixtures sintéticos y ejecuta todas las suites en escritorio y móvil sobre TEST, sin dotenv. [Cadena de CI, guardas y evidencias](docs/qa/CI-DATABASE.md).

Estado actual: `NAT-HU-001`, `NAT-HU-002`, `NAT-HU-003`, `NAT-HU-004`, `NAT-HU-005` y `NAT-HU-006` en `READY_FOR_REVIEW`.

Correccion ABC 2026-10-09: se cerraron invariantes de hash de previsualizacion, cortes historicos, idempotencia de reintentos, reversos dependientes, politica aprobada de reparto y centavos residuales.

Carga legacy operativa 2026-10-10: por autorizacion explicita de Juan se cargo el JSON/CSV real 2026 en DEV local operativo, con hash SHA-256 verificado, RPC transaccional idempotente y verificacion directa de conteos/totales. La entrega queda en `READY_FOR_REVIEW`; no implica despliegue, cierre de ciclo, comprobantes privados ni aceptacion `DONE`.

## Alcance HU-001

- Login por OTP de email con usuarios previamente provisionados.
- Resolucion de workspace/ciclo sin auto-crear acceso desde el cliente.
- Socios del ciclo y configuracion descriptiva de cuota/rango.
- Registro persistente de aportes de ahorro mediante RPC idempotente.
- Guardado transaccional de socios/participaciones mediante RPC.
- Calculo puro de rendimiento reconocido por fechas y previsualizacion de retiro.
- Prevalidacion local de fuentes legacy elegidas por el usuario.
- Exportacion del alcance implementado con version de formato.

No incluye liquidaciones reales, banco, comprobantes privados ni migracion completa.

La HU-001 sigue en `READY_FOR_REVIEW`; las correcciones de revision no la convierten en migracion completa ni en reemplazo operativo.

## Alcance Bloque B

- Registro financiero central con operaciones y partidas balanceadas.
- Contratos de prestamo para socios o deudores externos, desembolso separado por RPC y cobros con aplicacion explicita a capital/interes.
- Separacion contable entre caja, cartera, fondo de utilidad de prestamos, administracion por pagar, bolsa de polla, premios por pagar y ahorro.
- Actividades de polla por periodo, aportes identificados, premio bruto, comision fija y pago neto separado.
- Reglas verificadas para interes EA ACT/365F, cronograma amortizado, reparto 10/90 de intereses, distribucion igualitaria base, prepago y premio neto de polla.

El Bloque B no acepta A como `DONE`, no despliega, no importa datos reales y no habilita liquidaciones, banco real, conciliacion productiva ni comprobantes privados.

## Alcance Bloque C

- Cuentas bancarias descriptivas sin credenciales, movimientos bancarios reales registrados por RPC, ubicacion de liquidez entre banco, efectivo y pendiente.
- Conciliacion por cuenta/corte con diferencia visible sin crear ajustes automaticos.
- Liquidacion en tres pasos: previsualizar, confirmar obligacion y registrar pago efectivo separado.
- Compensacion de prestamos/premios sin caja ficticia, incluyendo acuerdo P013 versionado para primer mes de interes.
- Reparto de utilidad de prestamos con snapshot, reservas/obligaciones separadas y pago bloqueado si falta liquidez.
- Politicas de reparto aprobadas explicitamente, residual de centavos no negativo y pagos trazados por beneficiario en snapshot/asignaciones.

El Bloque C no despliega, no importa datos reales, no conecta APIs bancarias, no ejecuta transferencias externas y no habilita migracion completa legacy.

## Alcance Bloque D

- Dry-run de migracion con inventario por fuente, SHA-256, copia de trabajo local ignorada por Git, mapeos, incidencias y conciliacion.
- Staging SQL para lotes, mapeos, incidencias, procedencia y exportes ABC+D con RLS de lectura por workspace.
- Scripts `block-d:*` con guardas que se niegan a escribir fuera de TEST local `http://127.0.0.1:55421`.
- Ensayo parcial aislado: solo publica socios y aportes verificables; prestamos, pagos booleanos, premios inciertos, politicas y comprobantes sin bytes quedan en staging/incidencias.
- Exportacion `natillera-manager.abcd.v1` y restauracion verificada en destino vacio de archivos y workspace vacio dentro de TEST.

El Bloque D no despliega, no cambia DEV operativo, no importa productivamente datos reales y no declara comprobantes migrados si faltan bytes.

## Comandos

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run check:secrets
npm run dev:infra:start
npm run dev:db:migrate
npm run dev:bootstrap
npm run test:infra:start
npm run test:infra:reset
npm run test:rls
npm run test:e2e
npm run block-d:fixture
npm run block-d:dry-run -- --json incoming/block-d/fixtures/migration-d-fixture.json --csv incoming/block-d/fixtures/migration-d-fixture.csv
npm run block-d:stage -- --report incoming/block-d/reports/dry-run-<hash>.json
npm run block-d:publish-trial -- --report incoming/block-d/reports/dry-run-<hash>.json --allow-partial
npm run block-d:export -- --report incoming/block-d/reports/dry-run-<hash>.json
npm run block-d:restore-check -- --export incoming/block-d/exports/natillera-abcd-<hash>.json --to-test-db
npm run legacy:import-2026 -- --json <ruta-json-real-fuera-de-git> --csv <ruta-csv-real-fuera-de-git>
```

## Configuracion local

Para DEV recuperado, inicia Supabase local y ejecuta `npm run dev`: resuelve la URL y clave pública en memoria y no abre dotenv del PC anterior. `npm run dev:test` apunta al TEST independiente. [Setup local y auditoría](docs/LOCAL_SETUP.md). No uses correos reales de terceros en pruebas. El bootstrap es para instalaciones vacías; no repetirlo ni añadir datos demo a la base operativa restaurada.

## Seguridad

El cliente no contiene claves elevadas. RLS limita lectura por workspace. Los aportes de ahorro, desembolsos, cobros de prestamos, aportes de polla, pagos de premios monetarios, movimientos bancarios, liquidaciones y repartos se escriben por RPC idempotentes con auditoria y partidas financieras en la misma transaccion. Los scripts D usan credencial elevada solo en CLI local TEST, nunca en frontend ni exportaciones.
