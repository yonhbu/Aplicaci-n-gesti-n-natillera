# UX-02 - Direcciones visuales

## Prototipos

Preview ejecutable: `docs/ux/prototypes/ux-02a/index.html`

Capturas:

- `docs/ux/prototypes/ux-02a/screenshots/a-dashboard-desktop.png`
- `docs/ux/prototypes/ux-02a/screenshots/a-dashboard-mobile.png`
- `docs/ux/prototypes/ux-02a/screenshots/b-dashboard-desktop.png`
- `docs/ux/prototypes/ux-02a/screenshots/b-dashboard-mobile.png`
- `docs/ux/prototypes/ux-02a/screenshots/c-dashboard-desktop.png`
- `docs/ux/prototypes/ux-02a/screenshots/c-dashboard-mobile.png`
- `docs/ux/prototypes/ux-02a/screenshots/a-aporte.png`
- `docs/ux/prototypes/ux-02a/screenshots/a-prestamos.png`
- `docs/ux/prototypes/ux-02a/screenshots/a-movimientos.png`

## A. Financial Professional

Paleta: verde institucional, azul financiero, superficies blancas, fondo gris-verde, estados semanticos para exito/advertencia/error.

Tipografia: sistema actual o IBM Plex Sans si se aprueba carga externa; numeros tabulares para importes.

Espaciado: escala 4/8px, densidad media, gutters adaptativos.

Bordes/elevacion: radio 8-12px, sombras discretas, divisores visibles.

Navegacion: lateral desktop, superior/mobile sticky revisada, jerarquia clara entre ciclo, modulo y tarea.

Tarjetas/indicadores: pocas tarjetas, cada una con naturaleza del dinero y fecha/corte.

Formularios: labels visibles, ayuda persistente en COP/fecha, revision antes de confirmar.

Tablas: tabla desktop; lista/resumen con detalle expandible en mobile.

Accesibilidad: contraste AA por token, foco visible, sin color como unica senal.

Ventajas: maxima confianza, facil adopcion, menor riesgo de confundir estados financieros, buena base para design system.

Limitaciones: menos llamativa que SaaS moderno; exige buen trabajo de microcopy para no sentirse austera.

Costo: medio. Puede adoptarse gradualmente con tokens y componentes.

## B. Modern SaaS

Paleta: azul intenso, verde de accion, superficies brillantes, tarjetas de alto protagonismo.

Tipografia: Inter/sistema, jerarquia mas expresiva.

Espaciado: mas aire visual y composicion tipo bento.

Bordes/elevacion: radios 14-18px, sombras mas visibles.

Navegacion: enfoque de producto SaaS, acciones rapidas y resumen amigable.

Tarjetas/indicadores: muchas tarjetas resumidas, buen impacto inicial.

Formularios: formularios por pasos, lenguaje mas conversacional.

Tablas: reducir tablas visibles y priorizar vistas resumidas.

Accesibilidad: viable, pero el contraste debe medirse porque los gradientes pueden fallar.

Ventajas: percepcion moderna inmediata, buena para presentacion ejecutiva.

Limitaciones: riesgo de ocultar detalle auditable, abuso de tarjetas, menor densidad para operador experto.

Costo: medio-alto por necesidad de reorganizar flujos.

## C. Data-Dense Financial

Paleta: azul oscuro/slate, acentos verdes, alto contraste, menos superficie decorativa.

Tipografia: Fira Sans/Fira Code o sistema con numeros tabulares.

Espaciado: compacto, 8-16px, alto volumen de filas.

Bordes/elevacion: bordes funcionales, minima elevacion.

Navegacion: toolbar, filtros, vista de ledger y accesos rapidos.

Tarjetas/indicadores: compactos, orientados a comparacion.

Formularios: paneles laterales o pasos compactos.

Tablas: protagonistas, con filtros, sticky headers y detalle por operacion.

Accesibilidad: requiere mas cuidado por densidad y dark mode.

Ventajas: eficiencia para operador experto, mucha informacion por pantalla.

Limitaciones: mas dificil en mobile, mayor carga cognitiva, menor amabilidad para revision ocasional.

Costo: alto si se implementa bien; bajo solo si se vuelve una tabla cruda, lo cual seria mala UX.

## Recomendacion

Adoptar A. Financial Professional como direccion principal.

Motivo: Natillera no es una app de trading ni una landing fintech; es un sistema privado de dinero, obligaciones, historicos inciertos y revision manual. La direccion A conserva confianza, mejora legibilidad, permite densidad progresiva y reduce el riesgo de redisenar la semantica financiera por estetica.

Usar de B solo la claridad de jerarquia y de C la disciplina de tablas/filtros. No adoptar dark mode como default en UX-02B.

