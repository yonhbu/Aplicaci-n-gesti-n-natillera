# Guia de prueba local - correccion UX y exportaciones

Estado esperado de esta entrega: `READY_FOR_REVIEW`. No despliega, no importa productivamente legacy y no marca ninguna HU como `DONE`.

## 1. Preparar entorno

Directorio de ejecucion:

```powershell
cd "C:\Users\juan.vb\Documents\personalWorkSpace\Aplicación-gestión-natillera"
```

Instalar dependencias con lockfile:

```powershell
npm ci
```

Abrir Docker Desktop antes de iniciar Supabase local.

## 2. DEV persistente

Usar DEV solo para datos ficticios persistentes. No ejecutar reset destructivo sobre DEV como rutina.

Terminal 1:

```powershell
npm run dev:infra:start
npm run dev:env:write
npm run dev:db:migrate
npm run dev:bootstrap
npm run dev
```

Abrir la URL que imprima Vite. En esta configuracion suele ser:

```text
http://127.0.0.1:5176
```

Login local esperado: usuario provisionado por bootstrap. No hay alta libre desde la app. Para OTP local revisa la bandeja:

```text
http://127.0.0.1:44124
```

## 3. TEST descartable

Usar TEST para pruebas con escritura y automatizadas.

```powershell
npm run test:infra:start
npm run test:infra:reset
npm run test:rls
npm run test:e2e
npm run test:infra:stop
```

Puertos TEST:

```text
API Supabase: http://127.0.0.1:55421
Studio: http://127.0.0.1:55423
OTP/Mailpit: http://127.0.0.1:55424
```

## 4. Recorrido manual de navegacion

1. Iniciar sesion.
2. Verificar que `Inicio` muestra resumen, alertas y accesos rapidos, no todos los formularios.
3. Abrir `Ahorros` y verificar socios, aportes y detalle por socio.
4. Abrir `Prestamos` y verificar contratos, cobros y prepago.
5. Abrir `Polla` y verificar actividades, aportes y premios.
6. Abrir `Mas`.
7. Probar subpantallas `Banco y caja`, `Movimientos`, `Liquidaciones`, `Utilidad`, `Respaldos` y `Migracion`.
8. Recargar en una subpantalla y confirmar que conserva la vista por hash.
9. Usar atras/adelante del navegador y confirmar que cambia de pantalla.

En movil, la navegacion principal queda como barra inferior. Las tablas extensas pueden tener scroll propio, pero la pagina completa no deberia requerir scroll horizontal a 390 px.

## 5. Descargar respaldos y reportes

Ir a `Mas > Respaldos`.

1. `Descargar respaldo JSON`: genera un archivo `natillera-<anio>-<timestamp>-respaldo-abcd.json`.
   - Contiene la base actual visible por RLS: workspace, ciclo, socios, aportes, ledger, prestamos, polla, banco, liquidaciones, utilidad, politicas/asignaciones de utilidad y metadatos D disponibles.
   - Si la base esta vacia, el JSON sigue siendo valido y lo evidencia con conteos en cero.
   - No contiene tokens, credenciales ni bytes de comprobantes privados.
2. `Descargar reporte CSV`: genera `natillera-<anio>-<timestamp>-reporte.csv`.
   - Es UTF-8 con BOM, encabezados, comillas escapadas y proteccion basica contra formulas de hojas de calculo en textos.
   - No sustituye el respaldo JSON.
3. `Descargar informe de migracion`: esta deshabilitado hasta generar un dry-run en `Mas > Migracion`.

Los archivos quedan en la carpeta de descargas configurada por el navegador. La app solo puede verificar que el navegador inicio la descarga, no que el usuario la guardo definitivamente.

## 6. Migracion D

Ir a `Mas > Migracion`.

1. Seleccionar CSV y/o JSON legacy desde una ubicacion fuera de Git.
2. Ejecutar `Prevalidar sin escrituras`.
3. Revisar estado, fuente, hash, conteos, bloqueantes y decisiones.
4. Descargar el dry-run desde esa pantalla o volver a `Mas > Respaldos` y descargar el informe.

Estados reales:

- Archivo leido: el navegador pudo leer el CSV/JSON.
- Prevalidacion/dry-run: se generaron inventario, mapeos, incidencias y conciliacion local.
- Ensayo aislado: solo existe si se ejecutan los scripts D sobre TEST.
- Importacion operativa: no queda autorizada por esta correccion.

Un resultado con `0` bloqueantes y decisiones pendientes no equivale a migracion completa.

## 7. Checks antes de enviar a revision

```powershell
npm run check:secrets
npm run typecheck
npm run test
npm run build
```

Si Docker esta disponible:

```powershell
npm run test:infra:start
npm run test:infra:reset
npm run test:rls
npm run test:e2e
npm run test:infra:stop
```

Si Docker falla, reportar el error exacto y no declarar aprobadas RLS/E2E.

## 8. Telefono fisico

No uses `127.0.0.1` desde el telefono: apunta al propio telefono, no al computador. Para prueba fisica se requiere host LAN, Supabase accesible por LAN y contexto seguro para `crypto.randomUUID()`. No exponer Studio ni llaves administrativas.

## 9. Entregar a revision

Enviar:

- ZIP limpio del codigo actual A-D mas esta correccion, preservando rutas relativas.
- Resultados reales de checks.
- Capturas sin datos privados de Inicio escritorio/movil, una lista con detalle, Respaldos y Migracion.
- Exportaciones ficticias de TEST si se generaron.

No incluir `.env`, tokens, respaldos privados, `node_modules`, `dist`, temporales ni datos reales.
