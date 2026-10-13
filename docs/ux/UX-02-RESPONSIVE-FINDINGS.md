# UX-02 - Hallazgos responsive pendientes

## Entorno

- Entorno: TEST descartable.
- Comandos ejecutados: `npm run test:infra:start`, `npm run test:infra:reset`, `node scripts/bootstrap-test.mjs`.
- App local: Vite modo TEST en `http://127.0.0.1:5178`.
- Medicion guardada: `docs/ux/diagnostics/ux-02a-overflow-measurements.json`.
- Datos: sinteticos de bootstrap TEST.

## Resultado resumido

Pantalla | 320 px | 375 px | 390 px | Causa probable
--- | --- | --- | --- | ---
Ahorros | overflow global `390 > 320` | overflow global `390 > 375` | sin overflow | paneles/hero conservan ancho efectivo de 374px; `body { overflow-x:hidden }` oculta parte del defecto visual
Movimientos | overflow global `333 > 320` | sin overflow | sin overflow | ancho de contenedores con padding/gaps; no fue causado por la tabla en dataset vacio

## Detalle tecnico

En Ahorros, los elementos ofensores fueron `hero`, `section-view`, `columns` y `panel`. La tabla dentro de `.table-wrap` reporto `clientWidth == scrollWidth`, por lo que el hallazgo no es una tabla legitimamente desplazable sino layout global.

En Movimientos a 320 px, el desborde fue menor pero real: `documentScrollWidth` de 333. Los ofensores fueron `hero`, `more-tabs` y `panel wide`. La tabla tampoco presento scroll interno en el dataset medido.

## Impacto

- En dispositivos de 320 px puede existir contenido visual cortado o inaccesible si se depende de `overflow-x:hidden`.
- La solucion correcta no es ocultar overflow global, sino permitir que contenedores reduzcan ancho, ajusten padding y que textos largos envuelvan.
- Para tablas con datos reales largos, se requiere prueba adicional con filas densas y tokens largos.

## Correcciones candidatas para UX-02B

1. Remover `body { overflow-x:hidden }` despues de corregir causas.
2. Usar `min-width: 0` en contenedores grid/flex como `.layout`, `.section-view`, `.columns`, `.panel`, `.hero`.
3. Reducir padding movil de `.panel` y `.layout` en 320-375.
4. Aplicar `overflow-wrap:anywhere` a textos largos, IDs, referencias y hashes.
5. Convertir `hero` movil en layout estrictamente vertical sin anchos heredados.
6. Mantener scroll local solo en `.table-wrap` cuando la tabla realmente requiera columnas completas.

## Estado

Confirmado para Ahorros y Movimientos en TEST. Las correcciones quedan asociadas a UX-02B porque implican modificar CSS productivo.

