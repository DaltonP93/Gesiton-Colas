/* ------------------------------------------------------------------ */
/* Registro de auditoría: quién cambió qué y cuándo                    */
/* ------------------------------------------------------------------ */

export type AuditActorKind = 'user' | 'apiKey' | 'system';

/** Tipos de registro, para filtrar y mostrar con su nombre. */
export const AUDIT_ENTITIES = {
  auth: 'Ingresos',
  tenant: 'Organización y configuración',
  user: 'Usuarios',
  branch: 'Sucursales',
  counter: 'Puestos',
  department: 'Departamentos',
  service: 'Servicios',
  priority: 'Prioridades',
  display: 'Pantallas',
  kiosk: 'Kioscos',
  media: 'Publicidad',
  playlist: 'Listas de reproducción',
  integration: 'Integraciones',
  mail: 'Correo',
  notification: 'Avisos',
  survey: 'Encuestas',
  payment: 'Pagos y cobros',
  invoice: 'Facturación',
  queue: 'Colas',
  privacy: 'Privacidad',
  device: 'Dispositivos',
  appointment: 'Citas',
  invoicing: 'Factura electrónica',
  platform: 'Plataforma',
} as const;
export type AuditEntity = keyof typeof AUDIT_ENTITIES;

export interface AuditLogDTO {
  id: string;
  createdAt: string;
  tenantId: string | null;
  tenantName: string | null;
  actor: { kind: AuditActorKind; id: string | null; name: string; email: string | null; role: string | null };
  /** Un superadministrador actuó dentro de la organización (modo soporte). */
  support: boolean;
  action: string;
  entity: AuditEntity;
  entityId: string | null;
  summary: string;
  /** Datos enviados (sin contraseñas ni claves). */
  changes: Record<string, unknown> | null;
  ip: string | null;
}

export interface AuditPageDTO {
  items: AuditLogDTO[];
  total: number;
}
