import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { StatsSummaryDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { branches, tenants } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { tenantSettings } from '../../lib/dto';
import { badRequest, notFound } from '../../lib/errors';
import { dateOnly } from '../../lib/schemas';
import { dayInTimezone } from '../../lib/tz';

const rangeQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  branchId: z.uuid().optional(),
});

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Evita inyección de fórmulas al abrir el CSV en Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const reportRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Reportes'];
  const read = ctx.auth.require({ role: 'manager', scope: 'reports:read', module: 'reports' });

  async function scope(tenantId: string, query: z.infer<typeof rangeQuery>) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound('Organización');
    let timezone = tenantSettings(tenant).timezone;
    if (query.branchId) {
      const [branch] = await ctx.db
        .select()
        .from(branches)
        .where(and(eq(branches.id, query.branchId), eq(branches.tenantId, tenantId)));
      if (!branch) throw notFound('Sucursal');
      timezone = branch.timezone ?? timezone;
    }
    const today = dayInTimezone(new Date(), timezone);
    const from = query.from ?? today;
    const to = query.to ?? today;
    if (from > to) throw badRequest('El rango de fechas es inválido');
    const where = sql`t.tenant_id = ${tenantId} AND t.service_day BETWEEN ${from} AND ${to} ${
      query.branchId ? sql`AND t.branch_id = ${query.branchId}` : sql``
    }`;
    return { from, to, timezone, where };
  }

  app.get('/reports/summary', { preHandler: read, schema: { tags, summary: 'Indicadores de atención', querystring: rangeQuery } }, async (request): Promise<StatsSummaryDTO> => {
    const { from, to, timezone, where } = await scope(tenantIdOf(request), request.query);
    const [totals, byService, byAgent, byHour, byDay] = await Promise.all([
      ctx.db.execute(sql`
        SELECT
          count(*) FILTER (WHERE t.transferred_from_id IS NULL)::int AS issued,
          count(*) FILTER (WHERE t.status = 'finished')::int AS finished,
          count(*) FILTER (WHERE t.status = 'no_show')::int AS no_show,
          count(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled,
          count(*) FILTER (WHERE t.status = 'waiting')::int AS waiting,
          count(*) FILTER (WHERE t.status IN ('called', 'in_service'))::int AS in_service,
          avg(extract(epoch FROM t.called_at - t.created_at)) FILTER (WHERE t.called_at IS NOT NULL) AS avg_wait,
          avg(extract(epoch FROM t.finished_at - t.started_at)) FILTER (WHERE t.status = 'finished' AND t.started_at IS NOT NULL) AS avg_service
        FROM tickets t WHERE ${where}`),
      ctx.db.execute(sql`
        SELECT s.id, s.name, s.color,
          count(*) FILTER (WHERE t.transferred_from_id IS NULL)::int AS issued,
          count(*) FILTER (WHERE t.status = 'finished')::int AS finished,
          avg(extract(epoch FROM t.called_at - t.created_at)) FILTER (WHERE t.called_at IS NOT NULL) AS avg_wait,
          avg(extract(epoch FROM t.finished_at - t.started_at)) FILTER (WHERE t.status = 'finished' AND t.started_at IS NOT NULL) AS avg_service
        FROM tickets t JOIN services s ON s.id = t.service_id
        WHERE ${where} GROUP BY s.id ORDER BY issued DESC`),
      ctx.db.execute(sql`
        SELECT u.id, u.name, count(*)::int AS finished,
          avg(extract(epoch FROM t.finished_at - t.started_at)) FILTER (WHERE t.started_at IS NOT NULL) AS avg_service
        FROM tickets t JOIN users u ON u.id = t.agent_id
        WHERE ${where} AND t.status = 'finished' GROUP BY u.id ORDER BY finished DESC`),
      ctx.db.execute(sql`
        SELECT extract(hour FROM t.created_at AT TIME ZONE ${timezone})::int AS hour,
          count(*) FILTER (WHERE t.transferred_from_id IS NULL)::int AS issued,
          count(*) FILTER (WHERE t.status = 'finished')::int AS finished
        FROM tickets t WHERE ${where} GROUP BY 1 ORDER BY 1`),
      ctx.db.execute(sql`
        SELECT to_char(t.service_day, 'YYYY-MM-DD') AS day,
          count(*) FILTER (WHERE t.transferred_from_id IS NULL)::int AS issued,
          count(*) FILTER (WHERE t.status = 'finished')::int AS finished
        FROM tickets t WHERE ${where} GROUP BY 1 ORDER BY 1`),
    ]);
    const tt = totals.rows[0] as Record<string, unknown>;
    const hours = new Map((byHour.rows as { hour: number; issued: number; finished: number }[]).map((r) => [r.hour, r]));
    return {
      from,
      to,
      totals: {
        issued: Number(tt.issued ?? 0),
        finished: Number(tt.finished ?? 0),
        noShow: Number(tt.no_show ?? 0),
        cancelled: Number(tt.cancelled ?? 0),
        waiting: Number(tt.waiting ?? 0),
        inService: Number(tt.in_service ?? 0),
        avgWaitSeconds: num(tt.avg_wait),
        avgServiceSeconds: num(tt.avg_service),
      },
      byService: (byService.rows as Record<string, unknown>[]).map((r) => ({
        serviceId: String(r.id),
        name: String(r.name),
        color: String(r.color),
        issued: Number(r.issued),
        finished: Number(r.finished),
        avgWaitSeconds: num(r.avg_wait),
        avgServiceSeconds: num(r.avg_service),
      })),
      byAgent: (byAgent.rows as Record<string, unknown>[]).map((r) => ({
        agentId: String(r.id),
        name: String(r.name),
        finished: Number(r.finished),
        avgServiceSeconds: num(r.avg_service),
      })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        issued: hours.get(hour)?.issued ?? 0,
        finished: hours.get(hour)?.finished ?? 0,
      })),
      byDay: (byDay.rows as { day: string; issued: number; finished: number }[]).map((r) => ({ ...r })),
    };
  });

  app.get(
    '/reports/tickets.csv',
    { preHandler: read, schema: { tags, summary: 'Exportar turnos a CSV (Excel)', querystring: rangeQuery } },
    async (request, reply) => {
      const { from, to, timezone, where } = await scope(tenantIdOf(request), request.query);
      const rows = await ctx.db.execute(sql`
        SELECT t.code, t.status, t.channel, s.name AS service, p.name AS priority, b.name AS branch,
          c.name AS counter, u.name AS agent,
          t.customer->>'name' AS customer_name, t.customer->>'document' AS customer_document,
          t.customer->>'phone' AS customer_phone, t.customer->>'email' AS customer_email,
          to_char(t.created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
          to_char(t.called_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD HH24:MI:SS') AS called_at,
          to_char(t.started_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD HH24:MI:SS') AS started_at,
          to_char(t.finished_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD HH24:MI:SS') AS finished_at,
          round(extract(epoch FROM t.called_at - t.created_at))::int AS wait_seconds,
          round(extract(epoch FROM t.finished_at - t.started_at))::int AS service_seconds,
          t.notes
        FROM tickets t
        JOIN services s ON s.id = t.service_id
        JOIN priorities p ON p.id = t.priority_id
        JOIN branches b ON b.id = t.branch_id
        LEFT JOIN counters c ON c.id = t.counter_id
        LEFT JOIN users u ON u.id = t.agent_id
        WHERE ${where}
        ORDER BY t.created_at
        LIMIT 100000`);
      const headers = [
        'Código', 'Estado', 'Canal', 'Servicio', 'Prioridad', 'Sucursal', 'Puesto', 'Operador',
        'Cliente', 'Documento', 'Teléfono', 'Email', 'Emitido', 'Llamado', 'Inicio', 'Fin',
        'Espera (s)', 'Atención (s)', 'Notas',
      ];
      const keys = [
        'code', 'status', 'channel', 'service', 'priority', 'branch', 'counter', 'agent',
        'customer_name', 'customer_document', 'customer_phone', 'customer_email', 'created_at', 'called_at',
        'started_at', 'finished_at', 'wait_seconds', 'service_seconds', 'notes',
      ];
      const lines = [headers.map(csvCell).join(','), ...(rows.rows as Record<string, unknown>[]).map((r) => keys.map((k) => csvCell(r[k])).join(','))];
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="turnos_${from}_${to}.csv"`)
        .send(`﻿${lines.join('\r\n')}`);
    },
  );
};
