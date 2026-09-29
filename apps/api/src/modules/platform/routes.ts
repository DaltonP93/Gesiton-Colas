import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PLAN_IDS } from '@gc/shared';
import type { AppContext } from '../../context';
import { createTenantWithDefaults } from '../../db/seed';
import { tenants, users } from '../../db/schema';
import { toTenantDTO } from '../../lib/dto';
import { conflict, notFound } from '../../lib/errors';
import { idParam } from '../../lib/schemas';

export const platformRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Plataforma (superadmin)'];
  const superadmin = ctx.auth.require({ role: 'superadmin' });

  app.get('/platform/stats', { preHandler: superadmin, schema: { tags } }, async () => {
    const result = await ctx.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM tenants) AS tenants,
        (SELECT count(*)::int FROM tenants WHERE status = 'active') AS active_tenants,
        (SELECT count(*)::int FROM users WHERE tenant_id IS NOT NULL) AS users,
        (SELECT count(*)::int FROM tickets WHERE created_at > now() - interval '30 days') AS tickets_30d,
        (SELECT count(*)::int FROM displays) AS displays,
        (SELECT coalesce(sum(storage_bytes), 0)::bigint FROM tenants) AS storage_bytes`);
    const r = result.rows[0] as Record<string, unknown>;
    return {
      tenants: Number(r.tenants),
      activeTenants: Number(r.active_tenants),
      users: Number(r.users),
      tickets30d: Number(r.tickets_30d),
      displays: Number(r.displays),
      storageBytes: Number(r.storage_bytes),
    };
  });

  app.get(
    '/platform/tenants',
    { preHandler: superadmin, schema: { tags, querystring: z.object({ q: z.string().max(100).optional() }) } },
    async (request) => {
      const q = request.query.q?.trim();
      const rows = await ctx.db
        .select({
          tenant: tenants,
          users: sql<number>`(SELECT count(*)::int FROM users u WHERE u.tenant_id = ${tenants.id})`,
          branches: sql<number>`(SELECT count(*)::int FROM branches b WHERE b.tenant_id = ${tenants.id})`,
          displays: sql<number>`(SELECT count(*)::int FROM displays d WHERE d.tenant_id = ${tenants.id})`,
          tickets30d: sql<number>`(SELECT count(*)::int FROM tickets t WHERE t.tenant_id = ${tenants.id} AND t.created_at > now() - interval '30 days')`,
        })
        .from(tenants)
        .where(q ? sql`${tenants.name} ILIKE ${`%${q}%`} OR ${tenants.slug} ILIKE ${`%${q}%`}` : undefined)
        .orderBy(desc(tenants.createdAt))
        .limit(500);
      return rows.map((r) => ({
        ...toTenantDTO(r.tenant),
        storageBytes: r.tenant.storageBytes,
        usage: { users: r.users, branches: r.branches, displays: r.displays, tickets30d: r.tickets30d },
      }));
    },
  );

  app.post(
    '/platform/tenants',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Crear una organización con su administrador',
        body: z.object({
          organizationName: z.string().trim().min(2).max(120),
          adminName: z.string().trim().min(2).max(120),
          adminEmail: z.string().trim().toLowerCase().email(),
          adminPassword: z.string().min(8).max(200),
          plan: z.enum(PLAN_IDS).default('free'),
          timezone: z.string().max(64).optional(),
        }),
      },
    },
    async (request, reply) => {
      const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, request.body.adminEmail));
      if (exists) throw conflict('Ya existe un usuario con ese email');
      const { tenant } = await ctx.db.transaction((tx) => createTenantWithDefaults(tx, { ...request.body, emailVerified: true }));
      return reply.code(201).send(toTenantDTO(tenant));
    },
  );

  app.put(
    '/platform/tenants/:id',
    {
      preHandler: superadmin,
      schema: {
        tags,
        params: idParam,
        body: z.object({
          name: z.string().trim().min(2).max(120).optional(),
          plan: z.enum(PLAN_IDS).optional(),
          status: z.enum(['active', 'suspended']).optional(),
          /** `false` convierte una demo en organización definitiva. */
          isDemo: z.boolean().optional(),
          /** Extiende la demo N días (desde hoy o desde su vencimiento, lo que sea posterior). */
          extendDemoDays: z.number().int().min(1).max(365).optional(),
        }),
      },
    },
    async (request) => {
      const { isDemo, extendDemoDays, ...rest } = request.body;
      const [current] = await ctx.db.select().from(tenants).where(eq(tenants.id, request.params.id));
      if (!current) throw notFound('Organización');
      const patch: Partial<typeof tenants.$inferInsert> = { ...rest };
      if (isDemo === false) {
        patch.isDemo = false;
        patch.demoExpiresAt = null;
      }
      if (extendDemoDays && current.isDemo && isDemo !== false) {
        const from = Math.max(Date.now(), current.demoExpiresAt?.getTime() ?? 0);
        patch.demoExpiresAt = new Date(from + extendDemoDays * 24 * 3600 * 1000);
      }
      const [row] = await ctx.db.update(tenants).set(patch).where(eq(tenants.id, request.params.id)).returning();
      if (!row) throw notFound('Organización');
      if (request.body.status === 'suspended') ctx.refreshDevices(row.id);
      return toTenantDTO(row);
    },
  );
};
