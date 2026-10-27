# Reglas de negocio vigentes

Estado de documentación: `READY_FOR_REVIEW`. Esta síntesis restaura la ruta obligatoria eliminada en la limpieza del repositorio. Las migraciones y sus pruebas son el contrato ejecutable; los antecedentes pueden consultarse en Git, commit `59219a8`.

- Importes COP con decimal exacto y hasta dos centavos. Presentación con punto de miles y coma decimal; parámetros SQL con punto decimal, sin agrupación. Tasa, plazo, fecha e identificador no son importes monetarios.
- Ahorro, polla, administración, cartera, obligaciones y utilidades conservan cuentas separadas. `cash` representa liquidez total; banco y efectivo son ubicaciones de esa cuenta. Un recaudo en efectivo no aumenta Pibank.
- Una operación financiera se confirma por RPC y debe sumar cero en ledger. Crear un contrato, cotizar, conciliar y previsualizar no constituyen cobros ni pagos.
- Contrato y desembolso son pasos separados. El capital cobrado no puede superar el pendiente. Un abono regular al capital no equivale a cancelar totalmente el préstamo.
- `loan_payment_applications` aplica capital/interés a cuotas; `loan_schedule_progress` deriva pendientes excluyendo pagos revertidos. El cronograma contractual se conserva: original y pendiente deben identificarse por separado.
- Los atajos de cuota usan principal/interés pendientes. El pago total utiliza exclusivamente la cotización SQL y su hash; el cliente no inventa una cifra de cancelación.
- Para amortizados EA, aplica la política existente de intereses exigibles primero y cálculo ACT/365F. Los abonos extraordinarios que requieren decisión de reducción de plazo/cuota quedan bloqueados por el servidor.
- Para modalidades fijas/solo interés, `quote_loan_prepayment` conserva `contract-fixed-policy`: capital pendiente más el primer interés contractual todavía no cubierto. No es una nueva política de esta auditoría. El acuerdo `P013_FIRST_MONTH` sigue siendo explícito y particular.
- Los intereses del cronograma no se recalculan automáticamente tras un abono de capital. Cambiar esta política requiere acuerdo de negocio, fecha de aplicación y tratamiento de historia; no se decide por formato visual.
- El interés efectivamente satisfecho conserva reparto autorizado 10 % administración y 90 % fondo. No se descuenta administración dos veces.
- Reintentar una clave con la misma carga devuelve la misma operación; con otra carga se rechaza. Una respuesta de red perdida no autoriza generar otra clave. Reversos conservan historia y neutralizan efectos según dependencias.
- Notas de cobro opcionales: máximo 500 caracteres, sin controles, espacios exteriores normalizados, vacía equivale a NULL. Se guardan atómicamente con el pago, forman parte del intento idempotente y son inmutables después de confirmar, incluso al revertir. No afectan importes.
- La polla conserva su bolsa/derechos y comisión fija vigente. La acreditación a ahorro y el pago efectivo son efectos distintos; no se duplican premios ni caja.
- Una cuenta final separa previsualización, obligación y pago efectivo. La compensación de préstamos no fabrica caja. Neto insuficiente requiere el flujo explícito de completar y recalcular.
- Una diferencia de conciliación no crea un ajuste automático. Rendimiento bancario se reconoce cuando existe movimiento real.
- No se considera cierre/archivo del ciclo una publicación de repartos. El cierre integral y comprobantes privados no están habilitados por esta entrega.
- RLS limita lecturas por workspace. Escrituras financieras y notas auditadas no se editan directamente desde React. Nunca se crea un workspace automáticamente al faltar membresía.
