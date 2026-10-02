import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };

// Con WEBHOOKS_ALLOW_PRIVATE desactivado, los destinos de copia no pueden apuntar a direcciones internas (anti-SSRF).
let app: FastifyInstance;
let root: { headers: Record<string, string> };

beforeAll(async () => {
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password, WEBHOOKS_ALLOW_PRIVATE: 'false' });
  root = { headers: { authorization: `Bearer ${(await api(app, null, 'POST', '/auth/login', ROOT)).body.token}` } };
});

afterAll(async () => {
  await app.close();
});

describe('destinos de copia: anti-SSRF', () => {
  it('rechaza destinos que apunten a direcciones privadas o internas', async () => {
    const dav = (url: string) => ({ kind: 'webdav', name: 'x', config: { provider: 'other', url, username: 'a' }, secrets: { password: 'y' } });
    for (const url of ['http://127.0.0.1:5432/dav/', 'http://169.254.169.254/latest/', 'http://[::1]:9200/dav/', 'http://10.0.0.5/dav/']) {
      const test = await api(app, root, 'POST', '/platform/backups/targets/test', dav(url));
      expect(test.status, url).toBe(400);
      const save = await api(app, root, 'POST', '/platform/backups/targets', dav(url));
      expect(save.status, url).toBe(400);
    }
    const sftp = await api(app, root, 'POST', '/platform/backups/targets/test', {
      kind: 'sftp',
      name: 'x',
      config: { host: '127.0.0.1', port: 22, username: 'c', path: 'r', hostFingerprint: '' },
      secrets: { password: 'c' },
    });
    expect(sftp.status).toBe(400);
    const s3 = await api(app, root, 'POST', '/platform/backups/targets/test', {
      kind: 's3',
      name: 'x',
      config: { provider: 'minio', endpoint: 'http://169.254.169.254', region: 'us-east-1', bucket: 'copias', prefix: '', pathStyle: true },
      secrets: { accessKeyId: 'k', secretAccessKey: 's' },
    });
    expect(s3.status).toBe(400);
  });
});
