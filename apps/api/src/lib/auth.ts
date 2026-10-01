import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { MODULES, hasRole, type ApiKeyScope, type ModuleId, type Role } from '@gc/shared';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { apiKeys, tenants, users, type Tenant, type User } from '../db/schema';
import { sha256 } from './crypto';
import { AppError, forbidden, unauthorized } from './errors';

export type AuthInfo =
  | { kind: 'user'; userId: string; tenantId: string | null; role: Role; user: User; tenant: Tenant | null }
  | { kind: 'apiKey'; keyId: string; keyName: string; tenantId: string; role: Role; scopes: ApiKeyScope[]; tenant: Tenant };

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
  /** Módulo que la organización debe tener activo. */
  module?: ModuleId;
  /** Permitir el acceso aunque la organización esté suspendida por falta de pago (para poder pagar). */
  allowBillingSuspended?: boolean;
}

/** Calcula los módulos activos de una organización (lo provee el contexto de la aplicación). */
export type ModulesResolver = (tenant: Tenant) => Promise<ModuleId[]>;

/** Falla si la organización no tiene el módulo activo. */
export async function assertModuleActive(resolver: ModulesResolver, tenant: Tenant, module: ModuleId) {
  if (!(await resolver(tenant)).includes(module)) {
    throw new AppError(403, 'module_disabled', `El módulo «${MODULES[module].name}» no está activo para su organización. Contacte al administrador de la plataforma.`);
  }
}

export const API_KEY_PREFIX = 'gc_';

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createAuth(config: AppConfig, db: Database, modulesOf?: ModulesResolver) {
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
      // Tokens emitidos antes de un cambio o restablecimiento de contraseña ya no valen.
      const validAfter = found.user.sessionsValidAfter?.getTime();
      if (validAfter && (payload.iat ?? 0) * 1000 < validAfter) return null;
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
      keyName: found.key.name,
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
      if (auth.tenant && auth.role !== 'superadmin') assertTenantAvailable(auth.tenant, { allowBilling: options.allowBillingSuspended && auth.kind === 'user' });
      if (modulesOf && auth.tenant && !(options.allowBillingSuspended && auth.tenant.status !== 'active')) {
        // Las API keys solo funcionan con el módulo de integraciones activo.
        if (auth.kind === 'apiKey') await assertModuleActive(modulesOf, auth.tenant, 'integrations');
        if (options.module) await assertModuleActive(modulesOf, auth.tenant, options.module);
      }
    };
  }

  return { signToken, resolve, require, userFromToken };
}

export type Auth = ReturnType<typeof createAuth>;

/** Falla si la organización está suspendida o si su demo venció. */
export function assertTenantAvailable(tenant: Pick<Tenant, 'status' | 'isDemo' | 'demoExpiresAt'> & { suspendedReason?: string | null }, options: { allowBilling?: boolean } = {}) {
  if (tenant.status !== 'active') {
    if (tenant.suspendedReason === 'billing') {
      if (options.allowBilling) return;
      throw new AppError(403, 'billing_suspended', 'La organización está suspendida por falta de pago. Un administrador puede regularizarla en «Plan y facturación».');
    }
    throw forbidden('La organización está suspendida. Contacte al soporte.');
  }
  if (tenant.isDemo && tenant.demoExpiresAt && tenant.demoExpiresAt.getTime() < Date.now()) {
    throw new AppError(403, 'demo_expired', 'La demo venció. Contáctenos para continuar con un plan y conservar su configuración.');
  }
}

/** Marca de tiempo (redondeada al segundo) a partir de la cual valen los nuevos tokens de sesión. */
export function sessionsResetNow() {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/** Devuelve el tenant de la petición autenticada o falla. */
export function tenantIdOf(request: FastifyRequest): string {
  const tenantId = request.auth?.tenantId;
  if (!tenantId) throw forbidden('Esta acción requiere operar dentro de una organización');
  return tenantId;
}

export function userIdOf(request: FastifyRequest): string | null {
  return request.auth?.kind === 'user' ? request.auth.userId : null;
}
