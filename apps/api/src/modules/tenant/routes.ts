import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PLANS, RT, deepMerge, tenantSettingsSchema } from '@gc/shared';
import type { AppContext } from '../../context';
import { tenants } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { tenantSettings, toTenantDTO } from '../../lib/dto';
import { badRequest, notFound } from '../../lib/errors';
import { usageOf } from '../../lib/plans';
import { isValidTimezone } from '../../lib/tz';
import { rooms } from '../../realtime';

export const tenantRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Organización'];

  async function load(tenantId: string) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw notFound('Organización');
    return tenant;
  }

  app.get('/tenant', { preHandler: ctx.auth.require(), schema: { tags, summary: 'Datos y configuración de la organización' } }, async (request) =>
    toTenantDTO(await load(tenantIdOf(request))),
  );

  app.get('/tenant/usage', { preHandler: ctx.auth.require({ role: 'admin' }), schema: { tags, summary: 'Uso y límites del plan' } }, async (request) => {
    const tenant = await load(tenantIdOf(request));
    return { plan: tenant.plan, limits: PLANS[tenant.plan], usage: await usageOf(ctx.db, tenant.id) };
  });

  app.put(
    '/tenant',
    {
      preHandler: ctx.auth.require({ role: 'admin' }),
      schema: {
        tags,
        summary: 'Actualizar nombre y configuración (branding, terminología, turnos, campos del cliente)',
        description: 'La configuración se mezcla con la existente: solo envíe lo que quiere cambiar.',
        body: z.object({
          name: z.string().trim().min(2).max(120).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    },
    async (request) => {
      const tenant = await load(tenantIdOf(request));
      const patch: Partial<typeof tenants.$inferInsert> = {};
      if (request.body.name) patch.name = request.body.name;
      if (request.body.settings) {
        const merged = deepMerge(tenantSettings(tenant), request.body.settings);
        const parsed = tenantSettingsSchema.safeParse(merged);
        if (!parsed.success) throw badRequest('Configuración inválida', parsed.error.issues);
        if (!isValidTimezone(parsed.data.timezone)) throw badRequest('Zona horaria inválida');
        const keys = parsed.data.customerFields.map((f) => f.key);
        if (new Set(keys).size !== keys.length) throw badRequest('Hay campos del cliente con claves repetidas');
        patch.settings = parsed.data;
      }
      const [updated] = await ctx.db.update(tenants).set(patch).where(eq(tenants.id, tenant.id)).returning();
      ctx.rt.emit([rooms.tenant(tenant.id), rooms.devices(tenant.id)], RT.tenantSettings, {});
      return toTenantDTO(updated!);
    },
  );
};
