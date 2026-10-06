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

Pendiente de revision:

- Ejecutar pruebas SQL/E2E cuando Docker Desktop este corriendo.
- Validar visualmente con el navegador local.
- Confirmar datos reales antes de cualquier migracion completa.

## Verificaciones ejecutadas

- `npm run check:secrets`: aprobado.
- `npm run typecheck`: aprobado.
- `npm run test`: 4 archivos, 12 pruebas aprobadas.
- `npm run build`: aprobado.
- Servidor Vite local: responde en `http://127.0.0.1:5176`.

## Verificaciones no ejecutadas

- `npm run test:rls` y `npm run test:e2e`: Docker no estaba disponible; la conexion al daemon fallo antes de iniciar Supabase TEST.
