# Entrega Bloque A - NAT-HU-001

Fecha: 2026-10-07. Rama local: `fix/hu001-review-corrections`.

Estado: `READY_FOR_REVIEW`. No esta aceptado como `DONE` y no reemplaza la natillera operativa.

## Cambios entregados

- Correcciones HU-001 de la revision: idempotencia de extremo a extremo, retiro sin capital futuro, prevalidacion legacy robustecida, paginacion, bootstrap no destructivo y aislamiento DEV/TEST.
- Cierre tecnico adicional: intento pendiente de aporte persistente ante recarga/error ambiguo, payload canonico para evitar claves nuevas por formato monetario, fechas SQL finitas y grant explicito del helper RLS.
- Migracion incremental `20261006000200_correct_hu001_review_findings.sql` con validaciones servidor, identidades inmutables, RPC transaccional para socios/participaciones, auditoria y grants mas cerrados.
- Scripts locales reales:
  - `npm run dev:doctor`
  - `npm run dev:env:write`
  - `npm run dev:bootstrap`
  - `npm run dev:demo`
  - `npm run dev:open`
  - `npm run test:infra:start`
  - `npm run test:infra:reset`
  - `npm run test:rls`
  - `npm run test:e2e`
- E2E preparado para OTP completo, socio, aporte, recarga y usuario sin membresia sobre Supabase TEST.
- CI actualizado para ejecutar SQL/RLS y E2E en el job de base de datos.

## Inventario de respaldos privados

Se genero manifiesto SHA-256 local ignorado por Git en `incoming/manifests/legacy-sources-2026-10-06.sha256.json`.

Fuentes inventariadas desde la carpeta local de descargas:

| Fuente | Estado |
| --- | --- |
| CSV legacy de operaciones | Encontrado e inventariado |
| JSON legacy exportado del navegador | Encontrado e inventariado |
| Prompt de migracion Supabase | Encontrado e inventariado |
| Diagnostico financiero | Encontrado e inventariado |
| Revision HU-001 y correcciones | Encontrado e inventariado |

Comprobantes originales: no se recibio una carpeta/archivo separado con bytes de imagen. Las marcas del JSON no son los comprobantes.

## Verificaciones ejecutadas

| Comando | Estado | Codigo | Resultado |
| --- | --- | ---: | --- |
| `npm run typecheck` | APROBADO | 0 | TypeScript sin errores |
| `npm run test` | APROBADO | 0 | 6 archivos, 18 pruebas aprobadas |
| `npm run build` | APROBADO | 0 | Build Vite/PWA generado |
| `npm run check:secrets` | APROBADO | 0 | Sin secretos/datos privados rastreados detectados |
| `npm run dev:doctor` | APROBADO con advertencia | 0 | Node, npm, Supabase CLI y Docker OK; `.env.local` faltante |
| `npm run test:infra:reset` | APROBADO | 0 | Base TEST descartable reiniciada y migraciones aplicadas |
| `npm run test:rls` | APROBADO | 0 | 1 archivo SQL, 30 pruebas aprobadas |
| `npm run test:e2e` | APROBADO | 0 | 2 pruebas aprobadas: escritorio `chromium` y perfil `mobile` |
| `npm run test:infra:stop` | APROBADO | 0 | Stack TEST detenido |

## Pendiente para revision local

1. Crear `.env.local` para DEV con `npm run dev:env:write` cuando el stack DEV este activo.
2. Ejecutar recorrido manual de `docs/LOCAL_SETUP.md`, incluida prueba RPC idempotente en Studio local.
3. Validar en iPhone fisico solo cuando exista perfil LAN/HTTPS y Supabase accesible desde el dispositivo.

## Limites

- No hay migracion completa de datos reales.
- No se habilitaron prestamos, pollas, liquidaciones reales, banco ni comprobantes privados.
- La prevalidacion inspecciona fuentes elegidas por el usuario; no importa operaciones.
- Prueba fisica en iPhone queda pendiente de perfil LAN/HTTPS y Supabase accesible desde el dispositivo.
