import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  /** URL pública de la aplicación (se usa en enlaces de seguimiento y QR). */
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().default('postgres://gc:gc@127.0.0.1:5432/gestion_colas'),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please-0123456789'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /**
   * Proxies de confianza para tomar la IP real del cliente (X-Forwarded-For):
   * `false` (por defecto, la app recibe las conexiones directamente), `true`, la cantidad
   * de saltos (p. ej. `1` detrás de Nginx/Caddy/Traefik) o IPs/redes separadas por coma.
   * Mal configurado permite falsificar la IP y evadir los límites de intentos.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v): boolean | number | string[] => {
      const value = (v ?? '').trim().toLowerCase();
      if (!value || value === 'false' || value === '0') return false;
      if (value === 'true') return true;
      if (/^\d+$/.test(value)) return Number(value);
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }),
  /** Orígenes permitidos para CORS separados por coma (`*` = todos). */
  CORS_ORIGINS: z.string().default('*'),
  ALLOW_SIGNUP: bool(true),
  /** Permite solicitar una organización de demostración por correo. */
  ALLOW_DEMO: bool(true),
  /** Días que dura una demo antes de vencer. */
  DEMO_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /**
   * Verificación del correo al registrarse:
   * - `required`: no puede ingresar hasta confirmar el correo
   * - `optional`: puede usar el sistema y se le recuerda verificarlo
   * - `off`: no se envía correo de verificación
   */
  EMAIL_VERIFICATION: z.enum(['required', 'optional', 'off']).default('optional'),
  /** `smtp` para enviar correos reales; `log` los muestra en consola (desarrollo). Por defecto smtp si hay SMTP_HOST o SMTP_URL. */
  MAIL_DRIVER: z.enum(['smtp', 'log']).optional(),
  /** URL SMTP completa, p. ej. smtps://usuario:clave@smtp.proveedor.com:465 */
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Gestión de Colas <no-reply@gestioncolas.local>'),
  /** Solo para pruebas automatizadas: expone los correos enviados en /api/v1/dev/outbox (con MAIL_DRIVER=log). */
  DEV_OUTBOX: bool(false),
  AUTO_MIGRATE: bool(true),
  SUPERADMIN_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  SUPERADMIN_PASSWORD: z.string().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Carpeta de las copias de seguridad (por defecto, «backups» junto a UPLOAD_DIR: /data/backups en Docker). */
  BACKUP_DIR: z.string().optional().transform((v) => v?.trim() || undefined),
  /** Carpeta de pg_dump / pg_restore si no están en el PATH. */
  PG_BIN_DIR: z.string().optional().transform((v) => v?.trim() || undefined),
  MAX_UPLOAD_MB: z.coerce.number().int().default(1024),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  /** URL pública base de los archivos del bucket (CDN). */
  S3_PUBLIC_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  /** Permite webhooks hacia IPs privadas (solo instalaciones on-premise). */
  WEBHOOKS_ALLOW_PRIVATE: bool(false),
  /** Carpeta con el build del frontend para servirlo desde la API. */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, unknown>> = {}): AppConfig {
  const config = envSchema.parse({ ...process.env, ...overrides });
  if (config.NODE_ENV === 'production' && (config.JWT_SECRET.startsWith('dev-secret') || config.JWT_SECRET.startsWith('cambie-este-valor'))) {
    throw new Error('JWT_SECRET debe configurarse con un valor propio en producción');
  }
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.length < 32) {
    // No se detiene el servidor para no dejar sin servicio una instalación existente, pero se avisa.
    console.warn('⚠️  JWT_SECRET es corto (menos de 32 caracteres). Genere uno nuevo con: openssl rand -hex 32');
  }
  return config;
}
