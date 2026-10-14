# UX-04 - Redisenio de Socios y Ahorros

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-14

Harness declarado: UX Engineering Harness v0.1. Se aplicaron `AGENTS.md`, reglas de negocio vigentes y UI UX Pro Max.

## Objetivo

Modernizar la pantalla `Ahorros` con el Design System Financial Professional adoptado, separando la gestion de socios del registro de aportes y preservando los contratos financieros existentes.

## Alcance implementado

- Ajustes acotados de UX-03:
  - Acciones frecuentes de Inicio reubicadas cerca del inicio de la pantalla movil.
  - `Pendiente descriptivo` deja de usar estilo de advertencia para no sugerir morosidad.
  - Se preservan los 11 indicadores y su semantica.
- Nueva pantalla de Ahorros:
  - Resumen del ciclo con indicadores existentes.
  - Acciones frecuentes para registrar aporte, crear/editar socio y ver historial.
  - Formulario focalizado de aportes.
  - Gestion de socios separada del registro monetario.
  - Busqueda local de socios por nombre o legacy ID.
  - Tarjetas y tabla de socios con cuota, rango, flags de polla/utilidad y recibido.
  - Historial de aportes con fecha efectiva y mes aplicado separados.
- Evidencia visual before/after en 320, 375, 390, 768, 1024 y 1440 px.

## Fuera de alcance

- No se modificaron Supabase, SQL, RPC, RLS, modelos ni calculos.
- No se cambiaron permisos, roles, hashes ni navegacion.
- No se introdujeron dependencias.
- No se crearon indicadores de mora, deuda o cumplimiento.
- La correccion de fecha civil sigue como historia tecnica independiente.

## Auditoria funcional confirmada

| Area | Estado | Evidencia |
| --- | --- | --- |
| Creacion y edicion de socios | Confirmada | `MemberForm` usa `createCycleMember` / `updateCycleMember` por RPC `save_cycle_member` |
| Cuota mensual | Confirmada | Campo `Cuota mensual`, parseo COP y bloqueo servidor para cambios retroactivos con aportes |
| Rango de participacion | Confirmada | `participation_start_month` y `participation_end_month` conservados |
| Participacion en polla | Confirmada | Checkbox `Participa en polla` preservado |
| Participacion en utilidad de prestamos | Confirmada | Checkbox preservado |
| Registro de aportes | Confirmada | `ContributionForm` usa `registerContribution` por RPC idempotente |
| Fecha efectiva y mes aplicado | Confirmada | Campos separados y visibles en formulario e historial |
| Metodo de pago | Confirmada | `cash`, `bank_transfer`, `bank_deposit`, `other` preservados |
| Historial/detalle por socio | Confirmada | Tabla existente preservada y nueva tabla de historial agregada |
| Validaciones/estados | Confirmada | Validacion local contextual + validacion servidor existente; pendiente idempotente preservado |

## Archivos tocados

- `src/ui/App.tsx`
- `src/styles.css`
- `scripts/ux-02b-baseline.mjs`
- `docs/ux/UX-04-STORY.md`
- `docs/ux/UX-04-DESIGN-DECISIONS.md`
- `docs/ux/UX-04-RESULTS.md`
- `docs/ux/baseline/ux-04/`

## Rollback

Revertir el commit UX-04 restaura la pantalla anterior y elimina la evidencia/documentacion UX-04. No hay migraciones ni datos persistentes que revertir.
