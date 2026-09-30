import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { formatTicketCode, numberingPeriod, ticketNumberFor, type NumberingStatusDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { branches, branchServices, services, tenants, ticketSequences } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { tenantSettings } from '../../lib/dto';
import { notFound } from '../../lib/errors';
import { dayInTimezone } from '../../lib/tz';

/**
 * Estado y reinicio manual de la numeración de turnos. El contador vive en `ticket_sequences`
 * (uno por sucursal, servicio —o compartido— y período); reiniciar borra el del período actual.
 */
export const numberingRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Numeración de turnos'];
  const admin = ctx.auth.require({ role: 'admin' });

  async function context(tenantId: string, branchId?: string) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw notFound('Organización');
    const settings = tenantSettings(tenant);
    const branchRows = await ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), branchId ? eq(branches.id, branchId) : undefined));
    if (branchId && branchRows.length === 0) throw notFound('Sucursal');
    const periods = new Map(branchRows.map((b) => [b.id, numberingPeriod(dayInTimezone(new Date(), b.timezone ?? settings.timezone), settings.tickets.reset)]));
    return { settings, branchRows, periods };
  }

  app.get(
    '/numbering',
    {
      preHandler: admin,
      schema: { tags, summary: 'Último número emitido en el período actual, por sucursal y servicio', querystring: z.object({ branchId: z.uuid().optional() }) },
    },
    async (request): Promise<NumberingStatusDTO> => {
      const tenantId = tenantIdOf(request);
      const { settings, branchRows, periods } = await context(tenantId, request.query.branchId);
      const ids = branchRows.map((b) => b.id);
      const [sequences, offered] = ids.length
        ? await Promise.all([
            ctx.db.select().from(ticketSequences).where(and(eq(ticketSequences.tenantId, tenantId), inArray(ticketSequences.branchId, ids))),
            ctx.db
              .select({ branchId: branchServices.branchId, serviceId: services.id, name: services.name, prefix: branchServices.prefix, servicePrefix: services.prefix })
              .from(branchServices)
              .innerJoin(services, eq(services.id, branchServices.serviceId))
              .where(and(eq(branchServices.tenantId, tenantId), inArray(branchServices.branchId, ids), eq(branchServices.enabled, true), eq(services.active, true))),
          ])
        : [[], []];
      const t = settings.tickets;
      const rows = branchRows.flatMap((b) => {
        const period = periods.get(b.id)!;
        const scopes =
          t.scope === 'branch'
            ? [{ scopeKey: '*', label: 'Todos los servicios', prefix: '' }]
            : offered.filter((o) => o.branchId === b.id).map((o) => ({ scopeKey: o.serviceId, label: o.name, prefix: o.prefix ?? o.servicePrefix }));
        return scopes.map((scope) => {
          const counter = sequences.find((q) => q.branchId === b.id && q.scopeKey === scope.scopeKey && q.period === period)?.value ?? 0;
          const last = counter > 0 ? ticketNumberFor(counter, t) : null;
          return {
            branchId: b.id,
            branchName: b.name,
            scopeKey: scope.scopeKey,
            label: scope.label,
            issued: counter,
            lastCode: last === null ? null : formatTicketCode(scope.prefix, last, t.digits),
            nextCode: formatTicketCode(scope.prefix, ticketNumberFor(counter + 1, t), t.digits),
          };
        });
      });
      return { period: [...new Set(periods.values())].join(', '), settings: t, rows };
    },
  );

  app.post(
    '/numbering/reset',
    {
      preHandler: admin,
      schema: {
        tags,
        summary: 'Reiniciar la numeración ahora (el próximo turno vuelve al número inicial)',
        body: z.object({ branchId: z.uuid().optional() }),
      },
    },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const { branchRows, periods } = await context(tenantId, request.body.branchId);
      let reset = 0;
      for (const b of branchRows) {
        const deleted = await ctx.db
          .delete(ticketSequences)
          .where(and(eq(ticketSequences.tenantId, tenantId), eq(ticketSequences.branchId, b.id), eq(ticketSequences.period, periods.get(b.id)!)))
          .returning({ key: ticketSequences.scopeKey });
        reset += deleted.length;
      }
      request.log.info({ tenantId, branchId: request.body.branchId ?? 'todas', reset, by: request.auth?.kind === 'user' ? request.auth.userId : null }, 'numeración reiniciada');
      return { ok: true, reset };
    },
  );
};
