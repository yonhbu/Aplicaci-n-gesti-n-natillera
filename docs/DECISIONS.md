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
