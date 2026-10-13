# TEST-MATRIX — Gates del rediseño

**Uso:** plan de pruebas futuras; **ningún caso de esta matriz fue ejecutado durante este Discovery**. Base existente: Vitest, Playwright, Supabase TEST y SQL/RLS según el repositorio. Las ejecuciones históricas documentadas en `docs/PROJECT_STATE.md` no sustituyen validación nueva.

Estados: `TODO`, `PASS`, `FAIL`, `BLOCKED`, `NOT_APPLICABLE`. Guardar evidencia, fecha, commit, viewport, dispositivo, entorno y responsable.

## A. Acceso / navegación / adaptabilidad

| ID | Escenario y aserción | Capa | Estado |
|---|---|---|---|
| NAV-01 | OTP usuario autorizado → contenido; no autosignup | E2E + servidor | TODO |
| NAV-02 | Usuario sin workspace → sin acceso, no crea workspace | E2E + RLS | TODO |
| NAV-03 | Refresh de `#/more/migration` conserva destino | E2E | TODO |
| NAV-04 | Back/forward entre inicio, préstamos, Más/Respaldos | E2E | TODO |
| NAV-05 | 320, 375, 390, 768, 1024, 1440px sin superposición de barra inferior | E2E visual y DOM | TODO |
| NAV-06 | Teclado móvil abierto: campo y CTA alcanzables | Manual dispositivo | TODO |
| NAV-07 | Zoom 200% y reflow 400% según criterio: sin pérdidas de datos ni funcionalidad | Manual/a11y | TODO |
| NAV-08 | Tabulador, foco visible, sin `force:true` en clic de Playwright | E2E | TODO |
| NAV-09 | Lectura por screen reader de nav activa, alertas, errores y tablas | Manual asistivo | TODO |
| NAV-10 | Sin scroll horizontal global; tabla con alternativa móvil y acceso al detalle | E2E + manual | TODO |
| NAV-11 | Login OTP: errores, cambiar correo y reenviar si se implementa | E2E | TODO |
| NAV-12 | Clic en CTA rápido abre tarea pretendida, no solo módulo ambiguo | E2E | TODO |

## B. Transacciones monetarias sin regresión

| ID | Escenario y aserción | Capa | Estado |
|---|---|---|---|
| FIN-01 | Registrar aporte COP con socio/mes/fecha correctos, una sola RPC | E2E + SQL | TODO |
| FIN-02 | Fallo ambiguo/red: mismo payload + misma clave en reintento; no duplicación | E2E inyectado + RPC | TODO |
| FIN-03 | Crear contrato ≠ desembolsar; borrador no suma caja ficticia | E2E + ledger | TODO |
| FIN-04 | Cobro separa capital/interés; saldo y ledger iguales al baseline | E2E + dominio | TODO |
| FIN-05 | Cotización prepago invalidada al cambiar contrato o fecha; servidor valida | E2E + RPC | TODO |
| FIN-06 | Polla: aporte separado de ahorro, comisión/premio neto y pago trazado | E2E + SQL | TODO |
| FIN-07 | Conciliación exhibe diferencia; no crea ajuste automático | E2E + SQL | TODO |
| FIN-08 | Liquidación: preview vigente / invalidación de entrada / hash verificado | E2E + RPC | TODO |
| FIN-09 | Confirmación liquidación crea obligación; caja se mueve solo al pago | E2E + ledger | TODO |
| FIN-10 | Utilidad requiere política aprobada; residual centavos e idempotencia | SQL + E2E | TODO |
| FIN-11 | Pago posterior/reverso respeta estado e historial (si UI disponible) | SQL + E2E | TODO |
| FIN-12 | Asientos por operación balanceados; ubicación banco/caja/pendiente no se duplica | SQL | TODO |
| FIN-13 | Fecha local de Colombia cerca de 19:00–23:59 no pasa al día siguiente por UTC | Unit/E2E con reloj | TODO |
| FIN-14 | Indicadores al corte iguales a cálculo base para conjunto fijo | Unit/E2E | TODO |
| FIN-15 | Premios/pagos legacy sin evidencia no se muestran como efectivo verificado | E2E + fixture | TODO |

## C. Estados, exportaciones y administración

| ID | Escenario y aserción | Capa | Estado |
|---|---|---|---|
| EXP-01 | Descarga JSON versión/formato, conjunto de registros, sin secretos | E2E + check:secrets | TODO |
| EXP-02 | CSV etiquetado como reporte, no como restauración completa | E2E + UX | TODO |
| EXP-03 | Dry-run D no escribe en base operativa; error/advertencia claros | E2E + seguridad | TODO |
| EXP-04 | Comprobantes ausentes muestran «no verificado», sin links ficticios | UX + fixture | TODO |
| STATE-01 | Loading, empty, error, no-access y operation uncertain tienen estados adecuados | Component/E2E | TODO |
| STATE-02 | Mensajes urgentes anunciados; foco va a primer error contextual | A11y manual | TODO |
| STATE-03 | Fechas, separadores COP y etiqueta del corte correctos en desktop/móvil | Unit + visual | TODO |
| SEC-01 | RLS mantiene aislamiento del workspace bajo nuevos componentes | SQL/RLS existente | TODO |
| SEC-02 | No datos privados en capturas, logs, prompts ni snapshots públicos | Manual + CI | TODO |

## D. Línea base y ejecución técnica

1. Preparar y validar TEST aislado; **no** resetear DEV local (`AGENTS.md`, `docs/LOCAL_SETUP.md`).
2. Fijar dataset ficticio estable con conteos y suma de partidas; nunca usar JSON/CSV reales en capturas compartidas.
3. Instalar dependencias de forma controlada y ejecutar `npm run typecheck`, `npm run test`, `npm run build`, `npm run check:secrets`.
4. Con infraestructura TEST disponible y credenciales seguras: `npm run test:rls` y `npm run test:e2e` siguiendo `docs/LOCAL_SETUP.md`.
5. Capturar antes/después para rutas críticas, estados alternos y breakpoints; tolerancias explícitas, no aprobar solo con un pixel diff.
6. Auditar axe-core y WCAG 2.2 AA; corregir hallazgos manuales no detectados automáticamente.
7. Comparar snapshots contables (operación, monto, fecha, estado, cuentas, deuda/cartera), no solamente texto de pantalla.

## E. Gates de aceptación

- **G0 Discovery:** contratos e incertidumbres documentados, sin código editado.
- **G1 Diseño:** IA, flujos y definiciones financieras aprobados; tokens contrastados.
- **G2 PR:** pruebas de lint/typecheck/test/build/secretos + casos E2E aplicables + accesibilidad y visuales sin regresión crítica.
- **G3 Finanzas:** revisión de cambios en flujo monetario, misma idempotencia y servidor como autoridad; sin cambios indebidos de DB.
- **G4 Aceptación:** propietario valida tarea real y pasa explícitamente `READY_FOR_REVIEW` → `DONE`.
