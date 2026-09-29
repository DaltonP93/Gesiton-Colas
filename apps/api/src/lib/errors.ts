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
export const notFound = (what = 'Recurso') => new AppError(404, 'not_found', `${what} no encontrado`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);
export const planLimit = (message: string) => new AppError(402, 'plan_limit', message);
