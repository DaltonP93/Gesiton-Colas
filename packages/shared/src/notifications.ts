import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Avisos al cliente por WhatsApp y SMS                                */
/* ------------------------------------------------------------------ */

/**
 * - `meta`: WhatsApp Cloud API oficial (plantillas aprobadas por Meta)
 * - `waha`: WAHA u otra API local de WhatsApp (WhatsApp HTTP API, instalada por usted)
 * - `http`: cualquier proveedor de SMS que reciba los envíos por una URL
 */
export const NOTIFY_PROVIDERS = ['meta', 'waha', 'http'] as const;
export type NotifyProvider = (typeof NOTIFY_PROVIDERS)[number];

export const NOTIFY_PROVIDER_LABELS: Record<NotifyProvider, string> = {
  meta: 'WhatsApp oficial (Meta Cloud API)',
  waha: 'WhatsApp local (WAHA u otra API HTTP)',
  http: 'SMS por HTTP (cualquier proveedor)',
};

/** Momentos en que se avisa al cliente. */
export const NOTIFY_EVENTS = ['created', 'near', 'called', 'finished'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export const NOTIFY_EVENT_LABELS: Record<NotifyEvent, { name: string; description: string }> = {
  created: { name: 'Al sacar el turno', description: 'Confirmación con el número, la espera y el enlace de seguimiento.' },
  near: { name: 'Cuando se acerca', description: 'Aviso cuando faltan pocos turnos para que lo llamen.' },
  called: { name: 'Cuando lo llaman', description: '«Es su turno»: el número y el puesto al que debe ir.' },
  finished: { name: 'Al terminar la atención', description: 'Agradecimiento con el enlace de la encuesta de satisfacción.' },
};

/** Variables de los mensajes: {{code}} {{service}} {{branch}} {{counter}} {{customer}} {{waiting}} {{remaining}} {{link}} {{survey}} {{organization}} */
export const NOTIFY_VARIABLES = ['code', 'service', 'branch', 'counter', 'customer', 'waiting', 'remaining', 'link', 'survey', 'organization'] as const;

const eventConfig = (template: string, enabled = true) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      /** Texto del mensaje (WAHA y SMS) o respaldo del de la plantilla (Meta). */
      template: z.string().max(700).default(template),
      /** Nombre de la plantilla aprobada en Meta (solo WhatsApp oficial). */
      metaTemplate: z.string().max(120).default(''),
    })
    .prefault({});

/** Qué avisos se envían y con qué texto (lo define cada organización). */
export const notificationSettingsSchema = z.object({
  /** Código de país que se agrega a los teléfonos sin él (Paraguay = 595). */
  countryCode: z.string().regex(/^\d{1,4}$/).default('595'),
  /** Idioma de las plantillas de Meta (es, es_AR, es_MX, en_US...). */
  metaLanguage: z.string().max(10).default('es'),
  /** Cuántos turnos antes se envía el aviso «cuando se acerca». */
  nearAhead: z.number().int().min(1).max(20).default(3),
  events: z
    .object({
      created: eventConfig('Hola {{customer}}. Su turno {{code}} para {{service}} en {{branch}} quedó registrado. Personas antes que usted: {{waiting}}. Siga su turno: {{link}}'),
      near: eventConfig('{{code}}: ya casi es su turno en {{branch}} (quedan {{remaining}} antes que usted). Por favor acérquese a la sala de espera.'),
      called: eventConfig('¡Es su turno! {{code}}, por favor diríjase a {{counter}}.'),
      finished: eventConfig('Gracias por su visita a {{organization}}. ¿Cómo lo atendimos? Responda en un minuto: {{survey}}', false),
    })
    .prefault({}),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** Proveedor configurado (sin secretos: el token/clave nunca vuelve al navegador). */
export interface NotifyProviderDTO {
  enabled: boolean;
  provider: NotifyProvider;
  /** Meta: id del número de teléfono. */
  metaPhoneNumberId: string;
  metaApiVersion: string;
  /** WAHA: dirección base (http://10.0.0.5:3000) y sesión. */
  wahaUrl: string;
  wahaSession: string;
  /** HTTP: método, URL y cuerpo con {{phone}} y {{message}}. */
  httpMethod: 'GET' | 'POST';
  httpUrl: string;
  httpBody: string;
  httpContentType: string;
  /** Encabezado de autenticación (el valor es secreto). */
  httpAuthHeader: string;
  /** Hay un token / clave guardado (cifrado). */
  hasSecret: boolean;
  updatedAt: string | null;
}

export type NotifySource = 'tenant' | 'platform' | 'none';

export interface NotifyStatusDTO {
  settings: NotifyProviderDTO;
  /** Proveedor que se usa hoy para esta organización (o la plataforma). */
  active: NotifySource;
}

export type NotifyMessageStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface NotifyMessageDTO {
  id: string;
  event: NotifyEvent | 'test';
  to: string;
  body: string;
  provider: NotifyProvider | null;
  status: NotifyMessageStatus;
  attempts: number;
  error: string | null;
  ticketCode: string | null;
  createdAt: string;
  sentAt: string | null;
}

/**
 * Normaliza un teléfono a formato internacional sin «+» (lo que piden WhatsApp y la mayoría de los SMS):
 * quita espacios y signos, el 0 inicial del número local y agrega el código de país si falta.
 */
export function normalizePhone(raw: string | null | undefined, countryCode: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) digits = digits.replace(/^00/, '');
  else if (!digits.startsWith(countryCode) || digits.length <= 9) digits = `${countryCode}${digits.replace(/^0+/, '')}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
