# Component Inventory - UX-02B

Estado: `READY_FOR_REVIEW`

## Componentes base agregados

Componente | Archivo | Estado | Uso actual
--- | --- | --- | ---
`Button` | `src/ui/App.tsx` | Implementado local | Topbar, hero, login y acciones rapidas de inicio
`Panel` | `src/ui/App.tsx` | Implementado local | Login e Inicio
`Field` | `src/ui/App.tsx` | Implementado local | Login OTP
`StatusBadge` | `src/ui/App.tsx` | Implementado local | Estado sintetico de Inicio
`InlineNotice` | `src/ui/App.tsx` | Implementado local | Mensaje global, login y dry-run de migracion

## CSS base

Clase | Proposito
--- | ---
`.button-*` | Variantes primary, secondary, quiet, danger
`.panel` | Superficie financiera con borde, radio y sombra ligera
`.field-*` | Hint/error de campo
`.inline-notice-*` | Estados success, warning, danger, neutral, uncertain
`.status-badge-*` | Estado compacto textual

## Decisiones

- Los componentes permanecen en `App.tsx` para evitar una extraccion amplia prematura.
- No se introdujo biblioteca de UI.
- No se cambio ningun contrato de datos.
- No se reemplazaron todos los formularios: UX-02B establece fundamentos, no rediseno completo.

## Pendientes

- Extraer componentes a archivos propios cuando UX-02C/UX-03 tenga mas uso repetido.
- Aplicar `Field` progresivamente a formularios financieros, cuidando errores y ayudas.
- Agregar patron de `TransactionReview` en una HU posterior; no corresponde a UX-02B.

