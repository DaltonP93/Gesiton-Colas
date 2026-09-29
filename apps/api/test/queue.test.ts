import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

let app: FastifyInstance;
let admin: TenantSession;
let branchId: string;
let services: { id: string; name: string; prefix: string }[];
let priorities: { id: string; name: string; weight: number }[];
let counters: { id: string; name: string }[];
let kioskToken: string;

beforeAll(async () => {
  app = await createTestApp();
  admin = await registerTenant(app, 'Clínica Central');
  branchId = (await api(app, admin, 'GET', '/branches')).body[0].id;
  services = (await api(app, admin, 'GET', '/services')).body;
  priorities = (await api(app, admin, 'GET', '/priorities')).body;
  counters = (await api(app, admin, 'GET', `/counters?branchId=${branchId}`)).body;
  kioskToken = (await api(app, admin, 'GET', '/kiosks')).body[0].token;
});

afterAll(async () => {
  await app.close();
});

const svc = (prefix: string) => services.find((s) => s.prefix === prefix)!;
const normal = () => priorities.find((p) => p.weight === 0)!;
const preferential = () => priorities.find((p) => p.weight > 0)!;

async function createAgent(name: string) {
  const email = uniqueEmail(name);
  const created = await api(app, admin, 'POST', '/users', { email, name, password: 'password123', role: 'agent' });
  expect(created.status).toBe(201);
  const login = await api(app, null, 'POST', '/auth/login', { email, password: 'password123' });
  return { headers: { authorization: `Bearer ${login.body.token}` }, id: created.body.id as string };
}

describe('organización por defecto', () => {
  it('crea sucursal, servicios, prioridades, puestos, pantalla y kiosco', async () => {
    expect(services.map((s) => s.prefix).sort()).toEqual(['A', 'C']);
    expect(priorities).toHaveLength(2);
    expect(counters).toHaveLength(3);
    const me = await api(app, admin, 'GET', '/auth/me');
    expect(me.body.tenant.settings.branding.appName).toBe('Clínica Central');
    expect(me.body.limits.branches).toBe(1);
  });
});

describe('flujo completo de atención', () => {
  it('emite, llama por prioridad, atiende, deriva y reporta', async () => {
    const kiosk = await api(app, null, 'GET', `/public/kiosks/${kioskToken}`);
    expect(kiosk.status).toBe(200);
    expect(kiosk.body.services).toHaveLength(2);

    const issue = (serviceId: string, priorityId?: string) =>
      api(app, null, 'POST', `/public/kiosks/${kioskToken}/tickets`, { serviceId, priorityId });

    const t1 = await issue(svc('A').id);
    const t2 = await issue(svc('A').id);
    const t3 = await issue(svc('A').id, preferential().id);
    expect(t1.status).toBe(201);
    expect(t1.body.ticket.code).toBe('A001');
    expect(t2.body.ticket.code).toBe('A002');
    expect(t3.body.ticket.code).toBe('A003');
    expect(t2.body.waitingAhead).toBe(1);
    // el preferencial pasa adelante
    expect(t3.body.waitingAhead).toBe(0);
    expect(t1.body.trackingUrl).toBe(`http://colas.test/t/${t1.body.ticket.publicToken}`);

    const agent = await createAgent('agente');
    // sin puesto configurado no puede llamar
    expect((await api(app, agent, 'POST', '/agent/call-next')).status).toBe(400);

    const ws = await api(app, agent, 'PUT', '/agent/workstation', {
      branchId,
      counterId: counters[0]!.id,
      serviceIds: [svc('A').id, svc('C').id],
      paused: false,
    });
    expect(ws.status).toBe(200);
    expect(ws.body.serviceIds).toHaveLength(2);

    const first = await api(app, agent, 'POST', '/agent/call-next');
    expect(first.body.ticket.code).toBe('A003');
    expect(first.body.ticket.status).toBe('called');
    expect(first.body.ticket.counter.name).toBe(counters[0]!.name);

    // no puede llamar otro sin finalizar el actual
    expect((await api(app, agent, 'POST', '/agent/call-next')).status).toBe(409);

    const recall = await api(app, agent, 'POST', `/agent/tickets/${first.body.ticket.id}/recall`);
    expect(recall.body.ticket.callCount).toBe(2);

    const started = await api(app, agent, 'POST', `/agent/tickets/${first.body.ticket.id}/start`);
    expect(started.body.ticket.status).toBe('in_service');
    const finished = await api(app, agent, 'POST', `/agent/tickets/${first.body.ticket.id}/finish`, { notes: 'ok' });
    expect(finished.body.ticket.status).toBe('finished');

    const second = await api(app, agent, 'POST', '/agent/call-next');
    expect(second.body.ticket.code).toBe('A001');

    // derivar a Caja: el turno conserva el código y el enlace de seguimiento
    const transferred = await api(app, agent, 'POST', `/agent/tickets/${second.body.ticket.id}/transfer`, { serviceId: svc('C').id });
    expect(transferred.status).toBe(200);
    expect(transferred.body.ticket.code).toBe('A001');
    expect(transferred.body.ticket.serviceId).toBe(svc('C').id);
    expect(transferred.body.ticket.status).toBe('waiting');
    expect(transferred.body.ticket.publicToken).toBe(t1.body.ticket.publicToken);

    const tracking = await api(app, null, 'GET', `/public/tickets/${t1.body.ticket.publicToken}`);
    expect(tracking.body.status).toBe('waiting');
    expect(tracking.body.service).toBe('Caja');
    expect(tracking.body.estimatedMinutes).toBeGreaterThan(0);

    const third = await api(app, agent, 'POST', '/agent/call-next');
    expect(third.body.ticket.code).toBe('A002');
    const noShow = await api(app, agent, 'POST', `/agent/tickets/${third.body.ticket.id}/no-show`);
    expect(noShow.body.ticket.status).toBe('no_show');

    const fourth = await api(app, agent, 'POST', '/agent/call-next');
    expect(fourth.body.ticket.code).toBe('A001');
    expect(fourth.body.ticket.serviceId).toBe(svc('C').id);
    expect((await api(app, agent, 'POST', `/agent/tickets/${fourth.body.ticket.id}/finish`)).status).toBe(200);

    const empty = await api(app, agent, 'POST', '/agent/call-next');
    expect(empty.body.ticket).toBeNull();

    const report = await api(app, admin, 'GET', `/reports/summary?branchId=${branchId}`);
    expect(report.status).toBe(200);
    expect(report.body.totals.issued).toBe(3);
    expect(report.body.totals.finished).toBe(2);
    expect(report.body.totals.noShow).toBe(1);
    expect(report.body.byAgent[0].finished).toBe(2);
    expect(report.body.byHour).toHaveLength(24);

    const csv = await app.inject({ method: 'GET', url: '/api/v1/reports/tickets.csv', headers: admin.headers });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Código,Estado');
    expect(csv.body.split('\r\n')).toHaveLength(5);
  });

  it('dos operadores no toman el mismo turno', async () => {
    const [a, b] = await Promise.all([createAgent('a1'), createAgent('a2')]);
    for (const [agent, counter] of [
      [a, counters[1]!],
      [b, counters[2]!],
    ] as const) {
      await api(app, agent, 'PUT', '/agent/workstation', { branchId, counterId: counter.id, serviceIds: [svc('A').id], paused: false });
    }
    await api(app, null, 'POST', `/public/kiosks/${kioskToken}/tickets`, { serviceId: svc('A').id });
    const [ra, rb] = await Promise.all([api(app, a, 'POST', '/agent/call-next'), api(app, b, 'POST', '/agent/call-next')]);
    const got = [ra.body.ticket, rb.body.ticket].filter(Boolean);
    expect(got).toHaveLength(1);
    await api(app, a.id === got[0].agentId ? a : b, 'POST', `/agent/tickets/${got[0].id}/finish`);
  });

  it('el cliente puede cancelar su turno y el cierre de jornada reinicia la numeración', async () => {
    const issued = await api(app, null, 'POST', `/public/kiosks/${kioskToken}/tickets`, { serviceId: svc('C').id });
    const cancel = await api(app, null, 'POST', `/public/tickets/${issued.body.ticket.publicToken}/cancel`);
    expect(cancel.body.ok).toBe(true);
    const again = await api(app, null, 'GET', `/public/tickets/${issued.body.ticket.publicToken}`);
    expect(again.body.status).toBe('cancelled');

    await api(app, null, 'POST', `/public/kiosks/${kioskToken}/tickets`, { serviceId: svc('C').id });
    const reset = await api(app, admin, 'POST', `/branches/${branchId}/queue/reset`);
    expect(reset.body.cancelled).toBe(1);
    const fresh = await api(app, null, 'POST', `/public/kiosks/${kioskToken}/tickets`, { serviceId: svc('C').id });
    expect(fresh.body.ticket.code).toBe('C001');

    const queue = await api(app, admin, 'GET', `/branches/${branchId}/queue`);
    expect(queue.body.waiting).toHaveLength(1);
    expect(queue.body.counts.waiting).toBe(1);
  });
});
