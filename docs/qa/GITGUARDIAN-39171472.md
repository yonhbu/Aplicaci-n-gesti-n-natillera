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

[Run indicado 40572942417](https://github.com/yonhbu/Aplicaci-n-gesti-n-natillera/actions/runs/40572942417). Al iniciar, el conector devolvía 404; se revisó en su lugar el ZIP local `logs_109973499375.zip`, aportado por Juan. SHA256: `0c76142370041b73151ba613f08387cebe3a70b4357b4010975e45333db60400`.

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

Las comprobaciones locales se ejecutaron en Windows/Chrome contra TEST descartable; no equivalen por sí solas al resultado de Ubuntu:

| Comprobación | Resultado real |
|---|---|
| `test:e2e:guards` | 12/12, cero fallidas y omitidas. |
| `qa:functional:unit` | 29 archivos, 164/164; se conservan las 160 pruebas anteriores. |
| TypeScript y `qa:functional:build` | Correctos; Vite de auditoría sin dotenv. |
| Reconstrucción TEST | Primer intento DbSetupError al inicializar el contenedor; segundo intento terminó con las 41 migraciones. No se cuenta el primero como éxito. |
| `test:rls` | 27/27 archivos y 686 aserciones correctas tras reconstruir TEST. |
| Regresión dirigida inicial | 12/12 entre escritorio y móvil. |
| `test:e2e` completo, árbol operativo c5b0ec1 | 252/252: 126 escritorio y 126 móvil; cero fallidas, omitidas y flaky; proceso terminó con código 0. |
| `check:secrets` | Correcto. |
| Artefactos de la corrida completa | 276 ZIP, 81.408 entradas; sin JWT, claves elevadas ni trazas crudas. |
| Regresión posterior del título, 6f96177 | UX14 texto al 200 %: 1/1 escritorio y 1/1 móvil. |

Se verificó por el canal administrativo local que TEST registra la migración 20261108000100, ambas RPC de notas y la columna de nota. No se extrapola ese resultado a producción.

Los logs locales se conservan en `incoming/gitguardian-39171472-*` (ignorados por Git). La corrida completa está en `gitguardian-39171472-full-e2e.log`; su resumen de 252 casos en `gitguardian-39171472-summary.log`. La corrida dirigida posterior genera otro informe filtrado: no debe presentarse como sustituto de los 252 casos completos.

## Contraste adicional en GitHub Actions

Después de que Juan hizo público el repositorio fue posible leer Actions con el conector. La creación del PR devuelve 403 `Resource not accessible by integration`; se publicó la rama mediante Git, sin hacer merge.

El [primer CI de la corrección, 40584318635](https://github.com/yonhbu/Aplicaci-n-gesti-n-natillera/actions/runs/40584318635), commit c5b0ec1, confirmó web correcto y **250/252 E2E correctos, 2 fallidos, cero omitidos/flaky**. Los dos fallos eran UX14: palabra administrador partida en fuentes de Ubuntu a 320 px. Contraste, detalle, enfoque y HU001 ya pasaban allí.

El ajuste 6f96177 retira la partición de esa palabra y reduce únicamente el padding lateral del encabezado de administración a 8 px cuando el viewport es menor a 360 px. Mantiene el tamaño de texto y las aserciones de palabra íntegra, ausencia de recorte y colisiones. La regresión local de ambos proyectos pasó.

Ejecución de validación Ubuntu de ese ajuste: [40597955108](https://github.com/yonhbu/Aplicaci-n-gesti-n-natillera/actions/runs/40597955108), SHA `6f961770e6b1b1ccad9456c59917c0050c10b66e`. Resultado: web correcto; E2E 250/252, cero omitidos/flaky. Móvil pasó 126/126; en escritorio reaparecieron el desborde del título y el enfoque fuera del viewport en UX16. El ajuste de padding por sí solo no fue suficiente y no se presenta como cierre aprobado.

La revisión 03aa651 mantiene visible el control enfocado del diálogo ante cambios de tamaño/contenido mediante ResizeObserver y el evento focusin. Solo desplaza el scroll del propio diálogo; no cambia foco ni datos financieros. La aserción de viewport espera la actualización de layout y conserva los límites geométricos originales. El diagnóstico de texto incorpora ancho, rectángulos y tipografía calculada si falla, sin credenciales.

El workflow añade una comprobación dirigida de esos cuatro recorridos antes de `npm run test:e2e`; la colección completa de ambos proyectos permanece obligatoria. En [40601516059](https://github.com/yonhbu/Aplicaci-n-gesti-n-natillera/actions/runs/40601516059), SHA `03aa651fa86c9dd0845a7219a5019e1db9254e92`, **web y database terminaron correctamente**. La comprobación dirigida de Ubuntu pasó 4/4 y después la colección completa pasó **252/252: 126 escritorio y 126 móvil, cero fallidas, omitidas y flaky**. El escaneo remoto de artefactos pasó: **108 ZIP y 16.696 entradas**, sin JWT, claves elevadas ni trazas crudas. Las 12 guardas y las 686 aserciones SQL también pasaron en esa ejecución. No se utilizaron retries, continue-on-error ni exclusiones para aprobarla. En Windows, 164/164 unitarias, TypeScript, 4/4 E2E dirigidas y 12/12 guardas pasaron después del cambio de enfoque.

## Archivos modificados

- `scripts/test-e2e-guards.mjs`: fixture explícitamente sintético, destinos negativos y verificación de redacción.
- `scripts/lib/source-secret-findings.mjs`: detector que devuelve solo ubicaciones.
- `scripts/check-secrets.mjs`: integración del detector y revisión YAML.
- `src/data/loans.ts` y `src/data/loans.test.ts`: rechazo explícito de RPC de notas ausente, sin fallback financiero; regresión de pago y prepago.
- `src/lib/userMessages.ts` y `src/lib/userMessages.test.ts`: aviso conocido permitido sin exponer errores arbitrarios; pruebas anteriores conservadas.
- `e2e/functional-audit.spec.ts`: ausencia simulada de migración, conservación de nota y cero efectos financieros.
- `e2e/hu001.spec.ts`: comprobar recibos y cerrar el detalle antes de filtrar, sin clic forzado.
- `src/styles.css` y `src/ui/overview.css`: reflow, ancho mínimo, enfoque y contraste; sin tocar cálculos financieros.
- `src/ui/App.tsx`: conservación de la visibilidad del foco en diálogos con contenido dinámico.
- `e2e/ux14.spec.ts` y `e2e/ux16.spec.ts`: diagnóstico geométrico sin valores sensibles y espera de visibilidad completa antes de medir.
- `.github/workflows/ci.yml`: comprobación dirigida previa; colección completa y escaneo de artefactos conservados.
- Este informe: origen, límites, evidencia, pruebas y dependencia productiva pendiente.

## Cierre para revisión

La ejecución remota anterior verifica el último commit funcional. La actualización posterior de este informe modifica únicamente documentación y no cambia su árbol operativo de frontend, SQL, scripts, workflow o pruebas. Los resultados previos fallidos se conservan arriba; no se presentan como aprobados.

Estado final: **READY_FOR_REVIEW**. El código está publicado en `codex/gitguardian-39171472`. El conector permite lectura del repositorio público, pero crear PR sigue rechazado con 403 de permisos de la integración; no se ha creado un PR ni hecho merge. [Abrir comparación para revisión](https://github.com/yonhbu/Aplicaci-n-gesti-n-natillera/compare/main...codex/gitguardian-39171472?expand=1).

Pendientes externos: clasificar el incidente 39171472 como Test credential en GitGuardian y revisar/aplicar explícitamente la migración de notas antes de la operación productiva del frontend correspondiente. Este parche no aplica SQL de producción ni convierte ese esquema pendiente en compatible por sí solo. Solo Juan puede aceptar la entrega y pasarla a DONE.
