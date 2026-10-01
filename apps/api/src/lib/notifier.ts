import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  NOTIFY_PROVIDERS,
  normalizePhone,
  renderTemplate,
  type ModuleId,
  type NotifyEvent,
  type NotifyProvider,
  type NotifyProviderDTO,
  type NotifyStatusDTO,
  type TicketDTO,
  type WebhookEvent,
} from '@gc/shared';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { branches, notifyMessages, notifyProviders, priorities, tenants, tickets, type NotifyProviderRow, type Tenant } from '../db/schema';
import { decryptSecret, encryptSecret } from './crypto';
import { tenantSettings } from './dto';
import { badRequest } from './errors';
import { outboundRequest } from './net';
import { countAhead, findTickets } from '../modules/tickets/queue';

export const PLATFORM_NOTIFY_SCOPE = 'platform';
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [1, 5];
const PRIVATE_HINT =
  'La dirección del proveedor está en una red privada. Configúrelo como proveedor de la plataforma (superadministrador) o habilite WEBHOOKS_ALLOW_PRIVATE=true en el servidor.';

/* ------------------------------------------------------------------ */
/* Configuración del proveedor                                          */
/* ------------------------------------------------------------------ */

export const notifyProviderBody = z.object({
  enabled: z.boolean(),
  provider: z.enum(NOTIFY_PROVIDERS),
  metaPhoneNumberId: z.string().trim().max(60).default(''),
  metaApiVersion: z.string().trim().regex(/^v\d{1,2}\.\d$/, 'Versión inválida (p. ej. v22.0)').or(z.literal('')).default(''),
  wahaUrl: z.union([z.literal(''), z.string().trim().url().max(500)]).default(''),
  wahaSession: z.string().trim().max(60).default(''),
  httpMethod: z.enum(['GET', 'POST']).default('POST'),
  httpUrl: z.string().trim().max(1000).default(''),
  httpBody: z.string().max(4000).default(''),
  httpContentType: z.string().trim().max(120).default('application/json'),
  httpAuthHeader: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/, 'Nombre de encabezado inválido').default(''),
  /** Token (Meta), API key (WAHA) o valor del encabezado (HTTP). Sin enviar = conservar; vacío = borrar. */
  secret: z.string().max(4000).optional(),
});
export type NotifyProviderBody = z.infer<typeof notifyProviderBody>;

const CONFIG_KEYS = ['metaPhoneNumberId', 'metaApiVersion', 'wahaUrl', 'wahaSession', 'httpMethod', 'httpUrl', 'httpBody', 'httpContentType', 'httpAuthHeader'] as const;

function toDTO(row: NotifyProviderRow | undefined): NotifyProviderDTO {
  const c = row?.config ?? {};
  return {
    enabled: row?.enabled ?? false,
    provider: row?.provider ?? 'waha',
    metaPhoneNumberId: c.metaPhoneNumberId ?? '',
    metaApiVersion: c.metaApiVersion ?? '',
    wahaUrl: c.wahaUrl ?? '',
    wahaSession: c.wahaSession ?? '',
    httpMethod: c.httpMethod === 'GET' ? 'GET' : 'POST',
    httpUrl: c.httpUrl ?? '',
    httpBody: c.httpBody ?? '',
    httpContentType: c.httpContentType ?? 'application/json',
    httpAuthHeader: c.httpAuthHeader ?? '',
    hasSecret: Boolean(row?.secretEnc),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

interface Runtime {
  provider: NotifyProvider;
  config: Record<string, string>;
  secret: string;
  allowPrivate: boolean;
}

export interface OutgoingMessage {
  to: string;
  body: string;
  /** Parámetros de la plantilla de Meta (en orden). */
  params: string[];
  metaTemplate?: string;
  metaLanguage?: string;
}

function assertUsable(body: NotifyProviderBody) {
  if (body.provider === 'meta' && !body.metaPhoneNumberId) throw badRequest('Indique el identificador del número de WhatsApp (Phone number ID)');
  if (body.provider === 'waha' && !body.wahaUrl) throw badRequest('Indique la dirección de WAHA (p. ej. http://10.0.0.5:3000)');
  if (body.provider === 'http') {
    if (!/^https?:\/\//i.test(body.httpUrl)) throw badRequest('Indique la URL del proveedor de SMS (http o https)');
    if (!body.httpUrl.includes('{{phone}}') && !body.httpBody.includes('{{phone}}')) throw badRequest('Use {{phone}} en la URL o en el cuerpo para indicar el destinatario');
    if (!body.httpUrl.includes('{{message}}') && !body.httpBody.includes('{{message}}')) throw badRequest('Use {{message}} en la URL o en el cuerpo para indicar el texto');
  }
}

function describeError(body: string) {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const e = typeof json.error === 'string' ? json.error : json.error?.message;
    return (e ?? json.message ?? body).toString().slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/** Envía un mensaje con el proveedor configurado. Devuelve la referencia del proveedor si la hay. */
export async function deliver(rt: Runtime, msg: OutgoingMessage): Promise<string | null> {
  const c = rt.config;
  const json = { 'content-type': 'application/json' };
  if (rt.provider === 'meta') {
    const version = c.metaApiVersion || 'v22.0';
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(c.metaPhoneNumberId ?? '')}/messages`;
    const payload = msg.metaTemplate
      ? {
          messaging_product: 'whatsapp',
          to: msg.to,
          type: 'template',
          template: {
            name: msg.metaTemplate,
            language: { code: msg.metaLanguage || 'es' },
            components: msg.params.length ? [{ type: 'body', parameters: msg.params.map((text) => ({ type: 'text', text: text || '-' })) }] : [],
          },
        }
      : { messaging_product: 'whatsapp', to: msg.to, type: 'text', text: { body: msg.body } };
    const res = await outboundRequest(url, { method: 'POST', headers: { ...json, authorization: `Bearer ${rt.secret}` }, body: JSON.stringify(payload), allowPrivate: rt.allowPrivate });
    if (res.status < 200 || res.status >= 300) throw new Error(`Meta respondió ${res.status}: ${describeError(res.body)}`);
    return (JSON.parse(res.body) as { messages?: { id?: string }[] }).messages?.[0]?.id ?? null;
  }
  if (rt.provider === 'waha') {
    const url = `${(c.wahaUrl ?? '').replace(/\/$/, '')}/api/sendText`;
    const headers: Record<string, string> = { ...json, ...(rt.secret ? { 'x-api-key': rt.secret } : {}) };
    const res = await outboundRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session: c.wahaSession || 'default', chatId: `${msg.to}@c.us`, text: msg.body }),
      allowPrivate: rt.allowPrivate,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`WAHA respondió ${res.status}: ${describeError(res.body)}`);
    try {
      const data = JSON.parse(res.body) as { id?: string | { _serialized?: string } };
      return typeof data.id === 'string' ? data.id : (data.id?._serialized ?? null);
    } catch {
      return null;
    }
  }
  // SMS (o cualquier servicio) por HTTP con {{phone}} y {{message}}.
  const contentType = c.httpContentType || 'application/json';
  const encodeBody = (v: string) =>
    contentType.includes('json') ? JSON.stringify(v).slice(1, -1) : contentType.includes('x-www-form-urlencoded') ? encodeURIComponent(v) : v;
  const fill = (tpl: string, encode: (v: string) => string) =>
    tpl.replace(/\{\{\s*(phone|message)\s*\}\}/g, (_, key: string) => encode(key === 'phone' ? msg.to : msg.body));
  const method = c.httpMethod === 'GET' ? 'GET' : 'POST';
  const headers: Record<string, string> = {};
  if (method === 'POST') headers['content-type'] = contentType;
  if (c.httpAuthHeader && rt.secret) headers[c.httpAuthHeader] = rt.secret;
  const res = await outboundRequest(fill(c.httpUrl ?? '', encodeURIComponent), {
    method,
    headers,
    body: method === 'POST' ? fill(c.httpBody ?? '', encodeBody) : undefined,
    allowPrivate: rt.allowPrivate,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`El proveedor respondió ${res.status}: ${describeError(res.body)}`);
  return null;
}

/* ------------------------------------------------------------------ */
/* Avisos de los turnos                                                 */
/* ------------------------------------------------------------------ */

interface NotifierDeps {
  config: AppConfig;
  db: Database;
  log: FastifyBaseLogger;
  modulesOf(tenant: Pick<Tenant, 'plan' | 'modules'>): Promise<ModuleId[]>;
}

/** Enlace de la encuesta de un turno (lo provee el módulo de encuestas). */
export type SurveyLinkResolver = (tenant: Tenant, ticket: TicketDTO) => Promise<string | null>;

/** Orden de los parámetros de las plantillas de Meta para cada aviso. */
export const META_PARAMS: Record<NotifyEvent, string[]> = {
  created: ['code', 'service', 'waiting', 'link'],
  near: ['code', 'remaining', 'branch'],
  called: ['code', 'counter'],
  finished: ['organization', 'survey'],
};

export class Notifier {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  surveyLink: SurveyLinkResolver = async () => null;

  constructor(private readonly deps: NotifierDeps) {}

  private get base() {
    return this.deps.config.PUBLIC_URL.replace(/\/$/, '');
  }

  start(intervalMs = 15_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.processDue(), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ---------------------------- Proveedores --------------------------- */

  private async row(scope: string) {
    const [row] = await this.deps.db.select().from(notifyProviders).where(eq(notifyProviders.scope, scope)).limit(1);
    return row;
  }

  private runtime(row: NotifyProviderRow, scope: string): Runtime {
    const secret = decryptSecret(this.deps.config.JWT_SECRET, row.secretEnc, 'notify');
    if (secret === null) this.deps.log.warn({ scope }, 'No se pudo descifrar la clave del proveedor de avisos (¿cambió JWT_SECRET?)');
    return {
      provider: row.provider,
      config: row.config,
      secret: secret ?? '',
      allowPrivate: scope === PLATFORM_NOTIFY_SCOPE || this.deps.config.WEBHOOKS_ALLOW_PRIVATE,
    };
  }

  /** Proveedor que usa una organización: el propio o, si no tiene, el de la plataforma. */
  async resolve(tenantId: string): Promise<{ source: 'tenant' | 'platform' | 'none'; runtime: Runtime | null }> {
    const own = await this.row(tenantId);
    if (own?.enabled) return { source: 'tenant', runtime: this.runtime(own, tenantId) };
    const platform = await this.row(PLATFORM_NOTIFY_SCOPE);
    if (platform?.enabled) return { source: 'platform', runtime: this.runtime(platform, PLATFORM_NOTIFY_SCOPE) };
    return { source: 'none', runtime: null };
  }

  async status(scope: string, tenantId: string | null): Promise<NotifyStatusDTO> {
    const row = await this.row(scope);
    const active = tenantId ? (await this.resolve(tenantId)).source : row?.enabled ? 'platform' : 'none';
    return { settings: toDTO(row), active };
  }

  async save(scope: string, tenantId: string | null, body: NotifyProviderBody): Promise<NotifyStatusDTO> {
    if (body.enabled) assertUsable(body);
    const current = await this.row(scope);
    const secretEnc = body.secret === undefined ? (current?.secretEnc ?? '') : encryptSecret(this.deps.config.JWT_SECRET, body.secret, 'notify');
    const config = Object.fromEntries(CONFIG_KEYS.map((k) => [k, String(body[k] ?? '')]));
    await this.deps.db
      .insert(notifyProviders)
      .values({ scope, tenantId, enabled: body.enabled, provider: body.provider, config, secretEnc })
      .onConflictDoUpdate({ target: notifyProviders.scope, set: { enabled: body.enabled, provider: body.provider, config, secretEnc, updatedAt: new Date() } });
    return this.status(scope, tenantId);
  }

  /** Prueba el formulario (aunque no esté guardado) enviando un mensaje real. */
  async test(scope: string, body: NotifyProviderBody & { to: string; countryCode?: string }) {
    assertUsable(body);
    let secret = body.secret;
    if (secret === undefined) {
      const current = await this.row(scope);
      // La clave guardada solo se usa con el mismo proveedor y destino.
      const targetKey = { meta: 'metaPhoneNumberId', waha: 'wahaUrl', http: 'httpUrl' } as const;
      const key = targetKey[body.provider];
      const sameTarget = current && current.provider === body.provider && (current.config[key] ?? '') === body[key];
      if (current?.secretEnc && !sameTarget) throw badRequest('Cambió el proveedor o la dirección: escriba la clave o el token para probar.');
      secret = current ? (decryptSecret(this.deps.config.JWT_SECRET, current.secretEnc, 'notify') ?? '') : '';
    }
    const to = normalizePhone(body.to, body.countryCode ?? '595');
    if (!to) throw badRequest('Teléfono inválido');
    const runtime: Runtime = {
      provider: body.provider,
      config: Object.fromEntries(CONFIG_KEYS.map((k) => [k, String(body[k] ?? '')])),
      secret,
      allowPrivate: scope === PLATFORM_NOTIFY_SCOPE || this.deps.config.WEBHOOKS_ALLOW_PRIVATE,
    };
    try {
      await deliver(runtime, { to, body: 'Mensaje de prueba de Gestión de Colas: los avisos por este canal funcionan.', params: [] });
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw badRequest(code === 'EPRIVATE' ? PRIVATE_HINT : error instanceof Error ? error.message : 'No se pudo enviar');
    }
    return { ok: true, message: `Mensaje de prueba enviado a +${to}.` };
  }

  /** Envía un mensaje libre (alertas al personal, citas) con el canal de la organización y lo deja en el historial. */
  async sendText(tenant: Tenant, phone: string, text: string, event: 'alert' | 'appointment' | 'reminder' = 'alert'): Promise<boolean> {
    const to = normalizePhone(phone, tenantSettings(tenant).notifications.countryCode);
    const { runtime } = await this.resolve(tenant.id);
    if (!to || !runtime) return false;
    try {
      const ref = await deliver(runtime, { to, body: text, params: [] });
      await this.deps.db.insert(notifyMessages).values({ tenantId: tenant.id, event, to, body: text, provider: runtime.provider, status: 'sent', attempts: 1, providerRef: ref, sentAt: new Date(), nextAttemptAt: null });
      return true;
    } catch (error) {
      await this.deps.db
        .insert(notifyMessages)
        .values({ tenantId: tenant.id, event, to, body: text, provider: runtime.provider, status: 'failed', attempts: 1, error: (error instanceof Error ? error.message : 'Error').slice(0, 500), nextAttemptAt: null });
      return false;
    }
  }

  /**
   * Mensaje de la plataforma (vencimientos, alertas) con el canal compartido de la plataforma.
   * Con `tenantId` queda también en el historial de avisos de esa organización.
   */
  async sendPlatformText(phone: string, text: string, options: { countryCode: string; tenantId?: string | null; event?: string }): Promise<{ ok: boolean; error?: string }> {
    const to = normalizePhone(phone, options.countryCode);
    const row = await this.row(PLATFORM_NOTIFY_SCOPE);
    if (!to) return { ok: false, error: 'Número inválido' };
    if (!row?.enabled) return { ok: false, error: 'La plataforma no tiene un canal de WhatsApp/SMS configurado' };
    const runtime = this.runtime(row, PLATFORM_NOTIFY_SCOPE);
    try {
      const ref = await deliver(runtime, { to, body: text, params: [] });
      if (options.tenantId) {
        await this.deps.db.insert(notifyMessages).values({ tenantId: options.tenantId, event: options.event ?? 'platform', to, body: text, provider: runtime.provider, status: 'sent', attempts: 1, providerRef: ref, sentAt: new Date(), nextAttemptAt: null });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error instanceof Error ? error.message : 'Error').slice(0, 300) };
    }
  }

  /* ------------------------------ Eventos ----------------------------- */

  /** Llamado en cada cambio de turno: arma los avisos que correspondan. */
  async onTicketEvent(tenantId: string, event: WebhookEvent, ticket: TicketDTO) {
    const map: Partial<Record<WebhookEvent, NotifyEvent>> = { 'ticket.created': 'created', 'ticket.called': 'called', 'ticket.finished': 'finished' };
    const notifyEvent = map[event];
    if (!notifyEvent) return;
    const [tenant] = await this.deps.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant || !(await this.deps.modulesOf(tenant)).includes('notifications')) return;
    const settings = tenantSettings(tenant).notifications;
    await this.enqueueFor(tenant, ticket, notifyEvent);
    // Tras cada llamado, avisa a quien quedó a N turnos de ser atendido.
    if (notifyEvent === 'called' && settings.events.near.enabled) {
      const next = await this.deps.db
        .select({ id: tickets.id })
        .from(tickets)
        .innerJoin(priorities, eq(priorities.id, tickets.priorityId))
        .where(and(eq(tickets.branchId, ticket.branchId), eq(tickets.serviceId, ticket.serviceId), eq(tickets.status, 'waiting')))
        .orderBy(desc(priorities.weight), asc(tickets.sortAt))
        .offset(settings.nearAhead)
        .limit(1);
      if (next[0]) {
        const [target] = await findTickets(this.deps.db, eq(tickets.id, next[0].id), [], 1);
        if (target) await this.enqueueFor(tenant, target, 'near', { remaining: settings.nearAhead });
      }
    }
  }

  private async enqueueFor(tenant: Tenant, ticket: TicketDTO, event: NotifyEvent, extra: Record<string, string | number> = {}) {
    const settings = tenantSettings(tenant);
    const cfg = settings.notifications.events[event];
    if (!cfg.enabled) return;
    const to = normalizePhone(ticket.customer?.phone as string | undefined, settings.notifications.countryCode);
    if (!to) return;
    const [branch] = await this.deps.db.select({ name: branches.name }).from(branches).where(eq(branches.id, ticket.branchId)).limit(1);
    const survey = event === 'finished' ? await this.surveyLink(tenant, ticket) : null;
    if (event === 'finished' && !survey && cfg.template.includes('{{survey}}')) return;
    const waiting = event === 'created' ? await this.waitingAhead(ticket) : 0;
    const vars: Record<string, string | number> = {
      code: ticket.code,
      service: ticket.service?.name ?? '',
      branch: branch?.name ?? '',
      counter: ticket.counter?.name ?? '',
      customer: String(ticket.customer?.name ?? '').split(' ')[0] ?? '',
      waiting,
      remaining: extra.remaining ?? '',
      link: `${this.base}/t/${ticket.publicToken}`,
      survey: survey ?? '',
      organization: tenant.name,
      ...extra,
    };
    const body = renderTemplate(cfg.template, vars).replace(/\s+/g, ' ').trim();
    const params = META_PARAMS[event].map((k) => String(vars[k] ?? ''));
    await this.deps.db
      .insert(notifyMessages)
      .values({ tenantId: tenant.id, ticketId: ticket.id, event, to, body, params })
      .onConflictDoNothing();
    setImmediate(() => void this.processDue());
  }

  private async waitingAhead(ticket: TicketDTO) {
    return countAhead(this.deps.db, ticket);
  }

  /** Envía los mensajes pendientes (con bloqueo para varias instancias) y programa reintentos. */
  async processDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.deps.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(notifyMessages)
          .where(and(eq(notifyMessages.status, 'pending'), lte(notifyMessages.nextAttemptAt, new Date())))
          .orderBy(asc(notifyMessages.createdAt))
          .limit(20)
          .for('update', { skipLocked: true });
        if (rows.length) {
          await tx
            .update(notifyMessages)
            .set({ nextAttemptAt: new Date(Date.now() + 2 * 60_000) })
            .where(inArray(notifyMessages.id, rows.map((r) => r.id)));
        }
        return rows;
      });
      for (const message of due) {
        const [tenant] = await this.deps.db.select().from(tenants).where(eq(tenants.id, message.tenantId)).limit(1);
        const { runtime } = tenant ? await this.resolve(tenant.id) : { runtime: null };
        if (!tenant || !runtime) {
          await this.deps.db.update(notifyMessages).set({ status: 'skipped', error: 'No hay un proveedor de avisos configurado' }).where(eq(notifyMessages.id, message.id));
          continue;
        }
        const settings = tenantSettings(tenant).notifications;
        const event = message.event as NotifyEvent;
        const metaTemplate = runtime.provider === 'meta' ? (settings.events[event]?.metaTemplate ?? '') : '';
        const attempts = message.attempts + 1;
        try {
          const ref = await deliver(runtime, { to: message.to, body: message.body, params: message.params, metaTemplate, metaLanguage: settings.metaLanguage });
          await this.deps.db
            .update(notifyMessages)
            .set({ status: 'sent', attempts, provider: runtime.provider, providerRef: ref, sentAt: new Date(), error: null })
            .where(eq(notifyMessages.id, message.id));
        } catch (error) {
          const exhausted = attempts >= MAX_ATTEMPTS;
          const code = (error as { code?: string }).code;
          await this.deps.db
            .update(notifyMessages)
            .set({
              status: exhausted ? 'failed' : 'pending',
              attempts,
              provider: runtime.provider,
              error: (code === 'EPRIVATE' ? PRIVATE_HINT : error instanceof Error ? error.message : 'Error').slice(0, 500),
              nextAttemptAt: exhausted ? null : new Date(Date.now() + RETRY_MINUTES[attempts - 1]! * 60_000),
            })
            .where(eq(notifyMessages.id, message.id));
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }
}
