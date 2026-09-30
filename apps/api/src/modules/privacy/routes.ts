import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { tickets } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';

/** Derechos de los titulares de datos: borrar los datos personales de una persona en todos sus turnos. */
export const privacyRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Privacidad'];

  app.post(
    '/privacy/erase',
    {
      preHandler: ctx.auth.require({ role: 'admin' }),
      schema: {
        tags,
        summary: 'Borrar los datos personales de un cliente (por documento, teléfono o email)',
        description: 'Los turnos se conservan para las estadísticas, pero sin nombre, documento, teléfono, email ni campos propios.',
        body: z.object({
          field: z.enum(['document', 'phone', 'email']),
          value: z.string().trim().min(3).max(200),
        }),
      },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const { field, value } = request.body;
      const normalized = field === 'email' ? value.toLowerCase() : value.replace(/[\s.-]/g, '');
      const match =
        field === 'email'
          ? sql`lower(${tickets.customer}->>'email') = ${normalized}`
          : sql`regexp_replace(coalesce(${tickets.customer}->>${field}, ''), '[\\s.-]', '', 'g') = ${normalized}`;
      const updated = await ctx.db
        .update(tickets)
        .set({ customer: {} })
        .where(and(eq(tickets.tenantId, tenantId), match))
        .returning({ id: tickets.id });
      request.log.info({ tenantId, field, count: updated.length, by: request.auth?.kind === 'user' ? request.auth.userId : 'api' }, 'datos personales borrados a pedido');
      return { ok: true, erased: updated.length };
    },
  );
};
