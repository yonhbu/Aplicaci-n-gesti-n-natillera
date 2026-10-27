# Auditoría funcional y financiera

Estado: `READY_FOR_REVIEW`. Auditoría iniciada el 2026-10-26 y continuada el 2026-10-27, America/Bogota. Rama: `qa/auditoria-funcional-financiera`. Base inicial limpia: `f5f6671` (`main`). No se publicó código, no se accedió a producción ni se modificó DEV operativo.

## Alcance y seguridad

La auditoría utiliza los módulos existentes, sus RPC, ledger y migraciones. [Inventario y trazabilidad de 37 operaciones](INVENTARIO-Y-COBERTURA.md). No convierte el producto en reemplazo operativo aceptado ni habilita cierre/archivo de ciclo, importaciones reales o comprobantes privados.

Se verificaron API `127.0.0.1:55421`, binding PostgreSQL `55422` del contenedor `supabase_db_natillera-manager-test`, frontend `5198`, OTP local `55424` y endpoint efectivo del cliente autenticado. Se comprobó además que PostgREST y Auth TEST conectan a ese mismo contenedor de BD; el preflight ahora lo exige automáticamente sin imprimir sus cadenas de conexión. El navegador bloquea service workers y destinos ajenos a app/API/fuentes autorizadas. Las credenciales del CLI permanecen en memoria; las entradas de auditoría no cargan dotenv. No se abrieron fuentes privadas, respaldos reales ni datos personales reales.

La base TEST se reconstruyó desde cero con las 41 migraciones versionadas, incluida la nueva de notas. Los fixtures tienen UUID/workspace/identidad sintéticos independientes; cada ejecución parte de un estado conocido. La limpieza reproducible es `node scripts/test-supabase.mjs reset`, exclusivamente TEST. Se conservan los fixtures finales para revisión local hasta ese reset.

La configuración E2E general se corrigió: anteriormente `--mode test` no seleccionaba el entorno en `start-local-safe.mjs`, que exige `--test`. Además leía dotenv. Ahora verifica TEST, arranca con `--test`, rechaza overrides incompatibles y no pasa credenciales elevadas al servidor Vite. Mantiene las suites históricas y sus requisitos de fixtures; la suite autocontenida es `qa:functional:e2e`.

## Defectos y correcciones

| ID | Prioridad | Reproducción / observado | Causa y corrección | Evidencia / estado |
|---|---|---|---|---|
| QA-01 | P0 | Préstamo solo interés 500.000; dos intereses de 25.000; abono capital 200.000. Cuota final mostraba 525.000 junto al parcial de 325.000. | `App.tsx` mezclaba total contractual con pendiente. Se muestra 325.000 pendiente, capital 300.000, interés 25.000 y original 525.000 separado; tarjetas e Inicio usan pendiente. SQL ya aplicaba capital y bloqueaba sobrecapital: no se atribuye un doble cobro efectivo sin evidencia. | Prueba contra componente exacto `f5f6671` falló 325.000 vs 525.000; prueba corregida y ciclo UI/SQL pasan. `READY_FOR_REVIEW`. |
| QA-02 | P1 | Nota deshabilitada y aviso de que no se guarda. | No existía persistencia de nota. Nueva columna `loan_payments.note`, trigger de inmutabilidad y RPC transaccionales con nota/destino/idempotencia. UI permite editar antes de confirmar y muestra nota después de recarga/reverso. | 42 aserciones SQL nuevas; tests de datos/UI y pago total; nota incluida en JSON real descargado. `READY_FOR_REVIEW`. |
| QA-03 | P1 | Importes sin agrupación automática mientras se escribe. | Nuevo `CopInput` reutilizable en 23 campos. Opera sobre cadenas, conserva cursor/selección, centavos, portapapeles y entradas inválidas; `parseCop → toDatabaseMoney` mantiene el contrato SQL. No formatea porcentajes/fechas/códigos. | 18 pruebas de componente y recorrido de teclado/portapapeles/envío `200000.15` con persistencia. Cuatro verificaciones de integración por fuente se distinguen de pruebas de navegador. `READY_FOR_REVIEW`. |
| QA-04 | P1 | Se edita una cuota a abono exclusivo de capital y sigue seleccionada «Cuota». | Edición de monto/desglose cambia modalidad a «Otro monto» y explica abono de capital. No se redistribuye dinero ni se cambia `regular` a cancelación total. | Unitarias y P011 UI; RPC recibió capital 200000.00/interés 0.00. `READY_FOR_REVIEW`. |
| QA-05 | P0 | Runner general podía arrancar DEV por desacuerdo de argumentos y configuración privada. | Configuración segura en memoria, URLs fijas y guardas previas al bootstrap/servidor. | Seis overrides incorrectos rechazados, TEST reconstruido y endpoint efectivo verificado en cada login. `READY_FOR_REVIEW`. |
| QA-06 | P1 | Tres listas de repartos retornaban 1.000 de 1.005 filas y omitían errores de página 2. | `listBankYieldDistributions`, `listLoanProfitPeriodDistributions`, `listLoanProfitPeriodAllocations` ahora usan `fetchAllPages`, filtro de alcance y orden estable por ID. | Seis pruebas RED antes y seis PASS después, incluido error de segunda página. `READY_FOR_REVIEW`. |
| QA-07 | P1 | Corte 25/oct afectado por abono/cancelación del 26; reverso del 27 alteraba estado del 26. | Estado mutable/vista de aplicaciones actuales se usaban como historia. Loader pagina aplicaciones originales; `loanSchedulesAtCut` las cruza con pagos efectivos y reversos al corte. Se reconstruyen estado, cuotas e historial sin cambiar contrato/tasas. Operaciones desde cortes históricos se bloquean con explicación. | Seis fallos reproducidos; pruebas de dominio, loader y UI, más P011 real con ambos cortes y reapertura de sesión. `READY_FOR_REVIEW`. |
| QA-08 | P2 | Cuentas sin movimientos mostraban `-$0,00`. | Cero negativo de Decimal llegaba a Intl. El formateador normaliza exclusivamente ceros al redondeo solicitado; no cambia ledger ni importes. | Prueba RED/PASS y regresión general. `READY_FOR_REVIEW`. |
| QA-09 | P2 | Faltaban los cinco documentos obligatorios tras limpieza de Git; README describía versiones anteriores. | Se consultaron antecedentes `59219a8`, se contrastaron con SQL/código y se restauró síntesis vigente. README distingue alcances históricos de estado FIN actual. | Documentación de reglas, decisiones, setup, backlog y estado incluida. `READY_FOR_REVIEW`. |
| QA-10 | P1 | Tras pagar 100 de interés en un amortizado, abrir inmediatamente otro cobro conservaba 30.000 en vez de 29.900. SQL rechazaba correctamente el monto obsoleto con HTTP 400. | La hoja se cerraba antes de que `refreshAll` completara y el atajo admitía apertura mientras `pending` seguía activo. Se espera la recarga antes de cerrar y se bloquea reapertura durante el guardado. No se relaja SQL ni se cambia el cronograma. | Reproducción Playwright conservada en `reproductions/qa10-amortized-stale-schedule.md`; prueba unitaria RED/PASS con refresco diferido y ciclo completo EA por UI PASS. `READY_FOR_REVIEW`. |
| QA-11 | P2 | La revisión visual a 320 px mostró cifras partidas en los totales de Movimientos. | La cuadrícula imponía dos columnas incluso sin espacio. Usa columnas adaptables con ancho mínimo y apila las tarjetas en móvil estrecho. | Captura inicial conserva el defecto; el test comprueba que cada total ocupa una línea y espera la pantalla cargada antes de capturar. `READY_FOR_REVIEW`. |

## Cobertura ejecutada y límites

La inspección estática del inventario no se marca aprobada. Los resultados de ejecución son:

| Operaciones / superficies | Evidencia ejecutada | Alcance de la conclusión |
|---|---|---|
| I01 acceso, salida/reapertura | OTP real local, nuevo login e identidad sin membresía por UI/API; SQL/RLS | Usuario sin membresía ve «Sin acceso asignado», no crea workspace ni lee cobros/notas del otro ciclo. No se prueba proveedor de correo externo. |
| I02–I03 socios A/B, edición, ahorro completo/parcial | UI, recarga, API y ledger | Cuota y centavos persistidos, aportes separados de polla. |
| I05–I12 contratos, desembolso, interés, abono, cancelación, reverso, destino, notas | P011 y contratos externos fijos/EA por UI; aplicaciones/quotes/RLS SQL | No recobrar capital, conservar historia y claves ante doble clic/respuesta perdida. Acuerdos particulares conservan regresión SQL/dominio; no se inventa reducción de plazo/cuota. |
| I05–I09 amortizado EA | UI: crear 60.000, desembolsar, pagar 100 de interés, pagar cuota restante 29.900 y cancelar | Aplicaciones de 30.000 a la primera cuota; capital restante 30.561,49. La cotización se contrasta con dominio ACT/365F usando fechas efectivas de capital, no con una cifra visual como única fuente. Capital final cero; ingreso de intereses y ledger reconciliados. |
| I13–I16 polla, contribución, ganador, comisión y crédito | UI y SQL | Aporte 10.000, comisión 5.000, crédito 5.000, ahorro original sin mezclar. Variantes de premios históricos y entrega a retirado se distinguen de este recorrido. |
| I19–I22 banco, intereses, retenciones, comisión, traslado y conciliación | UI y SQL | Banco 1.000.000 + 10.000 − 500 − 100 − 1.000 − 100.000 = 908.400; extracto 908.000 deja diferencia −400 sin ajuste automático. |
| I25 administración | Preview y retiro por UI según disponibilidad real; SQL/concurrencia | Reserva EA y saldo libre comprobados; un retiro bancario reduce cash y obligación administrativa exactamente. |
| I26–I29 cuentas finales | UI, RPC y ledger; SQL de compensación/completar/pagar/revertir | Confirmar no disminuye caja; pagar 200.000 sí; pruebas SQL/concurrentes comprueban pago 32,72 y compensación de dos préstamos sin cobros ficticios. |
| I30–I32 repartos | Previews actuales y bloqueo 2026; publicación/reversos/pago en ciclo sintético 2025 vencido, más SQL | Se usa la fecha real de API, sin parchear `fin_civil_today` ni respuestas. Publicar repartos no equivale a archivar/cerrar un ciclo. |
| I30 política clásica | UI: aprobar versión/descripcion sintéticas, costos 500/reserva 1.000, confirmar y pagar | Confirmación sin salida de caja; asignaciones más residual igualan distribuible; pago bancario y reintento único. No se crea una política real ni se cambia la del ciclo operativo. |
| I34 corte, Inicio, movimientos, estadísticas | P011 al 25/26, DOM/recarga/sesión y resúmenes/ledger; navegación 14 rutas | No usar saldo de una sola pantalla como oráculo. Los botones de navegación se comprueban por hit target a 320/768/1440 px. |
| I35 JSON/CSV | Descargas reales; JSON `workspace.v3` comparado con tablas/ciclos/ledger/notas y CSV con partidas | Restauración de workspace verificada por SQL; no se restauraron respaldos reales ni Auth/bytes privados. |
| I37 moneda | Teclado, portapapeles nativo, selección, cursor, borrado, inválidos, centavos, payload y recarga | Interacción real en cuota/principal/ahorro; otros campos comparten componente y tienen integración estática y cobertura financiera de sus formularios. No se afirma haber repetido todos los gestos en cada uno de los 23 campos. |
| I23–I24, I27 y variantes de I11/I28/I29 | 23 pruebas adicionales de `fin-recon`, `money-control`, `reconciliation`, `settlement-loans` | Comparación de extracto, multa por UI, conciliación inicial y reverso, fondos personales entrada/devolución, faltante parcial/excesivo, cobro bancario/anulación y compensación de dos préstamos con pago 32,72. Recarga y viewports 320/375/390/768/1280. Algunas preparaciones/reintentos/reversos usan API autenticada explícita y se distinguen de los clics UI. |
| I04, I18 reversos de ahorro/premio/aporte de polla y cancelación | Recorrido dirigido desde controles UI, conservación de filas y contraste de todas las cuentas antes/después | El premio se revierte junto a crédito y comisión; el aporte se revierte después; cancelar la actividad no borra historia ni deja dinero residual. |
| I17, I33, I36 y variantes legacy no expuestas por la navegación actual | Regresión SQL/dominio existente, según matriz | `confirmLegacyPollaPrizeUnpaid`, activación y fecha de cierre conservan adaptadores, pero no tienen llamadas desde controles activos del `App.tsx` auditado. No se habilitan rutas ocultas para hacer un test. Fuentes reales/comprobantes quedan excluidos por el prompt. |

## Conciliación P011 sintética

Importes COP. Banco es una ubicación de `cash`; efectivo y liquidez total se verifican por separado.

| Estado | Capital pendiente | Interés cobrado acumulado | Efectivo | Banco | Liquidez total |
|---|---:|---:|---:|---:|---:|
| Inicial, después de dos intereses | 500.000 | 50.000 | 550.000 | 1.000.000 | 1.550.000 |
| Abono capital 200.000 | 300.000 | 50.000 | 750.000 | 1.000.000 | 1.750.000 |
| Reverso del abono | 500.000 | 50.000 | 550.000 | 1.000.000 | 1.550.000 |
| Segundo abono y reintento tras respuesta perdida | 300.000 | 50.000 | 750.000 | 1.000.000 | 1.750.000 |
| Cancelación cotizada 300.000 | 0 | 50.000 | 1.050.000 | 1.000.000 | 2.050.000 |

El abono exclusivo de capital no cambia administración ni fondo de utilidad. Cada operación suma cero en ledger. Tras el corte 25/oct, la deuda y cuota final se muestran 500.000 y 525.000; al 26, después del abono, 300.000 y 325.000. Un reverso posterior no modifica retrospectivamente lo satisfecho al corte.

La cuota final pendiente de 325.000 **no es la cotización de cancelación total**. La política SQL vigente `contract-fixed-policy` cobra capital restante y primer interés contractual aún no cubierto; con dos intereses ya satisfechos cotiza 300.000. No se modificó esta política ni se supuso que el interés mensual debía bajar automáticamente a 15.000. Antes de extender el tratamiento de intereses futuros tras un abono, Juan debe confirmar modalidad, causación y acuerdo aplicable.

## Regresión y evidencias

| Verificación | Resultado registrado |
|---|---|
| Línea base inicial unitarias | 22 archivos, 113 pruebas PASS |
| Línea base SQL | 26 archivos, 644 aserciones PASS |
| Reproducción P011 en componente inicial | Fallo esperado 325.000 vs 525.000, reproducible con `scripts/prove-p011-baseline.mjs` |
| Reconstrucción de TEST | Migraciones aplicadas desde cero, incluida `20261108000100` |
| SQL final canónico | 27 archivos, 686 aserciones PASS, plan TAP completo |
| Unitarias finales | 29 archivos, 160 pruebas PASS |
| Concurrencia real PostgreSQL | 4 scripts PASS; reintentos, competencia por fondos, cambio de modalidad, liquidación/pago y cero desbalances |
| TypeScript / build de auditoría | PASS, `npm run qa:functional:build`, sin dotenv |
| Secretos | PASS, `node scripts/check-secrets.mjs` |
| Playwright última corrida completa | **44/44 PASS**, 0 fallidos, 0 omitidos y 0 flaky; `incoming/functional-audit/all-results.json`. Son 40 casos con navegador y 4 comprobaciones estáticas de integración COP, diferenciados en sus títulos. |
| Playwright complementario | 23/23 PASS, sin omisiones, `incoming/functional-audit/extended-results.json` |
| Ajuste visual posterior QA-11 | 3/3 PASS a 320/768/1440 px; cifras completas en una línea y navegación de 14 rutas, capturas `navigation-browser/`. Build/TypeScript repetido PASS después del ajuste CSS. |
| Trazas saneadas | PASS después de la corrida conjunta y repetición de navegación; registro local `incoming/functional-audit/artifact-check-final.txt`, comprobación `node scripts/check-audit-artifacts.mjs`. Sin JWT/claves elevadas detectadas ni trazas crudas. |

Artefactos locales ignorados por Git: `incoming/functional-audit/p011-baseline.txt`, `p011-after-capital.json`, `p011-final.json`, `concurrency/summary.json`, `browser/`, `extended-browser/`, `all-browser/`, `navigation-browser/` y resultados JSON. Las trazas comienzan después del OTP, se eliminan los ZIP crudos y se adjuntan versiones saneadas. Los datos de todos esos escenarios son sintéticos.

La regresión completa se reproduce con **`npm run qa:functional:all`**. El suplemento también puede ejecutarse con `node node_modules/@playwright/test/cli.js test --config playwright.audit-extended.config.ts`; su setup prepara cuatro workspaces distintos mediante scripts sintéticos existentes y preflight antes de cada uno. No se mezclan los datos con P011. El runner principal conserva las operaciones del escenario al 26/oct; su reloj de navegador usa el día civil obtenido del servidor TEST para mantener operativa la vista actual cuando cambia el día, sin alterar el reloj SQL.

El resumen local de cierre queda en `incoming/functional-audit/closure.json`. La corrida completa precede al ajuste CSS QA-11; después de ese cambio se repitieron las tres pruebas de navegación y legibilidad, la compilación y las revisiones de secretos/artefactos.

Los fallos de localizadores de selects, expectativa de modal que se cierra al pagar y expectativa de preview deshabilitado sin política se corrigieron en los tests al contrastar el contrato real. Simular está permitido; confirmar sin política sigue bloqueado. No se cambió el producto para satisfacer esas expectativas erróneas.

## Publicación y reversión

Estos cambios no reescriben importes históricos. El estado de los datos reales no se diagnosticó porque esta auditoría no los lee ni los modifica. No se ejecutaron correcciones sobre DEV o producción.

1. Revisar diff, evidencias de conciliación y política fija existente. Confirmar el destino de despliegue y disponer de respaldo/restauración administrados por su propietario; esta auditoría no lee ni manipula esos respaldos.
2. Verificar primero la versión de esquema del destino aprobado: no se inspeccionó producción y no se asume que tenga aplicadas las 40 migraciones previas del checkout. La nueva migración `20261108000100_immutable_loan_payment_notes.sql` requiere las tablas/RPC predecesoras, en particular `record_located_loan_payment`. Revisar cualquier dependencia pendiente antes de publicar. No editar ni repetir migraciones históricas y no ejecutar resets o `db push --linked` desde esta auditoría.
3. Verificar columna, restricciones, triggers, grants y firmas de `record_noted_loan_payment` / `confirm_noted_loan_prepayment`, luego desplegar frontend. La UI nueva depende de esas RPC; SQL debe precederla.
4. Compilar para el destino aprobado con su URL/clave pública. **No publicar `dist/` de esta verificación**, que apunta a TEST. El navegador solo recibe `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. Hacer smoke autorizado de acceso, lectura, nota, aporte/pago y exportación con datos permitidos. No usar el despliegue público como entorno de pruebas de esta auditoría.
6. Ante un problema de frontend, volver al bundle anterior manteniendo columna/RPC/notas como extensión compatible. Las RPC antiguas se conservaron para intentos previos. No borrar notas auditadas ni quitar la columna como rollback automático. Un ajuste SQL posterior debe ser incremental y revisado.

Archivos productivos: `src/ui/App.tsx`, `CopInput.tsx`, `CompletionReceipt.tsx`, `PersonalFunds.tsx`, `StatementCheck.tsx`; `src/data/loans.ts`, `blockC.ts`; `src/domain/loanPosition.ts`, `money.ts`; `src/lib/types.ts`, `src/styles.css`; nueva migración. El resto corresponde a pruebas, harness, configuración segura y documentación. [Inventario completo de 52 archivos](ARCHIVOS-CAMBIADOS.md), sin mezclar artefactos privados. Los cambios quedan locales, sin commit, push ni PR automático.

## Pendientes de decisión y límites

- Aprobar esta entrega es responsabilidad de Juan; no hay estado `DONE` ni autorización de publicación implícita.
- Confirmar el contrato de intereses futuros ante abonos extraordinarios, sin cambiar porcentajes o acuerdos por intuición. La implementación conserva la política vigente.
- Cierre/archivo integral de ciclo y comprobantes privados no se encontraron como flujos operativos completos; no se certifican ni se implementan a escondidas de esta auditoría.
- El auxiliar legacy `fetchFinBackupExtensions` no tiene consumidores actuales y conserva consultas no paginadas; no se atribuye ese problema al respaldo activo, que usa RPC y se probó con descarga real.
- No se realizó prueba en dispositivo físico, proveedor de correo externo ni infraestructura pública. Se verificaron Chrome y viewports emulados. La restauración validada es sintética/SQL, no prueba de recuperación de secretos, accesos o archivos privados.

