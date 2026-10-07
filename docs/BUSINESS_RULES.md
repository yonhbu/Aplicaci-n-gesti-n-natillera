# Reglas de negocio

## Ahorro

- Importe, fecha efectiva y mes aplicado son datos distintos.
- Un aporte aplicado a octubre puede tener fecha efectiva en septiembre y debe remunerar desde esa fecha.
- Dinero COP se modela con decimal exacto; la UI no decide saldos con `number` binario.
- Los aportes parciales y extras son ahorro. Aportes de polla no se mezclan con ahorro.
- HU-001 registra aportes; no corrige ni borra movimientos monetarios publicados.
- El servidor rechaza aportes si el ciclo no esta activo, el socio no participa en ahorro, el mes aplicado sale del rango de participacion o el ano no corresponde al ciclo.
- La idempotencia se conserva desde el formulario hasta la RPC: repetir la misma operacion con la misma clave devuelve el mismo aporte; la misma clave con contenido distinto se rechaza.

## Retiro anticipado

La previsualizacion pura usa:

`ahorro aportado + rendimiento reconocido 12% EA ACT/365F + premios netos pendientes - deudas - cuota anual - penalidad - otros descuentos`.

HU-001 no confirma liquidaciones, no ejecuta transferencias y no reparte utilidad de prestamos.

## Legacy

- CSV y JSON legacy se inspeccionan, no se importan definitivamente.
- El CSV no es respaldo completo.
- Las marcas booleanas de pagos no prueban fecha real de cobro.
- Referencias a comprobantes no contienen imagenes.
- Datos inciertos se reportan para revision; no se rellenan con cero ni fechas inventadas.
- Inventario CSV y JSON se reporta por fuente. No se suman fuentes como si fueran operaciones nuevas sin conciliacion.
