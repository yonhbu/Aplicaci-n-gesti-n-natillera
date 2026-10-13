# Design Tokens - UX-02B

Estado: `READY_FOR_REVIEW`

## Paleta

Token | Valor | Uso
--- | --- | ---
`--color-canvas` | `#f5f8f6` | Fondo general
`--color-surface` | `#ffffff` | Paneles, inputs, tarjetas
`--color-surface-muted` | `#edf5ef` | Superficie secundaria
`--color-surface-raised` | `#fbfdfb` | Superficie elevada
`--color-text` | `#102018` | Texto principal
`--color-text-muted` | `#52665b` | Texto secundario
`--color-border` | `#d7e2d9` | Bordes normales
`--color-border-strong` | `#b8cbbb` | Bordes de controles
`--color-primary` | `#14532d` | Accion primaria / marca
`--color-primary-hover` | `#0f3f23` | Hover primario
`--color-secondary` | `#1e3a5f` | Accion secundaria financiera
`--color-danger` | `#b42318` | Error
`--color-warning` | `#92400e` | Advertencia
`--color-success` | `#166534` | Exito
`--color-uncertain` | `#6d28d9` | Estado incierto
`--focus-ring` | `#2563eb` | Foco visible

## Espaciado, radios y elevacion

Token | Valor
--- | ---
`--space-1` | `4px`
`--space-2` | `8px`
`--space-3` | `12px`
`--space-4` | `16px`
`--space-5` | `20px`
`--space-6` | `24px`
`--radius-control` | `8px`
`--radius-panel` | `10px`
`--shadow-panel` | `0 12px 28px rgba(16, 32, 24, 0.08)`

## Contraste verificado

Par | Ratio
--- | ---
Texto principal `#102018` sobre blanco | `16.91:1`
Texto secundario `#52665b` sobre blanco | `6.16:1`
Blanco sobre primario `#14532d` | `9.11:1`
Blanco sobre secundario `#1e3a5f` | `11.50:1`
Exito `#166534` sobre `#e7f6ec` | `6.38:1`
Advertencia `#92400e` sobre `#fff7ed` | `6.68:1`
Error `#b42318` sobre `#fef3f2` | `6.05:1`
Incierto `#6d28d9` sobre `#f3e8ff` | `6.02:1`

Estas combinaciones pasan AA para texto normal. No se declara conformidad WCAG completa porque faltan pruebas manuales de lector de pantalla, zoom/reflow y navegacion completa por teclado.

## Reglas de uso

- No usar rojo/verde como unica senal: cada estado debe tener texto.
- Importes usan `font-variant-numeric: tabular-nums`.
- Foco visible se conserva globalmente con 3px.
- El scroll horizontal global no debe usarse como solucion responsive.
- Tablas pueden tener scroll local dentro de `.table-wrap`.

