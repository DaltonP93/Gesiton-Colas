import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LOCALES } from '@gc/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { branches, services, userBranches, userServices, users } from '../../db/schema';
import type { FastifyRequest } from 'fastify';
import { hashPassword, sessionsResetNow, tenantIdOf } from '../../lib/auth';
import { randomToken } from '../../lib/crypto';
import { sendInvite } from '../../lib/invites';
import { removeAvatar } from '../../lib/avatars';
import { toUserDTO } from '../../lib/dto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { assertWithinLimit } from '../../lib/plans';
import { idParam, updateSchema } from '../../lib/schemas';
import { userScope } from '../tickets/queue';

const userBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  /** Si se omite, se envía una invitación por correo para que el usuario elija su contraseña. */
  password: z.string().min(8).max(200).optional(),
  role: z.enum(['admin', 'manager', 'agent']).default('agent'),
  active: z.boolean().default(true),
  locale: z.enum(LOCALES).nullable().default(null),
  /** Sucursales asignadas (vacío = todas). */
  branchIds: z.array(z.uuid()).default([]),
  /** Servicios que puede atender (vacío = todos). */
  serviceIds: z.array(z.uuid()).default([]),
});

async function setAssignments(db: DbOrTx, tenantId: string, userId: string, branchIds?: string[], serviceIds?: string[]) {
  if (branchIds) {
    const valid = branchIds.length
      ? await db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), inArray(branches.id, branchIds)))
      : [];
    if (valid.length !== new Set(branchIds).size) throw badRequest('Sucursal inválida');
    await db.delete(userBranches).where(eq(userBranches.userId, userId));
    if (valid.length) await db.insert(userBranches).values(valid.map((b) => ({ userId, branchId: b.id })));
  }
  if (serviceIds) {
    const valid = serviceIds.length
      ? await db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, serviceIds)))
      : [];
    if (valid.length !== new Set(serviceIds).size) throw badRequest('Servicio inválido');
    await db.delete(userServices).where(eq(userServices.userId, userId));
    if (valid.length) await db.insert(userServices).values(valid.map((s) => ({ userId, serviceId: s.id })));
  }
}

export const userRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Usuarios'];
  const admin = ctx.auth.require({ role: 'admin' });

  async function dto(db: DbOrTx, userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound('Usuario');
    const scope = await userScope(db, userId);
    return toUserDTO(user, scope.branchIds, scope.serviceIds);
  }

  app.get('/users', { preHandler: ctx.auth.require({ role: 'manager' }), schema: { tags } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const rows = await ctx.db.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(asc(users.name));
    const [ub, us] = await Promise.all([
      ctx.db.select().from(userBranches).innerJoin(users, eq(users.id, userBranches.userId)).where(eq(users.tenantId, tenantId)),
      ctx.db.select().from(userServices).innerJoin(users, eq(users.id, userServices.userId)).where(eq(users.tenantId, tenantId)),
    ]);
    return rows.map((u) =>
      toUserDTO(
        u,
        ub.filter((r) => r.user_branches.userId === u.id).map((r) => r.user_branches.branchId),
        us.filter((r) => r.user_services.userId === u.id).map((r) => r.user_services.serviceId),
      ),
    );
  });

  const inviterName = (request: FastifyRequest) => (request.auth?.kind === 'user' ? request.auth.user.name : 'El administrador');

  app.post(
    '/users',
    { preHandler: admin, schema: { tags, summary: 'Crear usuario (sin contraseña = invitación por correo)', body: userBody } },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      const { password, branchIds, serviceIds, ...data } = request.body;
      await assertWithinLimit(ctx.db, tenantId, 'users');
      const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
      if (exists) throw conflict('Ya existe un usuario con ese email');
      const invite = !password;
      const created = await ctx.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            ...data,
            tenantId,
            passwordHash: await hashPassword(password ?? randomToken(32)),
            hasPassword: !invite,
            invitePending: invite,
            // El administrador responde por el correo de quienes crea con contraseña.
            emailVerifiedAt: invite ? null : new Date(),
          })
          .returning();
        await setAssignments(tx, tenantId, user!.id, branchIds, serviceIds);
        return dto(tx, user!.id);
      });
      // Si no hay correo configurado, la respuesta trae el enlace para compartirlo por otro medio.
      const invitation = invite ? await sendInvite(ctx, created.id, inviterName(request)) : null;
      return reply.code(201).send({ ...created, invitation });
    },
  );

  app.post(
    '/users/:id/invite',
    { preHandler: admin, schema: { tags, summary: 'Reenviar la invitación por correo (devuelve también el enlace)', params: idParam } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const [target] = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.id, request.params.id), eq(users.tenantId, tenantId)));
      if (!target) throw notFound('Usuario');
      if (!target.invitePending) throw badRequest('El usuario ya aceptó la invitación');
      return { ok: true, ...(await sendInvite(ctx, target.id, inviterName(request))) };
    },
  );

  app.put(
    '/users/:id',
    { preHandler: admin, schema: { tags, params: idParam, body: updateSchema(userBody) } },
    async (request) => {
      const tenantId = tenantIdOf(request);
      const { password, branchIds, serviceIds, ...data } = request.body;
      const [target] = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.id, request.params.id), eq(users.tenantId, tenantId)));
      if (!target) throw notFound('Usuario');
      if (data.email && data.email !== target.email) {
        const [exists] = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, data.email), ne(users.id, target.id)));
        if (exists) throw conflict('Ya existe un usuario con ese email');
      }
      if (target.role === 'admin' && (data.role && data.role !== 'admin' || data.active === false)) {
        await assertAnotherAdmin(tenantId, target.id);
      }
      return ctx.db.transaction(async (tx) => {
        const patch: Partial<typeof users.$inferInsert> = { ...data };
        if (password) {
          patch.passwordHash = await hashPassword(password);
          patch.hasPassword = true;
          patch.invitePending = false;
          patch.sessionsValidAfter = sessionsResetNow();
        }
        if (Object.keys(patch).length > 0) await tx.update(users).set(patch).where(eq(users.id, target.id));
        await setAssignments(tx, tenantId, target.id, branchIds, serviceIds);
        return dto(tx, target.id);
      });
    },
  );

  async function assertAnotherAdmin(tenantId: string, exceptId: string) {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptId)));
    if ((row?.n ?? 0) === 0) throw badRequest('Debe quedar al menos un administrador activo');
  }

  app.delete('/users/:id', { preHandler: admin, schema: { tags, params: idParam } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (request.auth?.kind === 'user' && request.auth.userId === request.params.id) throw badRequest('No puede eliminar su propio usuario');
    const [target] = await ctx.db
      .select()
      .from(users)
      .where(and(eq(users.id, request.params.id), eq(users.tenantId, tenantId)));
    if (!target) throw notFound('Usuario');
    if (target.role === 'admin') await assertAnotherAdmin(tenantId, target.id);
    await ctx.db.delete(users).where(eq(users.id, target.id));
    await removeAvatar(ctx.storage, target.avatarUrl);
    return reply.code(204).send();
  });
};
