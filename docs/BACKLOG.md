# Backlog

## NAT-HU-002

Registro financiero minimo, prestamos/contratos, cobros reales y caja. No duplicar aportes HU-001 como nueva caja sin transicion idempotente.

Estado: `READY_FOR_REVIEW` en Bloque B corregido y revisado dentro del cierre ABC. Pendiente de aceptacion de Juan, pantalla operativa completa de reversos y validaciones finales de politica financiera para pasar a paquetes posteriores.

## NAT-HU-003

Actividades de polla, participantes por mes, premios netos, comisiones y derechos de retirados.

Estado: `READY_FOR_REVIEW` en Bloque B corregido. Pendiente de aceptacion de Juan y de conciliacion/migracion legacy en paquete posterior.

## NAT-HU-004

Liquidacion atomica con reglas/versiones, compensacion de deudas, administracion y pago separado.

Estado: `READY_FOR_REVIEW` en Bloque C con correcciones ABC. Pendiente de aceptacion de Juan, politicas reales de destino para penalidad/cuota/otros descuentos y reversos operativos completos.

## NAT-HU-005

Banco real, conciliacion, reservas, reparto de utilidad neta y dashboard consistente.

Estado: `READY_FOR_REVIEW` en Bloque C para registro bancario manual, conciliacion, reservas y reparto de utilidad de prestamos con fixtures ficticios. Correccion ABC exige politica aprobada y residual no negativo. Pendiente de aceptacion de Juan, conciliacion real de fuentes actuales, politica real de reservas/costos y migracion D.

## NAT-HU-006

Migracion completa con JSON vigente, decisiones explicitas, comprobantes privados y conciliacion.

Estado: `READY_FOR_REVIEW` en Bloque D y carga real local 2026. Se ejecuto importacion operativa autorizada del JSON/CSV real en DEV local, con ensayo TEST, hash, lote idempotente y verificacion de conteos/totales. Pendiente de revision de Juan, comprobantes privados si existen, validacion visual/operativa y decision explicita antes de despliegue o `DONE`.

## NAT-HU-007

Archivo/cierre de ciclos conservando cartera y obligaciones.
