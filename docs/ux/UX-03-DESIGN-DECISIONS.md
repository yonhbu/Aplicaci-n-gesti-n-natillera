# UX-03 - Decisiones de Diseno

Estado: `READY_FOR_REVIEW`

Fecha: 2026-10-13

## Consulta UI UX Pro Max

Se consulto UI UX Pro Max para contrastar recomendaciones de dashboard financiero, responsive, accesibilidad y sistema visual.

Consulta ejecutada:

```powershell
python .agents\skills\ui-ux-pro-max\scripts\search.py "financial dashboard decision oriented data cards responsive accessible" --domain ux -n 8
```

Lectura aplicada:

- Mantener jerarquia clara y accionable.
- Evitar overflow global; permitir scroll local solo donde el patron lo exige.
- Probar breakpoints moviles y desktop.
- Preservar labels y foco visible.
- No inventar indicadores agregados si el significado financiero no esta sustentado.

## Decisiones

| Decision | Resultado | Justificacion |
| --- | --- | --- |
| No crear `saldo disponible` | Aprobada en implementacion | Los saldos mezclan activos, pasivos y fondos restringidos. Sumarlo seria riesgoso. |
| Dividir posicion financiera y seguimiento de ahorro | Aprobada en implementacion | Separa ledger al corte de aportes/expectativas descriptivas. |
| Mantener atajos en Inicio | Aprobada en implementacion | Preserva operaciones existentes y reduce regresion funcional. |
| Quitar badge `Ciclo con datos visibles` | Aprobada en implementacion | No estaba sustentado como estado de negocio verificable. |
| Mantener barra superior movil de UX-01/UX-02B | Aprobada en implementacion | UX-03 no reabre navegacion principal; solo corrige tabs secundarios. |
| No introducir librerias | Aprobada en implementacion | CSS y componentes existentes bastan para el alcance. |

## Evaluacion visual

- En 1440 px el dashboard gana jerarquia: contexto arriba, posicion financiera completa, ahorro y acciones lado a lado.
- En 320 px el contenido queda bajo el primer fold, pero sin solapamiento ni overflow global. Es aceptable para UX-03 porque se conserva legibilidad y accionabilidad.
- Las tarjetas usan borde lateral semantico moderado; no se introduce una paleta nueva ni decoracion innecesaria.
- La informacion complementaria evita competir con la posicion financiera principal.

## Riesgos

- El archivo `App.tsx` sigue concentrando demasiados componentes. UX-03 no lo resolvio para evitar refactor fuera de alcance.
- El dashboard aun depende de que los datos ya cargados por la app sean correctos; no agrega validaciones financieras nuevas.
- Las capturas de Movimientos muestran estado vacio en TEST; falta un baseline con movimientos variados.
