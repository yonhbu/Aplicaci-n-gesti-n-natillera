# Decisiones de la auditoría funcional

Estado: `READY_FOR_REVIEW`. Fecha de referencia: 2026-10-26, America/Bogota. Los identificadores de migraciones posteriores a esta fecha mantienen el orden ya presente en el repositorio; no prueban fechas de despliegue.

1. Conservar el ledger y las RPC existentes. Las correcciones no reescriben importes históricos ni modifican migraciones aplicadas.
2. Conservar cronograma contractual y aplicaciones verificadas. Mostrar el pendiente como importe principal de una cuota abierta; mostrar el original y capital aplicado cuando difieren. Inicio y tarjetas deben usar el mismo pendiente.
3. Mantener la cotización de cancelación vigente. En el análogo de P011, dos intereses de $25.000 ya satisfechos y abono de $200.000 dejan capital de $300.000. La cuota contractual final conserva $25.000 de interés programado y $300.000 de capital pendiente; la cancelación total cotizada usa la política fija existente y da $300.000. No igualar ambos conceptos ni crear una política nueva para hacerlos coincidir.
4. Agregar notas por migración incremental `20261108000100`. Son inmutables, opcionales y transaccionales, con permisos heredados de pagos. Los intentos antiguos sin nota conservan su RPC/carga para poder resolverse sin cambiar la clave.
5. Usar `CopInput` para importes editables y conservar `parseCop → toDatabaseMoney` como frontera de envío. No usar `Number` para formatear el texto ni truncar datos pegados inválidos.
6. Auditoría exclusivamente TEST, API `55421`, PostgreSQL `55422`, frontend `5198`, correo sintético local. Leer claves del runtime en memoria; no abrir dotenv, fuentes privadas ni respaldos.
7. Restaurar documentación obligatoria como síntesis actual. Los textos de `59219a8` son antecedentes históricos; no se publican como especificación actual sin contrastar el código.
8. Un cobro permanece ocupado hasta terminar la recarga de datos compartidos. Cerrar antes permitía reabrir un formulario con la cuota antigua; el ensayo EA lo reprodujo. Se conserva la validación autoritativa SQL y se corrige la coordinación de la UI.

Decisión pendiente del administrador: confirmar contractualmente si futuros intereses de préstamos de modalidad fija deben recalcularse después de abonos extraordinarios. Alternativas: conservar importes pactados; recalcular períodos no causados sobre saldo; exigir acuerdo individual. Recomendación: mantener el contrato actual hasta definir modalidad, causación y transición verificables. La auditoría no cambia esta política.
