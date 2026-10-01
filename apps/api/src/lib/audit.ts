import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { AuditActorKind, AuditEntity } from '@gc/shared';
import type { Database } from '../db/client';
import { auditLogs } from '../db/schema';

export interface AuditEntry {
  tenantId: string | null;
  actor: { kind: AuditActorKind; id: string | null; name: string; email?: string | null; role?: string | null };
  support?: boolean;
  action: string;
  entity: AuditEntity;
  entityId?: string | null;
  summary: string;
  changes?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/* ------------------------------------------------------------------ */
/* Datos sin secretos                                                   */
/* ------------------------------------------------------------------ */

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|private|^key$|csc|cert|p12|pfx|webhookSecret|authorization/i;

/** Copia de los datos enviados sin contraseñas ni claves, con textos y listas acotados. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '…';
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    return value.length > 20 ? [...items, `… (${value.length - 20} más)`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) out[k] = v === '' || v === null || v === undefined ? v : '••••';
    else out[k] = sanitize(v, depth + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Qué significa cada ruta                                              */
/* ------------------------------------------------------------------ */

interface RouteMeta {
  action: string;
  entity: AuditEntity;
  /** Descripción; `{name}` = nombre enviado o el id. */
  label: string;
}

const M = (action: string, entity: AuditEntity, label: string): RouteMeta => ({ action, entity, label });

const ROUTES: Record<string, RouteMeta> = {
  'PUT /auth/me': M('profile.update', 'user', 'Actualizó su perfil'),
  'PUT /tenant': M('tenant.update', 'tenant', 'Cambió la configuración'),
  'POST /users': M('user.create', 'user', 'Creó el usuario {name}'),
  'PUT /users/:id': M('user.update', 'user', 'Modificó el usuario {name}'),
  'DELETE /users/:id': M('user.delete', 'user', 'Eliminó un usuario'),
  'POST /users/:id/invite': M('user.invite', 'user', 'Reenvió una invitación'),
  'POST /branches': M('branch.create', 'branch', 'Creó la sucursal {name}'),
  'PUT /branches/:id': M('branch.update', 'branch', 'Modificó la sucursal {name}'),
  'DELETE /branches/:id': M('branch.delete', 'branch', 'Eliminó una sucursal'),
  'PUT /branches/:id/services': M('branch.services', 'branch', 'Cambió los servicios de una sucursal'),
  'POST /branches/:id/queue/reset': M('queue.reset', 'queue', 'Cerró la jornada de una sucursal'),
  'POST /counters': M('counter.create', 'counter', 'Creó el puesto {name}'),
  'PUT /counters/:id': M('counter.update', 'counter', 'Modificó el puesto {name}'),
  'DELETE /counters/:id': M('counter.delete', 'counter', 'Eliminó un puesto'),
  'POST /departments': M('department.create', 'department', 'Creó el departamento {name}'),
  'PUT /departments/:id': M('department.update', 'department', 'Modificó el departamento {name}'),
  'DELETE /departments/:id': M('department.delete', 'department', 'Eliminó un departamento'),
  'POST /services': M('service.create', 'service', 'Creó el servicio {name}'),
  'PUT /services/:id': M('service.update', 'service', 'Modificó el servicio {name}'),
  'DELETE /services/:id': M('service.delete', 'service', 'Eliminó un servicio'),
  'POST /priorities': M('priority.create', 'priority', 'Creó la prioridad {name}'),
  'PUT /priorities/:id': M('priority.update', 'priority', 'Modificó la prioridad {name}'),
  'DELETE /priorities/:id': M('priority.delete', 'priority', 'Eliminó una prioridad'),
  'POST /numbering/reset': M('numbering.reset', 'queue', 'Reinició la numeración de turnos'),
  'POST /tickets/:id/cancel': M('ticket.cancel', 'queue', 'Canceló un turno'),
  'POST /displays': M('display.create', 'display', 'Creó la pantalla {name}'),
  'PUT /displays/:id': M('display.update', 'display', 'Modificó la pantalla {name}'),
  'DELETE /displays/:id': M('display.delete', 'display', 'Eliminó una pantalla'),
  'POST /displays/:id/rotate-token': M('display.rotate', 'display', 'Regeneró el enlace de una pantalla'),
  'POST /kiosks': M('kiosk.create', 'kiosk', 'Creó el kiosco {name}'),
  'PUT /kiosks/:id': M('kiosk.update', 'kiosk', 'Modificó el kiosco {name}'),
  'DELETE /kiosks/:id': M('kiosk.delete', 'kiosk', 'Eliminó un kiosco'),
  'POST /kiosks/:id/rotate-token': M('kiosk.rotate', 'kiosk', 'Regeneró el enlace de un kiosco'),
  'POST /pairings/claim': M('device.pair', 'device', 'Vinculó un equipo con un código'),
  'POST /media': M('media.create', 'media', 'Agregó el contenido {name}'),
  'POST /media/upload': M('media.upload', 'media', 'Subió un archivo'),
  'PUT /media/:id': M('media.update', 'media', 'Modificó el contenido {name}'),
  'DELETE /media/:id': M('media.delete', 'media', 'Eliminó un contenido'),
  'POST /playlists': M('playlist.create', 'playlist', 'Creó la lista {name}'),
  'PUT /playlists/:id': M('playlist.update', 'playlist', 'Modificó la lista {name}'),
  'DELETE /playlists/:id': M('playlist.delete', 'playlist', 'Eliminó una lista'),
  'POST /api-keys': M('apikey.create', 'integration', 'Creó la API key {name}'),
  'DELETE /api-keys/:id': M('apikey.delete', 'integration', 'Revocó una API key'),
  'POST /webhooks': M('webhook.create', 'integration', 'Creó un webhook'),
  'PUT /webhooks/:id': M('webhook.update', 'integration', 'Modificó un webhook'),
  'DELETE /webhooks/:id': M('webhook.delete', 'integration', 'Eliminó un webhook'),
  'POST /webhooks/:id/rotate-secret': M('webhook.rotate', 'integration', 'Regeneró el secreto de un webhook'),
  'PUT /mail-settings': M('mail.update', 'mail', 'Cambió el servidor de correo'),
  'PUT /notifications/provider': M('notifications.provider', 'notification', 'Cambió el canal de avisos'),
  'POST /surveys': M('survey.create', 'survey', 'Creó la encuesta {name}'),
  'PUT /surveys/:id': M('survey.update', 'survey', 'Modificó la encuesta {name}'),
  'DELETE /surveys/:id': M('survey.delete', 'survey', 'Eliminó una encuesta y sus respuestas'),
  'PUT /payments/gateway': M('payments.gateway', 'payment', 'Cambió la pasarela de pagos'),
  'POST /tickets/:id/charge/manual': M('payment.manual', 'payment', 'Registró un cobro en el puesto'),
  'POST /billing/invoices/:id/pay': M('invoice.pay_online', 'invoice', 'Inició el pago en línea de una factura'),
  'POST /privacy/erase': M('privacy.erase', 'privacy', 'Borró los datos personales de una persona'),
  // Plataforma
  'POST /platform/tenants': M('platform.tenant_create', 'platform', 'Creó la organización {name}'),
  'PUT /platform/tenants/:id': M('platform.tenant_update', 'platform', 'Modificó una organización (plan, estado o módulos)'),
  'PUT /platform/settings': M('platform.settings', 'platform', 'Cambió los ajustes de la plataforma'),
  'POST /platform/admins': M('platform.admin_create', 'platform', 'Agregó al superadministrador {name}'),
  'PUT /platform/admins/:id': M('platform.admin_update', 'platform', 'Modificó un superadministrador'),
  'DELETE /platform/admins/:id': M('platform.admin_delete', 'platform', 'Quitó un superadministrador'),
  'PUT /platform/users/:id/password': M('platform.user_password', 'platform', 'Definió la contraseña de un usuario'),
  'POST /platform/users/:id/access-link': M('platform.access_link', 'platform', 'Generó un enlace de acceso para un usuario'),
  'PUT /platform/mail': M('platform.mail', 'platform', 'Cambió el correo de la plataforma'),
  'PUT /platform/notifications': M('platform.notifications', 'platform', 'Cambió el canal de avisos de la plataforma'),
  'PUT /platform/payments/gateway': M('platform.gateway', 'platform', 'Cambió la pasarela de la plataforma'),
  'POST /platform/backups': M('platform.backup', 'platform', 'Creó una copia de seguridad'),
  'DELETE /platform/backups/:id': M('platform.backup_delete', 'platform', 'Borró una copia de seguridad'),
  'POST /platform/billing/invoices': M('invoice.create', 'invoice', 'Emitió una factura'),
  'POST /platform/billing/generate': M('invoice.generate', 'invoice', 'Generó las facturas del mes'),
  'POST /platform/billing/invoices/:id/pay': M('invoice.pay', 'invoice', 'Registró el pago de una factura'),
  'POST /platform/billing/invoices/:id/void': M('invoice.void', 'invoice', 'Anuló una factura'),
  'PUT /invoicing/issuer': M('invoicing.issuer', 'invoicing', 'Cambió los datos de la factura electrónica'),
  'POST /invoicing/issuer/certificate': M('invoicing.certificate', 'invoicing', 'Cargó el certificado digital'),
  'DELETE /invoicing/issuer/certificate': M('invoicing.certificate_delete', 'invoicing', 'Quitó el certificado digital'),
  'PUT /invoicing/issuer/csc': M('invoicing.csc', 'invoicing', 'Cambió el código de seguridad (CSC)'),
  'POST /invoicing/documents': M('invoicing.issue', 'invoicing', 'Emitió una factura electrónica'),
  'POST /invoicing/documents/:id/retry': M('invoicing.retry', 'invoicing', 'Reenvió una factura electrónica'),
  'POST /invoicing/documents/:id/cancel': M('invoicing.cancel', 'invoicing', 'Anuló una factura electrónica'),
  'PUT /platform/invoicing/issuer': M('platform.invoicing_issuer', 'invoicing', 'Cambió los datos de la factura electrónica de la plataforma'),
  'POST /platform/invoicing/issuer/certificate': M('platform.invoicing_certificate', 'invoicing', 'Cargó el certificado digital de la plataforma'),
  'PUT /platform/invoicing/issuer/csc': M('platform.invoicing_csc', 'invoicing', 'Cambió el CSC de la plataforma'),
  'POST /platform/invoicing/documents': M('platform.invoicing_issue', 'invoicing', 'Emitió una factura electrónica de la plataforma'),
  'POST /platform/invoicing/documents/:id/cancel': M('platform.invoicing_cancel', 'invoicing', 'Anuló una factura electrónica de la plataforma'),
  'POST /appointments': M('appointment.create', 'appointment', 'Agendó una cita'),
  'PUT /appointments/:id': M('appointment.update', 'appointment', 'Modificó una cita'),
  'POST /appointments/:id/cancel': M('appointment.cancel', 'appointment', 'Canceló una cita'),
  'POST /appointments/:id/no-show': M('appointment.no_show', 'appointment', 'Marcó una cita como «No vino»'),
  'POST /appointments/import': M('appointment.import', 'appointment', 'Importó citas (CSV)'),
  'POST /appointment-schedules': M('appointment.schedule_create', 'appointment', 'Agregó un horario de citas'),
  'PUT /appointment-schedules/:id': M('appointment.schedule_update', 'appointment', 'Modificó un horario de citas'),
  'DELETE /appointment-schedules/:id': M('appointment.schedule_delete', 'appointment', 'Quitó un horario de citas'),
};

/** Rutas que no se registran: operación diaria (ya queda en el historial de cada turno), pruebas y consultas. */
const SKIP = [
  /^POST \/agent\//,
  /^PUT \/agent\//,
  /^POST \/tickets$/,
  /^POST \/(platform\/)?invoicing\/(ruc|documents\/:id\/refresh)$/,
  // Llegadas y sincronización con otros sistemas: quedan en la cita y en el turno.
  /^POST \/appointments\/:id\/check-in$/,
  /^(PUT|POST) \/appointments\/external\//,
  /^POST \/media\/detect$/,
  /\/test$/,
  /^POST \/notifications\/messages\/:id\/retry$/,
  /^POST \/webhooks\/deliveries\//,
  /^POST \/auth\//,
  /^POST \/public\//,
  /^POST \/platform\/assets$/,
  /^POST \/platform\/billing\/invoices\/:id\/resend$/,
  /^POST \/platform\/admins\/:id\/invite$/,
];

const ROUTE_PREFIX = '/api/v1';

export class Audit {
  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Guarda un registro sin demorar la respuesta (un error al registrar no rompe la operación). */
  record(entry: AuditEntry): void {
    void this.db
      .insert(auditLogs)
      .values({
        tenantId: entry.tenantId,
        actorKind: entry.actor.kind,
        actorId: entry.actor.id,
        actorName: entry.actor.name,
        actorEmail: entry.actor.email ?? null,
        actorRole: entry.actor.role ?? null,
        support: entry.support ?? false,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        summary: entry.summary.slice(0, 500),
        changes: (entry.changes ? sanitize(entry.changes) : null) as Record<string, unknown> | null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent?.slice(0, 300) ?? null,
      })
      .catch((error) => this.log.error({ err: error, action: entry.action }, 'auditoría: no se pudo registrar'));
  }

  /** Quién hizo el pedido. */
  actorOf(request: FastifyRequest): Pick<AuditEntry, 'actor' | 'support' | 'tenantId' | 'ip' | 'userAgent'> | null {
    const auth = request.auth;
    if (!auth) return null;
    const base = { ip: request.ip, userAgent: request.headers['user-agent'] ?? null };
    if (auth.kind === 'apiKey') {
      return { ...base, tenantId: auth.tenantId, actor: { kind: 'apiKey', id: auth.keyId, name: `API key «${auth.keyName}»`, role: 'api' } };
    }
    const superadmin = auth.role === 'superadmin';
    return {
      ...base,
      tenantId: auth.tenantId,
      support: superadmin && Boolean(auth.tenantId),
      actor: { kind: 'user', id: auth.userId, name: auth.user.name, email: auth.user.email, role: auth.role },
    };
  }

  /** Hook `onSend` del API: registra cada cambio exitoso con su descripción. */
  hook() {
    return async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      try {
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || reply.statusCode >= 400) return payload;
        const route = (request.routeOptions.url ?? '').replace(ROUTE_PREFIX, '');
        const key = `${request.method} ${route}`;
        if (!route || SKIP.some((re) => re.test(key))) return payload;
        const who = this.actorOf(request);
        if (!who) return payload;
        const meta = ROUTES[key] ?? M(`${request.method.toLowerCase()} ${route}`, route.startsWith('/platform') ? 'platform' : 'tenant', `${request.method} ${route}`);
        const params = (request.params ?? {}) as Record<string, string>;
        const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : null;
        let createdId: string | null = null;
        if (!params.id && typeof payload === 'string' && payload.startsWith('{')) {
          try {
            const parsed = JSON.parse(payload) as { id?: unknown };
            if (typeof parsed.id === 'string') createdId = parsed.id;
          } catch {
            /* respuesta que no es JSON */
          }
        }
        const name = typeof body?.name === 'string' ? `«${body.name}»` : typeof body?.email === 'string' ? `«${body.email}»` : '';
        let summary = meta.label.replace('{name}', name).replace(/\s+/g, ' ').trim();
        if (key === 'PUT /tenant' && body) {
          const parts = [...(typeof body.name === 'string' ? ['nombre'] : []), ...Object.keys((body.settings as object) ?? {})];
          if (parts.length) summary = `Cambió la configuración: ${parts.join(', ')}`;
        }
        // Las acciones de la plataforma sobre una organización también se ven en esa organización.
        const tenantId = route.startsWith('/platform/tenants/:id') ? (params.id ?? null) : route.startsWith('/platform') ? null : who.tenantId;
        this.record({ ...who, tenantId, action: meta.action, entity: meta.entity, entityId: params.id ?? createdId, summary, changes: body });
      } catch (error) {
        this.log.error({ err: error }, 'auditoría: error en el registro automático');
      }
      return payload;
    };
  }
}
