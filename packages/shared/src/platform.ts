import { z } from 'zod';
import { DEFAULT_PLAN_MODULES, MODULE_IDS } from './modules';
import { PLAN_IDS, type PlanId } from './plans';
import { CURRENCIES } from './currency';
import { billingSettingsSchema } from './payments';

const color = z.string().regex(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'Color hexadecimal inválido');

/* ------------------------------------------------------------------ */
/* Ajustes de la plataforma (los define el superadministrador)          */
/* ------------------------------------------------------------------ */

/**
 * Qué se abre en la dirección principal (/) cuando nadie inició sesión:
 * - `landing`: la página de presentación del producto
 * - `login`: directamente la pantalla de ingreso
 * - `redirect`: otra dirección (p. ej. el sitio web de la empresa)
 */
export const HOME_PAGES = ['landing', 'login', 'redirect'] as const;
export type HomePage = (typeof HOME_PAGES)[number];

export const platformBrandSchema = z.object({
  appName: z.string().min(1).max(80).default('Gestión de Colas'),
  logoUrl: z.string().max(2048).nullable().default(null),
  faviconUrl: z.string().max(2048).nullable().default(null),
  primaryColor: color.default('#2563eb'),
  /** Frase principal del panel lateral de la pantalla de ingreso. */
  loginTitle: z.string().max(160).default('Turnos, pantallas y publicidad en un solo lugar.'),
  loginText: z
    .string()
    .max(400)
    .default('Organice la atención de todas sus sucursales, muestre contenido en las salas de espera e intégrelo con sus sistemas.'),
  /** Foto o ilustración de fondo del panel lateral del ingreso. */
  loginImageUrl: z.string().max(2048).nullable().default(null),
  /** Contacto que se muestra a quien no puede ingresar. */
  supportEmail: z.string().max(200).default(''),
});
export type PlatformBrand = z.infer<typeof platformBrandSchema>;

/** Monedas para precios de planes y cobros. */

/** Configuración comercial de un plan: módulos incluidos y precio mensual. */
const planConfig = (id: PlanId) =>
  z
    .object({
      modules: z.array(z.enum(MODULE_IDS)).default(DEFAULT_PLAN_MODULES[id]),
      monthlyPrice: z.number().min(0).max(1_000_000_000).default(0),
      currency: z.enum(CURRENCIES).default('PYG'),
    })
    .prefault({});
export type PlanConfig = z.infer<ReturnType<typeof planConfig>>;

export const platformPlansSchema = z.object(Object.fromEntries(PLAN_IDS.map((id) => [id, planConfig(id)])) as Record<PlanId, ReturnType<typeof planConfig>>);

/** Copias de seguridad automáticas (base de datos y archivos subidos). */
export const backupSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Hora del día (0-23) en `timezone`. */
    hour: z.number().int().min(0).max(23).default(3),
    timezone: z.string().max(64).default('America/Asuncion'),
    /** Días que se conservan las copias. */
    keepDays: z.number().int().min(1).max(365).default(14),
    /** Incluir las imágenes, videos y audios subidos (si se guardan en el disco del servidor). */
    includeUploads: z.boolean().default(true),
    /** Copiar también a S3 (requiere S3_BUCKET y credenciales en el servidor). */
    s3: z.boolean().default(false),
  })
  .prefault({});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export interface BackupDTO {
  id: string;
  file: string;
  sizeBytes: number;
  status: 'running' | 'ok' | 'failed';
  error: string | null;
  trigger: 'auto' | 'manual';
  includesUploads: boolean;
  s3Key: string | null;
  /** El archivo sigue en el servidor y se puede descargar. */
  available: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface BackupStatusDTO {
  settings: BackupSettings;
  items: BackupDTO[];
  /** pg_dump instalado en el servidor. */
  ready: boolean;
  dir: string;
  s3Available: boolean;
}

export const platformSettingsSchema = z.object({
  homePage: z.enum(HOME_PAGES).default('landing'),
  homeRedirectUrl: z.string().max(2048).default(''),
  /** Registro público de organizaciones («Crear cuenta» / «Probar gratis»). */
  allowSignup: z.boolean().default(true),
  /** Solicitud de demos por correo. */
  allowDemo: z.boolean().default(true),
  /** Ingreso con un código enviado por correo, sin contraseña. */
  allowEmailLogin: z.boolean().default(true),
  brand: platformBrandSchema.prefault({}),
  /** Módulos y precio de cada plan. */
  plans: platformPlansSchema.prefault({}),
  /**
   * Precio mensual de cada módulo cuando se activa a una organización cuyo plan no lo incluye
   * (en la moneda del plan de esa organización). Sin precio = sin cargo adicional.
   */
  addons: z.partialRecord(z.enum(MODULE_IDS), z.number().min(0).max(1_000_000_000)).default({}),
  /** Facturación de los planes a las organizaciones. */
  billing: billingSettingsSchema.prefault({}),
  backups: backupSettingsSchema,
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const defaultPlatformSettings = (): PlatformSettings => platformSettingsSchema.parse({});

/** Opciones públicas de la instalación (las lee la pantalla de ingreso antes de iniciar sesión). */
export interface PublicConfigDTO {
  homePage: HomePage;
  homeRedirectUrl: string;
  /** Registro público habilitado (ajuste de plataforma y variable ALLOW_SIGNUP). */
  allowSignup: boolean;
  allowDemo: boolean;
  allowEmailLogin: boolean;
  demoDays: number;
  emailVerification: 'required' | 'optional' | 'off';
  /** Hay un servidor de correo configurado (se pueden enviar invitaciones, códigos y recuperaciones). */
  emailEnabled: boolean;
  brand: PlatformBrand;
}

/* ------------------------------------------------------------------ */
/* Correo saliente (SMTP)                                               */
/* ------------------------------------------------------------------ */

/** Cifrado de la conexión: STARTTLS (puerto 587), SSL/TLS directo (465) o sin cifrar (25, redes internas). */
export const MAIL_SECURITY = ['starttls', 'ssl', 'none'] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];

export interface MailSettingsDTO {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  /** La contraseña nunca se devuelve: solo si hay una guardada. */
  hasPassword: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  updatedAt: string | null;
}

/** De dónde sale el correo en este momento. */
export type MailSource = 'tenant' | 'platform' | 'env' | 'none';

export interface MailStatusDTO {
  settings: MailSettingsDTO;
  /** Servidor que se usa hoy para los correos de este ámbito. */
  active: MailSource;
  /** Remitente con el que salen los correos. */
  from: string | null;
}
