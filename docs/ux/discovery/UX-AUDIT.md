# UX-AUDIT — Natillera Manager

**Método:** heurística sobre 14 capturas + lectura de código fuente. **C** = defecto/diseño observable confirmado; **R** = riesgo sustentado en código, pendiente de reproducir; **H** = hipótesis de valor UX a validar con usuarios. **P0** bloqueante para aceptación UX, **P1** alto, **P2** medio, **P3** menor. Una prioridad UX no equivale a una incidencia productiva demostrada.

## Hallazgos priorizados y accionables

| ID | Prioridad | Certeza | Evidencia reproducible | Impacto / propuesta |
|---|---|---|---|---|
| UX-01 | P0 | C+R | Capturas móviles 12-14; navegación fija `App.tsx:521-535` y contenido reservado con 96px `636-640` | La barra inferior invade visualmente el flujo; no basta un padding fijo frente a teclado/zoom. Crear app shell móvil con safe-area y medición de no-ocultamiento en todos los estados. Comprobar clics y foco. |
| UX-02 | P0 | C | `e2e/hu001.spec.ts:282-287` | El fallback `click({force:true})` invalida parte de la comprobación normal de accionabilidad. Retirarlo tras reparar UI y hacer que la prueba falle si hay superposición. |
| UX-03 | P1 | C | `App.tsx:1-50,135-237,321-495`, archivo de 2448 líneas | Presentación muy concentrada; alto riesgo de regresión al rediseñar. Extraer layout/componentes/rutas preservando comportamiento y contrato; sin reescritura masiva. |
| UX-04 | P1 | C | CSS `App.tsx:517-660` incrustado + `src/styles.css:1-281` | No hay una fuente central de tokens; las decisiones visuales están dispersas. Crear tokens semánticos y componentes base sin alterar el dominio. |
| UX-05 | P1 | C | `App.tsx:71-85,333-335,662-708`; capturas desktop 2,6-11 | Seis submódulos distintos en “Más”; respaldo duplicado como botón del encabezado. Reorganizar IA y nombres; redirigir hashes antiguos. |
| UX-06 | P1 | C | `App.tsx:799-829,831-883`; captura Inicio | KPIs mezclan expectativa anual descriptiva con balances contables al corte, sin explicar naturaleza o restricciones. Jerarquizar en disponibilidad/obligaciones/seguimiento, previa validación funcional de definiciones. |
| UX-07 | P1 | C | `App.tsx:889-930`, captura 07 | Tipos de operación y cuentas internas en inglés/enum directamente al usuario; partidas en una sola cadena y sin detalle individual. Crear lista humana + detalle contable disponible bajo demanda. |
| UX-08 | P1 | C | `App.tsx:1223-1470`, captura 04 | Crear contrato, cobrar, desembolsar y prepagar conviven. Separar flujos: listado/detalle, alta, cobro y prepago con confirmación contextual. |
| UX-09 | P1 | C | `App.tsx:1473-~1638`, captura 05 | Crear actividad, aportar, premiar y pagar conviven y comparten controles. Separar actividad, participantes, aportes, premio y pago. |
| UX-10 | P1 | C | `App.tsx:~1640-1746`, captura 06 | Apertura, financiación, interés, comisión, traslado y conciliación en formulario continuo. Crear tareas con vistas y resúmenes distintos. |
| UX-11 | P1 | R | `App.tsx:1760-1809,1833-1855` | `preview` se conserva al cambiar socio/corte/descuentos. Puede mostrarse una previsualización obsoleta y seguir habilitado “Confirmar”. Invalidar preview inmediatamente y probar rechazo del hash en servidor. **No se afirma bypass del backend**. |
| UX-12 | P1 | R | `App.tsx:1905-1958,1992-2010` | Mismo riesgo de preview persistente en utilidad al editar parámetros después de previsualizar. Aplicar firma de entrada + invalidación + comprobación servidor. |
| UX-13 | P1 | C | `App.tsx:92-94` | `new Date().toISOString().slice(0,10)` calcula **fecha UTC**, no fecha civil de Colombia. Cerca de medianoche local puede preseleccionar un día futuro. Corregir con fecha local civil y pruebas de huso. |
| UX-14 | P1 | C | Capturas móviles 13-14 y tablas `App.tsx:1195-1217,905-930` | Tablas y contenido técnico se comprimen o generan desplazamiento horizontal; desarrollar presentaciones móviles equivalentes sin eliminar columnas/datos auditables. |
| UX-15 | P1 | C | `App.tsx:325,710-756` | Errores/éxitos principalmente como párrafos visuales, sin live region ni foco explícito; revisar `role=alert`, `role=status`, errores cercanos al campo y navegación al mensaje. |
| UX-16 | P2 | C | `App.tsx:741-756` | OTP no ofrece reenviar código ni volver a editar correo después del envío; definir estados e integración sin modificar protección de acceso. |
| UX-17 | P2 | C | `App.tsx:760-795` | “Consultar socio” y “Registrar aporte” navegan al mismo módulo sin seleccionar tarea; deep links/foco por tarea. |
| UX-18 | P2 | R | `App.tsx:179-237`, actualizaciones `refreshAll()` | Tras cada operación se consultan numerosas colecciones. Es riesgo de latencia y estado global, **no** prueba de problema de rendimiento. Medir con datos representativos antes de optimizar. |
| UX-19 | P2 | C | `App.tsx:1200-1214,1461-1468`; capturas 03-04 | Historial de socios y préstamos poco explorable, ausencia de filtros/estado contextual; convertir a listado operable y detalle, con acceso a cronogramas. |
| UX-20 | P2 | C | `App.tsx:301-309` | Mensaje “bootstrap local” expone detalle de implementación al usuario final. Reemplazar por instrucción funcional y contacto de administrador. |
| UX-21 | P2 | R | `App.tsx:1304-1311,1429-1432,1465` | El botón desembolsar usa `startDate` del formulario global de creación, no una fecha claramente vinculada al borrador elegido; confirmar regla funcional y probar contexto antes de rediseñar. |
| UX-22 | P2 | C | `App.tsx:1157-1158,1402-1422`, `src/domain/money.ts:5-45` | Entrada monetaria mediante texto libre y parser estricto COP sin orientación dinámica de formato. Usar ayuda, teclado y errores contextuales; jamás cambiar la semántica de `parseCop` inadvertidamente. |
| UX-23 | P2 | C | `App.tsx:1833-1885,1990-2039` | Liquidación y utilidad mezclan previsualización/confirmación con pagos posteriores. Crear separación visual de obligación pendiente y desembolso efectivamente registrado. |
| UX-24 | P2 | C | `App.tsx:2350-2367`; captura 11 | Un “respaldo JSON” y “reporte CSV” comparten zona sin suficiente distinción sobre restaurabilidad; conservar explicación de que CSV no recupera la base. |
| UX-25 | P2 | H | Captura login y dashboard | Diseño neutro y plano, sin identidad visual ni distinciones semánticas. Investigar estilo institucional sobrio, mejor escala tipográfica y densidad antes de aplicar estilos decorativos. |
| UX-26 | P2 | R | Captura movimientos 07; `App.tsx:889-929` | La captura muestra operaciones aparentemente repetidas. **No se confirma duplicación**: podrían ser operaciones distintas generadas por fixtures/E2E. Verificar IDs y origen antes de proponer deduplicación. |

## Riesgos de mayor prioridad al negocio

**Integridad monetaria:** una modernización que fusione obligaciones confirmadas con pagos efectuados, normalice saldos negativos, oculte estado incierto o recalcule ledger desde el cliente sería una regresión grave (`docs/BUSINESS_RULES.md`, `docs/DECISIONS.md`). Es una restricción, no una mejora UX opcional.

**Operación incierta:** `runPendingFinancialAction` conserva clave/carga de reintento si falla la red (`App.tsx:96-126`). La nueva UI debe representar “no sabemos si se confirmó” y ofrecer reintento idempotente con **el mismo payload**; nunca habilitar un segundo cargo con clave nueva por conveniencia visual.

**Evidencia de uso:** en capturas se observan encabezados, botones, listas y textos; ninguna evidencia entregada mide tiempo de tarea, tasa de error, comprensión o satisfacción. Los cambios de flujos son recomendaciones heurísticas hasta probarlos.

## Métricas base sugeridas (no medidas todavía)

Tiempo/errores al registrar un aporte, encontrar deuda del socio, cobrar préstamo, cotizar prepago, conciliar banco y liquidar retiro; tareas abandonadas, clics necesarios, manejo de errores, completitud sin ratón, ausencia de superposición en 375/390/768/1024/1440px y zoom 200%/400% donde aplique.
