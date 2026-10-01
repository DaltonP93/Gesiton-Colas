import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { displays } from '../src/db/schema';
import { withinAlertWindow } from '../src/lib/deviceMonitor';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

let app: FastifyInstance;
let org: TenantSession;
let adminEmail: string;

// Lunes 5/10/2026 a las 10:00 en Asunción (UTC-3).
const MONDAY_10 = new Date('2026-10-05T13:00:00Z');
const window = { days: [1, 2, 3, 4, 5, 6], from: '07:00', to: '20:00' };

beforeAll(async () => {
  app = await createTestApp();
  org = await registerTenant(app, 'Equipos SA');
  adminEmail = (await api(app, org, 'GET', '/auth/me')).body.user.email;
});

afterAll(async () => {
  await app.close();
});

// La bandeja de prueba guarda primero lo más reciente: se invierte para leer en orden.
const alertsTo = (email: string) => app.ctx.mailer.outbox().filter((m) => m.to === email && m.tag === 'device_alert').reverse();

describe('horario de las alertas', () => {
  it('respeta los días, el horario y la zona horaria', () => {
    expect(withinAlertWindow(MONDAY_10, 'America/Asuncion', window)).toBe(true);
    expect(withinAlertWindow(new Date('2026-10-04T13:00:00Z'), 'America/Asuncion', window)).toBe(false); // domingo
    expect(withinAlertWindow(new Date('2026-10-06T01:00:00Z'), 'America/Asuncion', window)).toBe(false); // lunes 22:00
    expect(withinAlertWindow(new Date('2026-10-06T01:00:00Z'), 'America/Asuncion', { ...window, from: '20:00', to: '06:00' })).toBe(true);
  });
});

describe('alertas de equipos desconectados', () => {
  it('avisa una vez cuando una TV deja de responder y otra cuando vuelve', async () => {
    const display = (await api(app, org, 'GET', '/displays')).body[0];
    await app.ctx.db.update(displays).set({ lastSeenAt: new Date(MONDAY_10.getTime() - 10 * 60_000), offlineAlertedAt: null }).where(eq(displays.id, display.id));

    await app.ctx.devices.check(MONDAY_10);
    const sent = alertsTo(adminEmail);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Un equipo se desconectó · Equipos SA');
    expect(sent[0]!.text).toContain(`Pantalla «${display.name}»`);
    const offline = await api(app, org, 'GET', '/devices/offline');
    expect(offline.body).toEqual([expect.objectContaining({ id: display.id, kind: 'display', name: display.name })]);

    // Sigue desconectada: no se repite la alerta.
    await app.ctx.devices.check(new Date(MONDAY_10.getTime() + 5 * 60_000));
    expect(alertsTo(adminEmail)).toHaveLength(1);

    // Vuelve a conectarse.
    await app.ctx.db.update(displays).set({ lastSeenAt: new Date(MONDAY_10.getTime() + 6 * 60_000) }).where(eq(displays.id, display.id));
    await app.ctx.devices.check(new Date(MONDAY_10.getTime() + 7 * 60_000));
    const all = alertsTo(adminEmail);
    expect(all).toHaveLength(2);
    expect(all[1]!.subject).toBe('Los equipos volvieron a conectarse · Equipos SA');
    expect((await api(app, org, 'GET', '/devices/offline')).body).toEqual([]);
  });

  it('no avisa fuera de horario, si está desactivado o si el equipo nunca se conectó', async () => {
    const display = (await api(app, org, 'GET', '/displays')).body[0];
    await app.ctx.db.update(displays).set({ lastSeenAt: new Date(MONDAY_10.getTime() - 60 * 60_000), offlineAlertedAt: null }).where(eq(displays.id, display.id));
    const before = alertsTo(adminEmail).length;
    await app.ctx.devices.check(new Date('2026-10-04T13:00:00Z')); // domingo
    expect(alertsTo(adminEmail).length).toBe(before);

    await api(app, org, 'PUT', '/tenant', { settings: { alerts: { devices: { enabled: false } } } });
    await app.ctx.devices.check(MONDAY_10);
    expect(alertsTo(adminEmail).length).toBe(before);

    // Destinatarios propios y alerta de prueba.
    await api(app, org, 'PUT', '/tenant', { settings: { alerts: { devices: { enabled: true, emails: ['soporte@equipos.test'] } } } });
    const test = await api(app, org, 'POST', '/alerts/devices/test');
    expect(test.status).toBe(200);
    expect(alertsTo('soporte@equipos.test')).toHaveLength(1);
  });
});
