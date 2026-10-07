# Decisiones

## 2026-10-06 - Alcance estricto HU-001

Hecho: la implementacion activa es solo NAT-HU-001.

Decision: no se implementan prestamos, pollas, liquidaciones reales, banco ni comprobantes privados.

Motivo: esos modulos requieren reglas y operaciones atomicas propias; simularlos ahora crearia informacion financiera falsa.

## 2026-10-06 - Aportes por RPC

Decision: `savings_contributions` no acepta insert/update/delete directos desde el cliente; se usa `register_savings_contribution`.

Motivo: idempotencia, validacion de membresia y auditoria deben ocurrir en la misma transaccion.

## 2026-10-06 - Legacy solo prevalidado

Decision: HU-001 inspecciona CSV/JSON seleccionados por el usuario en el navegador y no versiona ni importa datos reales.

Motivo: el respaldo completo y los comprobantes requieren una HU de migracion con conciliacion y decisiones explicitas.

## 2026-10-06 - Correcciones bloqueantes de revision HU-001

Hecho: la revision de HU-001 identifico riesgos de duplicacion por reintento, validaciones SQL incompletas, guardado no atomico de socios, aportes futuros incluidos en retiro, inventario legacy insuficiente y mezcla posible de DEV/TEST.

Decision: mantener `READY_FOR_REVIEW` y corregir sin ampliar alcance funcional. Socios/participaciones se guardan por RPC transaccional; aportes se validan en servidor; identidades de participacion son inmutables; TEST se selecciona de forma explicita; y la prevalidacion legacy reporta inventario por fuente.

Motivo: aceptar HU-001 con esos defectos crearia riesgo financiero real antes de migrar o reemplazar la app operativa.
