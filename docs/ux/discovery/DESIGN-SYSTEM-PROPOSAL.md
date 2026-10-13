# DESIGN-SYSTEM-PROPOSAL — Natillera Manager (borrador)

**Estado:** propuesto; no aprobado ni contrastado todavía con WCAG en navegador.  
**Objetivo:** panel financiero operativo sobrio, alta legibilidad, errores imposibles de ignorar y trazabilidad preservada. **UI UX Pro Max es insumo de decisión**, no un generador que reemplace criterios del producto.

## 1. Dirección visual

- **Patrón dominante:** Operations / Finance Dashboard, densidad moderada en escritorio y progresiva en móvil.
- **Estilo:** moderno, sobrio, alto contraste, mínimo efecto decorativo. Mantener la identidad verde de la natillera, pero pasar de un único verde en todos los botones a jerarquía semántica.
- **Evitar:** glassmorphism en tablas densas, degradados ornamentales en resultados financieros, rojo/verde como único significado, modales con formularios larguísimos y cards para cada partida contable.

## 2. Tokens de referencia (hipótesis visual)

```css
:root {
  --color-brand-700: #14532d;   /* color heredado: contrastar usos */
  --color-brand-600: #166534;
  --color-brand-050: #f0fdf4;
  --color-surface: #ffffff;
  --color-canvas: #f6f8f5;
  --color-text: #172026;
  --color-text-muted: #475569;
  --color-border: #d9e2d5;
  --color-danger: #b42318;
  --color-warning: #92400e;
  --color-success: #166534;
  --radius-control: 8px;
  --radius-card: 12px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --focus-ring: 3px solid #2563eb;
}
```

No declarar estos colores “WCAG aprobados” sin comprobar contraste por combinación y estado. Ajustar tokens si las mediciones lo requieren.

## 3. Tipografía y datos

- Fuente: conservar stack del sistema o adoptar una sans de interfaz solo si la carga y licencia están justificadas.
- Cuerpo: base 16px para lectura general; labels y metadatos con legibilidad verificable, nunca depender de 11px en móvil.
- Cifras: `font-variant-numeric: tabular-nums`; alineación por unidades, reglas de separadores COP desde `formatCop`, sin redondeos escondidos.
- Fecha: visual `dd/MM/yyyy` para es-CO, pero formatos de almacenamiento/contratos actuales permanecen inalterados. Evitar convertir fechas civiles por UTC.
- Nombres financieros sin anglicismos internos: glosario `member_settlement_paid` → `Pago de liquidación`; cuenta contable visible en detalle técnico, no eliminada.

## 4. Componentes reutilizables

| Nivel | Componente | Contrato UX |
|---|---|---|
| Primitivo | `Button` | variantes primary/secondary/quiet/danger, loading y disabled con razón accesible |
| Primitivo | `TextField`, `MoneyField`, `DateField`, `SelectField` | label real, hint, error inline, teclado adecuado, foco visible |
| Primitivo | `StatusBadge`, `InlineNotice`, `EmptyState`, `ConfirmDialog` | texto semántico; no color como única señal; focus management |
| Estructural | `AppShell`, `Sidebar`, `BottomNavigation`, `PageHeader` | navegación responsive, espacio para safe area y teclado |
| Estructural | `DataTable`, `MobileRecordList`, `FilterBar` | mismos registros y acceso al detalle, distinta representación |
| Financiero | `MoneyMetric`, `FinancialBreakdown`, `PaymentReview` | importe, naturaleza, fecha de corte, estado y fuente distinguibles |
| Financiero | `OperationTimeline`, `TransactionDetail` | actividad humana y evidencia contable expandible |
| Proceso | `Wizard`, `ReviewStep`, `UncertainOperationNotice` | no perder estado ni idempotency key durante un error de red |

**Evitar reescritura de lógica de negocio en componentes visuales.** Las nuevas vistas deben consumir data/domain ya existentes.

## 5. Responsive y accesibilidad

- Evaluar anchos 320, 375, 390, 768, 1024 y 1440; no scroll horizontal global; tablas pueden desplazar horizontalmente **solo si** hay acceso visible y usable a cada columna, o transformarse en lista.
- Barra inferior nunca debe tapar foco, acciones o texto; respetar `env(safe-area-inset-bottom)` sin sustituir medición real.
- Objetivo WCAG 2.2 AA. Aplicar `:focus-visible`, `role=status` para éxito y `role=alert` para errores urgentes cuando proceda; etiquetas asociadas; validación accesible.
- Cuerpo escalable con zoom 200%, reflow 400% según criterios aplicables, orden de tabulación correcto y lectores de pantalla.
- Controles táctiles recomendados de ~44×44px para acciones frecuentes. No afirmar que sea el mínimo universal de WCAG 2.2 AA.
- Preferencia `prefers-reduced-motion`; transiciones funcionales sin animación por defecto en operaciones monetarias.

## 6. Layout de referencia

**Desktop:** sidebar izquierda 220–256px, encabezado de contexto estable, área principal flexible; usar ancho completo disponible para tablas, no forzar todas las vistas al centro en un panel angosto. Dos zonas: lectura/resumen y tareas (no mezclar políticas con pagos).

**Mobile:** header compacto, cinco destinos en bottom nav, listas resumidas, acciones contextuales, confirmaciones sin tapar CTA; evitar scroll de dos niveles y tablas diminutas.

## 7. Decisiones de uso de gráficos

No añadir gráficas porque el catálogo tenga 25 tipos. Primero confirmar que existe una serie temporal comparable y correctamente imputada: progreso de aportes, cartera vencida o ubicación de fondos. Mostrar el dato fuente, rango, unidades y definiciones; si no existe calidad de datos, usar números y tablas.

## 8. Gobernanza y evolución

Centralizar variables CSS semánticas y documentación; componentizar gradualmente `App.tsx`. No instalar Tailwind, shadcn ni otro kit **solo** por estética: decidir tras inspección de complejidad, alcance y costos. Congelar una baseline visual aprobada por pantalla y dispositivo; cambios financieros deben respetar equivalencia de resultados.
