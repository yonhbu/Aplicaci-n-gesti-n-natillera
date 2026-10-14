# UX-04 - Decisiones de Diseno

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-14

## Consulta UI UX Pro Max

Consulta ejecutada:

```powershell
python .agents\skills\ui-ux-pro-max\scripts\search.py "financial savings members contribution form dashboard mobile responsive table" --domain ux -n 8
```

Recomendaciones aplicadas:

- Usar layout mobile-first y evitar scroll horizontal global.
- Mantener targets tactiles comodos.
- Preservar labels visibles en formularios.
- Mostrar feedback de submit y errores cerca del campo cuando sea posible.
- En movil, usar tabla con scroll local o representacion tipo card.

## Decisiones principales

| Decision | Resultado | Justificacion |
| --- | --- | --- |
| Separar aporte de gestion de socios | Implementado | Un aporte registra dinero; editar socio administra participacion. Mezclarlos aumentaba carga cognitiva. |
| Mantener nombres accesibles existentes | Implementado | Evita romper E2E y memoria operativa del usuario. |
| No crear indicadores de mora | Implementado | No hay definicion aprobada de cumplimiento/deuda exigible. |
| `Pendiente descriptivo` en tono neutro | Implementado | El dato es descriptivo, no prueba morosidad. |
| Busqueda local simple | Implementado | Los datos ya estan cargados en cliente; no requiere contrato nuevo. |
| Historial separado | Implementado | Aclara fecha efectiva, mes aplicado, metodo y fuente. |
| Evidencia UX-04 con dataset ampliado | Implementado | Permite revisar nombres largos, importes grandes, rangos y legacy sin datos privados. |

## Semantica de indicadores de Ahorros

| Indicador | Fuente | Cautela |
| --- | --- | --- |
| Socios ciclo | `cycleMembers.length` | Participaciones visibles, no personas reales unicas garantizadas. |
| Ahorro recibido | Suma de `savings_contributions.amount` | Conserva comportamiento existente; no se filtra por fecha de corte. |
| Cuotas esperadas ciclo | Cuota mensual por meses activos del rango | Es expectativa descriptiva. |
| Pendiente descriptivo | `max(esperado - recibido, 0)` | No equivale por si solo a mora ni deuda exigible. |

## Hallazgos UX restantes

- El formulario de socio sigue exponiendo varios campos a la vez. UX-04 lo ordena, pero un flujo paso a paso podria ser mejor si crece la base.
- El historial usa tabla; es correcto para trazabilidad, pero podria evolucionar a detalle expandible por socio.
- La fecha civil sigue usando la deuda tecnica previa.
- Los mensajes de error de servidor no siempre identifican un campo exacto; UX-04 mapea los casos mas comunes sin cambiar contratos.
