# Pendientes y prioridades

Todos los elementos implementados permanecen `READY_FOR_REVIEW` hasta aceptación de Juan.

- P0: aprobar conciliación del escenario sintético P011 y revisar tratamiento contractual de futuros intereses sin reescribir historia.
- P1: revisar migración incremental de notas y orden de publicación SQL/frontend. No desplegar el frontend de notas antes de disponer de sus RPC.
- P1: completar cualquier recorrido indicado como pendiente en el informe QA; cobertura SQL o inspección estática no reemplazan interacción de navegador.
- P1: ampliar escenarios UI de concurrencia entre sesiones, pérdida de respuesta y cortes históricos cuando no exista evidencia ejecutada específica.
- P2: revisar la corrección de las tres consultas de repartos truncadas. El auxiliar legacy sin consumidores conserva su limitación; no afecta el respaldo RPC vigente.
- NAT-HU-007: cierre/archivo integral de ciclo, pendiente de especificación/implementación verificable. No confundir con publicación de utilidades al cierre.
- Comprobantes privados, conciliación productiva y restauración de datos reales siguen sujetos a revisión y autorización propias. No importar datos reales en esta auditoría.
