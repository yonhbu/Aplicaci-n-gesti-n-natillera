# UX-02B - Design System Foundations

Estado: `READY_FOR_REVIEW`

## Objetivo

Implementar la base visual y responsive de Natillera Manager con la direccion `Financial Professional`, incorporando jerarquia moderna moderada y patrones de datos densos sin redisenar flujos ni modificar reglas financieras.

## Alcance implementado

- Tokens semanticos de color, superficie, texto, espaciado, radios, elevacion, foco y estados.
- Componentes base pequenos en `src/ui/App.tsx`: `Button`, `Panel`, `Field`, `StatusBadge`, `InlineNotice`.
- Correccion responsive de overflow global confirmado en Ahorros y Movimientos.
- Mejora visual del shell y navegacion UX-01 sin cambiar nombres ni hashes.
- Script deterministico de baseline visual sobre TEST descartable.
- Capturas `before` y `after` con el mismo dataset sintetico y viewports.
- Prueba E2E reforzada para fallar ante overflow global.

## Fuera de alcance

- Supabase, SQL, RPC, RLS y persistencia.
- Calculos financieros, contratos de dominio e idempotencia.
- Nueva arquitectura de informacion Tesoreria/Cierre.
- Redisenar dashboard completo o formularios de negocio.
- Dependencias nuevas de UI.
- Declarar conformidad WCAG completa.

## Archivos principales

- `src/styles.css`
- `src/ui/App.tsx`
- `e2e/hu001.spec.ts`
- `scripts/ux-02b-baseline.mjs`
- `package.json`
- `docs/ux/DESIGN-TOKENS.md`
- `docs/ux/COMPONENT-INVENTORY.md`
- `docs/ux/UX-02B-RESULTS.md`
- `docs/ux/baseline/ux-02b/**`

## Criterios de aceptacion

1. No hay overflow horizontal global en 320, 375, 390, 768, 1024 y 1440 px para Inicio, Ahorros y Movimientos.
2. Las tablas conservan acceso mediante scroll local cuando lo requieran.
3. El shell mantiene navegacion superior sticky en movil y lateral en desktop.
4. Los hashes existentes se conservan.
5. Los componentes base no cambian comportamiento financiero.
6. La baseline se puede regenerar con `npm run ux:baseline -- --phase after`.
7. Quality gates del repo pasan o quedan documentados.

## Rollback

Revertir cambios de `src/styles.css`, componentes visuales locales de `src/ui/App.tsx`, aserciones responsive E2E, script de baseline y docs UX-02B. No hay migraciones ni datos que revertir.

