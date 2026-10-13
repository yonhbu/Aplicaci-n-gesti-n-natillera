# Estado del proyecto

## NAT-HU-001

Estado: `READY_FOR_REVIEW`

Implementado:

- Proyecto Vite/React/TypeScript.
- Supabase local separado con migracion HU-001.
- Auth OTP sin autosignup desde cliente.
- Workspace/ciclo por bootstrap local.
- Socios, cycle members y aportes de ahorro persistentes.
- RPC idempotente para aportes con auditoria.
- Dominio puro de fechas, dinero, rendimiento y previsualizacion de retiro.
- Prevalidacion legacy local desde archivos elegidos por el usuario.
- Export HU-001 versionado.
- Scripts de build, tests, secretos, DEV/TEST Supabase y Netlify.
- Correcciones de revision HU-001: idempotencia de formulario, validaciones SQL, RPC transaccional para socios, identidades inmutables, retiro sin capital futuro, prevalidacion legacy robustecida, paginacion completa, bootstrap no destructivo y TEST aislado.
- Cierre tecnico A: intento pendiente de aporte persistente ante recarga/error ambiguo, payload canonico para reintento, fechas SQL finitas, grant explicito del helper RLS y salida TEST sin llaves locales.

Pendiente de revision:

- Validar visualmente con el navegador local.
- Confirmar datos reales antes de cualquier migracion completa.
- Revisar los comprobantes originales: no se recibio una fuente de bytes de imagen separada.

## NAT-HU-002 y NAT-HU-003

Estado: `READY_FOR_REVIEW`

Implementado:

- Migracion incremental de Bloque B con `financial_operations` y `ledger_entries`.
- RPC transaccionales e idempotentes para crear contrato de prestamo, confirmar desembolso, registrar cobro, registrar aporte de polla, asignar premio y pagar premio neto.
- Tablas de dominio para contratos, cronogramas, pagos, actividades de polla, aportes, premios y pagos de premios.
- RLS por workspace para lectura y gestion permitida; escrituras monetarias directas quedan cerradas al cliente.
- UI operativa para prestamos/cobros, resumen financiero reconstruido desde ledger, pollas y premios.
- Reglas puras probadas para interes EA ACT/365F, 10/90 de interes cobrado, distribucion igualitaria base, cotizacion P013 y premio neto de polla.
- Correccion B 2026-10-09: ahorro enlazado a ledger en transaccion, cronogramas amortizado/EA corregidos, cobros bloqueados para borradores/sobrecapital, idempotencia con payload canonico, ciclos cruzados rechazados en polla, fechas visibles de polla, prepago cotizado por servidor y exportacion A+B.

Limites vigentes de B:

- Banco real, conciliacion, liquidaciones, reparto final de utilidad, reversos operativos de UI, importacion productiva y comprobantes privados siguen fuera de alcance.
- La caja inicial de pruebas puede quedar negativa en escenarios ficticios de desembolso; no es conciliacion bancaria.
- Los respaldos reales se conservan fuera de Git; B no declara migracion completa.

## NAT-HU-004 y NAT-HU-005

Estado: `READY_FOR_REVIEW`

Implementado:

- Banco/conciliacion con cuentas descriptivas, apertura verificada ficticia, intereses recibidos, comisiones y transferencias internas por RPC.
- Ubicacion de liquidez en partidas `cash`: banco, efectivo y pendiente; no se duplica banco como saldo aparte de caja.
- Conciliaciones con saldo externo, saldo reconstruido y diferencia visible sin ajuste automatico.
- Liquidaciones con previsualizacion, confirmacion transaccional, snapshot/hash, cambio de participacion de ahorro y pago efectivo separado.
- Compensacion de premios y prestamos sin entrada ficticia de caja; P013 usa marca de acuerdo `P013_FIRST_MONTH`.
- Reparto de utilidad de prestamos con politica versionada, reservas/obligaciones separadas, elegibilidad igualitaria y pago bloqueado por liquidez insuficiente.
- UI operativa para banco, conciliacion, liquidacion y utilidad; exportacion versionada `natillera-manager.abc.v1`.
- Correccion ABC 2026-10-09: regresiones reproducidas para hash nulo, corte historico, idempotencia de reintentos, reversos, politica aprobada, centavos residuales y aperturas unicas.
- UI B/C conserva claves idempotentes pendientes por accion financiera y bloquea reemplazar una operacion incierta con otra carga.

Limites vigentes de C:

- Politicas reales de destino para penalidad, cuota anual, reservas y costos siguen pendientes de confirmacion operativa; los fixtures usan parametros ficticios identificados.
- No hay importacion productiva de JSON/CSV, comprobantes privados, conexion bancaria externa, despliegue ni cierre de ciclo.
- Reversos de liquidaciones/repartos con dependencias quedan bloqueados para flujo dedicado; no se borra historia.
- No se implemento importacion D; solo queda preparado el criterio para inventario/ensayo posterior.

## NAT-HU-006

Estado: `READY_FOR_REVIEW`

Implementado:

- Dominio de migracion D para inventario JSON/CSV, mapeo, incidencias, conciliacion y precondiciones ABC.
- Preservacion local de originales/copia de trabajo en `incoming/block-d/`, ignorado por Git, con SHA-256.
- Migracion SQL `20261009000400_block_d_migration_staging.sql` con lotes, mapeos, incidencias, procedencia, exportes y RLS.
- Scripts `block-d:fixture`, `block-d:dry-run`, `block-d:stage`, `block-d:publish-trial`, `block-d:export` y `block-d:restore-check`, con escritura permitida solo sobre TEST local.
- UI de dry-run D en la seccion legacy y exportacion `natillera-manager.abcd.v1`.
- Ensayo fixture en TEST: lote staged/blocked por incidencias, publicacion parcial explicita de 2 socios y 2 aportes verificables, 2 operaciones y 4 partidas balanceadas.
- Restauracion verificada desde export ABC+D en destino vacio de archivos y workspace vacio dentro de TEST.
- Carga real operativa 2026 autorizada el 2026-10-10: JSON y CSV con SHA-256 esperado, importados primero en TEST descartable y luego en DEV local operativo por RPC transaccional `import_natillera_legacy_2026`.
- Datos cargados y verificados en DEV local: 11 socios, 107 aportes de ahorro por $15.400.000, 13 prestamos por $19.420.964, 84 filas de cronograma con 51 marcas legacy pagadas, 19 aportes de polla por $990.000, 4 multas por $20.000 y 8 premios brutos por $390.000.
- Las marcas pagadas de prestamos legacy quedaron como declaracion historica sin fechas de caja: capital $8.985.108 e interes $1.498.052 reducen saldo legacy sin crear cobros ficticios.
- P013 quedo como unico prestamo con acuerdo `P013_FIRST_MONTH`; los 8 premios quedan con pago historico no verificado.

Limites vigentes de D:

- No se recibieron bytes reales de comprobantes en este hilo.
- No hay despliegue, cierre de ciclo ni aceptacion `DONE`.
- Prestamos, pagos booleanos, premios inciertos, politicas de liquidacion/utilidad y comprobantes sin bytes no se publican automaticamente.
- El segundo destino de restauracion usado es un workspace vacio dentro de la base TEST aislada, no una instancia productiva.

## Verificaciones ejecutadas

- `npm run check:secrets`: aprobado.
- `npm run typecheck`: aprobado.
- `npm run test`: aprobado tras correcciones ABC, 9 archivos y 31 pruebas.
- `npm run build`: aprobado.
- `npm run test:infra:reset`: aprobado sobre `.supabase-test`.
- `npm run test:rls`: aprobado tras Bloque D con 6 archivos SQL, 158 pruebas.
- `npm run test:e2e`: 2 pruebas aprobadas, proyectos `chromium` y `mobile`.
- Bloque C/ABC corregido: `npm run typecheck` aprobado; `npm run test` aprobado, 9 archivos y 31 pruebas; `npm run test:rls` aprobado, 5 archivos SQL y 144 pruebas; `PLAYWRIGHT_PORT=5177 npm run test:e2e` aprobado, 2 pruebas.
- Bloque D: `npm run typecheck` aprobado; `npm run test` aprobado, 10 archivos y 34 pruebas; `npm run check:secrets` aprobado; `npm run build` aprobado; `npm run test:rls` aprobado, 6 archivos SQL y 158 pruebas; `PLAYWRIGHT_PORT=5177 npm run test:e2e` aprobado, 2 pruebas; `npm run block-d:dry-run` fixture aprobado; `npm run block-d:stage` fixture aprobado en TEST; `npm run block-d:publish-trial -- --allow-partial` aprobo con 2 socios/2 aportes; `npm run block-d:export` y `npm run block-d:restore-check -- --to-test-db` aprobados.
- Carga real 2026: `npm run typecheck` aprobado; `npm run test:infra:reset` aplico migraciones `20261010000100_import_legacy_2026_operational.sql` y `20261010000200_fix_legacy_import_operation_types.sql`; `npm run legacy:import-2026` aprobado en TEST; reintento TEST devolvio el mismo lote; verificacion directa TEST aprobo conteos/totales; `npm run dev:db:migrate` aplico las migraciones en DEV sin reset; `npm run legacy:import-2026` aprobado en DEV; reintento DEV devolvio el mismo lote `c7c15e78-6865-494b-883d-dedacde22dc3`; verificacion directa DEV aprobo conteos/totales.
- Servidor Vite local: responde en `http://127.0.0.1:5176`.
- Rama local de Bloque B: `feature/block-b-hu002-hu003`.
- Manifiesto SHA-256 local de fuentes entregadas: `incoming/manifests/legacy-sources-2026-10-06.sha256.json`, ignorado por Git.
- `npm run test:infra:stop`: aprobado; stack TEST detenido.

## Verificaciones no ejecutadas

- Prueba fisica en iPhone: no ejecutada. Requiere perfil LAN/HTTPS y Supabase accesible desde el dispositivo.
