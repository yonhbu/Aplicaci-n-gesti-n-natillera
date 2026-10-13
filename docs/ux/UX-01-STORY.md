# UX-01 - Navegacion y shell responsive

Estado: `READY_FOR_REVIEW`

## Harness

- Version adoptada: UX Engineering Harness v0.1
- Archivo leido: `C:\Users\juan.vb\Documents\personalWorkSpace\UX_ENGINEERING_HARNESS_v0.1.0\HARNESS.md`
- Fecha de implementacion: 2026-10-13

## Objetivo

Como operador autorizado de Natillera, quiero navegar en escritorio y movil sin solapamientos, conservando seccion, hash, recarga y atras/adelante, para operar sin perder contexto ni activar acciones tapadas.

## Alcance aprobado

- Mantener nombres, destinos, hashes y comportamiento de navegacion existentes.
- Mejorar shell responsive, safe-area, foco visible y accionabilidad.
- Preservar todas las operaciones existentes en desktop y mobile.
- Eliminar mecanismos de click forzado en las pruebas de navegacion afectadas.
- Crear baseline visual versionada con datos sinteticos.

## Fuera de alcance

- Correccion de fecha civil Colombia; queda como deuda tecnica independiente.
- Operaciones financieras, dominio, contratos, persistencia, Supabase, SQL, RPC y RLS.
- Arquitectura de informacion futura, renombres de modulos o nuevos roles.
- Redisenar formularios de Ahorros, Prestamos, Polla o Liquidaciones.
- Introducir dependencias nuevas.

## Archivos permitidos

- `src/ui/App.tsx`
- `src/styles.css`
- `e2e/hu001.spec.ts`
- `docs/ux/UX-01-STORY.md`
- `docs/ux/baseline/**`
- `docs/ux/discovery/**` solo para ubicar los seis documentos aprobados sin cambiar su contenido.

## Criterios de aceptacion

1. Los destinos existentes siguen visibles y operables.
2. `#/more/migration`, recarga, atras y adelante reproducen el destino correcto.
3. En 320, 375, 390, 768, 1024 y 1440 px no hay CTA ni foco tapado por la navegacion.
4. La navegacion por teclado alcanza shell y acciones principales con foco visible.
5. Playwright navega con click normal, sin `force: true`.
6. Pasan `typecheck`, `test`, `build`, `check:secrets` y E2E en TEST descartable.
7. No hay cambios en `src/data`, `src/domain`, `src/lib` financiero ni `supabase` por UX-01.

## Rollback

Revertir solamente cambios de shell, estilos, pruebas E2E de navegacion y artefactos UX. No debe haber migraciones ni datos que revertir.
