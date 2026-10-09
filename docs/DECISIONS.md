# Decisiones

## 2026-10-06 - Alcance estricto HU-001

Hecho: la implementacion activa es solo NAT-HU-001.

Decision: no se implementan prestamos, pollas, liquidaciones reales, banco ni comprobantes privados.

Motivo: esos modulos requieren reglas y operaciones atomicas propias; simularlos ahora crearia informacion financiera falsa.

Vigencia: reemplazada parcialmente por la orden de Bloque B del 2026-10-07 para implementar solo NAT-HU-002 y NAT-HU-003. Liquidaciones reales, banco, comprobantes privados e importacion completa siguen bloqueados.

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

## 2026-10-07 - Cierre tecnico de bloque A

Decision: persistir localmente la operacion de aporte pendiente con clave idempotente y payload canonico hasta resolverla, y reforzar SQL con fechas finitas y grants explicitos.

Motivo: una respuesta perdida o recarga no debe convertir un reintento ambiguo en otro aporte; las politicas RLS no deben depender de privilegios heredados; y el servidor debe rechazar fechas no finitas aunque el frontend valide.

## 2026-10-07 - Bloque B con ledger minimo balanceado

Hecho: NAT-HU-002 y NAT-HU-003 requieren operaciones monetarias atomicas para prestamos, cobros, pollas y premios.

Decision: usar `financial_operations` como cabecera idempotente y `ledger_entries` como partidas balanceadas por operacion, sin plan contable configurable ni motor ERP. Las tablas de prestamos y polla son tablas de dominio; el ledger es la fuente comun de saldos publicados.

Motivo: una sola lista de caja no representa cartera, obligaciones, fondos y premios pendientes. El par operacion/partidas permite demostrar balance, idempotencia y trazabilidad sin sobredisenar el sistema.

Limite: los reversos completos, banco real, conciliacion, liquidacion y reparto final quedan para HUs posteriores.

## 2026-10-09 - Correccion de invariantes financieras de Bloque B

Hecho: la revision de B reprodujo defectos en cronogramas, ahorro sin ledger, sobrecobros, idempotencia parcial y mezcla de ciclos.

Decision: mantener el nucleo operacion/partidas y agregar una migracion incremental correctiva. Ahorro nuevo enlaza ledger en la misma transaccion; prestamos se crean como borrador y se desembolsan aparte; cobros bloquean estado/saldo bajo lock; polla se crea por RPC; y la idempotencia compara payload economico antes de cualquier efecto lateral.

Motivo: corregir historia mediante migraciones nuevas preserva trazabilidad y evita ocultar defectos ya revisados.
