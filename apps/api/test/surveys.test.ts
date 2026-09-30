import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SURVEY_TEMPLATES, npsOf, scoreAnswers, validateAnswers } from '@gc/shared';
import { notifyMessages } from '../src/db/schema';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
let app: FastifyInstance;
let root: { headers: { authorization: string } };
let org: TenantSession;
let branch: { id: string };
let services: { id: string; name: string }[];
let counter: { id: string; name: string };

const general = SURVEY_TEMPLATES.find((t) => t.key === 'general')!.body;

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
  org = await registerTenant(app, 'Encuestas SA');
  branch = (await api(app, org, 'GET', '/branches')).body[0];
  services = (await api(app, org, 'GET', '/services')).body;
  counter = (await api(app, org, 'GET', `/counters?branchId=${branch.id}`)).body[0];
  await api(app, org, 'PUT', '/agent/workstation', { branchId: branch.id, counterId: counter.id, serviceIds: services.map((s) => s.id), paused: false });
});

afterAll(async () => {
  await app.close();
});

/** Emite, llama y finaliza un turno; devuelve el turno. */
async function attended(serviceId = services[0]!.id, customer: Record<string, string> = {}) {
  const ticket = (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId, customer })).body.ticket;
  const called = await api(app, org, 'POST', '/agent/call-next');
  expect(called.body.ticket.id).toBe(ticket.id);
  await api(app, org, 'POST', `/agent/tickets/${ticket.id}/finish`);
  return ticket as { id: string; code: string; publicToken: string };
}

describe('cálculos de las encuestas', () => {
  it('valida respuestas y calcula NPS y calificación', () => {
    expect(validateAnswers(general.questions, {})).toEqual({ ok: false, error: expect.stringMatching(/Responda/) });
    expect(validateAnswers(general.questions, { atencion: 6, recomienda: 9 }).ok).toBe(false);
    const ok = validateAnswers(general.questions, { atencion: 5, recomienda: 10, mejorar: '  Nada  ', otra: 'x' });
    expect(ok).toEqual({ ok: true, answers: { atencion: 5, recomienda: 10, mejorar: 'Nada' } });
    expect(scoreAnswers(general.questions, { atencion: 4, recomienda: 7, mejorar: 'Rápido' })).toEqual({ nps: 7, rating: 4, comment: 'Rápido' });
    expect(npsOf(6, 2, 10)).toBe(40);
    expect(npsOf(0, 0, 0)).toBeNull();
  });
});

describe('encuestas de satisfacción', () => {
  it('es un módulo activable', async () => {
    expect((await api(app, org, 'GET', '/surveys')).status).toBe(403);
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { surveys: true } });
    expect((await api(app, org, 'GET', '/surveys')).body).toEqual([]);
  });

  it('crea encuestas y valida las preguntas', async () => {
    const bad = await api(app, org, 'POST', '/surveys', { name: 'Mala', questions: [{ id: 'x', type: 'choice', title: '¿Cuál?', options: ['Solo una'] }] });
    expect(bad.status).toBe(400);
    const created = await api(app, org, 'POST', '/surveys', general);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Satisfacción general', active: true, serviceIds: [], responses: 0 });
    expect(created.body.publicToken).toHaveLength(20);
    // Los ids de otra organización se descartan.
    const other = await registerTenant(app, 'Otra SA');
    const foreignBranch = (await api(app, other, 'GET', '/branches')).body[0].id;
    const scoped = await api(app, org, 'POST', '/surveys', { ...general, name: 'Solo cajas', serviceIds: [services[1]!.id], branchIds: [foreignBranch] });
    expect(scoped.body).toMatchObject({ serviceIds: [services[1]!.id], branchIds: [] });
    await api(app, root, 'PUT', `/platform/tenants/${other.tenantId}`, { modules: { surveys: true } });
    expect((await api(app, other, 'PUT', `/surveys/${created.body.id}`, general)).status).toBe(404);
  });

  it('el cliente responde la encuesta de su turno una sola vez', async () => {
    const waiting = (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: services[0]!.id })).body.ticket;
    expect((await api(app, null, 'GET', `/public/surveys/t/${waiting.publicToken}`)).body.status).toBe('not_ready');
    expect((await api(app, null, 'POST', `/public/surveys/t/${waiting.publicToken}`, { answers: { atencion: 5, recomienda: 10 } })).status).toBe(400);
    await api(app, org, 'POST', `/tickets/${waiting.id}/cancel`, {});

    const ticket = await attended();
    const open = await api(app, null, 'GET', `/public/surveys/t/${ticket.publicToken}`);
    expect(open.body).toMatchObject({ status: 'open', ticket: { code: ticket.code, counter: counter.name }, survey: { title: '¿Cómo fue su atención?' } });
    expect(open.body.survey.questions).toHaveLength(3);
    const tracking = await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`);
    expect(tracking.body.survey).toEqual({ url: `/encuesta/${ticket.publicToken}`, answered: false });

    expect((await api(app, null, 'POST', `/public/surveys/t/${ticket.publicToken}`, { answers: { recomienda: 10 } })).body.message).toMatch(/Responda/);
    const sent = await api(app, null, 'POST', `/public/surveys/t/${ticket.publicToken}`, { answers: { atencion: 5, recomienda: 10, mejorar: 'Muy amables' } });
    expect(sent.status).toBe(200);
    expect(sent.body.thanks).toMatch(/Gracias/);
    expect((await api(app, null, 'POST', `/public/surveys/t/${ticket.publicToken}`, { answers: { atencion: 1, recomienda: 0 } })).status).toBe(409);
    expect((await api(app, null, 'GET', `/public/surveys/t/${ticket.publicToken}`)).body.status).toBe('answered');
    expect((await api(app, null, 'GET', `/public/tickets/${ticket.publicToken}`)).body.survey.answered).toBe(true);
  });

  it('usa la encuesta más específica del servicio', async () => {
    const ticket = await attended(services[1]!.id);
    const survey = await api(app, null, 'GET', `/public/surveys/t/${ticket.publicToken}`);
    expect(survey.status).toBe(200);
    await api(app, null, 'POST', `/public/surveys/t/${ticket.publicToken}`, { answers: { atencion: 2, recomienda: 3, mejorar: 'La espera fue larga' } });
    const list = (await api(app, org, 'GET', '/surveys')).body as { name: string; responses: number }[];
    expect(list.find((s) => s.name === 'Solo cajas')!.responses).toBe(1);
    expect(list.find((s) => s.name === 'Satisfacción general')!.responses).toBe(1);
  });

  it('enlace general (QR) con la sucursal y se puede desactivar', async () => {
    const survey = ((await api(app, org, 'GET', '/surveys')).body as { name: string; publicToken: string; id: string }[]).find((s) => s.name === 'Satisfacción general')!;
    const page = await api(app, null, 'GET', `/public/surveys/s/${survey.publicToken}`);
    expect(page.body).toMatchObject({ status: 'open', ticket: null });
    const res = await api(app, null, 'POST', `/public/surveys/s/${survey.publicToken}`, { answers: { atencion: 4, recomienda: 8 }, branchId: branch.id });
    expect(res.status).toBe(200);
    await api(app, org, 'PUT', `/surveys/${survey.id}`, { ...general, allowAnonymous: false });
    expect((await api(app, null, 'GET', `/public/surveys/s/${survey.publicToken}`)).status).toBe(404);
    const notFound = await api(app, null, 'GET', '/public/surveys/s/no-existe-1234567890');
    expect(notFound.body.message).toBe('Encuesta no encontrada');
  });

  it('muestra las métricas: NPS, satisfacción, por servicio y comentarios', async () => {
    const results = await api(app, org, 'GET', '/surveys/results');
    expect(results.status).toBe(200);
    const t = results.body.totals;
    // Respuestas: (5,10) (2,3) (4,8) → promotores 1, pasivos 1, detractores 1.
    expect(t).toMatchObject({ responses: 3, promoters: 1, passives: 1, detractors: 1, nps: 0, ratingResponses: 3, comments: 2 });
    expect(t.csat).toBeCloseTo(2 / 3);
    expect(t.ratingAvg).toBeCloseTo(3.7);
    expect(t.finished).toBe(2);
    expect(t.responseRate).toBe(1);
    expect(results.body.byService.find((s: { id: string }) => s.id === services[1]!.id)).toMatchObject({ responses: 1, nps: -100, csat: 0 });
    expect(results.body.byAgent[0]).toMatchObject({ name: 'Admin', responses: 2 });
    expect(results.body.comments.map((c: { comment: string }) => c.comment)).toEqual(['La espera fue larga', 'Muy amables']);
    expect(results.body.byDay).toHaveLength(1);

    const survey = ((await api(app, org, 'GET', '/surveys')).body as { name: string; id: string }[]).find((s) => s.name === 'Satisfacción general')!;
    const detail = await api(app, org, 'GET', `/surveys/results?surveyId=${survey.id}`);
    const rating = detail.body.questions.find((q: { id: string }) => q.id === 'atencion');
    expect(rating).toMatchObject({ responses: 2, average: 4.5 });
    expect(rating.distribution).toEqual([
      { label: '1', count: 0 },
      { label: '2', count: 0 },
      { label: '3', count: 0 },
      { label: '4', count: 1 },
      { label: '5', count: 1 },
    ]);

    const csv = await api(app, org, 'GET', `/surveys/responses.csv?surveyId=${survey.id}`);
    expect(csv.res.headers['content-type']).toContain('text/csv');
    expect(csv.res.body).toContain('¿Cómo calificaría la atención recibida?');
    expect(csv.res.body).toContain('Muy amables');
    expect(csv.res.body).toContain('Enlace general');
  });

  it('el aviso al terminar incluye el enlace de la encuesta', async () => {
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { surveys: true, notifications: true } });
    await api(app, org, 'PUT', '/tenant', { settings: { notifications: { events: { finished: { enabled: true } } } } });
    const ticket = await attended(services[0]!.id, { phone: '0981 777 888' });
    let finished: typeof notifyMessages.$inferSelect | undefined;
    for (let i = 0; i < 50 && !finished; i++) {
      finished = (await app.ctx.db.select().from(notifyMessages).where(eq(notifyMessages.ticketId, ticket.id))).find((m) => m.event === 'finished');
      if (!finished) await new Promise((r) => setTimeout(r, 20));
    }
    expect(finished!.body).toContain(`http://colas.test/encuesta/${ticket.publicToken}`);
    expect(finished!.body).toContain('Encuestas SA');
  });

  it('eliminar la encuesta borra sus respuestas', async () => {
    const list = (await api(app, org, 'GET', '/surveys')).body as { id: string; name: string }[];
    const scoped = list.find((s) => s.name === 'Solo cajas')!;
    expect((await api(app, org, 'DELETE', `/surveys/${scoped.id}`)).status).toBe(204);
    expect((await api(app, org, 'GET', '/surveys/results')).body.totals.responses).toBe(2);
  });
});
