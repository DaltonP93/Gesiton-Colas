import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

export async function createTestApp(overrides: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTO_MIGRATE: 'false',
    WEBHOOKS_ALLOW_PRIVATE: 'true',
    UPLOAD_DIR: mkdtempSync(path.join(os.tmpdir(), 'gc-uploads-')),
    PUBLIC_URL: 'http://colas.test',
    ...overrides,
  });
  return buildApp({ config, logger: false });
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@test.local`;
}

export interface TenantSession {
  token: string;
  tenantId: string;
  userId: string;
  headers: { authorization: string };
}

export async function registerTenant(app: FastifyInstance, name = 'Org Test'): Promise<TenantSession> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: name, name: 'Admin', email: uniqueEmail('admin'), password: 'password123', timezone: 'America/Asuncion' },
  });
  if (res.statusCode !== 201) throw new Error(`registro falló: ${res.body}`);
  const body = res.json();
  return { token: body.token, tenantId: body.tenant.id, userId: body.user.id, headers: { authorization: `Bearer ${body.token}` } };
}

export async function api<T = any>(app: FastifyInstance, session: { headers: Record<string, string> } | null, method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: session?.headers ?? {},
    payload: payload as any,
  });
  let body: T;
  try {
    body = res.json() as T;
  } catch {
    body = res.body as unknown as T;
  }
  return { status: res.statusCode, body, res };
}
