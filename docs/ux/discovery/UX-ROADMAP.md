# UX-ROADMAP — Implementación incremental (sin ejecución)

**Estado actual:** `DISCOVERY_READY_FOR_REVIEW`. Ningún PR de la aplicación autorizado. Duraciones y esfuerzos **no estimados** por ausencia de equipo, ambiente y revisión en navegador.

| Etapa | Prioridad | Alcance | Condiciones para pasar |
|---|---|---|---|
| UX-00 | P0 | Validación del Discovery, definición de usuarios/tareas, glosario financiero, baseline y reglas de no regresión | Firmar definiciones y baseline; revisar hallazgos UX-01/02/11/12/13; acordar qué cambios son UX vs funcionales |
| UX-01 | P0/P1 | App shell móvil/escritorio, navegación robusta, estados de foco, mejoras E2E de accionabilidad; mantener hashes | 320/375/390/768/1024/1440; scroll y teclado; tests de back/forward; sin cambios RPC |
| UX-02 | P1 | Tokens, tipografía, Button/Field/Notice/Status/Panel; extracción incremental desde `App.tsx` | Componentes con estados accesibles, sin nueva dependencia sin ADR; snapshots de baseline |
| UX-03 | P1 | Dashboard: semántica validada de caja, cartera y obligaciones; ayuda contextual y acciones | KPI al corte invariantes vs datos de origen; no inferir “saldo disponible” sin regla aprobada |
| UX-04 | P1 | Ahorros: socios, detalle, aporte, historial móvil, ayudas formato COP | Flujo registro/reintento y montos idénticos; ingreso y aplicación de mes correctos |
| UX-05 | P1 | Préstamos: lista/detalle, contrato, desembolso, cobro, cotización/prepago | Borrador != desembolsado; hash/fecha/capital/interés protegidos; reintento incierto preservado |
| UX-06 | P1 | Liquidaciones y utilidad: simulación, revisión, obligación, pago | Previews inválidas bloqueadas; obligación != caja; políticas y residuales auditables |
| UX-07 | P2 | Polla, tesorería y conciliación | No mezclar bolsa polla con ahorro; no ajustar diferencias automáticamente |
| UX-08 | P2 | Movimientos, reportes, respaldos y migración | Partidas consultables; JSON ≠ CSV; dry-run no escribe; no exponer datos privados |
| UX-09 | P2 | Instrumentación de métricas, revisión con usuarios y ajustes | Resultados medidos vs baseline; pendientes y accesibilidad cerrados o con riesgo aceptado |

## Principios de entrega

- Cada etapa es un PR independiente o una secuencia pequeña y revisable.
- No cambiar frontend y SQL en el mismo PR por estética. Si un defecto financiero real requiere arreglo, crear HU separada, validada por negocio.
- No introducir nuevos endpoints ni alterar contratos de respuesta como efecto secundario.
- Cada PR adjunta capturas antes/después desktop/móvil, ejecución de E2E, resultados UX y tabla de **paridad funcional**.
- Si una captura luce mejor pero E2E falla o altera importes/estatus, rechazar la entrega.
- El sistema no cambia de `READY_FOR_REVIEW` a `DONE` sin la aprobación explícita prevista en `AGENTS.md`.

## Primer STORY recomendado: UX-01 — Navegación segura y responsive

**Como** operador autorizado de Natillera, **quiero** navegar desde escritorio y móvil sin solapamientos, conservando la sección al recargar y regresar, **para** ejecutar tareas sin perder contexto.

**Dentro del alcance:** reorganizar `NavigationStyles` sin cambiar IDs de sección; safe-area; reserva de espacio por altura real; foco, scroll y teclado; accesibilidad; eliminar fallback Playwright `force: true` cuando los clics normales funcionen.

**Fuera de alcance:** renombrar rutas, mover banco/utilidad/liquidaciones, refactorizar formularios y alterar dominio, SQL o RPC.

**Aceptación:**
1. Las cinco secciones y seis submódulos existentes conservan alcance y disponibilidad.
2. En 320/375/390px los cinco destinos son visibles/operables o se ofrece patrón explícito accesible; ningún CTA queda cubierto al hacer scroll, con teclado o en safe-area.
3. `#/more/migration`, recarga, atrás y adelante reproducen el destino correcto.
4. Tabulador alcanza navegación y CTA en orden lógico, con foco visible y sin obstrucción.
5. Playwright ejecuta clics normales sin `force`; fallan ante obstrucciones.
6. Se preservan todos los flujos financieros y pruebas de base existentes; no hay diffs en `src/data`, `src/domain` o `supabase`.

**Rollback:** restaurar los componentes/estilos del shell sin tocar datos; no revertir migraciones porque no debe haber ninguna.

## Dependencias y riesgos

- UX-03 depende de glosario/definición de KPI en UX-00.
- UX-06 depende de reglas y aprobaciones monetarias existentes; no inventar políticas faltantes.
- Retirar CSS inline sin verificar breakpoints puede romper navegación; implementar detrás de equivalencia visual/funcional.
- Capturas de datos E2E pueden ser sintéticas; no decidir diseño financiero con base en un único fixture.
