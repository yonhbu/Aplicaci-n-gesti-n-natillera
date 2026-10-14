# UX-03 - Resultados

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-13

## Resumen

Se implemento el redisenio del dashboard financiero de `Inicio` sin modificar dominio, Supabase, contratos, permisos ni persistencia. La entrega conserva los indicadores originales, mantiene los atajos existentes y reorganiza la pantalla para que los saldos al corte, el seguimiento del ahorro y la informacion complementaria no se confundan.

## Cambios implementados

- Nuevo componente `HomeDashboard` en `src/ui/App.tsx`.
- Nueva semantica visual de metricas con `data-figure-key` para evidencia automatica.
- Estilos responsive para dashboard en `src/styles.css`.
- Ajuste de `.more-tab` en 320-420 px para evitar que `Migracion` ocupe una fila completa.
- Baseline UX extendida con parametro `--suite` y captura `dashboard-figures.json`.
- Documentacion UX-03 agregada.

## Evidencia visual

Baseline deterministica:

- Before: `docs/ux/baseline/ux-03/before/`
- After: `docs/ux/baseline/ux-03/after/`
- Rutas: `#/home`, `#/savings`, `#/more/movements`
- Viewports: 320, 375, 390, 768, 1024, 1440
- Dataset: TEST descartable con datos sinteticos.

Resultado de overflow:

| Fase | Mediciones | Overflow global |
| --- | ---: | ---: |
| Before | 18 | 0 |
| After | 18 | 0 |

Paridad de indicadores:

| Revision | Resultado |
| --- | --- |
| 11 indicadores originales | Sin diferencias before/after |
| Viewports comparados | 320, 375, 390, 768, 1024, 1440 |
| Fuente | `dashboard-figures.json` before/after |

## Pruebas ejecutadas

- `npm run typecheck`: PASS.
- `npm run test`: PASS, 10 archivos y 34 pruebas.
- `npm run build`: PASS.
- `npm run check:secrets`: PASS.
- `npm run ux:baseline -- --suite ux-03 --phase before --port 5184`: PASS, evidencia before generada.
- `npm run ux:baseline -- --suite ux-03 --phase after --port 5184`: PASS, evidencia after generada.
- `npm run test:infra:start`: PASS sobre TEST descartable.
- `npm run test:infra:reset`: PASS sobre TEST descartable.
- `PLAYWRIGHT_PORT=5185 npm run test:e2e`: PASS, 6 pruebas.
- `npm run test:infra:stop`: PASS.

## Pruebas no ejecutadas

- Lector de pantalla manual.
- Auditoria WCAG completa.
- Prueba fisica en dispositivo movil real.

## Riesgos residuales

- El baseline de Movimientos todavia no representa un set rico de operaciones financieras; se registra como deuda de evidencia.
- La fecha civil sigue siendo deuda fuera de UX-03.
- `App.tsx` sigue siendo un archivo grande; no se extrajo una arquitectura de componentes para evitar cambiar superficie fuera del alcance.

## Estado final

`READY_FOR_REVIEW`. No hacer merge, deploy ni declarar Natillera operativamente completada.
