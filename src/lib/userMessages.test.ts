import { describe, expect, it } from 'vitest';
import { PAYMENT_NOTES_SCHEMA_REQUIRED, userSafeError } from './userMessages';

describe('known financial validation messages', () => {
  it('explains the polla quota without exposing arbitrary backend text', () => {
    expect(userSafeError(new Error('El aporte de polla es de $10.000 por actividad; este socio ya tiene 0.00.')))
      .toBe('El aporte de polla no puede superar $10.000 por actividad. Revisa el monto y los aportes anteriores.');
  });
  it('explains why a fixed-yield member cannot contribute to polla', () => {
    expect(userSafeError(new Error('Este socio solo ahorra al 12 % EA y no participa en polla.')))
      .toBe('Este socio solo ahorra al 12 % EA y no participa en polla.');
  });
  it('does not expose unknown database errors', () => {
    expect(userSafeError(new Error('internal details in table private_example'))).not.toContain('private_example');
  });
  it('explains blocked extraordinary payments', () => {
    expect(userSafeError(new Error('El pago excede las cuotas exigibles. Los abonos extraordinarios requieren definir reduccion de plazo o cuota.'))).toContain('excedente requiere definir');
  });
  it('explains historical reconciliation without exposing database internals', () => {
    expect(userSafeError(new Error('Los intereses historicos no tienen periodo verificado. Concilie la cobertura antes de cotizar el prepago EA.'))).toContain('históricos pendientes de conciliación');
  });
  it('explains the protected EA reserve and the selected source', () => {
    expect(userSafeError(new Error('El retiro supera el saldo libre despues de reservar el 12 % EA hasta el cierre.'))).toContain('reservar el 12 % EA');
    expect(userSafeError(new Error('No hay liquidez suficiente en el origen seleccionado.'))).toContain('cuenta o el efectivo seleccionados');
  });
  it('requires a refreshed quotation after another payment', () => {
    expect(userSafeError(new Error('La cotizacion cambio. Vuelva a calcular antes de confirmar el prepago.'))).toContain('Vuelve a calcular');
  });
  it('explains stale settlement and blocked retroactive confirmation', () => {
    expect(userSafeError(new Error('La previsualizacion esta obsoleta; calcule de nuevo antes de confirmar.'))).toContain('Vuelve a calcular la cuenta final');
    expect(userSafeError(new Error('La liquidacion retroactiva tiene cobros posteriores; genere politica explicita antes de confirmar.'))).toContain('revisión financiera');
    expect(userSafeError(new Error('Liquidez insuficiente para pagar la liquidacion.'))).toContain('No hay dinero suficiente');
  });
});


it('muestra la actualización requerida sin ocultar que no se confirmó el pago', () => {
  expect(userSafeError(new Error(PAYMENT_NOTES_SCHEMA_REQUIRED))).toBe(PAYMENT_NOTES_SCHEMA_REQUIRED);
});
it('no expone mensajes arbitrarios del servidor al permitir el aviso de versión', () => {
  expect(userSafeError(new Error('TEST_ONLY_INTERNAL_SERVER_DETAIL'))).not.toContain('TEST_ONLY_INTERNAL_SERVER_DETAIL');
});
