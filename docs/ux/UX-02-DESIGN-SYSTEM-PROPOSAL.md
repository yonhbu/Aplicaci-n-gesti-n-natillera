# UX-02 - Propuesta de design system

Estado: propuesta para aprobacion, no implementada.

## Tokens iniciales

```css
:root {
  --color-canvas: #f5f8f6;
  --color-surface: #ffffff;
  --color-surface-muted: #eef4f0;
  --color-text: #102018;
  --color-text-muted: #586b60;
  --color-border: #d8e2da;
  --color-primary: #14532d;
  --color-primary-hover: #0f3f23;
  --color-secondary: #1e3a5f;
  --color-success: #166534;
  --color-warning: #92400e;
  --color-danger: #b42318;
  --color-focus: #2563eb;
  --radius-control: 8px;
  --radius-panel: 10px;
  --shadow-panel: 0 12px 28px rgba(16, 32, 24, 0.08);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Los pares de color deben verificarse con contraste real antes de produccion.

## Componentes compartidos

- `AppShell`: topbar, navegacion, area principal, skip link y safe-area.
- `PageHeader`: titulo, ciclo, corte, acciones principales.
- `Button`: primary, secondary, quiet, danger, loading, disabled.
- `Field`: text, money, date, select, checkbox con label/hint/error.
- `Panel`: contenedor estructural simple.
- `MetricCard`: importe, etiqueta, naturaleza, fecha/corte, fuente.
- `StatusBadge`: estado textual y color semantico.
- `InlineNotice`: success, warning, error, uncertain.
- `DataTable`: desktop con overflow local.
- `MobileRecordList`: representacion movil de los mismos registros.
- `TransactionReview`: paso de revision antes de confirmar operacion monetaria.
- `UncertainOperationNotice`: reintento idempotente del mismo payload.

## Patrones de formularios financieros

1. Captura de datos.
2. Validacion local solo de formato.
3. Previsualizacion o revision cuando exista servidor.
4. Confirmacion contextual.
5. Resultado confirmado, rechazado o incierto.
6. Reintento solo con misma clave/payload si la operacion queda incierta.

## Tablas responsive

- Desktop: tabla con columnas completas, alineacion numerica y detalle expandible.
- Mobile: lista de registros con campos prioritarios y boton "Ver detalle".
- Scroll horizontal solo dentro de `.table-wrap`, nunca como scroll global del documento.
- Celdas con IDs/hashes deben usar `overflow-wrap:anywhere`.

## Estados

- Loading: skeleton simple, no spinner infinito sin contexto.
- Empty: mensaje funcional y siguiente accion.
- Error: mensaje cerca del origen, `role=alert` cuando bloquee.
- Success: `role=status`, no mover foco salvo que sea necesario.
- Uncertain: estado propio, no success ni error generico.

## Estrategia de adopcion

1. UX-02B: tokens CSS + componentes primitivos sin cambiar flujos.
2. UX-03: dashboard con `MetricCard` y glosario aprobado.
3. UX-04/05: formularios y listas por dominio.
4. UX-06+: patrones de revision/confirmacion para liquidacion/utilidad.

No extraer todo `App.tsx` en una sola entrega. La unidad maxima recomendada es un componente base o una pantalla de flujo.

