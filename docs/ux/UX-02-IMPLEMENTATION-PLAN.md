# UX-02 - Plan incremental

Estado: `READY_FOR_DESIGN_REVIEW`

## Decision recomendada

Aprobar `Financial Professional` como direccion principal para UX-02B.

## UX-02B propuesto

Alcance:

- Crear tokens CSS semanticos.
- Corregir overflow responsive confirmado en Ahorros/Movimientos.
- Introducir componentes primitivos pequenos: `Button`, `Panel`, `Field`, `StatusBadge`, `InlineNotice`.
- No cambiar operaciones, RPC, SQL, permisos ni persistencia.
- No redisenar formularios completos; solo aplicar base visual si no cambia comportamiento.

Archivos candidatos:

- `src/styles.css`
- `src/ui/App.tsx` solo si se extraen componentes locales minimos
- `e2e/hu001.spec.ts` para aserciones responsive si se corrige overflow
- `docs/ux/*` para evidencia

No permitidos:

- `supabase/**`
- `src/data/**`
- `src/domain/**` salvo prueba/documento aprobado no visual
- contratos financieros

## Secuencia sugerida

1. Aprobar direccion visual.
2. Crear STORY UX-02B acotada.
3. Corregir overflow sin `overflow-x:hidden`.
4. Agregar tokens y primitivas CSS.
5. Capturar baseline deterministica.
6. Ejecutar `typecheck`, `test`, `build`, `check:secrets` y E2E aplicable en TEST.
7. Entregar `READY_FOR_REVIEW`.

## Riesgos

- App.tsx sigue demasiado grande; extraer de golpe aumentaria riesgo.
- Una mejora visual puede ocultar diferencias entre obligacion y pago si no se revisa microcopy financiero.
- Dark mode como default puede bajar legibilidad si no se audita por combinacion real.
- Mobile 320 requiere pruebas reales porque los contenedores actuales ya desbordan.

## Criterios de aprobacion para UX-02B

- Sin scroll horizontal global en 320/375/390.
- Tablas con scroll local o lista movil equivalente.
- Foco visible no queda cubierto por sticky nav.
- Tokens documentados y usados consistentemente.
- Ninguna operacion financiera cambia resultado, estado ni idempotencia.
- Capturas before/after con mismo dataset.

## Estado final

`READY_FOR_DESIGN_REVIEW`. Detenerse antes de UX-02B y solicitar aprobacion explicita de direccion visual.

