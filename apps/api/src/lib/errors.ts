export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Autenticación requerida') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'No tiene permisos para esta acción') => new AppError(403, 'forbidden', message);
/** «Turno no encontrado», «Sucursal no encontrada» (concuerda con la primera palabra). */
export const notFound = (what = 'Recurso') => {
  const first = what.split(' ')[0] ?? what;
  const feminine = /(a|ión|dad)$/i.test(first) || ['Sucursal', 'API'].includes(first);
  return new AppError(404, 'not_found', `${what} no ${feminine ? 'encontrada' : 'encontrado'}`);
};
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);
export const planLimit = (message: string) => new AppError(402, 'plan_limit', message);

/** ¿Es una violación de un índice único de PostgreSQL (opcionalmente, uno en particular)? */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let e = error as { code?: string; constraint?: string; cause?: unknown } | undefined, i = 0; e && i < 3; e = e.cause as typeof e, i++) {
    if (e.code === '23505') return !constraint || e.constraint === constraint;
  }
  return false;
}
