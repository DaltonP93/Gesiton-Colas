import { and, count, desc, eq, inArray, max, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  FACE_LABELS,
  npsOf,
  scoreAnswers,
  surveyAnswersSchema,
  surveyBodySchema,
  validateAnswers,
  type PublicSurveyDTO,
  type PublicSurveyStatus,
  type SurveyDTO,
  type SurveyGroupStat,
  type SurveyQuestion,
  type SurveyQuestionStat,
  type SurveyResultsDTO,
} from '@gc/shared';
import type { AppContext } from '../../context';
import { branches, counters, services, surveyResponses, surveys, tenants, tickets, type Survey, type Tenant } from '../../db/schema';
import { assertModuleActive, assertTenantAvailable, tenantIdOf } from '../../lib/auth';
import { randomToken } from '../../lib/crypto';
import { tenantSettings, toPublicTenantDTO } from '../../lib/dto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { dateOnly, idParam } from '../../lib/schemas';
import { surveyForTicket, toSurveyDTO } from '../../lib/surveys';
import { dayInTimezone } from '../../lib/tz';

const resultsQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  surveyId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  agentId: z.uuid().optional(),
});
type ResultsQuery = z.infer<typeof resultsQuery>;

const tokenParam = z.object({ token: z.string().min(10).max(64) });

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = Array.isArray(value) ? value.join(' | ') : typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const round1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

export const surveyRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Encuestas'];
  const read = ctx.auth.require({ role: 'manager', scope: 'reports:read', module: 'surveys' });
  const write = ctx.auth.require({ role: 'admin', module: 'surveys' });

  /** Solo servicios y sucursales de la organización. */
  async function ownIds(tenantId: string, serviceIds: string[], branchIds: string[]) {
    const [svc, br] = await Promise.all([
      serviceIds.length ? ctx.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, serviceIds))) : [],
      branchIds.length ? ctx.db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), inArray(branches.id, branchIds))) : [],
    ]);
    return { serviceIds: svc.map((s) => s.id), branchIds: br.map((b) => b.id) };
  }

  async function ownSurvey(tenantId: string, id: string) {
    const [row] = await ctx.db.select().from(surveys).where(and(eq(surveys.id, id), eq(surveys.tenantId, tenantId)));
    if (!row) throw notFound('Encuesta');
    return row;
  }

  /* ------------------------------ Encuestas ----------------------------- */

  app.get('/surveys', { preHandler: read, schema: { tags, summary: 'Encuestas de la organización' } }, async (request): Promise<SurveyDTO[]> => {
    const tenantId = tenantIdOf(request);
    const [rows, stats] = await Promise.all([
      ctx.db.select().from(surveys).where(eq(surveys.tenantId, tenantId)).orderBy(desc(surveys.active), desc(surveys.updatedAt)),
      ctx.db
        .select({ surveyId: surveyResponses.surveyId, responses: count(), last: max(surveyResponses.createdAt) })
        .from(surveyResponses)
        .where(eq(surveyResponses.tenantId, tenantId))
        .groupBy(surveyResponses.surveyId),
    ]);
    const bySurvey = new Map(stats.map((s) => [s.surveyId, s]));
    return rows.map((r) => {
      const s = bySurvey.get(r.id);
      return toSurveyDTO(r, { responses: s?.responses ?? 0, lastResponseAt: s?.last ?? null });
    });
  });

  app.post('/surveys', { preHandler: write, schema: { tags, summary: 'Crear una encuesta', body: surveyBodySchema } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    const scope = await ownIds(tenantId, request.body.serviceIds, request.body.branchIds);
    const [row] = await ctx.db
      .insert(surveys)
      .values({ ...request.body, ...scope, tenantId, publicToken: randomToken(20) })
      .returning();
    reply.code(201);
    return toSurveyDTO(row!);
  });

  app.put('/surveys/:id', { preHandler: write, schema: { tags, summary: 'Modificar una encuesta', params: idParam, body: surveyBodySchema } }, async (request) => {
    const tenantId = tenantIdOf(request);
    await ownSurvey(tenantId, request.params.id);
    const scope = await ownIds(tenantId, request.body.serviceIds, request.body.branchIds);
    const [row] = await ctx.db
      .update(surveys)
      .set({ ...request.body, ...scope, updatedAt: new Date() })
      .where(and(eq(surveys.id, request.params.id), eq(surveys.tenantId, tenantId)))
      .returning();
    return toSurveyDTO(row!);
  });

  app.delete('/surveys/:id', { preHandler: write, schema: { tags, summary: 'Eliminar una encuesta y sus respuestas', params: idParam } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    await ownSurvey(tenantId, request.params.id);
    await ctx.db.delete(surveys).where(and(eq(surveys.id, request.params.id), eq(surveys.tenantId, tenantId)));
    return reply.code(204).send();
  });

  /* ------------------------------ Métricas ------------------------------ */

  async function scope(tenantId: string, query: ResultsQuery) {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound('Organización');
    let timezone = tenantSettings(tenant).timezone;
    if (query.branchId) {
      const [branch] = await ctx.db.select().from(branches).where(and(eq(branches.id, query.branchId), eq(branches.tenantId, tenantId)));
      if (!branch) throw notFound('Sucursal');
      timezone = branch.timezone ?? timezone;
    }
    const survey = query.surveyId ? await ownSurvey(tenantId, query.surveyId) : null;
    const today = dayInTimezone(new Date(), timezone);
    const from = query.from ?? today;
    const to = query.to ?? today;
    if (from > to) throw badRequest('El rango de fechas es inválido');
    const filters: SQL[] = [sql`r.tenant_id = ${tenantId}`, sql`(r.created_at AT TIME ZONE ${timezone})::date BETWEEN ${from} AND ${to}`];
    if (survey) filters.push(sql`r.survey_id = ${survey.id}`);
    if (query.branchId) filters.push(sql`r.branch_id = ${query.branchId}`);
    if (query.serviceId) filters.push(sql`r.service_id = ${query.serviceId}`);
    if (query.agentId) filters.push(sql`r.agent_id = ${query.agentId}`);
    const ticketFilters: SQL[] = [sql`t.tenant_id = ${tenantId}`, sql`t.status = 'finished'`, sql`t.service_day BETWEEN ${from} AND ${to}`];
    if (query.branchId) ticketFilters.push(sql`t.branch_id = ${query.branchId}`);
    if (query.serviceId) ticketFilters.push(sql`t.service_id = ${query.serviceId}`);
    if (query.agentId) ticketFilters.push(sql`t.agent_id = ${query.agentId}`);
    if (survey?.serviceIds.length) ticketFilters.push(sql`t.service_id IN (${sql.join(survey.serviceIds.map((id) => sql`${id}`), sql`, `)})`);
    if (survey?.branchIds.length) ticketFilters.push(sql`t.branch_id IN (${sql.join(survey.branchIds.map((id) => sql`${id}`), sql`, `)})`);
    return { from, to, timezone, survey, where: sql.join(filters, sql` AND `), ticketWhere: sql.join(ticketFilters, sql` AND `) };
  }

  const AGG = sql`
    count(*)::int AS responses,
    count(r.nps)::int AS nps_n,
    count(*) FILTER (WHERE r.nps >= 9)::int AS promoters,
    count(*) FILTER (WHERE r.nps BETWEEN 7 AND 8)::int AS passives,
    count(*) FILTER (WHERE r.nps <= 6)::int AS detractors,
    count(r.rating)::int AS rating_n,
    avg(r.rating)::float AS rating_avg,
    count(*) FILTER (WHERE r.rating >= 4)::int AS satisfied`;

  type AggRow = { responses: number; nps_n: number; promoters: number; passives: number; detractors: number; rating_n: number; rating_avg: number | null; satisfied: number };
  const group = (row: AggRow & { id: string | null; name: string | null; color?: string | null }): SurveyGroupStat => ({
    id: row.id ?? 'none',
    name: row.name ?? 'Sin dato',
    color: row.color ?? null,
    responses: row.responses,
    nps: npsOf(row.promoters, row.detractors, row.nps_n),
    csat: row.rating_n ? row.satisfied / row.rating_n : null,
    ratingAvg: round1(row.rating_avg),
  });

  function questionStats(questions: SurveyQuestion[], rows: { answers: Record<string, unknown> }[]): SurveyQuestionStat[] {
    return questions.map((q) => {
      const values = rows.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== null && v !== '');
      const tally = (labels: string[], key: (v: unknown) => string[]) => {
        const counts = new Map(labels.map((l) => [l, 0]));
        for (const v of values) for (const k of key(v)) if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
        return [...counts].map(([label, c]) => ({ label, count: c }));
      };
      const numeric = values.filter((v): v is number => typeof v === 'number');
      const average = ['nps', 'rating', 'faces'].includes(q.type) && numeric.length ? round1(numeric.reduce((a, b) => a + b, 0) / numeric.length) : null;
      let distribution: SurveyQuestionStat['distribution'] = [];
      if (q.type === 'nps') distribution = tally(Array.from({ length: 11 }, (_, i) => String(i)), (v) => [String(v)]);
      else if (q.type === 'rating') distribution = tally(['1', '2', '3', '4', '5'], (v) => [String(v)]);
      else if (q.type === 'faces') distribution = tally([...FACE_LABELS], (v) => [FACE_LABELS[Number(v) - 1] ?? '']);
      else if (q.type === 'choice') distribution = tally(q.options, (v) => [String(v)]);
      else if (q.type === 'multi') distribution = tally(q.options, (v) => (Array.isArray(v) ? v.map(String) : []));
      else if (q.type === 'yesno') distribution = tally(['Sí', 'No'], (v) => [v === true ? 'Sí' : 'No']);
      return { id: q.id, title: q.title, type: q.type, responses: values.length, average, distribution };
    });
  }

  app.get(
    '/surveys/results',
    { preHandler: read, schema: { tags, summary: 'Métricas de satisfacción: NPS, CSAT, por servicio, operador y sucursal', querystring: resultsQuery } },
    async (request): Promise<SurveyResultsDTO> => {
      const tenantId = tenantIdOf(request);
      const { from, to, timezone, survey, where, ticketWhere } = await scope(tenantId, request.query);
      const [totals, finished, byDay, byService, byAgent, byBranch, comments, answerRows] = await Promise.all([
        ctx.db.execute<AggRow & { ticket_responses: number; comments: number }>(sql`
          SELECT ${AGG}, count(r.ticket_id)::int AS ticket_responses, count(r.comment)::int AS comments
          FROM survey_responses r WHERE ${where}`),
        ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tickets t WHERE ${ticketWhere}`),
        ctx.db.execute<AggRow & { day: string }>(sql`
          SELECT to_char((r.created_at AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS day, ${AGG}
          FROM survey_responses r WHERE ${where} GROUP BY 1 ORDER BY 1`),
        ctx.db.execute<AggRow & { id: string | null; name: string | null; color: string | null }>(sql`
          SELECT s.id, s.name, s.color, ${AGG} FROM survey_responses r LEFT JOIN services s ON s.id = r.service_id
          WHERE ${where} GROUP BY s.id, s.name, s.color ORDER BY responses DESC`),
        ctx.db.execute<AggRow & { id: string | null; name: string | null }>(sql`
          SELECT u.id, u.name, ${AGG} FROM survey_responses r LEFT JOIN users u ON u.id = r.agent_id
          WHERE ${where} GROUP BY u.id, u.name ORDER BY responses DESC`),
        ctx.db.execute<AggRow & { id: string | null; name: string | null }>(sql`
          SELECT b.id, b.name, ${AGG} FROM survey_responses r LEFT JOIN branches b ON b.id = r.branch_id
          WHERE ${where} GROUP BY b.id, b.name ORDER BY responses DESC`),
        ctx.db.execute<{ id: string; created_at: Date; comment: string; rating: number | null; nps: number | null; code: string | null; service: string | null; agent: string | null; branch: string | null }>(sql`
          SELECT r.id, r.created_at, r.comment, r.rating, r.nps, t.code, s.name AS service, u.name AS agent, b.name AS branch
          FROM survey_responses r
          LEFT JOIN tickets t ON t.id = r.ticket_id
          LEFT JOIN services s ON s.id = r.service_id
          LEFT JOIN users u ON u.id = r.agent_id
          LEFT JOIN branches b ON b.id = r.branch_id
          WHERE ${where} AND r.comment IS NOT NULL ORDER BY r.created_at DESC LIMIT 50`),
        survey ? ctx.db.execute<{ answers: Record<string, unknown> }>(sql`SELECT r.answers FROM survey_responses r WHERE ${where} LIMIT 50000`) : null,
      ]);
      const t = totals.rows[0]!;
      const done = finished.rows[0]?.n ?? 0;
      return {
        from,
        to,
        totals: {
          responses: t.responses,
          finished: done,
          responseRate: done ? Math.min(1, t.ticket_responses / done) : null,
          nps: npsOf(t.promoters, t.detractors, t.nps_n),
          promoters: t.promoters,
          passives: t.passives,
          detractors: t.detractors,
          npsResponses: t.nps_n,
          csat: t.rating_n ? t.satisfied / t.rating_n : null,
          ratingAvg: round1(t.rating_avg),
          ratingResponses: t.rating_n,
          comments: t.comments,
        },
        byDay: byDay.rows.map((d) => ({ day: d.day, responses: d.responses, nps: npsOf(d.promoters, d.detractors, d.nps_n), ratingAvg: round1(d.rating_avg) })),
        byService: byService.rows.map(group),
        byAgent: byAgent.rows.map(group),
        byBranch: byBranch.rows.map(group),
        questions: survey && answerRows ? questionStats(survey.questions, answerRows.rows) : [],
        comments: comments.rows.map((c) => ({
          id: c.id,
          createdAt: new Date(c.created_at).toISOString(),
          comment: c.comment,
          rating: c.rating,
          nps: c.nps,
          ticketCode: c.code,
          service: c.service,
          agent: c.agent,
          branch: c.branch,
        })),
      };
    },
  );

  app.get(
    '/surveys/responses.csv',
    { preHandler: read, schema: { tags, summary: 'Exportar las respuestas (CSV)', querystring: resultsQuery } },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      const { from, to, timezone, survey, where } = await scope(tenantId, request.query);
      const rows = await ctx.db.execute<{
        created_at: Date;
        survey: string;
        code: string | null;
        branch: string | null;
        service: string | null;
        agent: string | null;
        counter: string | null;
        channel: string;
        nps: number | null;
        rating: number | null;
        comment: string | null;
        answers: Record<string, unknown>;
      }>(sql`
        SELECT r.created_at, sv.name AS survey, t.code, b.name AS branch, s.name AS service, u.name AS agent, c.name AS counter,
               r.channel, r.nps, r.rating, r.comment, r.answers
        FROM survey_responses r
        JOIN surveys sv ON sv.id = r.survey_id
        LEFT JOIN tickets t ON t.id = r.ticket_id
        LEFT JOIN branches b ON b.id = r.branch_id
        LEFT JOIN services s ON s.id = r.service_id
        LEFT JOIN users u ON u.id = r.agent_id
        LEFT JOIN counters c ON c.id = r.counter_id
        WHERE ${where} ORDER BY r.created_at LIMIT 100000`);
      const questions = survey?.questions ?? [];
      const header = ['Fecha', 'Encuesta', 'Turno', 'Sucursal', 'Servicio', 'Operador', 'Puesto', 'Origen', 'Recomendación (0-10)', 'Calificación (1-5)', 'Comentario', ...questions.map((q) => q.title)];
      const fmt = new Intl.DateTimeFormat('es', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
      const lines = rows.rows.map((r) =>
        [
          fmt.format(new Date(r.created_at)),
          r.survey,
          r.code,
          r.branch,
          r.service,
          r.agent,
          r.counter,
          r.channel === 'link' ? 'Enlace general' : 'Turno',
          r.nps,
          r.rating,
          r.comment,
          ...questions.map((q) => (q.type === 'faces' && typeof r.answers[q.id] === 'number' ? FACE_LABELS[(r.answers[q.id] as number) - 1] : r.answers[q.id])),
        ]
          .map(csvCell)
          .join(','),
      );
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="encuestas-${from}-a-${to}.csv"`);
      return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}`;
    },
  );

  /* ------------------------------ Público ------------------------------- */

  async function tenantFor(tenantId: string): Promise<Tenant> {
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw notFound('Encuesta');
    assertTenantAvailable(tenant);
    await assertModuleActive(ctx.modulesOf, tenant, 'surveys');
    return tenant;
  }

  const publicSurvey = (s: Survey): PublicSurveyDTO['survey'] => ({ title: s.title, intro: s.intro, thanks: s.thanks, questions: s.questions });

  /** Encuesta del turno y su estado. */
  async function ticketSurvey(token: string) {
    const [ticket] = await ctx.db.select().from(tickets).where(eq(tickets.publicToken, token)).limit(1);
    if (!ticket) throw notFound('Encuesta');
    const tenant = await tenantFor(ticket.tenantId);
    const survey = await surveyForTicket(ctx.db, tenant.id, ticket);
    if (!survey) throw notFound('Encuesta');
    const [answered] = await ctx.db.select({ id: surveyResponses.id }).from(surveyResponses).where(eq(surveyResponses.ticketId, ticket.id)).limit(1);
    let status: PublicSurveyStatus = 'open';
    if (answered) status = 'answered';
    else if (ticket.status !== 'finished') status = 'not_ready';
    else if (ticket.finishedAt && ticket.finishedAt.getTime() + survey.expiresDays * 86_400_000 < Date.now()) status = 'expired';
    return { ticket, tenant, survey, status };
  }

  const submitBody = z.object({ answers: surveyAnswersSchema });

  async function saveResponse(tenant: Tenant, survey: Survey, answers: z.infer<typeof surveyAnswersSchema>, from: { ticket?: typeof tickets.$inferSelect; branchId?: string | null }) {
    const checked = validateAnswers(survey.questions, answers);
    if (!checked.ok) throw badRequest(checked.error);
    const scores = scoreAnswers(survey.questions, checked.answers);
    const t = from.ticket;
    const [row] = await ctx.db
      .insert(surveyResponses)
      .values({
        tenantId: tenant.id,
        surveyId: survey.id,
        ticketId: t?.id ?? null,
        branchId: t?.branchId ?? from.branchId ?? null,
        serviceId: t?.serviceId ?? null,
        agentId: t?.agentId ?? null,
        counterId: t?.counterId ?? null,
        channel: t ? 'ticket' : 'link',
        answers: checked.answers,
        ...scores,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('Esta encuesta ya fue respondida. ¡Gracias!');
    void ctx.webhooks
      .dispatch(tenant.id, 'survey.answered', {
        survey: { id: survey.id, name: survey.name },
        response: { id: row.id, channel: row.channel, nps: row.nps, rating: row.rating, comment: row.comment, answers: row.answers, createdAt: row.createdAt.toISOString() },
        ticket: t ? { id: t.id, code: t.code, branchId: t.branchId, serviceId: t.serviceId, agentId: t.agentId } : null,
      })
      .catch((error) => ctx.log.error({ err: error }, 'webhooks: encuesta'));
    return { ok: true, thanks: survey.thanks };
  }

  app.get(
    '/public/surveys/t/:token',
    { schema: { tags, summary: 'Encuesta de un turno (enlace que recibe el cliente)', params: tokenParam, security: [] } },
    async (request): Promise<PublicSurveyDTO> => {
      const { ticket, tenant, survey, status } = await ticketSurvey(request.params.token);
      const [[service], [branch], [counter]] = await Promise.all([
        ctx.db.select({ name: services.name }).from(services).where(eq(services.id, ticket.serviceId)),
        ctx.db.select({ name: branches.name }).from(branches).where(eq(branches.id, ticket.branchId)),
        ticket.counterId ? ctx.db.select({ name: counters.name }).from(counters).where(eq(counters.id, ticket.counterId)) : Promise.resolve([]),
      ]);
      return {
        status,
        survey: publicSurvey(survey),
        tenant: toPublicTenantDTO(tenant),
        ticket: { code: ticket.code, service: service?.name ?? '', branch: branch?.name ?? '', counter: counter?.name ?? null },
      };
    },
  );

  app.post(
    '/public/surveys/t/:token',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags, summary: 'Responder la encuesta de un turno', params: tokenParam, body: submitBody, security: [] } },
    async (request) => {
      const { ticket, tenant, survey, status } = await ticketSurvey(request.params.token);
      if (status === 'answered') throw conflict('Esta encuesta ya fue respondida. ¡Gracias!');
      if (status === 'not_ready') throw badRequest('La encuesta se habilita al terminar la atención');
      if (status === 'expired') throw badRequest('El plazo para responder esta encuesta venció');
      return saveResponse(tenant, survey, request.body.answers, { ticket });
    },
  );

  async function linkSurvey(token: string) {
    const [survey] = await ctx.db.select().from(surveys).where(eq(surveys.publicToken, token)).limit(1);
    if (!survey || !survey.active || !survey.allowAnonymous) throw notFound('Encuesta');
    return { survey, tenant: await tenantFor(survey.tenantId) };
  }

  app.get(
    '/public/surveys/s/:token',
    { schema: { tags, summary: 'Encuesta por enlace general o QR (sin turno)', params: tokenParam, security: [] } },
    async (request): Promise<PublicSurveyDTO> => {
      const { survey, tenant } = await linkSurvey(request.params.token);
      return { status: 'open', survey: publicSurvey(survey), tenant: toPublicTenantDTO(tenant), ticket: null };
    },
  );

  app.post(
    '/public/surveys/s/:token',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Responder por enlace general (se puede indicar la sucursal del QR)',
        params: tokenParam,
        body: submitBody.extend({ branchId: z.uuid().nullish() }),
        security: [],
      },
    },
    async (request) => {
      const { survey, tenant } = await linkSurvey(request.params.token);
      let branchId: string | null = null;
      if (request.body.branchId) {
        const [branch] = await ctx.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, request.body.branchId), eq(branches.tenantId, tenant.id)));
        branchId = branch?.id ?? null;
      }
      return saveResponse(tenant, survey, request.body.answers, { branchId });
    },
  );
};

/** Estado de la encuesta para la página de seguimiento. */
export async function ticketSurveyInfo(ctx: AppContext, tenant: Tenant, ticket: typeof tickets.$inferSelect): Promise<{ url: string; answered: boolean } | null> {
  if (ticket.status !== 'finished' || !(await ctx.modulesOf(tenant)).includes('surveys')) return null;
  const survey = await surveyForTicket(ctx.db, tenant.id, ticket);
  if (!survey) return null;
  const [answered] = await ctx.db
    .select({ id: surveyResponses.id })
    .from(surveyResponses)
    .where(eq(surveyResponses.ticketId, ticket.id))
    .limit(1);
  if (!answered && ticket.finishedAt && ticket.finishedAt.getTime() + survey.expiresDays * 86_400_000 < Date.now()) return null;
  return { url: `/encuesta/${ticket.publicToken}`, answered: Boolean(answered) };
}

