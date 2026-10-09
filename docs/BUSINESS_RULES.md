# Reglas de negocio

## Ahorro

- Importe, fecha efectiva y mes aplicado son datos distintos.
- Un aporte aplicado a octubre puede tener fecha efectiva en septiembre y debe remunerar desde esa fecha.
- Dinero COP se modela con decimal exacto; la UI no decide saldos con `number` binario.
- Los aportes parciales y extras son ahorro. Aportes de polla no se mezclan con ahorro.
- HU-001 registra aportes; no corrige ni borra movimientos monetarios publicados.
- El servidor rechaza aportes si el ciclo no esta activo, el socio no participa en ahorro, el mes aplicado sale del rango de participacion o el ano no corresponde al ciclo.
- La idempotencia se conserva desde el formulario hasta la RPC: repetir la misma operacion con la misma clave devuelve el mismo aporte; la misma clave con contenido distinto se rechaza.
- Un intento de aporte pendiente conserva su clave y carga canonica entre recargas hasta resolverse. Cambios de formato monetario equivalentes no crean otra operacion.
- Fechas obligatorias de aportes y ciclos deben ser fechas civiles finitas; `infinity`, `-infinity` y NULL se rechazan en servidor.

## Retiro anticipado

La previsualizacion pura usa:

`ahorro aportado + rendimiento reconocido 12% EA ACT/365F + premios netos pendientes - deudas - cuota anual - penalidad - otros descuentos`.

HU-001 no confirma liquidaciones, no ejecuta transferencias y no reparte utilidad de prestamos. Bloque B reconoce utilidad de prestamos en fondo separado; su reparto final sigue pendiente de reglas de liquidacion.

## Registro financiero

- Los saldos visibles de caja, cartera, administracion, utilidad de prestamos, bolsa de polla y premios por pagar se reconstruyen desde operaciones publicadas.
- Toda operacion financiera multi-registro debe quedar balanceada en servidor: la suma de partidas de una operacion es cero.
- La idempotencia pertenece a la operacion completa; repetir la misma clave devuelve la misma operacion y no duplica caja.
- La misma clave con carga economica distinta se rechaza sin insertar derechos ni movimientos parciales.
- Desembolsos, cobros, aportes de polla, premios y pagos de premios se confirman por RPC transaccional.
- Cronogramas, cotizaciones y previsualizaciones no son movimientos de caja.
- Correcciones monetarias futuras deben hacerse por reverso trazable, no borrando historia. La pantalla de reversos no pertenece a B.

## Prestamos

- Un contrato puede estar asociado a un socio o a un deudor externo identificado.
- Metodos soportados en B: amortizado, interes fijo y solo interes. Las tasas son por contrato y pueden ser cero.
- El desembolso crea cartera y salida de caja; no se puede confirmar dos veces el mismo prestamo por reintento.
- Crear contrato no desembolsa. El desembolso es una confirmacion separada y unica.
- Un cobro exige fecha real, monto total, aplicacion a capital e interes, y clave de idempotencia.
- No se cobran prestamos en borrador, cancelados o pagados. El capital cobrado no puede superar el saldo pendiente.
- Un pago regular puede incluir capital; no todo capital positivo es prepago.
- La comision de administracion sobre intereses cobrados es 10%; el 90% restante queda en fondo de utilidad de prestamos para reglas posteriores.
- La cotizacion pura del acuerdo P013 no se generaliza a todos los prestamos: principal pendiente mas primer mes acordado solo si ese interes no fue cobrado antes.

## Pollas y premios

- Los aportes de polla entran a bolsa de polla y no remuneran como ahorro.
- Actividad, participante/ganador y aporte deben pertenecer al mismo ciclo y workspace.
- El premio se reconoce en dos pasos: premio bruto con comision fija y neto pendiente; luego pago efectivo separado.
- La comision fija vigente en B es $5.000 por premio. Un premio bruto menor que la comision se rechaza hasta tener regla confirmada.
- Los derechos historicos deben conservarse por participacion; no se deben cancelar por cambios posteriores del socio.

## Legacy

- CSV y JSON legacy se inspeccionan, no se importan definitivamente.
- El CSV no es respaldo completo.
- Las marcas booleanas de pagos no prueban fecha real de cobro.
- Referencias a comprobantes no contienen imagenes.
- Datos inciertos se reportan para revision; no se rellenan con cero ni fechas inventadas.
- Inventario CSV y JSON se reporta por fuente. No se suman fuentes como si fueran operaciones nuevas sin conciliacion.
