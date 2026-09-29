import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LOCALES, PLANS, type MeDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { createTenantWithDefaults } from '../../db/seed';
import { tenants, users } from '../../db/schema';
import { hashPassword, verifyPassword } from '../../lib/auth';
import { toTenantDTO, toUserDTO } from '../../lib/dto';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors';
import { userScope } from '../tickets/queue';

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);

export const authRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const authLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  async function me(userId: string, tenantOverride?: string | null): Promise<MeDTO> {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw unauthorized();
    const tenantId = tenantOverride ?? user.tenantId;
    const [tenant] = tenantId ? await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1) : [];
    const scope = await userScope(ctx.db, user.id);
    return {
      user: toUserDTO(user, scope.branchIds, scope.serviceIds),
      tenant: tenant ? toTenantDTO(tenant) : null,
      limits: tenant ? PLANS[tenant.plan] : null,
    };
  }

  app.post(
    '/auth/register',
    {
      config: authLimit,
      schema: {
        tags: ['Autenticación'],
        summary: 'Registrar una nueva organización (alta SaaS)',
        security: [],
        body: z.object({
          organizationName: z.string().trim().min(2).max(120),
          name: z.string().trim().min(2).max(120),
          email,
          password,
          timezone: z.string().max(64).optional(),
          locale: z.enum(LOCALES).optional(),
        }),
      },
    },
    async (request, reply) => {
      if (!ctx.config.ALLOW_SIGNUP) throw forbidden('El registro de nuevas organizaciones está deshabilitado');
      const body = request.body;
      const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (exists) throw conflict('Ya existe una cuenta con ese email');
      const { admin } = await ctx.db.transaction((tx) =>
        createTenantWithDefaults(tx, {
          organizationName: body.organizationName,
          adminName: body.name,
          adminEmail: body.email,
          adminPassword: body.password,
          timezone: body.timezone,
          locale: body.locale,
        }),
      );
      const token = await ctx.auth.signToken(admin);
      return reply.code(201).send({ token, ...(await me(admin.id)) });
    },
  );

  app.post(
    '/auth/login',
    {
      config: authLimit,
      schema: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión',
        security: [],
        body: z.object({ email, password: z.string().min(1).max(200) }),
      },
    },
    async (request) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.email, request.body.email)).limit(1);
      const valid = user && (await verifyPassword(request.body.password, user.passwordHash));
      if (!user || !valid) throw unauthorized('Email o contraseña incorrectos');
      if (!user.active) throw forbidden('El usuario está deshabilitado');
      if (user.tenantId) {
        const [tenant] = await ctx.db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, user.tenantId));
        if (tenant?.status !== 'active') throw forbidden('La organización está suspendida. Contacte al soporte.');
      }
      await ctx.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const token = await ctx.auth.signToken(user);
      return { token, ...(await me(user.id)) };
    },
  );

  app.get(
    '/auth/me',
    { preHandler: ctx.auth.require(), schema: { tags: ['Autenticación'], summary: 'Usuario actual, organización y límites del plan' } },
    async (request) => {
      if (request.auth?.kind !== 'user') throw badRequest('Disponible solo para usuarios');
      return me(request.auth.userId, request.auth.tenantId);
    },
  );

  app.put(
    '/auth/me',
    {
      preHandler: ctx.auth.require(),
      schema: {
        tags: ['Autenticación'],
        summary: 'Actualizar perfil propio',
        body: z.object({
          name: z.string().trim().min(2).max(120).optional(),
          locale: z.enum(LOCALES).nullable().optional(),
          currentPassword: z.string().max(200).optional(),
          newPassword: password.optional(),
        }),
      },
    },
    async (request) => {
      if (request.auth?.kind !== 'user') throw badRequest('Disponible solo para usuarios');
      const { user } = request.auth;
      const body = request.body;
      const patch: Partial<typeof users.$inferInsert> = {};
      if (body.name) patch.name = body.name;
      if (body.locale !== undefined) patch.locale = body.locale;
      if (body.newPassword) {
        if (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
          throw badRequest('La contraseña actual no es correcta');
        }
        patch.passwordHash = await hashPassword(body.newPassword);
      }
      if (Object.keys(patch).length > 0) await ctx.db.update(users).set(patch).where(eq(users.id, user.id));
      return me(user.id, request.auth.tenantId);
    },
  );
};
