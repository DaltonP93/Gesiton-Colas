import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { API_KEY_SCOPES, WEBHOOK_EVENTS } from '@gc/shared';
import type { AppContext } from '../../context';
import { apiKeys, tenants, webhookDeliveries, webhooks } from '../../db/schema';
import { API_KEY_PREFIX, tenantIdOf, userIdOf } from '../../lib/auth';
import { randomToken, sha256 } from '../../lib/crypto';
import { toApiKeyDTO, toWebhookDTO, toWebhookDeliveryDTO } from '../../lib/dto';
import { badRequest, notFound } from '../../lib/errors';
import { mailSettingsBody, mailStatus, mailTestBody, saveMailSettings, testMailSettings } from '../../lib/mailSettings';
import { assertPublicUrl } from '../../lib/net';
import { assertWithinLimit } from '../../lib/plans';
import { idParam, updateSchema } from '../../lib/schemas';

const webhookBody = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2048),
  /** Eventos suscritos (vacío = todos). */
  events: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
  active: z.boolean().default(true),
});

export const integrationRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const admin = ctx.auth.require({ role: 'admin' });

  async function assertUrl(url: string) {
    if (ctx.config.WEBHOOKS_ALLOW_PRIVATE) return;
    try {
      await assertPublicUrl(url);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'URL inválida');
    }
  }

  /* ------------------------------ API keys ---------------------------- */
  const ktags = ['Integraciones: API keys'];

  app.get('/api-keys', { preHandler: admin, schema: { tags: ktags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantIdOf(request)))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toApiKeyDTO);
  });

  app.post(
    '/api-keys',
    {
      preHandler: admin,
      schema: {
        tags: ktags,
        summary: 'Crear API key (la clave completa se muestra una sola vez)',
        body: z.object({ name: z.string().trim().min(1).max(120), scopes: z.array(z.enum(API_KEY_SCOPES)).min(1) }),
      },
    },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      await assertWithinLimit(ctx.db, tenantId, 'apiKeys');
      const prefix = randomToken(8);
      const key = `${API_KEY_PREFIX}${prefix}_${randomToken(32)}`;
      const [row] = await ctx.db
        .insert(apiKeys)
        .values({
          tenantId,
          name: request.body.name,
          prefix: `${API_KEY_PREFIX}${prefix}`,
          keyHash: sha256(key),
          scopes: [...new Set(request.body.scopes)],
          createdBy: userIdOf(request),
        })
        .returning();
      return reply.code(201).send({ ...toApiKeyDTO(row!), key });
    },
  );

  app.delete('/api-keys/:id', { preHandler: admin, schema: { tags: ktags, summary: 'Revocar API key', params: idParam } }, async (request, reply) => {
    const [row] = await ctx.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, request.params.id), eq(apiKeys.tenantId, tenantIdOf(request)), isNull(apiKeys.revokedAt)))
      .returning();
    if (!row) throw notFound('API key');
    return reply.code(204).send();
  });

  /* ------------------------------ Webhooks ---------------------------- */
  const wtags = ['Integraciones: webhooks'];

  async function load(tenantId: string, id: string) {
    const [row] = await ctx.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
    if (!row) throw notFound('Webhook');
    return row;
  }

  app.get('/webhooks', { preHandler: admin, schema: { tags: wtags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.tenantId, tenantIdOf(request)))
      .orderBy(desc(webhooks.createdAt));
    return rows.map(toWebhookDTO);
  });

  app.post(
    '/webhooks',
    { preHandler: admin, schema: { tags: wtags, summary: 'Crear webhook (el secreto de firma se muestra una sola vez)', body: webhookBody } },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      await assertUrl(request.body.url);
      await assertWithinLimit(ctx.db, tenantId, 'webhooks');
      const secret = `whsec_${randomToken(32)}`;
      const [row] = await ctx.db
        .insert(webhooks)
        .values({ ...request.body, tenantId, secret })
        .returning();
      return reply.code(201).send({ ...toWebhookDTO(row!), secret });
    },
  );

  app.put('/webhooks/:id', { preHandler: admin, schema: { tags: wtags, params: idParam, body: updateSchema(webhookBody) } }, async (request) => {
    const tenantId = tenantIdOf(request);
    await load(tenantId, request.params.id);
    if (request.body.url) await assertUrl(request.body.url);
    const [row] = await ctx.db.update(webhooks).set(request.body).where(eq(webhooks.id, request.params.id)).returning();
    return toWebhookDTO(row!);
  });

  app.post('/webhooks/:id/rotate-secret', { preHandler: admin, schema: { tags: wtags, params: idParam } }, async (request) => {
    const tenantId = tenantIdOf(request);
    await load(tenantId, request.params.id);
    const secret = `whsec_${randomToken(32)}`;
    const [row] = await ctx.db.update(webhooks).set({ secret }).where(eq(webhooks.id, request.params.id)).returning();
    return { ...toWebhookDTO(row!), secret };
  });

  app.delete('/webhooks/:id', { preHandler: admin, schema: { tags: wtags, params: idParam } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    await load(tenantId, request.params.id);
    await ctx.db.delete(webhooks).where(eq(webhooks.id, request.params.id));
    return reply.code(204).send();
  });

  app.post('/webhooks/:id/test', { preHandler: admin, schema: { tags: wtags, summary: 'Enviar un evento de prueba (ping)', params: idParam } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const webhook = await load(tenantId, request.params.id);
    return ctx.webhooks.send(webhook, {
      id: randomUUID(),
      event: 'ping',
      createdAt: new Date().toISOString(),
      tenantId,
      data: { message: 'Webhook configurado correctamente' },
    });
  });

  app.get('/webhooks/:id/deliveries', { preHandler: admin, schema: { tags: wtags, params: idParam } }, async (request) => {
    const tenantId = tenantIdOf(request);
    await load(tenantId, request.params.id);
    const rows = await ctx.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, request.params.id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100);
    return rows.map(toWebhookDeliveryDTO);
  });

  app.post(
    '/webhooks/deliveries/:id/retry',
    { preHandler: admin, schema: { tags: wtags, summary: 'Reintentar una entrega', params: idParam } },
    async (request) => {
      const [row] = await ctx.db
        .update(webhookDeliveries)
        .set({ status: 'pending', nextAttemptAt: new Date(), attempts: 0 })
        .where(and(eq(webhookDeliveries.id, request.params.id), eq(webhookDeliveries.tenantId, tenantIdOf(request))))
        .returning();
      if (!row) throw notFound('Entrega');
      await ctx.webhooks.processDue();
      const [updated] = await ctx.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, row.id));
      return toWebhookDeliveryDTO(updated!);
    },
  );

  /* ------------------------ Correo saliente (SMTP) -------------------- */
  const mtags = ['Integraciones: correo saliente'];

  app.get(
    '/mail-settings',
    { preHandler: admin, schema: { tags: mtags, summary: 'Servidor de correo propio de la organización y el que se usa hoy' } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      return mailStatus(ctx, tenantId, tenantId);
    },
  );

  app.put(
    '/mail-settings',
    {
      preHandler: admin,
      schema: {
        tags: mtags,
        summary: 'Guardar el servidor de correo propio',
        description: 'Las invitaciones, códigos de acceso y recuperaciones de contraseña de la organización salen por este servidor. Desactivado = se usa el de la plataforma.',
        body: mailSettingsBody,
      },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      return saveMailSettings(ctx, tenantId, tenantId, request.body);
    },
  );

  app.post(
    '/mail-settings/test',
    {
      preHandler: admin,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: mtags, summary: 'Probar el servidor de correo enviando un mensaje', body: mailTestBody },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
      return testMailSettings(ctx, tenantId, request.body, await ctx.emailBrand(tenant));
    },
  );
};
