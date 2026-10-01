import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appointments, auditLogs, tickets } from '../src/db/schema';
import { addDays, dayInTimezone, localToUtc } from '../src/lib/tz';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
const TZ = 'America/Asuncion';

let app: FastifyInstance;
let root: { headers: Record<string, string> };
let org: TenantSession;
let branch: { id: string; code: string };
let services: { id: string; name: string; prefix: string }[];
let slug: string;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const outbox = (tag: string, to: string) => app.ctx.mailer.outbox().filter((m) => m.tag === tag && m.to === to);

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password });
  const login = await api(app, null, 'POST', '/auth/login', ROOT);
  root = { headers: { authorization: `Bearer ${login.body.token}` } };
  org = await registerTenant(app, 'Clínica Citas');
  branch = (await api(app, org, 'GET', '/branches')).body[0];
  services = (await api(app, org, 'GET', '/services')).body;
  slug = (await api(app, org, 'GET', '/auth/me')).body.tenant.slug;
});

afterAll(async () => {
  await app.close();
});

describe('módulo de citas', () => {
  it('requiere el módulo activo', async () => {
    const res = await api(app, org, 'GET', '/appointments');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('module_disabled');
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { appointments: true, integrations: true } });
    expect((await api(app, org, 'GET', '/appointments')).status).toBe(200);
  });

  it('agenda, lista y avisa al cliente por correo', async () => {
    const created = await api(app, org, 'POST', '/appointments', {
      branchId: branch.id,
      serviceId: services[0]!.id,
      scheduledAt: inMinutes(180),
      customer: { name: 'María López', document: '1.234.567', email: 'maria@cliente.test', phone: '0981 111 222' },
      professional: 'Dra. Benítez',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'booked', source: 'manual', professional: 'Dra. Benítez', service: { name: services[0]!.name } });
    expect(created.body.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.body.manageUrl).toMatch(/^http:\/\/colas\.test\/cita\//);
    await new Promise((r) => setTimeout(r, 50));
    expect(outbox('appointment_confirmation', 'maria@cliente.test')).toHaveLength(1);

    const today = dayInTimezone(new Date(), TZ);
    const list = await api(app, org, 'GET', `/appointments?from=${today}&to=${addDays(today, 1)}&q=1234567`);
    expect(list.body.items.map((a: { id: string }) => a.id)).toContain(created.body.id);
    expect(list.body.counts.booked).toBeGreaterThanOrEqual(1);
  });

  it('la llegada respeta la ventana y ordena la fila por la hora de la cita', async () => {
    const service = services[1]!;
    // Cita dentro de 3 horas: todavía es temprano.
    const later = await api(app, org, 'POST', '/appointments', { branchId: branch.id, serviceId: service.id, scheduledAt: inMinutes(180), customer: { name: 'Pedro Ruiz', document: '555' }, notify: false });
    const early = await api(app, org, 'POST', `/appointments/${later.body.id}/check-in`, {});
    expect(early.status).toBe(409);
    expect(early.body.message).toContain('Todavía es temprano');

    // Una cita de hace 10 minutos (dentro de la tolerancia) y alguien que llegó sin cita.
    const walkIn = await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer: { name: 'Sin cita' } });
    expect(walkIn.status).toBe(201);
    const late = await api(app, org, 'POST', '/appointments', { branchId: branch.id, serviceId: service.id, scheduledAt: inMinutes(-10), customer: { name: 'Lucía Fernández', document: '777' }, notify: false });
    const checkIn = await api(app, org, 'POST', `/appointments/${late.body.id}/check-in`, {});
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.appointment.status).toBe('checked_in');
    expect(checkIn.body.ticket).toMatchObject({ appointmentId: late.body.id, channel: 'agent' });
    expect(checkIn.body.ticket.notes).toContain('Cita de las');
    // Conserva su lugar: queda antes de quien llegó sin cita.
    expect(checkIn.body.waitingAhead).toBe(0);
    const walkInNow = await api(app, org, 'GET', `/tickets/${walkIn.body.ticket.id}`);
    expect(walkInNow.body.waitingAhead).toBe(1);

    // Recepción puede dar llegada antes de hora: espera su horario (queda después de quien llegó sin cita).
    const forced = await api(app, org, 'POST', `/appointments/${later.body.id}/check-in`, { force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.waitingAhead).toBe(2);
    const [row] = await app.ctx.db.select({ sortAt: tickets.sortAt }).from(tickets).where(eq(tickets.id, forced.body.ticket.id));
    expect(row!.sortAt.toISOString()).toBe(later.body.scheduledAt);
    // No se puede presentar dos veces.
    expect((await api(app, org, 'POST', `/appointments/${later.body.id}/check-in`, { force: true })).status).toBe(409);

    // Al terminar la atención, la cita queda como atendida.
    app.ctx.publishTicket(org.tenantId, 'ticket.finished', { ...checkIn.body.ticket, status: 'finished' });
    await new Promise((r) => setTimeout(r, 100));
    expect((await api(app, org, 'GET', `/appointments/${late.body.id}`)).body.status).toBe('completed');
  });

  it('el cliente se presenta en el kiosco con su documento', async () => {
    const kiosk = (await api(app, org, 'GET', '/kiosks')).body[0];
    const boot = await api(app, null, 'GET', `/public/kiosks/${kiosk.token}`);
    expect(boot.body.appointments).toBe(true);
    const appt = await api(app, org, 'POST', '/appointments', {
      branchId: branch.id,
      serviceId: services[0]!.id,
      scheduledAt: inMinutes(20),
      customer: { name: 'Ana Torres', document: '4.567.890' },
      notify: false,
    });

    const lookup = await api(app, null, 'POST', `/public/kiosks/${kiosk.token}/appointments/lookup`, { query: '4567890' });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual([expect.objectContaining({ id: appt.body.id, customer: 'Ana T.', canCheckIn: true })]);
    // También por el código de la cita.
    const byCode = await api(app, null, 'POST', `/public/kiosks/${kiosk.token}/appointments/lookup`, { query: appt.body.code.toLowerCase() });
    expect(byCode.body.map((m: { id: string }) => m.id)).toEqual([appt.body.id]);

    // Con otro documento no puede presentar esa cita.
    expect((await api(app, null, 'POST', `/public/kiosks/${kiosk.token}/appointments/${appt.body.id}/check-in`, { query: '999999' })).status).toBe(404);
    const issued = await api(app, null, 'POST', `/public/kiosks/${kiosk.token}/appointments/${appt.body.id}/check-in`, { query: '4.567.890' });
    expect(issued.status).toBe(201);
    expect(issued.body.ticket).toMatchObject({ channel: 'kiosk', appointmentId: appt.body.id });
    expect(issued.body.trackingUrl).toMatch(/\/t\//);
    const again = await api(app, null, 'POST', `/public/kiosks/${kiosk.token}/appointments/lookup`, { query: '4567890' });
    expect(again.body[0]).toMatchObject({ canCheckIn: false, reason: expect.stringContaining('Ya se presentó') });
  });

  it('se sincroniza con otro sistema por API key e id externo', async () => {
    const key = (await api(app, org, 'POST', '/api-keys', { name: 'HIS', scopes: ['appointments:read', 'appointments:write'] })).body.key;
    const his = { headers: { 'x-api-key': key } };
    const body = { branchCode: branch.code, serviceName: services[0]!.prefix, scheduledAt: inMinutes(60 * 26), customer: { name: 'Jorge Silva', document: '3333' }, professional: 'Dr. Vera', notify: false };
    const created = await api(app, his, 'PUT', '/appointments/external/HIS-001', body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ externalId: 'HIS-001', source: 'api', serviceId: services[0]!.id });
    const moved = await api(app, his, 'PUT', '/appointments/external/HIS-001', { ...body, scheduledAt: inMinutes(60 * 27) });
    expect(moved.status).toBe(200);
    expect(moved.body.id).toBe(created.body.id);
    expect((await api(app, his, 'GET', '/appointments/external/HIS-001')).body.scheduledAt).toBe(moved.body.scheduledAt);
    expect((await api(app, his, 'POST', '/appointments', { ...body, externalId: 'HIS-001' })).status).toBe(409);
    const cancelled = await api(app, his, 'POST', '/appointments/external/HIS-001/cancel', { reason: 'Reprogramada en el HIS' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Reprogramada en el HIS' });

    // Una API key sin el permiso no puede.
    const other = (await api(app, org, 'POST', '/api-keys', { name: 'Solo turnos', scopes: ['tickets:read'] })).body.key;
    expect((await api(app, { headers: { 'x-api-key': other } }, 'GET', '/appointments')).status).toBe(403);
  });

  it('importa un CSV de otro sistema y reporta las filas con error', async () => {
    const day = addDays(dayInTimezone(new Date(), TZ), 3);
    const [y, m, d] = day.split('-');
    const csv = [
      'Fecha;Hora;Documento;Nombre;Teléfono;Servicio;Sucursal;ID externo;Médico',
      `${d}/${m}/${y};08:30;1.111.111;Carlos Gómez;0981222333;${services[0]!.name};${branch.code};E-1;Dr. Acosta`,
      `${day};9:00;2222222;Sofía Díaz;;${services[1]!.prefix};Casa central;E-2;`,
      `${day};25:00;3333333;Hora mala;;${services[0]!.name};${branch.code};E-3;`,
      // Fecha que no existe (no debe pasar al 3 de marzo).
      `31/02/2026;10:00;4444444;Fecha imposible;;${services[0]!.name};${branch.code};E-4;`,
    ].join('\n');
    const result = await api(app, org, 'POST', '/appointments/import', { csv });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      created: 2,
      updated: 0,
      errors: [
        { line: 4, message: 'Fecha u hora inválida' },
        { line: 5, message: 'Fecha u hora inválida' },
      ],
    });
    const again = await api(app, org, 'POST', '/appointments/import', { csv });
    expect(again.body).toMatchObject({ created: 0, updated: 2 });
    const list = await api(app, org, 'GET', `/appointments?from=${day}&to=${day}`);
    const carlos = list.body.items.find((a: { externalId: string }) => a.externalId === 'E-1');
    expect(carlos).toMatchObject({ source: 'import', professional: 'Dr. Acosta', customer: { name: 'Carlos Gómez', document: '1.111.111' } });
    expect(carlos.scheduledAt).toBe(localToUtc(day, 8 * 60 + 30, TZ).toISOString());
  });

  it('reserva en línea con horarios, cupo y cancelación del cliente', async () => {
    const service = services[0]!;
    // Sin habilitar, la página no existe.
    expect((await api(app, null, 'GET', `/public/booking/${slug}`)).status).toBe(404);
    const schedule = await api(app, org, 'POST', '/appointment-schedules', { branchId: branch.id, serviceId: service.id, days: [0, 1, 2, 3, 4, 5, 6], from: '08:00', to: '10:00', slotMinutes: 30, capacity: 1 });
    expect(schedule.status).toBe(201);
    await api(app, org, 'PUT', '/tenant', { settings: { appointments: { booking: { enabled: true, requirePhone: false } } } });

    const page = await api(app, null, 'GET', `/public/booking/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body.services).toEqual([expect.objectContaining({ id: service.id, branchIds: [branch.id] })]);

    const day = addDays(dayInTimezone(new Date(), TZ), 2);
    const avail = await api(app, null, 'GET', `/public/booking/${slug}/availability?branchId=${branch.id}&serviceId=${service.id}&from=${day}&days=1`);
    expect(avail.body[0].slots.map((s: { time: string }) => s.time)).toEqual(['08:00', '08:30', '09:00', '09:30']);
    const slot = avail.body[0].slots[1];

    const booked = await api(app, null, 'POST', `/public/booking/${slug}`, { branchId: branch.id, serviceId: service.id, scheduledAt: slot.at, customer: { name: 'Valentina Rojas', document: '8.888.888', email: 'vale@cliente.test' } });
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ time: '08:30', status: 'booked', canCancel: true, customerName: 'Valentina R.' });
    expect(outbox('appointment_confirmation', 'vale@cliente.test')).toHaveLength(1);

    // El horario se ocupó; la misma persona no puede reservar dos veces el mismo día.
    expect((await api(app, null, 'POST', `/public/booking/${slug}`, { branchId: branch.id, serviceId: service.id, scheduledAt: slot.at, customer: { name: 'Otra persona', document: '9999' } })).status).toBe(409);
    const dup = await api(app, null, 'POST', `/public/booking/${slug}`, { branchId: branch.id, serviceId: service.id, scheduledAt: avail.body[0].slots[2].at, customer: { name: 'Valentina Rojas', document: '8888888' } });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('Ya tiene una cita');
    // Un horario que no existe en la agenda.
    expect((await api(app, null, 'POST', `/public/booking/${slug}`, { branchId: branch.id, serviceId: service.id, scheduledAt: localToUtc(day, 11 * 60, TZ).toISOString(), customer: { name: 'Mateo', document: '1010' } })).status).toBe(409);
    // Documento obligatorio.
    expect((await api(app, null, 'POST', `/public/booking/${slug}`, { branchId: branch.id, serviceId: service.id, scheduledAt: avail.body[0].slots[3].at, customer: { name: 'Sin documento' } })).status).toBe(400);

    const after = await api(app, null, 'GET', `/public/booking/${slug}/availability?branchId=${branch.id}&serviceId=${service.id}&from=${day}&days=1`);
    expect(after.body[0].slots[1].available).toBe(0);

    // Feriado: no hay horarios.
    await api(app, org, 'PUT', '/tenant', { settings: { appointments: { booking: { closedDates: [day] } } } });
    expect((await api(app, null, 'GET', `/public/booking/${slug}/availability?branchId=${branch.id}&serviceId=${service.id}&from=${day}&days=1`)).body[0].slots).toEqual([]);

    // El cliente ve y cancela su cita desde el enlace.
    const view = await api(app, null, 'GET', `/public/appointments/${booked.body.token}`);
    expect(view.body).toMatchObject({ code: booked.body.code, canCancel: true });
    const cancelled = await api(app, null, 'POST', `/public/appointments/${booked.body.token}/cancel`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', canCancel: false });
    expect((await api(app, null, 'POST', `/public/appointments/${booked.body.token}/cancel`)).status).toBe(409);
  });

  it('envía el recordatorio una sola vez y marca «No vino»', async () => {
    const remind = await api(app, org, 'POST', '/appointments', {
      branchId: branch.id,
      serviceId: services[0]!.id,
      scheduledAt: inMinutes(60 * 20),
      customer: { name: 'Martín Acosta', email: 'martin@cliente.test' },
      notify: false,
    });
    // Se agendó hace dos días.
    await app.ctx.db.update(appointments).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(appointments.id, remind.body.id));
    const missed = await api(app, org, 'POST', '/appointments', { branchId: branch.id, serviceId: services[0]!.id, scheduledAt: inMinutes(-120), customer: { name: 'Gabriel Ortiz' }, notify: false });

    await app.ctx.appointments.processDue();
    await app.ctx.appointments.processDue();
    expect(outbox('appointment_reminder', 'martin@cliente.test')).toHaveLength(1);
    expect((await api(app, org, 'GET', `/appointments/${remind.body.id}`)).body.reminderSentAt).not.toBeNull();
    expect((await api(app, org, 'GET', `/appointments/${missed.body.id}`)).body.status).toBe('no_show');

    // Al reprogramar, se vuelve a recordar.
    const moved = await api(app, org, 'PUT', `/appointments/${remind.body.id}`, { scheduledAt: inMinutes(60 * 22) });
    expect(moved.body.reminderSentAt).toBeNull();
  });

  it('el borrado a pedido del titular también limpia sus citas', async () => {
    const appt = await api(app, org, 'POST', '/appointments', { branchId: branch.id, serviceId: services[0]!.id, scheduledAt: inMinutes(300), customer: { name: 'Florencia Vera', document: '9.191.919' }, notify: false });
    const erased = await api(app, org, 'POST', '/privacy/erase', { field: 'document', value: '9191919' });
    expect(erased.body.appointments).toBe(1);
    const after = await api(app, org, 'GET', `/appointments/${appt.body.id}`);
    expect(after.body.customer).toEqual({});

    // La auditoría no guarda el documento que se pidió borrar ni los datos del cliente de las citas.
    await new Promise((r) => setTimeout(r, 100));
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.tenantId, org.tenantId));
    const erase = logs.find((l) => l.action === 'privacy.erase');
    expect(erase?.changes).toEqual({ field: 'document' });
    const created = logs.filter((l) => l.action === 'appointment.create');
    expect(created.length).toBeGreaterThan(0);
    for (const l of created) expect((l.changes as { customer?: unknown }).customer).toBe('(datos personales omitidos)');
    expect(JSON.stringify(logs.map((l) => l.changes))).not.toContain('9191919');
    expect(JSON.stringify(logs.map((l) => l.changes))).not.toContain('9.191.919');
  });
});
