# UX-03 - Financial Dashboard Redesign

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-13

Harness declarado: UX Engineering Harness v0.1. `HARNESS.md` no existe en la raiz del repositorio; se aplicaron las reglas vigentes de `AGENTS.md` y el alcance aprobado por el prompt.

## Objetivo

Redisenar exclusivamente el dashboard de `Inicio` para que sea una pantalla de decision financiera, no una lista plana de tarjetas y atajos.

## Alcance implementado

- Reorganizacion de `Inicio` en cinco bloques:
  - Contexto del ciclo y fecha de corte.
  - Posicion financiera.
  - Seguimiento del ahorro.
  - Operaciones frecuentes.
  - Informacion complementaria.
- Conservacion de los 11 indicadores originales y sus valores.
- Conservacion de los atajos existentes:
  - Registrar aporte.
  - Registrar cobro.
  - Consultar socio.
  - Revisar migracion.
- Eliminacion del badge no verificable `Ciclo con datos visibles`.
- Correccion de distribucion de tabs secundarios para que `Migracion` no ocupe una fila completa en 320-420 px.
- Extension de la baseline UX para capturar valores del dashboard y comparar paridad before/after.

## Fuera de alcance

- No se modificaron Supabase, SQL, RPC, RLS, contratos ni persistencia.
- No se cambiaron reglas financieras, permisos ni roles.
- No se redisenaron formularios de Ahorros, Prestamos, Polla o Liquidaciones.
- No se implemento la arquitectura de informacion futura.
- No se introdujeron dependencias.
- No se corrigio la deuda de fecha civil fuera del alcance de UX-03.

## Archivos permitidos usados

- `src/ui/App.tsx`
- `src/styles.css`
- `scripts/ux-02b-baseline.mjs`
- `docs/ux/UX-03-STORY.md`
- `docs/ux/UX-03-FINANCIAL-SEMANTICS.md`
- `docs/ux/UX-03-DESIGN-DECISIONS.md`
- `docs/ux/UX-03-RESULTS.md`
- `docs/ux/baseline/ux-03/`

## Criterios de aceptacion

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Dashboard de Inicio reorganizado por jerarquia financiera | Confirmado | `src/ui/App.tsx`, capturas `docs/ux/baseline/ux-03/after/home-*.png` |
| Indicadores originales preservados | Confirmado | `dashboard-figures.json` before/after sin diferencias |
| Acciones originales preservadas | Confirmado | E2E 6/6, botones existentes en Inicio |
| Sin overflow global en 320, 375, 390, 768, 1024 y 1440 | Confirmado | `measurements.json` after: 18 mediciones, 0 overflow |
| Sin cambios de dominio financiero | Confirmado | Diff limitado a UI, estilos, baseline y docs |
| TEST descartable usado para evidencia | Confirmado | `npm run ux:baseline -- --suite ux-03 --phase after --port 5184` |
| Baseline con datos representativos de movimientos | Parcial | Hay dataset sintetico fijo; sigue pendiente ampliar movimientos representativos distintos de vacio/cero |

## Rollback

Revertir el commit de UX-03 restaura el dashboard anterior y elimina los documentos/baseline de esta entrega. No hay migraciones ni cambios de persistencia que revertir.
