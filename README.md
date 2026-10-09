# Natillera Manager

Aplicacion privada para gestionar la base de Natillera con React, TypeScript, Vite y Supabase.

Estado actual: `NAT-HU-001`, `NAT-HU-002`, `NAT-HU-003`, `NAT-HU-004` y `NAT-HU-005` en `READY_FOR_REVIEW`.

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

El Bloque C no despliega, no importa datos reales, no conecta APIs bancarias, no ejecuta transferencias externas y no habilita migracion completa legacy.

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

El cliente no contiene claves elevadas. RLS limita lectura por workspace. Los aportes de ahorro, desembolsos, cobros de prestamos, aportes de polla, pagos de premios monetarios, movimientos bancarios, liquidaciones y repartos se escriben por RPC idempotentes con auditoria y partidas financieras en la misma transaccion.
