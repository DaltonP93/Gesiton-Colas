import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { OfflineDeviceDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { tenants } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { notFound } from '../../lib/errors';

/** Alertas de equipos: los desconectados y una alerta de prueba. */
export const alertRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Alertas'];

  app.get(
    '/devices/offline',
    { preHandler: ctx.auth.require({ role: 'manager' }), schema: { tags, summary: 'TVs y kioscos desconectados ahora' } },
    async (request): Promise<OfflineDeviceDTO[]> => ctx.devices.offline(tenantIdOf(request)),
  );

  app.post(
    '/alerts/devices/test',
    { preHandler: ctx.auth.require({ role: 'admin' }), config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags, summary: 'Enviar una alerta de prueba a los destinatarios' } },
    async (request) => {
      const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantIdOf(request)));
      if (!tenant) throw notFound('Organización');
      await ctx.devices.notify(tenant, [{ kind: 'display', name: 'Pantalla de prueba', branch: 'Sucursal de ejemplo', lastSeenAt: new Date(Date.now() - 6 * 60_000) }], []);
      return { ok: true, message: 'Enviamos una alerta de prueba a los destinatarios configurados.' };
    },
  );
};
