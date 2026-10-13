# UX-02 - Estrategia de baseline visual reproducible

## Problema de UX-01

La baseline before/after de UX-01 fue util, pero no completamente deterministica: las capturas after acumularon mas registros sinteticos en algunas tablas. Eso limita comparacion pixel a pixel.

## Objetivo

Crear capturas reproducibles con el mismo dataset, fechas, rutas, viewport, usuario y estado de UI para comparar cambios visuales sin tocar DEV ni datos reales.

## Procedimiento propuesto

1. Usar solo TEST descartable.
2. Ejecutar `npm run test:infra:start`.
3. Ejecutar `npm run test:infra:reset`.
4. Ejecutar `node scripts/bootstrap-test.mjs`.
5. Sembrar dataset UX sintetico idempotente con nombre y hash propios, por ejemplo `ux-baseline-2026`.
6. Fijar fecha del navegador con `page.addInitScript` cuando se prueben defaults de fecha.
7. Iniciar Vite en modo TEST con puerto dedicado.
8. Login OTP con usuario `e2e-admin@example.test`.
9. Navegar hashes fijos.
10. Capturar viewports desktop y mobile sin fullPage cuando se quiera revisar sticky real; usar fullPage solo como evidencia complementaria.

## Viewports

- 320x720
- 375x812
- 390x844
- 768x1024
- 1024x768
- 1440x1000

## Rutas minimas

- `#/home`
- `#/savings`
- `#/loans`
- `#/polla`
- `#/more/bank`
- `#/more/movements`
- `#/more/settlements`
- `#/more/profit`
- `#/more/exports`
- `#/more/migration`

## Reglas

- No usar datos reales.
- No limpiar ni resetear DEV.
- No actualizar referencias para ocultar diferencias no revisadas.
- Guardar commit, fecha, viewport, entorno y seed del dataset junto a las capturas.
- Distinguir capturas de prototipo de capturas de app productiva.

## Entregable sugerido para UX-02B

Agregar script `scripts/ux-baseline.ts` o prueba Playwright dedicada solo si se aprueba en UX-02B. UX-02A no lo implementa para evitar introducir mantenimiento antes de aprobar direccion visual.

