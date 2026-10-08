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

## Verificaciones ejecutadas

- `npm run check:secrets`: aprobado.
- `npm run typecheck`: aprobado.
- `npm run test`: 6 archivos, 18 pruebas aprobadas.
- `npm run build`: aprobado.
- `npm run test:infra:reset`: aprobado sobre `.supabase-test`.
- `npm run test:rls`: 1 archivo SQL, 30 pruebas aprobadas.
- `npm run test:e2e`: 2 pruebas aprobadas, proyectos `chromium` y `mobile`.
- Servidor Vite local: responde en `http://127.0.0.1:5176`.
- Rama local de correcciones: `fix/hu001-review-corrections`.
- Manifiesto SHA-256 local de fuentes entregadas: `incoming/manifests/legacy-sources-2026-10-06.sha256.json`, ignorado por Git.
- `npm run test:infra:stop`: aprobado; stack TEST detenido.

## Verificaciones no ejecutadas

- Prueba fisica en iPhone: no ejecutada. Requiere perfil LAN/HTTPS y Supabase accesible desde el dispositivo.
