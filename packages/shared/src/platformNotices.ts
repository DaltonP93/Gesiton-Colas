import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Avisos que envía la plataforma (superadministrador)                   */
/* ------------------------------------------------------------------ */

export const PLATFORM_NOTICE_EVENTS = [
  'invoice_issued',
  'invoice_due',
  'invoice_overdue',
  'tenant_suspended',
  'demo_expiring',
  'legal_updated',
  'tenant_created',
  'backup_failed',
] as const;
export type PlatformNoticeEvent = (typeof PLATFORM_NOTICE_EVENTS)[number];

export const PLATFORM_NOTICE_INFO: Record<
  PlatformNoticeEvent,
  { label: string; description: string; /** A quién: los administradores de la organización o los superadministradores. */ audience: 'tenant' | 'platform'; email: boolean; whatsapp: boolean }
> = {
  invoice_issued: { label: 'Factura del plan emitida', description: 'Cuando se genera la factura mensual de la organización.', audience: 'tenant', email: true, whatsapp: false },
  invoice_due: { label: 'Factura por vencer', description: 'Recordatorio unos días antes del vencimiento.', audience: 'tenant', email: true, whatsapp: false },
  invoice_overdue: { label: 'Factura vencida', description: 'Al día siguiente del vencimiento, con la fecha de suspensión si corresponde.', audience: 'tenant', email: true, whatsapp: false },
  tenant_suspended: { label: 'Organización suspendida por falta de pago', description: 'Cuando se suspende automáticamente; se reactiva sola al pagar.', audience: 'tenant', email: true, whatsapp: false },
  demo_expiring: { label: 'Demo por vencer', description: 'Unos días antes de que venza la demo, para convertirla en cliente.', audience: 'tenant', email: true, whatsapp: false },
  legal_updated: { label: 'Nueva versión de los términos', description: 'Cuando se publica un cambio importante que hay que aceptar.', audience: 'tenant', email: true, whatsapp: false },
  tenant_created: { label: 'Nueva organización o demo', description: 'Cuando alguien se registra o pide una demo (para el seguimiento comercial).', audience: 'platform', email: false, whatsapp: false },
  backup_failed: { label: 'Copia de seguridad fallida', description: 'Si la copia diaria falla o no se puede subir a un destino externo.', audience: 'platform', email: true, whatsapp: false },
};

const channels = (event: PlatformNoticeEvent) =>
  z
    .object({ email: z.boolean().default(PLATFORM_NOTICE_INFO[event].email), whatsapp: z.boolean().default(PLATFORM_NOTICE_INFO[event].whatsapp) })
    .prefault({});

export const platformNoticesSchema = z
  .object({
    events: z.object(Object.fromEntries(PLATFORM_NOTICE_EVENTS.map((e) => [e, channels(e)])) as Record<PlatformNoticeEvent, ReturnType<typeof channels>>).prefault({}),
    /** Días antes del vencimiento de la factura para el recordatorio. */
    dueDaysBefore: z.number().int().min(1).max(30).default(3),
    /** Días antes de que venza la demo. */
    demoDaysBefore: z.number().int().min(1).max(14).default(2),
    /** Celulares de los superadministradores para los avisos por WhatsApp/SMS. */
    adminPhones: z.array(z.string().trim().min(6).max(30)).max(5).default([]),
    /** Código de país para los números sin prefijo internacional. */
    countryCode: z.string().regex(/^\d{1,4}$/).default('595'),
  })
  .prefault({});
export type PlatformNoticeSettings = z.infer<typeof platformNoticesSchema>;

/** Canales de cada organización (Plataforma → Comunicaciones). */
export interface TenantChannelsDTO {
  tenant: { id: string; name: string; plan: string; isDemo: boolean };
  /** Correo: servidor propio de la organización o el de la plataforma. */
  mail: 'tenant' | 'platform' | 'none';
  /** WhatsApp/SMS: sin el módulo, con el canal propio o con el de la plataforma. */
  whatsapp: 'off' | 'tenant' | 'platform' | 'none';
  /** Hay un celular para los avisos de la plataforma (Plan y facturación). */
  phone: boolean;
  admins: number;
}

export interface PlatformNoticeTestDTO {
  email: { sent: number; error: string | null };
  whatsapp: { sent: number; error: string | null };
}
