import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLandingSection, landingSettingsSchema } from '@gc/shared';
import { api, createTestApp } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };

let app: FastifyInstance;
let root: { headers: Record<string, string> };

beforeAll(async () => {
  // Frontend compilado de mentira para probar el HTML que sirve el servidor.
  const web = mkdtempSync(path.join(os.tmpdir(), 'gc-web-'));
  writeFileSync(
    path.join(web, 'index.html'),
    '<!doctype html><html><head><meta name="description" content="genérica" /><title>Gestión de Colas</title></head><body><div id="root"></div></body></html>',
  );
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password, WEB_DIST: web });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
});

afterAll(async () => {
  await api(app, root, 'PUT', '/platform/settings', { homePage: 'landing', landing: landingSettingsSchema.parse({}) });
  await app.close();
});

describe('página de presentación', () => {
  it('trae el contenido de ejemplo y la dirección del panel en la configuración pública', async () => {
    await api(app, root, 'PUT', '/platform/settings', { landing: landingSettingsSchema.parse({}) });
    const config = await api(app, null, 'GET', '/public/config');
    expect(config.body.landing.template).toBe('moderna');
    expect(config.body.landing.sections.map((s: { type: string }) => s.type)).toEqual(['features', 'steps', 'faq', 'cta']);
    expect(config.body.landingPlans).toEqual([]);
    expect(config.body.appUrl).toBe('http://colas.test');
  });

  it('guarda cambios parciales sin pisar el resto y reemplaza la lista de secciones', async () => {
    const res = await api(app, root, 'PUT', '/platform/settings', { landing: { template: 'oscura', hero: { title: 'Turnos sin filas' } } });
    expect(res.status).toBe(200);
    expect(res.body.landing.template).toBe('oscura');
    expect(res.body.landing.hero).toMatchObject({ title: 'Turnos sin filas', highlight: 'sin filas', media: 'mockup' });
    expect(res.body.landing.sections).toHaveLength(4);

    const faq = { ...defaultLandingSection('faq'), items: [{ question: '¿Hay app?', answer: 'Funciona en el navegador.' }] };
    const replaced = await api(app, root, 'PUT', '/platform/settings', { landing: { sections: [faq], footer: { social: { instagram: 'https://instagram.com/colas' } } } });
    expect(replaced.body.landing.sections).toEqual([faq]);
    // Quitar una red social se guarda (no queda la anterior).
    const cleared = await api(app, root, 'PUT', '/platform/settings', { landing: { footer: { social: { instagram: '' } } } });
    expect(cleared.body.landing.footer.social.instagram).toBe('');
  });

  it('rechaza enlaces peligrosos, imágenes inválidas y secciones repetidas', async () => {
    const js = await api(app, root, 'PUT', '/platform/settings', { landing: { hero: { primary: { label: 'Ir', action: 'url', url: 'javascript:alert(1)' } } } });
    expect(js.status).toBe(400);
    expect(js.body.message).toContain('hero.primary.url');
    const img = await api(app, root, 'PUT', '/platform/settings', { landing: { hero: { imageUrl: 'data:image/svg+xml,<svg/>' } } });
    expect(img.status).toBe(400);
    const twice = await api(app, root, 'PUT', '/platform/settings', { landing: { sections: [defaultLandingSection('faq'), defaultLandingSection('faq')] } });
    expect(twice.status).toBe(400);
    expect((await api(app, root, 'PUT', '/platform/settings', { landing: { domain: 'https://www.colas.test/' } })).status).toBe(400);
  });

  it('muestra los precios de los planes elegidos solo con la sección de precios activa', async () => {
    await api(app, root, 'PUT', '/platform/settings', { plans: { pro: { monthlyPrice: 250000, currency: 'PYG' } } });
    const pricing = { ...defaultLandingSection('pricing'), plans: ['pro', 'enterprise'] };
    await api(app, root, 'PUT', '/platform/settings', { landing: { sections: [pricing] } });
    const config = await api(app, null, 'GET', '/public/config');
    expect(config.body.landingPlans.map((p: { id: string }) => p.id)).toEqual(['pro', 'enterprise']);
    expect(config.body.landingPlans[0]).toMatchObject({ name: 'Profesional', monthlyPrice: 250000, currency: 'PYG' });
    expect(config.body.landingPlans[0].modules.length).toBeGreaterThan(0);

    await api(app, root, 'PUT', '/platform/settings', { landing: { sections: [{ ...pricing, enabled: false }] } });
    expect((await api(app, null, 'GET', '/public/config')).body.landingPlans).toEqual([]);
    await api(app, root, 'PUT', '/platform/settings', { plans: { pro: { monthlyPrice: 0 } } });
  });

  it('no deja la presentación despublicada como página principal', async () => {
    await api(app, root, 'PUT', '/platform/settings', { homePage: 'landing' });
    expect((await api(app, root, 'PUT', '/platform/settings', { landing: { enabled: false } })).status).toBe(400);
    const ok = await api(app, root, 'PUT', '/platform/settings', { homePage: 'login', landing: { enabled: false } });
    expect(ok.status).toBe(200);
    expect((await api(app, null, 'GET', '/public/config')).body.homePage).toBe('login');
    await api(app, root, 'PUT', '/platform/settings', { homePage: 'landing', landing: { enabled: true } });
  });

  it('sirve el título y la imagen para compartir el enlace, con el texto escapado', async () => {
    await api(app, root, 'PUT', '/platform/settings', {
      homePage: 'landing',
      landing: { seo: { title: 'Colas "rápidas" <b>', description: 'Turnos & pantallas', imageUrl: '/uploads/platform/portada.png' } },
    });
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.body).toContain('<title>Colas &quot;rápidas&quot; &lt;b&gt;</title>');
    expect(home.body).toContain('<meta property="og:description" content="Turnos &amp; pantallas" />');
    expect(home.body).toContain('<meta property="og:image" content="http://colas.test/uploads/platform/portada.png" />');
    expect(home.body).not.toContain('genérica');

    // Las demás páginas reciben el HTML de siempre.
    const panel = await app.inject({ method: 'GET', url: '/app/turnos' });
    expect(panel.body).toContain('<title>Gestión de Colas</title>');

    // Con el ingreso como página principal, la presentación sigue en /presentacion y en su dominio propio.
    await api(app, root, 'PUT', '/platform/settings', { homePage: 'login', landing: { domain: 'www.colas.test' } });
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('<title>Gestión de Colas</title>');
    expect((await app.inject({ method: 'GET', url: '/presentacion' })).body).toContain('og:title');
    expect((await app.inject({ method: 'GET', url: '/', headers: { host: 'www.colas.test' } })).body).toContain('og:title');
    await api(app, root, 'PUT', '/platform/settings', { homePage: 'landing', landing: { domain: '' } });
  });
});
