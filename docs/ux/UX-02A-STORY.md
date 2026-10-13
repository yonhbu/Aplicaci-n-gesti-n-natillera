# UX-02A - Design system y modernizacion visual

Estado: `READY_FOR_DESIGN_REVIEW`

## Objetivo

Definir una direccion visual aprobable para Natillera Manager antes de implementar UX-02B. Esta fase produce investigacion, comparacion visual, prototipos estaticos, diagnostico responsive pendiente y plan incremental. No modifica el frontend productivo.

## Alcance

- Consultar UI UX Pro Max y contrastar sus recomendaciones con el dominio real.
- Proponer tres direcciones visuales diferenciadas.
- Crear prototipos estaticos separados de produccion.
- Medir overflow pendiente en Ahorros y Movimientos usando TEST descartable.
- Proponer arquitectura de design system, tokens y adopcion gradual.
- Definir estrategia de baseline visual reproducible.

## Fuera de alcance

- Cambiar logica financiera, Supabase, SQL, RPC, RLS o persistencia.
- Redisenar formularios productivos.
- Introducir dependencias.
- Implementar UX-02B.
- Declarar conformidad WCAG completa sin auditoria manual.
- Usar datos reales en capturas.

## Evidencia generada

- Prototipo ejecutable: `docs/ux/prototypes/ux-02a/index.html`
- CSS del prototipo: `docs/ux/prototypes/ux-02a/styles.css`
- Capturas: `docs/ux/prototypes/ux-02a/screenshots/`
- Medicion overflow: `docs/ux/diagnostics/ux-02a-overflow-measurements.json`

## Criterios de cierre

1. Tres direcciones visuales comparables.
2. Recomendacion principal justificada.
3. Plan incremental sin refactor masivo.
4. Pendientes responsive documentados con causas e impacto.
5. Baseline visual reproducible propuesta.
6. Estado final `READY_FOR_DESIGN_REVIEW`.

