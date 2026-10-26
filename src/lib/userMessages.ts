export function userSafeError(error: unknown): string {
  if (error instanceof Error) {
    if (/^(El retiro supera el dinero personal documentado|La clave del movimiento personal|Fecha o ciclo del movimiento personal|Indique direccion, referencia|La referencia personal ya fue registrada)/.test(error.message)) return error.message;
    if (error.message === 'El destino del cobro no coincide con el intento original.') return 'El cobro pendiente corresponde a otra cuenta o a efectivo. Resuelve ese intento antes de cambiar su destino.';
    if (/^(La cuenta final ya no admite|Fecha del pago complementario invalida|Indique la referencia del dinero recibido|Cuenta bancaria no disponible|Esta cuenta final no tiene faltante|La referencia bancaria ya fue registrada|La clave del pago complementario tiene otro contenido|El pago complementario ya respalda|La correccion de ubicacion ya tiene otro contenido|Este cobro ya tiene ubicacion corregida|El cobro no esta registrado integramente|Hay cuentas finales confirmadas|Seleccione un cobro e indique|Anule el grupo completo de correccion|Primero anule la correccion de ubicacion|No hay correccion de ubicacion para anular)/.test(error.message)) return error.message;
    if (error.message === 'La conciliacion cambio; vuelva a previsualizar.') return 'Los saldos cambiaron. Revisa nuevamente la conciliación antes de confirmar.';
    if (/^(La conciliacion requiere|No hay un lote inicial|Se requiere un unico traslado|Las cuotas pagadas no coinciden|La contrapartida inicial|Hay liquidaciones o repartos dependientes|Hay retiros, liquidaciones|Use el reverso completo|La multa requiere motivo|Destino de multa invalido|Fecha de multa invalida|Fecha de extracto invalida|La comparacion ya tiene otro contenido)/.test(error.message)) return error.message;
    if (/^(El premio tiene una liquidacion dependiente|El cobro tiene una liquidacion dependiente|El aporte tiene una liquidacion dependiente|Primero revierta|La comision del premio ya se utilizo|El capital del premio ya se utilizo|El dinero de este registro ya se utilizo|Esta polla ya fue cancelada|El premio ya fue revertido|El ciclo debe estar activo para revertir|Esta polla fue cancelada|La operacion ya tiene reverso|El corte afectaria una liquidacion confirmada)/.test(error.message)) return error.message;
    if (error.message==='Fecha de reverso invalida.') return 'La fecha del reverso debe estar entre el registro original y hoy.';
    if (error.message === 'La previsualizacion esta obsoleta; calcule de nuevo antes de confirmar.') return 'Los saldos cambiaron. Vuelve a calcular la cuenta final antes de confirmar.';
    if (error.message === 'Liquidez insuficiente para pagar la liquidacion.') return 'No hay dinero suficiente para pagar esta liquidación.';
    if (error.message === 'La liquidacion retroactiva tiene cobros posteriores; genere politica explicita antes de confirmar.') return 'Hay cobros posteriores al corte. Esta liquidación retroactiva requiere revisión financiera.';
    if (error.message === 'La cotizacion cambio. Vuelva a calcular antes de confirmar el prepago.') return 'La cotización cambió. Vuelve a calcular antes de confirmar el prepago.';
    if (error.message === 'El retiro supera el saldo libre despues de reservar el 12 % EA hasta el cierre.') return 'El retiro supera el saldo libre después de reservar el 12 % EA hasta el cierre.';
    if (error.message === 'No hay liquidez suficiente en el origen seleccionado.') return 'No hay dinero suficiente en la cuenta o el efectivo seleccionados.';
    if (error.message === 'El pago excede las cuotas exigibles. Los abonos extraordinarios requieren definir reduccion de plazo o cuota.') {
      return 'El pago supera las cuotas exigibles. El excedente requiere definir si reduce el plazo o la cuota.';
    }
    if (/^(Los intereses historicos no tienen periodo verificado|Hay intereses sin periodo conciliado|Hay abonos Pibank historicos pendientes)/.test(error.message)) {
      return 'Hay derechos o periodos históricos pendientes de conciliación. Conservamos lo registrado; esta operación requiere revisar su evidencia.';
    }
    if (/^El aporte de polla es de \$10\.000 por actividad;/.test(error.message)) {
      return 'El aporte de polla no puede superar $10.000 por actividad. Revisa el monto y los aportes anteriores.';
    }
    if (error.message === 'Este socio solo ahorra al 12 % EA y no participa en polla.') {
      return error.message;
    }
    if (/Failed to fetch|NetworkError|fetch failed/i.test(error.message)) {
      return 'No se pudo conectar. Revisa la conexion y vuelve a intentar.';
    }
    if (/idempotencia/i.test(error.message)) {
      return error.message;
    }
  }
  return 'La operacion no se pudo completar. No se guardo ningun exito aparente.';
}
