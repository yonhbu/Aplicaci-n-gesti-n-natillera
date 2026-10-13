# CURRENT-STATE — Natillera Manager

**Fecha de evaluación:** 2026-10-13  
**Fuente:** ZIP `natillera-manager-codigo-review-2026-10-13.zip` (100 entradas, 1 008 831 bytes descomprimidos). Complemento: 14 capturas suministradas por el propietario.  
**Tipo de revisión:** inspección estática del código y auditoría heurística de las capturas. **No** se inició Supabase, **no** se ejecutó la app ni se pasó la suite; las aprobaciones históricas del README no equivalen a una ejecución por este auditor.  
**Estado de negocio:** `READY_FOR_REVIEW`, no `DONE` ni despliegue productivo (`AGENTS.md:19-27`, `docs/PROJECT_STATE.md`).

## 1. Stack y arquitectura confirmados

| Capa | Implementación y evidencia |
|---|---|
| UI | React 19, TypeScript 5, Vite 7 (`package.json`), entrada `src/main.tsx:1-10` |
| Estilos | CSS global `src/styles.css:1-281` y CSS inyectado con `<style>` desde `NavigationStyles` en `src/ui/App.tsx:517-660` |
| Enrutamiento | Navegación interna basada en `window.location.hash`, sin React Router (`src/ui/App.tsx:67-85,128-132,165-176,283-290`) |
| Estado | `useState`, `useMemo`, `useEffect`; 16 colecciones de datos mantenidas por el componente raíz y recarga global tras acciones (`src/ui/App.tsx:135-237`) |
| Backend | Supabase Auth OTP, Postgres, RLS y RPC (`src/data/*`, `supabase/migrations/*`) |
| Contabilidad | Cabeceras `financial_operations` y partidas `ledger_entries`; distinción de pasivos/fondos/ubicaciones de liquidez (`docs/BUSINESS_RULES.md`, `docs/DECISIONS.md`) |
| PWA | `vite-plugin-pwa` y manifest (`vite.config.ts`) |
| Pruebas | Vitest y Playwright (desktop Chrome y Pixel 7), Supabase TEST/RLS en SQL (`package.json`, `playwright.config.ts`, `e2e/hu001.spec.ts`) |
| Despliegue | Configuración de Netlify (`netlify.toml`); no demuestra que se haya desplegado |

La UI visible para el usuario está concentrada en **`src/ui/App.tsx`, 2.448 líneas**. Las entidades financieras de dominio, la capa de datos y la base existen por separado: **no** es correcto afirmar que toda la aplicación sea un monolito o que carezca de pruebas. Lo que está altamente acoplado es la **capa de presentación**.

## 2. Acceso, roles y estados visibles

- Estados de aplicación: `loading`, `anonymous`, `ready`, `no-access`, `error` (`src/ui/App.tsx:67,293-319`).
- Login por correo y OTP; el registro de usuarios desde el cliente está deshabilitado (`src/data/auth.ts:10-21`).
- Sin workspace/ciclo accesible se muestra pantalla de no acceso; no se crea workspace automáticamente (`src/ui/App.tsx:179-196,301-309`).
- Se exhibe identidad por email en barra superior (`src/ui/App.tsx:505-514`).
- **No hay evidencia de una matriz frontend de roles por operación**. La autorización efectiva debe comprobarse en RLS/RPC antes de especificar vistas por rol. No inferir “todos son administradores” ni permisos de lectura para socios.

## 3. Inventario verificado de pantallas y tareas

| Entrada actual | Fuente y operaciones visibles |
|---|---|
| Login | `LoginPanel` (`710-758`): enviar OTP, verificar código, mostrar error |
| Inicio | `HomeActionsPanel` (`760-797`): atajos; `SavingsSummary` (`799-829`): socios, ahorro recibido, esperado de ciclo, pendiente descriptivo; `FinanceSummary` (`831-887`): balances al corte |
| Ahorros | `MemberForm` (`935-1060`): crear/editar socio y configuración de participación; `ContributionForm` (`1061-1178`): registrar ahorro; `MembersTable` (`1180-1221`) |
| Préstamos | `LoansPanel` (`1223-1471`): crear contrato, desembolsar borrador, registrar cobro, cotizar/confirmar prepago, listar cartera y cronogramas próximos |
| Polla | `PollaPanel` (`1473-~1638`): actividad por mes, aporte, asignación y pago neto de premio, historial resumido |
| Más › Banco y caja | `BankPanel` (`~1640-1746`): cuenta, apertura, financiación, interés, comisión, ubicación de liquidez, conciliación |
| Más › Movimientos | `MovementsPanel` (`889-933`): operaciones y partidas al corte, tabla con tipos contables crudos |
| Más › Liquidaciones | `SettlementPanel` (`1747-1888`): previsualizar retiro, confirmar obligación, registrar pago separado |
| Más › Utilidad | `ProfitDistributionPanel` (`1890-2044`): política aprobable, previsualización, confirmación, pago, lista de pagos |
| Más › Respaldos | `ExportsPanel` (`2211-2370`): JSON versionado, CSV informativo, informe migración cuando existe dry-run |
| Más › Migración | `LegacyPanel` (`2086-2196`): CSV/JSON locales, prevalidación y dry-run sin escritura; `FutureModules` (`2200-2207`) informa límites |
| Sin acceso | `src/ui/App.tsx:301-309` |
| Error/cargando | `src/ui/App.tsx:293-319` |

**Aclaración:** “Previsualización pura de retiro” (`src/ui/App.tsx:2047-2085`) está definida, pero en la composición principal revisada no se observó montada como pantalla. No presumir que está disponible para el usuario.

## 4. Comportamientos a preservar

1. OTP sin creación automática de usuario/workspace; separación DEV/TEST.
2. RLS de workspace, consultas y operaciones autorizadas por servidor.
3. RPC monetarias transaccionales e idempotentes y gestión de respuestas de red inciertas (`src/ui/App.tsx:88-126`, `src/lib/pendingFinancialOperationStorage.ts`).
4. Separación de contrato borrador, desembolso, cobro regular, cotización y prepago.
5. Contabilidad de caja, cartera, ahorro por pagar, fondo de utilidad, premio, polla y administración **sin mezclar saldos**.
6. Liquidación: previsualizar → confirmar obligación → registrar pago; nunca representar una obligación como caja egresada antes del pago.
7. Reparto de utilidad sujeto a política aprobada; trazabilidad de pagos y centavos residuales.
8. Export JSON distinto de reporte CSV; dry-run no equivale a importación; fuentes reales y comprobantes fuera de Git.
9. Reglas de aportes de polla separadas del ahorro; derechos a premios pendientes según participación definida por negocio.
10. Acuerdos e incertidumbres legacy explícitos; no crear movimientos de efectivo a partir de indicadores históricos.

## 5. Pruebas y límites reales de esta revisión

- Código versionado incluido: aplicación, migraciones SQL, 1 archivo E2E, pruebas unitarias y de RLS. La prueba E2E integra muchas operaciones en un solo escenario largo (`e2e/hu001.spec.ts:30-203`), más navegación y migración (`~207-244`).
- Playwright dispone de perfiles Chrome escritorio y Pixel 7 (`playwright.config.ts:19-24`), **sin demostrar** cobertura de zoom, teclado, iPhone, lectores de pantalla o regresiones visuales.
- No se encontraron capturas de baseline y snapshots automatizados en el ZIP.
- E2E usa clic forzado si falla un clic normal (`e2e/hu001.spec.ts:282-287`): este fallback puede ocultar defectos de superposición o accionabilidad; no prueba por sí solo que exista una superposición en todas las pantallas.
- No existe evidencia entregada de investigación con usuarios reales ni de métricas de uso.
- Capturas E2E sintéticas no prueban conciliación ni identidad de datos de producción.

## 6. Pendiente obligatorio antes de cambios UX

Validar con responsable de negocio: definiciones de KPI al corte, saldo disponible vs caja reconstruida, importe de cuotas esperadas de ciclo vs exigibles hasta hoy, significado y signo de bolsa de polla, permisos por rol y semántica de “pagado histórico no verificado”. Alinear etiquetas con `docs/BUSINESS_RULES.md` y `docs/DECISIONS.md` antes de diseñar indicadores.
