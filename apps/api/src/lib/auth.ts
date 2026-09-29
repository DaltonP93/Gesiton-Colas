import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { hasRole, type ApiKeyScope, type Role } from '@gc/shared';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { apiKeys, tenants, users, type Tenant, type User } from '../db/schema';
import { sha256 } from './crypto';
import { forbidden, unauthorized } from './errors';

export type AuthInfo =
  | { kind: 'user'; userId: string; tenantId: string | null; role: Role; user: User; tenant: Tenant | null }
  | { kind: 'apiKey'; keyId: string; tenantId: string; role: Role; scopes: ApiKeyScope[]; tenant: Tenant };

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthInfo;
  }
}

export interface RequireOptions {
  /** Rol mínimo para usuarios. */
  role?: Role;
  /** Si se indica, las API keys con este permiso también pueden acceder. */
  scope?: ApiKeyScope;
}

export const API_KEY_PREFIX = 'gc_';

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createAuth(config: AppConfig, db: Database) {
  const secret = new TextEncoder().encode(config.JWT_SECRET);

  async function signToken(user: Pick<User, 'id' | 'tenantId' | 'role'>) {
    return new SignJWT({ tid: user.tenantId, role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(config.JWT_EXPIRES_IN)
      .sign(secret);
  }

  async function userFromToken(token: string): Promise<{ user: User; tenant: Tenant | null } | null> {
    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      if (!payload.sub) return null;
      const row = await db
        .select({ user: users, tenant: tenants })
        .from(users)
        .leftJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, payload.sub))
        .limit(1);
      const found = row[0];
      if (!found || !found.user.active) return null;
      return { user: found.user, tenant: found.tenant };
    } catch {
      return null;
    }
  }

  async function authFromApiKey(key: string): Promise<AuthInfo | null> {
    const row = await db
      .select({ key: apiKeys, tenant: tenants })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)))
      .limit(1);
    const found = row[0];
    if (!found) return null;
    // No bloquea la petición: actualiza "último uso" en segundo plano.
    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, found.key.id)).catch(() => undefined);
    return {
      kind: 'apiKey',
      keyId: found.key.id,
      tenantId: found.key.tenantId,
      role: 'admin',
      scopes: found.key.scopes,
      tenant: found.tenant,
    };
  }

  async function resolve(request: FastifyRequest): Promise<AuthInfo | null> {
    if (request.auth) return request.auth;
    const header = request.headers.authorization;
    const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined;
    const apiKey = (request.headers['x-api-key'] as string | undefined) ?? (bearer?.startsWith(API_KEY_PREFIX) ? bearer : undefined);

    let auth: AuthInfo | null = null;
    if (apiKey) {
      auth = await authFromApiKey(apiKey);
    } else if (bearer) {
      const found = await userFromToken(bearer);
      if (found) {
        let { tenant } = found;
        let tenantId = found.user.tenantId;
        // El superadministrador puede operar dentro de cualquier organización (soporte).
        const impersonate = request.headers['x-tenant-id'];
        if (found.user.role === 'superadmin' && typeof impersonate === 'string' && impersonate) {
          const [t] = await db.select().from(tenants).where(eq(tenants.id, impersonate)).limit(1);
          if (t) {
            tenant = t;
            tenantId = t.id;
          }
        }
        auth = { kind: 'user', userId: found.user.id, tenantId, role: found.user.role, user: found.user, tenant };
      }
    }
    if (auth) request.auth = auth;
    return auth;
  }

  /** preHandler que exige autenticación con un rol mínimo (y opcionalmente acepta API keys con un permiso). */
  function require(options: RequireOptions = {}) {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = await resolve(request);
      if (!auth) throw unauthorized();
      if (auth.kind === 'apiKey') {
        if (!options.scope || !auth.scopes.includes(options.scope)) {
          throw forbidden(`La API key no tiene el permiso ${options.scope ?? 'requerido'}`);
        }
      } else if (options.role && !hasRole(auth.role, options.role)) {
        throw forbidden();
      }
      if (auth.tenant && auth.tenant.status !== 'active' && auth.role !== 'superadmin') {
        throw forbidden('La organización está suspendida. Contacte al soporte.');
      }
    };
  }

  return { signToken, resolve, require, userFromToken };
}

export type Auth = ReturnType<typeof createAuth>;

/** Devuelve el tenant de la petición autenticada o falla. */
export function tenantIdOf(request: FastifyRequest): string {
  const tenantId = request.auth?.tenantId;
  if (!tenantId) throw forbidden('Esta acción requiere operar dentro de una organización');
  return tenantId;
}

export function userIdOf(request: FastifyRequest): string | null {
  return request.auth?.kind === 'user' ? request.auth.userId : null;
}
