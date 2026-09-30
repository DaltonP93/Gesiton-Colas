export const TICKET_STATUSES = [
  'waiting',
  'called',
  'in_service',
  'finished',
  'no_show',
  'cancelled',
  /** El turno fue derivado a otro servicio (se crea un turno nuevo con el mismo código). */
  'transferred',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Estados en los que un turno todavía está "vivo" en la cola. */
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['waiting', 'called', 'in_service'];

export const ROLES = ['superadmin', 'admin', 'manager', 'agent'] as const;
export type Role = (typeof ROLES)[number];

/** Jerarquía de roles: un rol incluye los permisos de los de menor nivel. */
export const ROLE_LEVEL: Record<Role, number> = {
  agent: 1,
  manager: 2,
  admin: 3,
  superadmin: 4,
};

export function hasRole(role: Role, required: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

export const TICKET_CHANNELS = ['kiosk', 'web', 'api', 'agent', 'mobile'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export const MEDIA_KINDS = ['video', 'image', 'audio', 'youtube', 'vimeo', 'hls', 'embed', 'text'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_PROVIDERS = [
  'upload',
  'direct',
  'youtube',
  'vimeo',
  'dailymotion',
  'twitch',
  'facebook',
  'tiktok',
  'instagram',
  'google-drive',
  'google-slides',
  'canva',
  'loom',
  'hls',
  'web',
  'text',
] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

export const DISPLAY_LAYOUTS = ['split', 'fullscreen', 'tickets'] as const;
export type DisplayLayout = (typeof DISPLAY_LAYOUTS)[number];

export const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.called',
  'ticket.recalled',
  'ticket.started',
  'ticket.finished',
  'ticket.no_show',
  'ticket.cancelled',
  'ticket.transferred',
  'ticket.requeued',
  'queue.reset',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const API_KEY_SCOPES = [
  'tickets:read',
  'tickets:write',
  'catalog:read',
  'catalog:write',
  'reports:read',
  'displays:write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const LOCALES = ['es', 'en', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

/** Eventos emitidos por el servidor en tiempo real (Socket.IO). */
export const RT = {
  ticketCreated: 'ticket.created',
  ticketCalled: 'ticket.called',
  ticketUpdated: 'ticket.updated',
  queueChanged: 'queue.changed',
  displayConfig: 'display.config',
  kioskConfig: 'kiosk.config',
  tenantSettings: 'tenant.settings',
} as const;

/**
 * Sonidos de alerta incluidos (archivos en /sounds/<id>.wav). Todos permiten uso comercial:
 * CC0, CC BY 4.0 (con atribución en /sounds/CREDITOS.md) o sintetizados por el proyecto.
 */
export const ALERT_SOUNDS = [
  'airport-bingbong',
  'ding-dong',
  'doorbell-bingbong',
  'infobleep',
  'chime-soft',
  'bell-ding',
  'triple-rise',
  'triple-fall',
  'announcement',
  'marimba',
  'xylophone',
  'harp',
  'double-beep',
  'soft-pop',
  'gong',
  'retro',
] as const;
export type AlertSound = (typeof ALERT_SOUNDS)[number];

export const ALERT_SOUND_LABELS: Record<AlertSound, { label: string; category: 'Clásicos' | 'Suaves' | 'Llamativos' | 'Musicales' }> = {
  'airport-bingbong': { label: 'Aeropuerto', category: 'Clásicos' },
  'ding-dong': { label: 'Ding dong', category: 'Clásicos' },
  'doorbell-bingbong': { label: 'Timbre', category: 'Clásicos' },
  infobleep: { label: 'Bip informativo', category: 'Clásicos' },
  'chime-soft': { label: 'Campana suave', category: 'Suaves' },
  'bell-ding': { label: 'Campana única', category: 'Suaves' },
  'soft-pop': { label: 'Notificación suave', category: 'Suaves' },
  'triple-rise': { label: 'Tres tonos ascendentes', category: 'Llamativos' },
  'triple-fall': { label: 'Tres tonos descendentes', category: 'Llamativos' },
  announcement: { label: 'Anuncio (4 tonos)', category: 'Llamativos' },
  'double-beep': { label: 'Doble bip', category: 'Llamativos' },
  gong: { label: 'Gong', category: 'Llamativos' },
  marimba: { label: 'Marimba', category: 'Musicales' },
  xylophone: { label: 'Xilófono', category: 'Musicales' },
  harp: { label: 'Arpa', category: 'Musicales' },
  retro: { label: 'Retro 8 bits', category: 'Musicales' },
};

export function isAlertSound(value: string): value is AlertSound {
  return (ALERT_SOUNDS as readonly string[]).includes(value);
}

/** Un ícono de servicio puede ser uno de la biblioteca (clave) o una imagen propia (/uploads/... o URL). */
export function isImageIcon(icon: string | null | undefined): icon is string {
  return Boolean(icon && (icon.startsWith('/uploads/') || /^https?:\/\//i.test(icon) || icon.startsWith('data:image/')));
}
