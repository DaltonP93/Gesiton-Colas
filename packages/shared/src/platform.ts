import { z } from 'zod';

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
