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

## 2026-10-09 - Bloque C sobre el mismo ledger

Hecho: NAT-HU-004 y NAT-HU-005 requieren banco, conciliacion, liquidaciones y reparto sin duplicar saldos ni crear caja ficticia.

Decision: extender `ledger_entries` con ubicacion de liquidez (`bank`, `cash`, `unknown`) y cuenta bancaria opcional solo para partidas `cash`; mantener `financial_operations` como cabecera idempotente comun.

Motivo: banco y efectivo son ubicaciones del activo liquido, no saldos paralelos. Los movimientos previos sin ubicacion verificable quedan como `unknown`.

## 2026-10-09 - Politicas pendientes no se inventan

Decision: penalidad, cuota anual, otros descuentos, reservas y costos se registran con parametros/versiones explicitos. En C los fixtures usan politicas ficticias identificadas; la confirmacion real requiere politica operativa posterior.

Motivo: convertir acuerdos puntuales en regla global o asignar destinos sin evidencia distorsiona utilidad, obligaciones y liquidez.

## 2026-10-09 - Liquidacion y utilidad en dos fases monetarias

Decision: confirmar liquidacion/reparto crea obligaciones y snapshots; el pago efectivo se registra despues contra banco o efectivo con referencia y control de liquidez.

Motivo: una obligacion confirmada no debe disminuir dinero liquido hasta que exista pago real, y un reintento no debe pagar dos veces.

## 2026-10-09 - Cierre de invariantes ABC

Hecho: la revision ABC reprodujo fallos de hash nulo, cobros posteriores usados en cortes historicos, idempotencia validada despues de estados mutados, reversos que dejaban entidades desincronizadas, sobreasignacion de centavos y politicas libres de reparto.

Decision: agregar migracion incremental correctiva y pruebas de regresion. Las RPC resuelven idempotencia antes de validar estado/saldo cambiado por su propio commit; hashes nulos se rechazan; la deuda al corte usa operaciones fechadas y reversos efectivos; liquidaciones retroactivas con cobros posteriores se bloquean; pagos de liquidacion/reparto reversados reabren obligaciones; desembolsos con cobros/compensaciones no se reversan genericamente; una apertura bancaria es unica y la financiacion posterior usa tipo separado; el reparto exige politica aprobada y conserva residual de centavos no negativo.

Motivo: A+B+C no pueden avanzar a importacion D ni uso operativo si los invariantes financieros aceptan estados contradictorios o reintentos no deterministas.

Limite: no se importaron datos reales, no se desplego y no se marco ninguna HU como `DONE`.
