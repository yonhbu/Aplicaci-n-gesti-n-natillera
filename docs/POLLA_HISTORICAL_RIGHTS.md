# Derechos históricos de Polla — versión 10

Estado: READY_FOR_REVIEW. La migración incremental no asigna derechos ni altera dinero al instalarse. No aplicada en producción. No usar el estado actual o una cuota de ahorro como prueba de participación histórica.

## Evidencia y conciliación

La matriz administrativa con los UUID productivos y los importes suministrados se conserva solo localmente en `incoming/polla-history/matriz-evidencia.csv`, fuera de Git. Sus pendientes son diferencias aritméticas de la evidencia, no saldos certificados del ledger. No se consultó producción ni se inventaron identidades, fechas o actividades de meses sin evidencia.

La RPC `polla_reconciliation_matrix` devuelve por UUID contribuciones posted, colectivos, personas identificadas, derechos, premios vigentes y saldo ledger, además del saldo del ciclo y la parte sin vínculo/otro año. No fuerza coincidencias mediante ajustes. Octubre y noviembre conservan sus registros; una cancelada no se recupera y diciembre no se presume recaudado.

## Procedimiento por actividad

1. Revisar respaldo/restauración y aplicar la migración SQL únicamente tras aprobación independiente. Publicar frontend después de verificar contratos. Si no está disponible, la UI bloquea conciliación; versión 10 solo identifica código, no certifica migraciones ni conciliaciones.
2. Identificar UUID y colectivo posted original. Excluir canceladas y actividades con premio vigente. No reutilizar el dinero de otro UUID del mismo mes.
3. Verificar participantes efectivos de ese mes contra evidencia individual, modalidad, rango y corte de liquidación. Una marca general de participación no basta para seleccionar automáticamente. Si faltan fechas o respaldo, no confirmar; excluir de la propuesta. No inferir cuotas desde ahorro.
   La fuente debe conciliar con el débito de `polla_pool` de su operación original y no tener reverso. Una divergencia de importación bloquea la atribución; no se corrige inventando caja ni cambiando el recaudo.
4. Seleccionar manualmente cada persona, fuente, fecha respaldada y referencia. La UI ofrece el derecho de cuota 10.000; SQL admite fracciones documentadas sin exceder esa cuota total ni el colectivo disponible.
5. Previsualizar: revisar personas, importes y fechas. Confirmar explícitamente el respaldo. El hash impide confirmar una fotografía obsoleta; el bloqueo de actividad serializa confirmaciones y premios.
6. Comparar antes/después contribuciones, operaciones, ledger, banco, administración, premios y liquidaciones: deben ser idénticos. Solo cambian derechos y participantes. Conservar actor, fecha de confirmación, hash y clave.
7. Asignar después el premio por el flujo financiero existente. Mantener comisión 5.000 y el reconocimiento exactamente una vez. Cuenta final no revertida: premio pendiente de entrega separada; no reabrir capital. Mes de actividad, fecha efectiva del premio y timestamp de registro permanecen separados.

## Correcciones y riesgos

Los derechos confirmados no se editan desde cliente; el recaudo fuente queda protegido contra actualización/reverso mientras los respalde. No hay borrado/reasignación automática ni recuperación de canceladas. Un error de identificación requiere un procedimiento de corrección revisado, no SQL improvisado sobre registros confirmados. RLS permite lectura solo a administradores del workspace; solo RPC autorizada confirma. No se alteran migraciones históricas, importes existentes ni liquidaciones.

Una actividad ya premiada puede conservar remanente contable. Ese saldo no autoriza un segundo premio del mismo UUID, completar cuotas ausentes, trasladarlo a otro juego o recalcular el premio anterior: su distribución requiere decisión y procedimiento revisados. Una respuesta perdida tampoco demuestra rechazo; conservar el mismo intento y consultar los registros confirmados antes de iniciar otro.

Una atribución parcial no certifica el padrón completo: el importe restante continúa sin identificar. Antes de celebrar el juego deben revisarse las identidades y los pendientes; no declarar derechos inexistentes ni excluir posibles aportantes para completar una pantalla. La validación financiera vigente del ganador sigue exigiendo su cuota completa, sin inventar una regla nueva para distribuir el remanente.

Pruebas: `node scripts/test-polla-history.mjs`, suite SQL existente y `playwright.polla-audit.config.ts`. Ver logs sintéticos locales en `incoming/polla-history/`. No considerar una prueba escrita como prueba aprobada: el resultado ejecutado se entrega por separado.

La restauración de derechos también requiere reprovisionar de forma segura los usuarios Auth de los actores de confirmación, aunque hayan dejado el workspace. El inventario de recuperación pasa de 44 a 45 tablas; respaldos de otra versión de esquema requieren revisión, no restauración forzada.
