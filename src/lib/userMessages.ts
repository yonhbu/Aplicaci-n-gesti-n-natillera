export function userSafeError(error: unknown): string {
  if (error instanceof Error) {
    if (/Failed to fetch|NetworkError|fetch failed/i.test(error.message)) {
      return 'No se pudo conectar. Revisa la conexion y vuelve a intentar.';
    }
    if (/idempotencia/i.test(error.message)) {
      return error.message;
    }
  }
  return 'La operacion no se pudo completar. No se guardo ningun exito aparente.';
}
