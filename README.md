# Natillera Manager

Aplicacion privada para gestionar la base de Natillera con React, TypeScript, Vite y Supabase.

Estado actual: `NAT-HU-001 READY_FOR_REVIEW`.

## Alcance HU-001

- Login por OTP de email con usuarios previamente provisionados.
- Resolucion de workspace/ciclo sin auto-crear acceso desde el cliente.
- Socios del ciclo y configuracion descriptiva de cuota/rango.
- Registro persistente de aportes de ahorro mediante RPC idempotente.
- Guardado transaccional de socios/participaciones mediante RPC.
- Calculo puro de rendimiento reconocido por fechas y previsualizacion de retiro.
- Prevalidacion local de fuentes legacy elegidas por el usuario.
- Exportacion del alcance implementado con version de formato.

No incluye prestamos, pollas, liquidaciones reales, banco, comprobantes privados ni migracion completa.

La HU-001 sigue en `READY_FOR_REVIEW`; las correcciones de revision no la convierten en migracion completa ni en reemplazo operativo.

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
```

## Configuracion local

Copia `.env.example` a `.env.local` y ajusta valores locales. No uses correos reales de terceros en pruebas. El bootstrap crea usuarios Auth confirmados, workspace, membresia admin y ciclo; no envia invitaciones.

## Seguridad

El cliente no contiene claves elevadas. RLS limita lectura por workspace y los aportes se escriben por `register_savings_contribution`, con idempotencia y auditoria en la misma transaccion.
