# Incidente GitGuardian 39171472 y regresión CI

Estado: READY_FOR_REVIEW. Rama correctiva: `codex/gitguardian-39171472`, base `1bf223b`. No hay merge, reescritura de historial ni cambios de Supabase en producción.

## Diagnóstico sin divulgar la cadena detectada

El hallazgo de `scripts/test-e2e-guards.mjs:25` se introdujo en `1bf223b` como entrada negativa de una prueba. Las dos URI se escribieron literalmente en el fixture: un destino loopback con puerto DEV y un host reservado bajo `.invalid`. La contraseña era un marcador sintético literal; no se obtenía de variables, archivos de entorno ni del proveedor. El usuario era ilustrativo, sin emisión de credenciales. No se reproduce aquí la cadena original.

La función llamada, `assertTestEnvironment`, solo analiza URL y compara protocolo, host y puerto; no abre conexiones. Se contrastó el historial y la configuración versionada. Mediante el canal administrativo autorizado por socket local de Docker, sin utilizar la contraseña ni autenticar con la URI señalada, se verificó que el usuario candidato no tiene un rol con permiso de login en DEV ni TEST. Los bindings examinados corresponden a los contenedores separados de los puertos 44122 y 55422. No se leyó ningún archivo privado de entorno.

La evidencia sustenta **Test credential**. No hay evidencia de una credencial real que requiera rotación. La revisión no prueba la inexistencia de cualquier reutilización externa imaginable: no existe acceso autorizado a GitGuardian ni al inventario del proveedor desde esta conexión. No se ensayó la credencial contra ningún servidor.

El detector PostgreSQL de GitGuardian puede alertar sin validar la credencial; una alerta no demuestra acceso. Véase [detector oficial](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/postgresql_credentials). El dominio `.invalid` está reservado por [IANA](https://www.iana.org/assignments/special-use-domain-names).

## Corrección y clasificación

- El fixture declara marcadores TEST_ONLY explícitos, nunca provisionados. Construye el userinfo únicamente en memoria a partir de endpoints sin contraseña; no guarda otra URI con contraseña literal.
- Conserva y amplía las aserciones: ambos esquemas PostgreSQL, los tres nombres de variables admitidos, DEV, host externo en puerto normal y host externo usando incluso el puerto TEST. Comprueba que los errores no divulgan usuario, contraseña ni URI.
- `scripts/lib/source-secret-findings.mjs` detecta URI PostgreSQL con contraseña en fuentes y devuelve exclusivamente ubicaciones. `check:secrets` lo aplica también a YAML. Su regresión exige detección sin devolver el valor. No hay exclusiones añadidas ni desactivación de GitGuardian.
- El incidente puede clasificarse en GitGuardian como `Ignored → Test credential`, siguiendo sus [estados oficiales](https://docs.gitguardian.com/internal-monitoring/detect/incident-statuses). Esa clasificación requiere acceso a la consola; no se afirma que ya se haya cambiado el incidente remoto.

No se reescribe automáticamente el commit histórico. Si una comprobación autorizada posterior contradijera el diagnóstico, primero el propietario debe revocar o rotar la credencial mediante el proveedor, actualizar consumidores a través del gestor de secretos y revisar accesos. Solo después se debe acordar la limpieza de historial, referencias, clones y forks, con aprobación explícita antes de cualquier force push. No se debe validar manualmente usando una posible credencial filtrada.

## Evidencia remota aportada por Juan

[Run indicado 40572942417](https://github.com/yonhbu/Aplicaci-n-gesti-n-natillera/actions/runs/40572942417). El conector devuelve 404; se revisó en su lugar el ZIP local `logs_109973499375.zip`, aportado por Juan. SHA256: `0c76142370041b73151ba613f08387cebe3a70b4357b4010975e45333db60400`.

El checkout del ZIP es `1bf223bf31b5473eabf4ef89c966fbc32683c32a`, rama `codex/fix-ci-test-e2e`. El preflight confirma Auth/API TEST55421, correo TEST55424 y PostgreSQL TEST55422. No aparece el antiguo error de arranque DEV. Se ejecutaron 250 casos: **242 correctos, 8 fallidos, 0 omitidos, 0 flaky**. Por tanto el desacuerdo TEST/DEV quedó corregido en esa revisión, pero el trabajo database todavía fallaba por regresiones reales de interfaz:

| Caso | Proyectos | Causa observada |
|---|---|---|
| HU001 OTP y operaciones | Móvil | El detalle abierto intercepta el clic en el filtro externo Todos. |
| UX14 texto 200 % | Ambos | La palabra administrador rebasa su contenedor a 320 px. |
| UX15 teclado/táctil | Escritorio | Contraste medido 3,32, inferior a 4,5. |
| UX16 detalle y texto 200 % | Ambos | Grid y cifras del diálogo desbordan el ancho. |
| UX16 proyección histórica | Ambos | Desborde del diálogo o acción enfocada fuera del viewport. |

La rama corrige el reflow del encabezado y del diálogo, permite envolver cifras sin recorte, limita mínimos de grid/flex y mantiene espacio de scroll para enfoque. Define colores explícitos del hover de filtros y evita interpolar pares de color/fondo con contraste insuficiente. HU001 comprueba los dos pagos antes de cerrar el detalle mediante su botón real, y luego filtra Pagados; no usa clic forzado ni elimina la aserción financiera.

## Frontend y migración pendiente de notas

`origin/main` en `caa1bd7f4c69563971b9db38a389e8a548bc13a6` incorpora el árbol operativo de `1bf223b` sin diferencias en frontend, scripts, workflow y migraciones. El merge no perdió SQL ni código; esto no demuestra que la migración esté aplicada. Juan confirmó que **20261108000100 sigue pendiente en producción**.

Los nuevos formularios usan `record_noted_loan_payment` y `confirm_noted_loan_prepayment`, incluso cuando la nota enviada es nula. Por tanto un frontend de esa versión contra el esquema productivo anterior es incompatible para esos cobros. No se declara resuelta esa dependencia mediante este parche ni se ejecuta la migración en producción.

La corrección reconoce PGRST202 en las RPC de notas, muestra la migración requerida, mantiene los datos del formulario y falla sin retry por una RPC antigua que perdería la nota. Los contratos antiguos sin argumento de nota mantienen su RPC original. Hay regresiones unitarias de ambos caminos y una prueba E2E de esquema antiguo simulado sobre TEST: nota conservada, una sola llamada rechazada, ninguna alternativa y estado financiero idéntico antes/después. No se modifica siquiera el esquema TEST para simular esa ausencia.

**Condición de entrega operativa:** revisión y aplicación explícitamente autorizada de la migración aditiva y sus permisos antes de habilitar ese frontend para cobros en producción. Si se necesita revertir frontend, usar una versión compatible previamente revisada; no borrar columnas, notas ni RPC como rollback improvisado.

## Verificación de esta rama

Resultados finales pendientes de cerrar tras la ejecución completa local. Los logs desechables viven en `incoming/gitguardian-39171472-*`; no se versionan. El informe se actualizará con el resultado real, incluidos fallos si los hubiera.
