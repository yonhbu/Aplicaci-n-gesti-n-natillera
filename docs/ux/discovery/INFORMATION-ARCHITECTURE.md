# INFORMATION-ARCHITECTURE — Propuesta pendiente de aprobación

## 1. Principios

1. Navegar por **intenciones** (consultar, registrar, conciliar, liquidar) y no por ubicación de tablas o nombres RPC.
2. Diferenciar **lectura**, **simulación**, **confirmación de obligación** y **salida real de fondos**.
3. Nunca esconder ni fusionar registros auditables: introducir capas de resumen y de detalle.
4. Mantener enlaces directos a tareas importantes, ruta hash y botón Atrás; preservar rutas heredadas o crear redireccionamientos compatibles.
5. Tratar la migración como operación administrativa sujeta a autorización, no como CTA de uso cotidiano.
6. Primero mapa de tareas/roles; posteriormente decidir qué aparece por rol con evidencia RLS/RPC.

## 2. Sitemap propuesto

```
Natillera · ciclo activo
├── Resumen
│   ├── Estado del ciclo y corte
│   ├── Dinero por ubicación [solo si está conciliado/identificado]
│   ├── Obligaciones por categoría
│   ├── Cartera / próximos cobros
│   └── Acciones pendientes / accesos rápidos
├── Ahorros
│   ├── Socios (lista, búsqueda, estado)
│   │   ├── Detalle de socio
│   │   │   ├── Plan de aportes y pagos
│   │   │   ├── Elegibilidad / participación
│   │   │   └── Movimientos relacionados
│   │   └── Crear / editar socio
│   ├── Registrar aporte
│   └── Historial de aportes
├── Préstamos
│   ├── Cartera (activos, borradores, estados reales)
│   ├── Detalle (contrato, saldo, cronograma, cobros)
│   ├── Nuevo préstamo (deudor → condiciones → revisión → borrador)
│   ├── Confirmar desembolso
│   ├── Registrar cobro
│   └── Cotizar y confirmar prepago
├── Pollas
│   ├── Actividades por periodo
│   ├── Aportes de participantes
│   └── Premios (asignación → obligación neta → pago)
├── Tesorería
│   ├── Banco y cuentas
│   ├── Caja y ubicación de liquidez
│   ├── Conciliación
│   └── Movimientos (lectura humana → detalle de asiento)
├── Cierre y resultados
│   ├── Liquidaciones (previsualizar → confirmar → registrar pago)
│   └── Utilidad (política aprobada → previsualizar → confirmar → pagar)
└── Administración
    ├── Respaldos (JSON completo, CSV reporte)
    ├── Migración (archivos locales, dry-run, incidencias)
    └── Estado/limitaciones del ciclo [solo si aplica]
```

**No se afirma** que las secciones nuevas tengan APIs ya existentes ni que haya un cierre de ciclo implementado. “Cierre y resultados” es una **agrupación de navegación**, no una autorización para implementar NAT-HU-007.

## 3. Correspondencia y preservación de enlaces

| Hash actual | Destino lógico nuevo | Compatibilidad necesaria |
|---|---|---|
| `#/home` | Resumen | mantener o redirigir |
| `#/savings` | Ahorros | mantener; seleccionar subtarea explícita |
| `#/loans` | Préstamos | mantener |
| `#/polla` | Pollas | mantener |
| `#/more/bank` | Tesorería › Banco | redirigir sin perder contexto |
| `#/more/movements` | Tesorería › Movimientos | redirigir |
| `#/more/settlements` | Cierre y resultados › Liquidaciones | redirigir |
| `#/more/profit` | Cierre y resultados › Utilidad | redirigir |
| `#/more/exports` | Administración › Respaldos | redirigir |
| `#/more/migration` | Administración › Migración | redirigir |

Mantener `hashchange`, `reload`, `goBack`, `goForward` de las E2E existentes. Si se adopta router, justificar costo/beneficio **antes** de sumar la dependencia.

## 4. Navegación adaptable

**Escritorio (≥ 1024px, a validar):** lateral agrupado con título del ciclo, nav principal, subnav contextual y administración separada. No mostrar seis botones de “Más” sobre el mismo plano visual.

**Móvil:** barra con `Inicio`, `Ahorros`, `Préstamos`, `Polla`, `Más`; `Más` abre menú/página con `Tesorería`, `Cierre y resultados`, `Administración`. Esto preserva máximo cinco destinos en la base y evita pretender encajar seis secundarios. La barra no debe bloquear teclado ni CTA inferior.

**Tablet:** seleccionar por espacio real; no fijar breakpoints porque la captura esté tomada a determinado ancho.

## 5. Flujos transaccionales propuestos

### Aporte de ahorro

Elegir socio → ver nombre/plan y mes aplicable → ingresar importe/fecha/método → revisar beneficiario y mes → enviar UNA vez → mostrar resultado (confirmado, rechazado, incierto) → abrir comprobante/registro si realmente existe; no prometer comprobantes privados aún no implementados.

### Nuevo préstamo

Deudor (socio/external) → condiciones de contrato → simulación/validación según lógica existente → revisión → crear **borrador** → detalle → confirmar desembolso como transacción separada. No confundir “crear contrato” con otorgar dinero.

### Cobro y prepago

Seleccionar contrato → leer saldo/cronograma → elegir `Cobro regular` o `Prepago` → distribución capital/interés explícita → cotización de servidor para prepago → revisión → confirmar → estado incierto/reintento seguro. Invalidar cotización si cambian contrato, fecha o parámetros.

### Liquidación

Seleccionar socio + fecha de corte → parámetros explícitos con versión de política (si existe) → solicitar snapshot de servidor → presentar desglose completo y las implicaciones → confirmar obligación → pantalla de obligación pendiente → registrar pago posteriormente (ubicación, cuenta, fecha, referencia) → confirmación trazable. No sumar utilidades de préstamo no elegibles.

### Utilidad

Seleccionar política aprobada → corte + costos/reservas/rendimientos → simular de servidor → ver elegibles/asignaciones/residuales → confirmar → gestionar pagos por asignación solo cuando lo soporte API existente. No convertir un diseño nuevo en autorización de distribución.

### Conciliación

Elegir cuenta y corte → mostrar saldo registrado, saldo externo, diferencia, ubicación identificada/no identificada → confirmar conciliación (sin asiento de ajuste automático) → investigar diferencia, conservar auditoría.

## 6. Estados globales obligatorios

`loading`, `empty`, `ready`, `error`, `no-access`; para acciones monetarias: `draft`, `previewed`, `pending-confirmation`, `confirmed`, `pending-payment`, `paid`, `reversed`, `uncertain`, según estados reales de cada entidad. **No inventar equivalencias ni transiciones de negocio.**

Acciones destructivas o monetarias requieren confirmación contextual; las acciones repetibles requieren idempotencia y feedback. Mensajes de error no deben revelar payloads privados.

## 7. Decisiones abiertas

- Usuario(s) objetivo: ¿solo operador/admin o también socios consultores? Verificar RLS real.
- ¿Qué dinero está realmente disponible hoy y qué partidas son fondos restringidos?
- ¿Qué filtros exactos y estados financieros existen en préstamos y cobranza?
- ¿Qué restricciones configuran liquidaciones, penalidades, reservas y reparto de utilidad?
- ¿Se permitirá realizar tareas críticas desde móvil? No asumir.
- ¿Qué comprobantes existen realmente (bytes) y cuáles son referencias sin archivo?

**Gate:** aprobar mapa y flujos con negocio/usuario antes de tocar navegación de producción.
