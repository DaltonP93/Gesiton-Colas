import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '../src/lib/crypto';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

let app: FastifyInstance;
let orgA: TenantSession;
let orgB: TenantSession;

beforeAll(async () => {
  app = await createTestApp();
  orgA = await registerTenant(app, 'Banco A');
  orgB = await registerTenant(app, 'Banco B');
});

afterAll(async () => {
  await app.close();
});

describe('aislamiento entre organizaciones', () => {
  it('una organización no ve ni modifica datos de otra', async () => {
    const branchA = (await api(app, orgA, 'GET', '/branches')).body[0];
    expect((await api(app, orgB, 'GET', `/branches/${branchA.id}`)).status).toBe(404);
    expect((await api(app, orgB, 'PUT', `/branches/${branchA.id}`, { name: 'hack' })).status).toBe(404);
    expect((await api(app, orgB, 'GET', `/branches/${branchA.id}/queue`)).status).toBe(404);
    const servicesB = (await api(app, orgB, 'GET', '/services')).body;
    const res = await api(app, orgA, 'POST', '/tickets', { branchId: branchA.id, serviceId: servicesB[0].id });
    expect(res.status).toBe(404);
  });

  it('exige autenticación', async () => {
    expect((await api(app, null, 'GET', '/branches')).status).toBe(401);
    expect((await api(app, { headers: { authorization: 'Bearer basura' } }, 'GET', '/branches')).status).toBe(401);
  });
});

describe('configuración y personalización', () => {
  it('mezcla la configuración y valida colores', async () => {
    const ok = await api(app, orgA, 'PUT', '/tenant', {
      settings: {
        branding: { appName: 'Mi Banco', primaryColor: '#ff0000' },
        terminology: { ticket: 'Ficha', counter: 'Caja' },
        customerFields: [{ key: 'socio', label: 'N° de socio', type: 'text', required: true }],
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.branding.appName).toBe('Mi Banco');
    expect(ok.body.settings.branding.accentColor).toBe('#f59e0b');
    expect(ok.body.settings.terminology.ticket).toBe('Ficha');
    expect(ok.body.settings.customerFields[0].key).toBe('socio');

    const bad = await api(app, orgA, 'PUT', '/tenant', { settings: { branding: { primaryColor: 'rojo' } } });
    expect(bad.status).toBe(400);

    const display = (await api(app, orgA, 'GET', '/displays')).body[0];
    const updated = await api(app, orgA, 'PUT', `/displays/${display.id}`, {
      config: { layout: 'fullscreen', voice: { template: '{{code}} a {{counter}}' }, ticker: { enabled: true, messages: ['Hola'] } },
    });
    expect(updated.body.config.layout).toBe('fullscreen');
    expect(updated.body.config.voice.enabled).toBe(true);
    expect(updated.body.config.ticker.messages).toEqual(['Hola']);
  });

  it('respeta los límites del plan', async () => {
    const branch = (await api(app, orgB, 'GET', '/branches')).body[0];
    const second = await api(app, orgB, 'POST', '/displays', { branchId: branch.id, name: 'Pantalla 2' });
    expect(second.status).toBe(201);
    const third = await api(app, orgB, 'POST', '/displays', { branchId: branch.id, name: 'Pantalla 3' });
    expect(third.status).toBe(402);
    const branch2 = await api(app, orgB, 'POST', '/branches', { name: 'Sucursal 2', code: '002' });
    expect(branch2.status).toBe(402);
  });
});

describe('publicidad', () => {
  it('detecta plataformas, sube archivos y arma listas', async () => {
    const yt = await api(app, orgA, 'POST', '/media', { url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(yt.status).toBe(201);
    expect(yt.body).toMatchObject({ kind: 'youtube', provider: 'youtube', externalId: 'dQw4w9WgXcQ' });

    const tiktok = await api(app, orgA, 'POST', '/media', { url: 'https://www.tiktok.com/@marca/video/7234567890123456789', duration: 25 });
    expect(tiktok.body).toMatchObject({ kind: 'embed', provider: 'tiktok', duration: 25 });

    const text = await api(app, orgA, 'POST', '/media', { text: { content: '¡Promo 2x1!', background: '#000000', color: '#ffffff' } });
    expect(text.body.kind).toBe('text');

    // PNG de 1x1
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const boundary = '----gctest';
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nBanner\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="banner.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...orgA.headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    expect(upload.statusCode).toBe(201);
    const uploaded = upload.json();
    expect(uploaded).toMatchObject({ kind: 'image', provider: 'upload', name: 'Banner', sizeBytes: png.length });
    const served = await app.inject({ method: 'GET', url: uploaded.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-security-policy']).toContain('sandbox');

    const exe = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: { ...orgA.headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.exe"\r\nContent-Type: application/x-msdownload\r\n\r\nMZ`),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(exe.statusCode).toBe(400);

    const playlist = await api(app, orgA, 'POST', '/playlists', {
      name: 'Promos',
      items: [
        { mediaId: yt.body.id },
        { mediaId: uploaded.id, duration: 8, schedule: { days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00' } },
        { mediaId: text.body.id },
      ],
    });
    expect(playlist.status).toBe(201);
    expect(playlist.body.items.map((i: { media: { kind: string } }) => i.media.kind)).toEqual(['youtube', 'image', 'text']);

    const display = (await api(app, orgA, 'GET', '/displays')).body[0];
    await api(app, orgA, 'PUT', `/displays/${display.id}`, { playlistId: playlist.body.id });
    const boot = await api(app, null, 'GET', `/public/displays/${display.token}`);
    expect(boot.status).toBe(200);
    expect(boot.body.playlist.items).toHaveLength(3);
    expect(boot.body.tenant.branding.appName).toBe('Mi Banco');

    // al borrar un contenido desaparece de la lista
    await api(app, orgA, 'DELETE', `/media/${uploaded.id}`);
    const after = await api(app, orgA, 'GET', `/playlists/${playlist.body.id}`);
    expect(after.body.items).toHaveLength(2);
  });
});

describe('integraciones', () => {
  it('API keys con permisos', async () => {
    const created = await api(app, orgA, 'POST', '/api-keys', { name: 'ERP', scopes: ['tickets:write', 'tickets:read', 'catalog:read'] });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^gc_/);
    const keyHeaders = { headers: { 'x-api-key': created.body.key } };

    const branch = (await api(app, keyHeaders, 'GET', '/branches')).body[0];
    const service = (await api(app, keyHeaders, 'GET', '/services')).body[0];
    const ticket = await api(app, keyHeaders, 'POST', '/tickets', {
      branchId: branch.id,
      serviceId: service.id,
      customer: { name: 'Juan Pérez', socio: '123' },
    });
    expect(ticket.status).toBe(201);
    expect(ticket.body.ticket.channel).toBe('api');
    expect(ticket.body.ticket.customer).toEqual({ name: 'Juan Pérez', socio: '123' });

    // también como Bearer
    const bearer = await api(app, { headers: { authorization: `Bearer ${created.body.key}` } }, 'GET', '/services');
    expect(bearer.status).toBe(200);

    expect((await api(app, keyHeaders, 'GET', '/users')).status).toBe(403);
    expect((await api(app, keyHeaders, 'POST', '/services', { name: 'x' })).status).toBe(403);

    await api(app, orgA, 'DELETE', `/api-keys/${created.body.id}`);
    expect((await api(app, keyHeaders, 'GET', '/services')).status).toBe(401);
  });

  it('webhooks firmados con reintentos', async () => {
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    let fail = true;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = fail ? 500 : 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

    try {
      const hook = await api(app, orgA, 'POST', '/webhooks', { name: 'CRM', url, events: ['ticket.created'] });
      expect(hook.status).toBe(201);
      expect(hook.body.secret).toMatch(/^whsec_/);

      const ping = await api(app, orgA, 'POST', `/webhooks/${hook.body.id}/test`);
      expect(ping.body).toMatchObject({ ok: false, status: 500 });

      fail = false;
      const branch = (await api(app, orgA, 'GET', '/branches')).body[0];
      const service = (await api(app, orgA, 'GET', '/services')).body[0];
      await api(app, orgA, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id });
      await app.ctx.webhooks.processDue();
      await new Promise((r) => setTimeout(r, 100));

      const delivery = received.find((r) => r.headers['x-gc-event'] === 'ticket.created');
      expect(delivery).toBeDefined();
      const expected = hmacSha256(hook.body.secret, `${delivery!.headers['x-gc-timestamp']}.${delivery!.body}`);
      expect(delivery!.headers['x-gc-signature']).toBe(`sha256=${expected}`);
      expect(JSON.parse(delivery!.body).data.ticket.code).toBeTruthy();

      const deliveries = await api(app, orgA, 'GET', `/webhooks/${hook.body.id}/deliveries`);
      expect(deliveries.body[0].status).toBe('success');
    } finally {
      server.close();
    }
  });

  it('bloquea webhooks a redes privadas en modo SaaS', async () => {
    const strict = await createTestApp({ WEBHOOKS_ALLOW_PRIVATE: 'false' });
    try {
      const org = await registerTenant(strict, 'Estricta');
      const res = await api(strict, org, 'POST', '/webhooks', { name: 'x', url: 'http://127.0.0.1:9/hook' });
      expect(res.status).toBe(400);
    } finally {
      await strict.close();
    }
  });
});

describe('tiempo real', () => {
  it('la pantalla recibe el llamado sin datos personales', async () => {
    const rtApp = await createTestApp();
    await rtApp.listen({ port: 0, host: '127.0.0.1' });
    const port = (rtApp.server.address() as AddressInfo).port;
    try {
      const org = await registerTenant(rtApp, 'Tiempo Real');
      const display = (await api(rtApp, org, 'GET', '/displays')).body[0];
      const kiosk = (await api(rtApp, org, 'GET', '/kiosks')).body[0];
      const branch = (await api(rtApp, org, 'GET', '/branches')).body[0];
      const service = (await api(rtApp, org, 'GET', '/services')).body[0];
      const counter = (await api(rtApp, org, 'GET', `/counters?branchId=${branch.id}`)).body[0];

      const socket = ioClient(`http://127.0.0.1:${port}`, { auth: { kind: 'display', token: display.token }, transports: ['websocket'] });
      await new Promise<void>((resolve, reject) => {
        socket.on('ready', () => resolve());
        socket.on('connect_error', reject);
      });
      const called = new Promise<any>((resolve) => socket.on('ticket.called', resolve));

      await api(rtApp, null, 'POST', `/public/kiosks/${kiosk.token}/tickets`, {
        serviceId: service.id,
        customer: { name: 'Privado' },
      });
      await api(rtApp, org, 'PUT', '/agent/workstation', { branchId: branch.id, counterId: counter.id, serviceIds: [service.id], paused: false });
      await api(rtApp, org, 'POST', '/agent/call-next');

      const event = await called;
      expect(event.call.code).toBe('A001');
      expect(event.call.counter).toBe(counter.name);
      expect(event.call.customerName).toBeNull();
      expect(event.ticket.publicToken).toBeUndefined();
      expect(event.ticket.customer).toBeUndefined();
      socket.close();
    } finally {
      await rtApp.close();
    }
  });
});
