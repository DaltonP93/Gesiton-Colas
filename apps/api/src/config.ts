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
  /** Orígenes permitidos para CORS separados por coma (`*` = todos). */
  CORS_ORIGINS: z.string().default('*'),
  ALLOW_SIGNUP: bool(true),
  AUTO_MIGRATE: bool(true),
  SUPERADMIN_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  SUPERADMIN_PASSWORD: z.string().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
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
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.startsWith('dev-secret')) {
    throw new Error('JWT_SECRET debe configurarse en producción');
  }
  return config;
}
