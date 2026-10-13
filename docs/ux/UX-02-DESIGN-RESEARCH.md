# UX-02 - Investigacion de diseno

Fecha: 2026-10-13  
Herramienta consultada: UI UX Pro Max `2.15.0`  
Harness: UX Engineering Harness v0.1

## Lecturas base

Se revisaron `AGENTS.md`, `README.md`, reglas de negocio, estado del proyecto, backlog, decisiones, setup local, Discovery UX y resultados de UX-01.

Hechos relevantes:

- La app es React 19, TypeScript, Vite y CSS global.
- La UI sigue concentrada en `src/ui/App.tsx`.
- UX-01 cambio la navegacion movil a barra superior sticky y agrego foco visible/skip link.
- La UI esta en `READY_FOR_REVIEW`, no `DONE`.
- Las operaciones monetarias dependen de RPC/SQL, no de validacion visual.

## Consulta UI UX Pro Max

Consultas ejecutadas:

- `financial management dashboard fintech administration savings loans data heavy responsive`
- `responsive data-heavy applications accessible navigation data tables financial forms transaction confirmation`
- `fintech financial administration savings loans`
- `accessible ethical minimalism swiss financial dashboard`
- `fintech accessible professional green blue`
- `financial dashboard data table numeric typography`

Resultados utiles:

- Para dashboard financiero, UI UX Pro Max favorece `Dark Mode (OLED) + Data-Dense Dashboard`.
- Para accesibilidad, recomienda alto contraste, foco visible, navegacion por teclado, targets tactiles de 44px y reduced motion.
- Para tablas responsive, acepta scroll horizontal dentro de contenedor o conversion a tarjetas, pero rechaza que la tabla rompa el viewport.
- Para color, ofrece alternativas profesionales azul/verde y verde institucional.
- Para tipografia financiera, recomienda IBM Plex Sans o una familia de datos como Fira Sans/Fira Code.

## Contraste critico

No adopto dark/OLED como direccion principal para Natillera. Aunque puede funcionar en trading o monitoreo en tiempo real, Natillera requiere revision cuidadosa, formularios, tablas y confirmaciones de dinero. Una interfaz clara institucional reduce fatiga, facilita soporte, mejora impresion/revision y mantiene coherencia con el verde heredado.

Recomendacion: usar UI UX Pro Max como catalogo de patrones y checklist, no como autoridad de marca. La direccion principal debe priorizar legibilidad, trazabilidad y confianza sobre apariencia fintech generica.

## Principios para UX-02

1. Servidor y ledger siguen siendo autoridad.
2. Los indicadores deben decir naturaleza: liquidez, obligacion, cartera, fondo o historico no verificado.
3. Las acciones monetarias deben tener revision, estado incierto e idempotencia visible.
4. Las tablas no deben romper el documento; si requieren scroll horizontal, debe ser local y evidente.
5. La UI debe seguir en espanol Colombia.
6. No introducir librerias por estetica.

