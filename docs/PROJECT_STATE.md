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

Limites vigentes de C:

- Politicas reales de destino para penalidad, cuota anual, reservas y costos siguen pendientes de confirmacion operativa; los fixtures usan parametros ficticios identificados.
- No hay importacion productiva de JSON/CSV, comprobantes privados, conexion bancaria externa, despliegue ni cierre de ciclo.
- Reversos de liquidaciones/repartos con dependencias quedan bloqueados para flujo dedicado; no se borra historia.

## Verificaciones ejecutadas

- `npm run check:secrets`: aprobado.
- `npm run typecheck`: aprobado.
- `npm run test`: 8 archivos, 27 pruebas aprobadas.
- `npm run build`: aprobado.
- `npm run test:infra:reset`: aprobado sobre `.supabase-test`.
- `npm run test:rls`: aprobado en Bloque C con 4 archivos SQL, 116 pruebas.
- `npm run test:e2e`: 2 pruebas aprobadas, proyectos `chromium` y `mobile`.
- Bloque C: `npm run typecheck` aprobado; `npm run test` aprobado, 8 archivos y 27 pruebas; `npm run test:infra:reset && npm run test:e2e` aprobado, 2 pruebas.
- Servidor Vite local: responde en `http://127.0.0.1:5176`.
- Rama local de Bloque B: `feature/block-b-hu002-hu003`.
- Manifiesto SHA-256 local de fuentes entregadas: `incoming/manifests/legacy-sources-2026-10-06.sha256.json`, ignorado por Git.
- `npm run test:infra:stop`: aprobado; stack TEST detenido.

## Verificaciones no ejecutadas

- Prueba fisica en iPhone: no ejecutada. Requiere perfil LAN/HTTPS y Supabase accesible desde el dispositivo.
