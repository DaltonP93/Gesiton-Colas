import { z } from 'zod';

export const idParam = z.object({ id: z.uuid() });
export const hexColor = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Color hexadecimal inválido');
export const optionalText = (max: number) => z.string().trim().max(max);
/** Celular o teléfono: dígitos, espacios, +, guiones y paréntesis. */
export const phoneNumber = z
  .string()
  .trim()
  .max(30)
  .regex(/^\+?[\d\s()-]{6,}$/, 'Teléfono inválido: use solo números, espacios, + y guiones');
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Lista separada por comas en querystring → array de UUIDs. */
export const uuidList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
  .pipe(z.array(z.uuid()));

/**
 * Versión parcial de un esquema para actualizaciones (PUT/PATCH): todos los campos opcionales
 * y sin valores por defecto, para no pisar datos que el cliente no envió.
 */
export function updateSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodType;
    while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
