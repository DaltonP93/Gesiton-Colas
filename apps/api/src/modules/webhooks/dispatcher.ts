import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { WebhookEvent } from '@gc/shared';
import type { Database } from '../../db/client';
import { webhookDeliveries, webhooks, type Webhook, type WebhookDelivery } from '../../db/schema';
import { hmacSha256 } from '../../lib/crypto';
import { outboundRequest } from '../../lib/net';

/** Espera entre reintentos (segundos): 30s, 2m, 10m, 1h, 6h. */
const BACKOFF = [30, 120, 600, 3600, 21_600];
const MAX_ATTEMPTS = BACKOFF.length + 1;
const TIMEOUT_MS = 10_000;

export interface WebhookPayload {
  id: string;
  event: WebhookEvent | 'ping';
  createdAt: string;
  tenantId: string;
  data: unknown;
}

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/**
 * Envía eventos a sistemas externos (ERP, CRM, WhatsApp, Zapier, n8n, Make...).
 * Cada entrega se guarda, se firma con HMAC-SHA256 y se reintenta con backoff exponencial.
 */
export class WebhookDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
    private readonly allowPrivate: boolean,
    /** Si devuelve `false` la organización no envía webhooks (módulo de integraciones apagado). */
    private readonly enabledFor: (tenantId: string) => Promise<boolean> = async () => true,
  ) {}

  start(intervalMs = 10_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.processDue(), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatch(tenantId: string, event: WebhookEvent, data: unknown) {
    if (!(await this.enabledFor(tenantId))) return 0;
    const targets = await this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.tenantId, tenantId), eq(webhooks.active, true)));
    const subscribed = targets.filter((w) => w.events.length === 0 || w.events.includes(event));
    if (subscribed.length === 0) return 0;
    const createdAt = new Date().toISOString();
    await this.db.insert(webhookDeliveries).values(
      subscribed.map((w) => {
        const id = randomUUID();
        const payload: WebhookPayload = { id, event, createdAt, tenantId, data };
        return { id, tenantId, webhookId: w.id, event, payload: payload as unknown as Record<string, unknown> };
      }),
    );
    setImmediate(() => void this.processDue());
    return subscribed.length;
  }

  /** Toma entregas pendientes (con bloqueo para múltiples instancias) y las envía. */
  async processDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.db.execute<{ id: string }>(sql`
        UPDATE webhook_deliveries SET attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
        WHERE id IN (
          SELECT id FROM webhook_deliveries
          WHERE status = 'pending' AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          LIMIT 25
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`);
      const ids = claimed.rows.map((r) => r.id);
      for (const id of ids) {
        const [row] = await this.db
          .select({ delivery: webhookDeliveries, webhook: webhooks })
          .from(webhookDeliveries)
          .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
          .where(eq(webhookDeliveries.id, id));
        if (row) await this.attempt(row.delivery, row.webhook);
      }
      return ids.length;
    } catch (error) {
      this.log.error({ err: error }, 'webhooks: error procesando entregas');
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async attempt(delivery: WebhookDelivery, webhook: Webhook) {
    const result = await this.send(webhook, delivery.payload as unknown as WebhookPayload);
    if (result.ok) {
      await this.db
        .update(webhookDeliveries)
        .set({ status: 'success', responseStatus: result.status, error: null, deliveredAt: new Date(), nextAttemptAt: null })
        .where(eq(webhookDeliveries.id, delivery.id));
      return;
    }
    const exhausted = delivery.attempts >= MAX_ATTEMPTS;
    const wait = BACKOFF[Math.min(delivery.attempts - 1, BACKOFF.length - 1)]!;
    await this.db
      .update(webhookDeliveries)
      .set({
        status: exhausted ? 'failed' : 'pending',
        responseStatus: result.status,
        error: result.error,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + wait * 1000),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  }

  /** Envía un payload firmado. Cabeceras: X-GC-Event, X-GC-Delivery, X-GC-Timestamp, X-GC-Signature. */
  async send(webhook: Pick<Webhook, 'url' | 'secret'>, payload: WebhookPayload): Promise<DeliveryResult> {
    try {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = hmacSha256(webhook.secret, `${timestamp}.${body}`);
      // La IP se valida al conectar (no solo al guardar), así un cambio de DNS no llega a la red interna.
      const response = await outboundRequest(webhook.url, {
        method: 'POST',
        timeoutMs: TIMEOUT_MS,
        allowPrivate: this.allowPrivate,
        maxBytes: 4096,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'GestionColas-Webhooks/3.0',
          'x-gc-event': payload.event,
          'x-gc-delivery': payload.id,
          'x-gc-timestamp': timestamp,
          'x-gc-signature': `sha256=${signature}`,
        },
        body,
      });
      const ok = response.status >= 200 && response.status < 300;
      return { ok, status: response.status, error: ok ? null : `HTTP ${response.status}` };
    } catch (error) {
      const code = (error as { code?: string }).code;
      // A las organizaciones no se les devuelven detalles internos de la conexión.
      const message = code === 'EPRIVATE' ? 'La URL apunta a una dirección privada' : error instanceof Error ? error.message.slice(0, 200) : 'Error desconocido';
      return { ok: false, status: null, error: message };
    }
  }
}
