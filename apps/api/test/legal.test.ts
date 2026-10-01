import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_TEMPLATES } from '@gc/shared';
import { auditLogs, legalAcceptances } from '../src/db/schema';
import { api, createTestApp, registerTenant, uniqueEmail, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
const HOLDER = { name: 'Software Colas S.A.', taxId: '80012345-6', address: 'Av. Mariscal López 1234, Asunción', email: 'legal@colas.test', city: 'Asunción' };

let app: FastifyInstance;
let root: { headers: Record<string, string> };
let existing: TenantSession;

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password, DEV_OUTBOX: 'true' });
  const res = await api(app, null, 'POST', '/auth/login', ROOT);
  root = { headers: { authorization: `Bearer ${res.body.token}` } };
  // Organización que ya existía antes de publicar los términos.
  existing = await registerTenant(app, 'Clínica Existente');
});

afterAll(async () => {
  // Las demás pruebas registran organizaciones sin la casilla de los términos.
  await api(app, root, 'PUT', '/platform/legal/settings', { requireAcceptance: false });
  await app.close();
});

const publish = (kind: string, body: Record<string, unknown> = {}) =>
  api(app, root, 'POST', `/platform/legal/${kind}/publish`, { source: LEGAL_TEMPLATES[kind as keyof typeof LEGAL_TEMPLATES], ...body });

const register = (payload: Record<string, unknown> = {}) =>
  api(app, null, 'POST', '/auth/register', { organizationName: 'Sanatorio Nuevo', name: 'Ana Admin', email: uniqueEmail('legal'), password: 'password123', ...payload });

describe('plantillas', () => {
  it('coinciden con los documentos de docs/legal', () => {
    const dir = fileURLToPath(new URL('../../../docs/legal', import.meta.url));
    expect(LEGAL_TEMPLATES.terms).toBe(readFileSync(path.join(dir, 'TERMINOS-DEL-SERVICIO.md'), 'utf8'));
    expect(LEGAL_TEMPLATES.privacy).toBe(readFileSync(path.join(dir, 'POLITICA-DE-PRIVACIDAD.md'), 'utf8'));
    expect(LEGAL_TEMPLATES.dpa).toBe(readFileSync(path.join(dir, 'ACUERDO-DE-TRATAMIENTO-DE-DATOS.md'), 'utf8'));
    expect(LEGAL_TEMPLATES.license).toBe(readFileSync(path.join(dir, 'CONTRATO-DE-LICENCIA.md'), 'utf8'));
  });
});

describe('sin documentos publicados', () => {
  it('el registro no pide la casilla y no hay páginas públicas', async () => {
    const config = await api(app, null, 'GET', '/public/config');
    expect(config.body.legal).toEqual({ acceptance: false, documents: [] });
    expect((await register()).status).toBe(201);
    expect((await api(app, null, 'GET', '/public/legal/terms')).status).toBe(404);
    expect((await api(app, existing, 'GET', '/auth/me')).body.legal).toEqual([]);
  });

  it('no se publica sin los datos del titular', async () => {
    const admin = await api(app, root, 'GET', '/platform/legal');
    expect(admin.status).toBe(200);
    expect(admin.body.missing).toEqual(expect.arrayContaining(['razón social o nombre', 'RUC', 'domicilio', 'correo de contacto']));
    expect(admin.body.documents.map((d: { kind: string }) => d.kind)).toEqual(['terms', 'privacy', 'dpa']);
    expect(admin.body.documents[0].source).toBe(LEGAL_TEMPLATES.terms);
    const res = await publish('terms');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Complete los datos del titular');
  });

  it('solo el superadministrador administra los documentos', async () => {
    expect((await api(app, existing, 'GET', '/platform/legal')).status).toBe(403);
    expect((await api(app, existing, 'POST', '/platform/legal/terms/publish', { source: 'x'.repeat(50) })).status).toBe(403);
  });
});

describe('publicación', () => {
  it('guarda los datos del titular sin pisar lo que no se envía', async () => {
    const saved = await api(app, root, 'PUT', '/platform/legal/settings', { holder: HOLDER });
    expect(saved.status).toBe(200);
    expect(saved.body.missing).toEqual([]);
    const partial = await api(app, root, 'PUT', '/platform/legal/settings', { holder: { supportHours: 'de lunes a sábado de 7:00 a 19:00' } });
    expect(partial.body.settings.holder).toMatchObject({ ...HOLDER, supportHours: 'de lunes a sábado de 7:00 a 19:00', exportDays: 30 });
    expect((await api(app, root, 'PUT', '/platform/legal/settings', { holder: { email: 'no-es-correo' } })).status).toBe(400);
  });

  it('rechaza variables desconocidas', async () => {
    const res = await publish('terms', { source: `${LEGAL_TEMPLATES.terms}\n{{titularr}}` });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('{{titularr}}');
  });

  it('publica la versión 1 con los datos del titular', async () => {
    const terms = await publish('terms', { note: 'Primera versión' });
    expect(terms.status).toBe(200);
    expect(terms.body).toMatchObject({ kind: 'terms', version: 1, requiresAcceptance: true, note: 'Primera versión', accepted: 0 });
    expect((await publish('dpa')).body.version).toBe(1);
    // La privacidad se informa, no se acepta.
    expect((await publish('privacy', { requiresAcceptance: true })).body.requiresAcceptance).toBe(false);

    const page = await api(app, null, 'GET', '/public/legal/terms');
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ kind: 'terms', version: 1, current: true, path: '/terminos' });
    expect(page.body.content).toContain('**Software Colas S.A.**, RUC 80012345-6');
    expect(page.body.content).toContain('Versión 1 · Vigente desde el');
    expect(page.body.content).toContain('de lunes a sábado de 7:00 a 19:00');
    expect(page.body.content).toContain('http://colas.test/terminos');
    expect(page.body.content).not.toContain('{{');

    const config = await api(app, null, 'GET', '/public/config');
    expect(config.body.legal.acceptance).toBe(true);
    expect(config.body.legal.documents.map((d: { kind: string }) => d.kind)).toEqual(['terms', 'privacy', 'dpa']);

    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'legal.publish'));
    expect(logs.map((l) => l.summary)).toContain('Publicó una versión nueva de «Términos y condiciones del servicio»');
    expect(JSON.stringify(logs[0]!.changes)).not.toContain('Definiciones');
  });
});

describe('aceptación', () => {
  it('el registro exige la casilla y guarda la constancia', async () => {
    const without = await register();
    expect(without.status).toBe(400);
    expect(without.body.error).toBe('terms_required');

    const res = await register({ acceptTerms: true });
    expect(res.status).toBe(201);
    expect(res.body.legal).toEqual([]);
    const rows = await app.ctx.db.select().from(legalAcceptances).where(eq(legalAcceptances.tenantId, res.body.tenant.id));
    expect(rows.map((r) => `${r.kind}:${r.version}`).sort()).toEqual(['dpa:1', 'terms:1']);
    expect(rows[0]).toMatchObject({ userName: 'Ana Admin', tenantName: 'Sanatorio Nuevo' });
    expect(rows[0]!.ip).toBeTruthy();
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.tenantId, res.body.tenant.id));
    expect(logs.map((l) => l.summary)).toContain('Aceptó «Términos y condiciones del servicio» (versión 1) y «Acuerdo de tratamiento de datos personales» (versión 1) al crear la organización');
  });

  it('la demo también exige la casilla', async () => {
    expect((await api(app, null, 'POST', '/auth/demo', { email: uniqueEmail('demo'), name: 'Diego Demo' })).body.error).toBe('terms_required');
    const email = uniqueEmail('demo');
    expect((await api(app, null, 'POST', '/auth/demo', { email, name: 'Diego Demo', acceptTerms: true })).status).toBe(200);
    const rows = await app.ctx.db.select().from(legalAcceptances).where(eq(legalAcceptances.userEmail, email));
    expect(rows).toHaveLength(2);
  });

  it('una organización existente acepta desde el panel', async () => {
    const me = await api(app, existing, 'GET', '/auth/me');
    expect(me.body.legal.map((d: { kind: string; version: number }) => `${d.kind}:${d.version}`)).toEqual(['terms:1', 'dpa:1']);
    expect(me.body.legal[0].note).toBe('Primera versión');

    const status = await api(app, existing, 'GET', '/legal/status');
    expect(status.body.documents.find((d: { kind: string }) => d.kind === 'terms')).toMatchObject({ version: 1, accepted: null, pending: true });
    expect(status.body.documents.find((d: { kind: string }) => d.kind === 'privacy')).toMatchObject({ pending: false });

    // Una versión que no es la vigente no se acepta.
    const stale = await api(app, existing, 'POST', '/legal/accept', { documents: [{ kind: 'terms', version: 7 }] });
    expect(stale.status).toBe(409);
    expect((await api(app, existing, 'POST', '/legal/accept', { documents: [{ kind: 'privacy', version: 1 }] })).status).toBe(400);

    const ok = await api(app, existing, 'POST', '/legal/accept', {
      documents: [
        { kind: 'terms', version: 1 },
        { kind: 'dpa', version: 1 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.pending).toEqual([]);
    expect((await api(app, existing, 'GET', '/auth/me')).body.legal).toEqual([]);
    const after = await api(app, existing, 'GET', '/legal/status');
    expect(after.body.documents.find((d: { kind: string }) => d.kind === 'terms').accepted).toMatchObject({ version: 1, userName: 'Admin' });
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.tenantId, existing.tenantId));
    expect(logs.map((l) => l.summary)).toContain('Aceptó «Términos y condiciones del servicio» (versión 1) y «Acuerdo de tratamiento de datos personales» (versión 1) en nombre de la organización');
  });

  it('el soporte no acepta en nombre de la organización', async () => {
    const support = { headers: { ...root.headers, 'x-tenant-id': existing.tenantId } };
    expect((await api(app, support, 'GET', '/auth/me')).body.legal).toEqual([]);
    const res = await api(app, support, 'POST', '/legal/accept', { documents: [{ kind: 'terms', version: 1 }] });
    expect(res.status).toBe(403);
  });

  it('solo una versión importante pide aceptar de nuevo', async () => {
    const minor = await publish('terms', { requiresAcceptance: false, note: 'Correcciones de redacción' });
    expect(minor.body.version).toBe(2);
    expect((await api(app, existing, 'GET', '/auth/me')).body.legal).toEqual([]);

    const major = await publish('terms', { note: 'Nuevos precios de los módulos' });
    expect(major.body.version).toBe(3);
    const me = await api(app, existing, 'GET', '/auth/me');
    expect(me.body.legal).toEqual([{ kind: 'terms', title: 'Términos y condiciones del servicio', path: '/terminos', version: 3, note: 'Nuevos precios de los módulos' }]);

    // Las versiones anteriores siguen disponibles.
    const old = await api(app, null, 'GET', '/public/legal/terms?version=1');
    expect(old.body).toMatchObject({ version: 1, current: false });
    expect(old.body.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect((await api(app, null, 'GET', '/public/legal/terms?version=9')).status).toBe(404);

    const tenantsStatus = await api(app, root, 'GET', '/platform/legal/tenants');
    const row = tenantsStatus.body.find((t: { tenant: { id: string } }) => t.tenant.id === existing.tenantId);
    expect(row.pending).toEqual(['terms']);
    expect(row.accepted.dpa.version).toBe(1);
    const admin = await api(app, root, 'GET', '/platform/legal');
    expect(admin.body.pendingTenants).toBeGreaterThanOrEqual(1);
    expect(admin.body.documents[0].current).toMatchObject({ version: 3, accepted: 0 });
    const history = await api(app, root, 'GET', '/platform/legal/terms/versions');
    expect(history.body.map((v: { version: number; accepted: number }) => [v.version, v.accepted > 0])).toEqual([
      [3, false],
      [2, false],
      [1, true],
    ]);
  });

  it('avisa cuando los datos del titular cambiaron después de publicar', async () => {
    expect((await api(app, root, 'GET', '/platform/legal')).body.documents.every((d: { outdated: boolean }) => !d.outdated)).toBe(true);
    await api(app, root, 'PUT', '/platform/legal/settings', { holder: { address: 'Calle Nueva 99, Asunción' } });
    const admin = await api(app, root, 'GET', '/platform/legal');
    // El acuerdo de tratamiento de datos no usa el domicilio.
    expect(admin.body.documents.filter((d: { outdated: boolean }) => d.outdated).map((d: { kind: string }) => d.kind)).toEqual(['terms', 'privacy']);
    // El texto publicado no cambia hasta publicar de nuevo.
    expect((await api(app, null, 'GET', '/public/legal/privacy')).body.content).toContain('Av. Mariscal López 1234');
  });

  it('se puede desactivar la aceptación obligatoria', async () => {
    await api(app, root, 'PUT', '/platform/legal/settings', { requireAcceptance: false });
    expect((await api(app, existing, 'GET', '/auth/me')).body.legal).toEqual([]);
    expect((await register()).status).toBe(201);
    expect((await api(app, null, 'GET', '/public/config')).body.legal.acceptance).toBe(false);
    await api(app, root, 'PUT', '/platform/legal/settings', { requireAcceptance: true });
  });
});

describe('aviso de privacidad de la organización', () => {
  it('se muestra en el kiosco y en la reserva con el texto estándar o el propio', async () => {
    const kioskToken = (await api(app, existing, 'GET', '/kiosks')).body[0].token;
    expect((await api(app, null, 'GET', `/public/kiosks/${kioskToken}`)).body.tenant.privacyNotice).toBeNull();

    await api(app, existing, 'PUT', '/tenant', { settings: { privacy: { retentionDays: 90, notice: { enabled: true, contact: 'privacidad@clinica.test' } } } });
    const notice = (await api(app, null, 'GET', `/public/kiosks/${kioskToken}`)).body.tenant.privacyNotice;
    expect(notice.url).toBeNull();
    expect(notice.text).toContain('Clínica Existente es responsable de los datos');
    expect(notice.text).toContain('a los 3 meses');
    expect(notice.text).toContain('en privacidad@clinica.test');

    const custom = await api(app, existing, 'PUT', '/tenant', { settings: { privacy: { notice: { text: 'Aviso propio.', url: 'https://clinica.test/privacidad' } } } });
    expect(custom.status).toBe(200);
    expect((await api(app, null, 'GET', `/public/kiosks/${kioskToken}`)).body.tenant.privacyNotice).toEqual({ text: 'Aviso propio.', url: 'https://clinica.test/privacidad' });
    expect((await api(app, existing, 'PUT', '/tenant', { settings: { privacy: { notice: { url: 'javascript:alert(1)' } } } })).status).toBe(400);
  });
});
