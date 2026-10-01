import { and, eq, inArray, sql } from 'drizzle-orm';
import { normalizePhone } from '@gc/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { notifyMessages, tenants, tickets } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { tenantSettings } from '../../lib/dto';

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
        description:
          'Los turnos se conservan para las estadísticas, pero sin nombre, documento, teléfono, email ni campos propios. También se borra el historial de avisos por WhatsApp/SMS de esa persona.',
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
      // El historial de avisos guarda el teléfono y el texto enviado (con el nombre).
      let messages = 0;
      if (updated.length) {
        const removed = await ctx.db
          .delete(notifyMessages)
          .where(and(eq(notifyMessages.tenantId, tenantId), inArray(notifyMessages.ticketId, updated.map((t) => t.id))))
          .returning({ id: notifyMessages.id });
        messages += removed.length;
      }
      if (field === 'phone') {
        const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
        const phone = tenant ? normalizePhone(value, tenantSettings(tenant).notifications.countryCode) : null;
        if (phone) {
          const removed = await ctx.db
            .delete(notifyMessages)
            .where(and(eq(notifyMessages.tenantId, tenantId), eq(notifyMessages.to, phone)))
            .returning({ id: notifyMessages.id });
          messages += removed.length;
        }
      }
      request.log.info({ tenantId, field, count: updated.length, messages, by: request.auth?.kind === 'user' ? request.auth.userId : 'api' }, 'datos personales borrados a pedido');
      return { ok: true, erased: updated.length, messages };
    },
  );
};
