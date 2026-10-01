import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CURRENCIES,
  HOME_PAGES,
  PLATFORM_NOTICE_EVENTS,
  MODULE_IDS,
  PLAN_IDS,
  UPLOAD_MIME_TYPES,
  type AccessLinkDTO,
  type ModuleOverrides,
  type PlatformSettings,
} from '@gc/shared';
import type { AppContext } from '../../context';
import { createTenantWithDefaults } from '../../db/seed';
import { tenants, users } from '../../db/schema';
import { hashPassword, sessionsResetNow, verifyPassword } from '../../lib/auth';
import { randomToken } from '../../lib/crypto';
import { toTenantDTO, toUserDTO } from '../../lib/dto';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { sendInvite } from '../../lib/invites';
import { PLATFORM_MAIL_SCOPE } from '../../lib/mailer';
import { mailSettingsBody, mailStatus, mailTestBody, saveMailSettings, testMailSettings } from '../../lib/mailSettings';
import { idParam } from '../../lib/schemas';
import { issueToken } from '../../lib/tokens';
import { EXTENSIONS } from '../media/routes';

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);
const hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Color hexadecimal inválido');
const optionalUrl = z.string().trim().max(2048).nullable();

const settingsBody = z.object({
  homePage: z.enum(HOME_PAGES).optional(),
  homeRedirectUrl: z.union([z.literal(''), z.string().trim().url().max(2048)]).optional(),
  allowSignup: z.boolean().optional(),
  allowDemo: z.boolean().optional(),
  allowEmailLogin: z.boolean().optional(),
  brand: z
    .object({
      appName: z.string().trim().min(1).max(80),
      logoUrl: optionalUrl,
      faviconUrl: optionalUrl,
      primaryColor: hex,
      loginTitle: z.string().trim().max(160),
      loginText: z.string().trim().max(400),
      loginImageUrl: optionalUrl,
      supportEmail: z.union([z.literal(''), email]),
    })
    .partial()
    .optional(),
  plans: z
    .partialRecord(
      z.enum(PLAN_IDS),
      z.object({
        modules: z.array(z.enum(MODULE_IDS)).optional(),
        monthlyPrice: z.number().min(0).max(1_000_000_000).optional(),
        currency: z.enum(CURRENCIES).optional(),
      }),
    )
    .optional(),
  /** Precio mensual de cada módulo adicional (0 = sin cargo). */
  addons: z.partialRecord(z.enum(MODULE_IDS), z.number().min(0).max(1_000_000_000)).optional(),
  // Sin valores por defecto: lo que no se envía queda como está.
  billing: z
    .object({
      enabled: z.boolean(),
      autoGenerate: z.boolean(),
      dueDays: z.number().int().min(0).max(90),
      autoSuspend: z.boolean(),
      graceDays: z.number().int().min(0).max(120),
      issuerName: z.string().trim().max(160),
      issuerTaxId: z.string().trim().max(40),
      instructions: z.string().trim().max(1000),
    })
    .partial()
    .optional(),
  backups: z
    .object({
      enabled: z.boolean(),
      hour: z.number().int().min(0).max(23),
      timezone: z.string().trim().min(1).max(64),
      keepDays: z.number().int().min(1).max(365),
      includeUploads: z.boolean(),
      s3: z.boolean(),
    })
    .partial()
    .optional(),
  notices: z
    .object({
      events: z.partialRecord(z.enum(PLATFORM_NOTICE_EVENTS), z.object({ email: z.boolean(), whatsapp: z.boolean() }).partial()),
      dueDaysBefore: z.number().int().min(1).max(30),
      demoDaysBefore: z.number().int().min(1).max(14),
      adminPhones: z.array(z.string().trim().min(6).max(30)).max(5),
      countryCode: z.string().regex(/^\d{1,4}$/),
    })
    .partial()
    .optional(),
});

/** Límite de tiempo de un enlace de acceso generado por el superadministrador. */
const ACCESS_LINK_TTL = 24 * 3600 * 1000;

export const platformRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Plataforma (superadmin)'];
  const superadmin = ctx.auth.require({ role: 'superadmin' });
  const base = ctx.config.PUBLIC_URL.replace(/\/$/, '');
  const selfId = (request: FastifyRequest) => (request.auth?.kind === 'user' ? request.auth.userId : null);
  const inviter = (request: FastifyRequest) => (request.auth?.kind === 'user' ? request.auth.user.name : 'El administrador de la plataforma');

  app.get('/platform/stats', { preHandler: superadmin, schema: { tags } }, async () => {
    const result = await ctx.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM tenants) AS tenants,
        (SELECT count(*)::int FROM tenants WHERE status = 'active') AS active_tenants,
        (SELECT count(*)::int FROM users WHERE tenant_id IS NOT NULL) AS users,
        (SELECT count(*)::int FROM tickets WHERE created_at > now() - interval '30 days') AS tickets_30d,
        (SELECT count(*)::int FROM displays) AS displays,
        (SELECT coalesce(sum(storage_bytes), 0)::bigint FROM tenants) AS storage_bytes`);
    const r = result.rows[0] as Record<string, unknown>;
    return {
      tenants: Number(r.tenants),
      activeTenants: Number(r.active_tenants),
      users: Number(r.users),
      tickets30d: Number(r.tickets_30d),
      displays: Number(r.displays),
      storageBytes: Number(r.storage_bytes),
    };
  });

  /* --------------------------- Organizaciones ------------------------- */

  app.get(
    '/platform/tenants',
    { preHandler: superadmin, schema: { tags, querystring: z.object({ q: z.string().max(100).optional() }) } },
    async (request) => {
      const q = request.query.q?.trim();
      // Las subconsultas usan la columna calificada: en un SELECT de una sola tabla Drizzle
      // la escribiría sin tabla ("id") y se confundiría con el id de la subconsulta.
      const tenantRef = sql.raw('"tenants"."id"');
      const rows = await ctx.db
        .select({
          tenant: tenants,
          users: sql<number>`(SELECT count(*)::int FROM users u WHERE u.tenant_id = ${tenantRef})`,
          branches: sql<number>`(SELECT count(*)::int FROM branches b WHERE b.tenant_id = ${tenantRef})`,
          displays: sql<number>`(SELECT count(*)::int FROM displays d WHERE d.tenant_id = ${tenantRef})`,
          tickets30d: sql<number>`(SELECT count(*)::int FROM tickets t WHERE t.tenant_id = ${tenantRef} AND t.created_at > now() - interval '30 days')`,
        })
        .from(tenants)
        .where(q ? sql`${tenants.name} ILIKE ${`%${q}%`} OR ${tenants.slug} ILIKE ${`%${q}%`}` : undefined)
        .orderBy(desc(tenants.createdAt))
        .limit(500);
      return Promise.all(
        rows.map(async (r) => ({
          ...toTenantDTO(r.tenant),
          modules: await ctx.modulesOf(r.tenant),
          storageBytes: r.tenant.storageBytes,
          usage: { users: r.users, branches: r.branches, displays: r.displays, tickets30d: r.tickets30d },
        })),
      );
    },
  );

  app.post(
    '/platform/tenants',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Crear una organización con su administrador',
        description: 'Sin `adminPassword` se envía una invitación por correo y la respuesta incluye el enlace para compartirlo.',
        body: z.object({
          organizationName: z.string().trim().min(2).max(120),
          adminName: z.string().trim().min(2).max(120),
          adminEmail: email,
          adminPassword: password.optional(),
          plan: z.enum(PLAN_IDS).default('free'),
          timezone: z.string().max(64).optional(),
        }),
      },
    },
    async (request, reply) => {
      const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, request.body.adminEmail));
      if (exists) throw conflict('Ya existe un usuario con ese email');
      const invite = !request.body.adminPassword;
      const { tenant, admin } = await ctx.db.transaction(async (tx) => {
        const created = await createTenantWithDefaults(tx, { ...request.body, adminPassword: request.body.adminPassword ?? '', emailVerified: !invite });
        if (invite) await tx.update(users).set({ invitePending: true }).where(eq(users.id, created.admin.id));
        return created;
      });
      const invitation = invite ? await sendInvite(ctx, admin.id, inviter(request)) : null;
      return reply.code(201).send({ ...toTenantDTO(tenant), invitation });
    },
  );

  app.put(
    '/platform/tenants/:id',
    {
      preHandler: superadmin,
      schema: {
        tags,
        params: idParam,
        body: z.object({
          name: z.string().trim().min(2).max(120).optional(),
          plan: z.enum(PLAN_IDS).optional(),
          status: z.enum(['active', 'suspended']).optional(),
          /** `false` convierte una demo en organización definitiva. */
          isDemo: z.boolean().optional(),
          /** Extiende la demo N días (desde hoy o desde su vencimiento, lo que sea posterior). */
          extendDemoDays: z.number().int().min(1).max(365).optional(),
          /** Activa (`true`), desactiva (`false`) o deja según el plan (`null`) cada módulo. */
          modules: z.partialRecord(z.enum(MODULE_IDS), z.boolean().nullable()).optional(),
        }),
      },
    },
    async (request) => {
      const { isDemo, extendDemoDays, modules, ...rest } = request.body;
      const [current] = await ctx.db.select().from(tenants).where(eq(tenants.id, request.params.id));
      if (!current) throw notFound('Organización');
      const patch: Partial<typeof tenants.$inferInsert> = { ...rest };
      if (rest.status) patch.suspendedReason = rest.status === 'suspended' ? 'manual' : null;
      if (modules) {
        const next: ModuleOverrides = { ...(current.modules ?? {}) };
        for (const [id, value] of Object.entries(modules) as [keyof ModuleOverrides, boolean | null][]) {
          if (value === null) delete next[id];
          else next[id] = value;
        }
        patch.modules = next;
      }
      if (isDemo === false) {
        patch.isDemo = false;
        patch.demoExpiresAt = null;
      }
      if (extendDemoDays && current.isDemo && isDemo !== false) {
        const from = Math.max(Date.now(), current.demoExpiresAt?.getTime() ?? 0);
        patch.demoExpiresAt = new Date(from + extendDemoDays * 24 * 3600 * 1000);
      }
      const [row] = await ctx.db.update(tenants).set(patch).where(eq(tenants.id, request.params.id)).returning();
      if (!row) throw notFound('Organización');
      // Pantallas y kioscos recargan su configuración (p. ej. si se apagó un módulo).
      if (request.body.status === 'suspended' || modules || request.body.plan) ctx.refreshDevices(row.id);
      return { ...toTenantDTO(row), modules: await ctx.modulesOf(row) };
    },
  );

  /* -------------------- Usuarios de una organización ------------------ */

  app.get(
    '/platform/tenants/:id/users',
    { preHandler: superadmin, schema: { tags, summary: 'Usuarios de una organización', params: idParam } },
    async (request) => {
      const rows = await ctx.db.select().from(users).where(eq(users.tenantId, request.params.id)).orderBy(asc(users.name));
      return rows.map((u) => toUserDTO(u));
    },
  );

  async function tenantUser(userId: string) {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.tenantId) throw notFound('Usuario');
    return user;
  }

  app.put(
    '/platform/users/:id/password',
    {
      preHandler: superadmin,
      schema: { tags, summary: 'Definir la contraseña de un usuario de una organización', params: idParam, body: z.object({ password }) },
    },
    async (request) => {
      const user = await tenantUser(request.params.id);
      await ctx.db
        .update(users)
        .set({
          passwordHash: await hashPassword(request.body.password),
          hasPassword: true,
          invitePending: false,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          sessionsValidAfter: sessionsResetNow(),
        })
        .where(eq(users.id, user.id));
      request.log.info({ userId: user.id, by: selfId(request) }, 'contraseña definida por el superadministrador');
      return { ok: true };
    },
  );

  app.post(
    '/platform/users/:id/access-link',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Generar un enlace de acceso de un solo uso (vale 24 h)',
        description: 'Para entregar el acceso a un usuario cuando no hay correo configurado.',
        params: idParam,
      },
    },
    async (request): Promise<AccessLinkDTO> => {
      const user = await tenantUser(request.params.id);
      if (!user.active) throw badRequest('El usuario está deshabilitado');
      const { token } = await issueToken(ctx.db, user.id, 'email_login', { ttlMs: ACCESS_LINK_TTL });
      request.log.info({ userId: user.id, by: selfId(request) }, 'enlace de acceso generado por el superadministrador');
      return { url: `${base}/acceso?token=${token}`, expiresAt: new Date(Date.now() + ACCESS_LINK_TTL).toISOString() };
    },
  );

  /* ------------------------- Superadministradores --------------------- */

  const superadminWhere = (id?: string) => (id ? and(eq(users.role, 'superadmin'), eq(users.id, id)) : eq(users.role, 'superadmin'));

  async function assertAnotherActive(exceptId: string) {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'superadmin'), eq(users.active, true), ne(users.id, exceptId)));
    if ((row?.n ?? 0) === 0) throw badRequest('Debe quedar al menos un superadministrador activo');
  }

  app.get('/platform/admins', { preHandler: superadmin, schema: { tags, summary: 'Superadministradores de la plataforma' } }, async () => {
    const rows = await ctx.db.select().from(users).where(superadminWhere()).orderBy(asc(users.name));
    return rows.map((u) => toUserDTO(u));
  });

  app.post(
    '/platform/admins',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Agregar un superadministrador (sin contraseña = invitación por correo)',
        body: z.object({ name: z.string().trim().min(2).max(120), email, password: password.optional() }),
      },
    },
    async (request, reply) => {
      const { name, email: address, password: pass } = request.body;
      const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, address));
      if (exists) throw conflict('Ya existe un usuario con ese email');
      const invite = !pass;
      const [user] = await ctx.db
        .insert(users)
        .values({
          tenantId: null,
          email: address,
          name,
          role: 'superadmin',
          passwordHash: await hashPassword(pass ?? randomToken(32)),
          hasPassword: !invite,
          invitePending: invite,
          emailVerifiedAt: invite ? null : new Date(),
        })
        .returning();
      const invitation = invite ? await sendInvite(ctx, user!.id, inviter(request)) : null;
      return reply.code(201).send({ user: toUserDTO(user!), invitation });
    },
  );

  app.put(
    '/platform/admins/:id',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Editar un superadministrador',
        description: 'Para cambiar el correo o la contraseña propios se pide la contraseña actual.',
        params: idParam,
        body: z.object({
          name: z.string().trim().min(2).max(120).optional(),
          email: email.optional(),
          password: password.optional(),
          active: z.boolean().optional(),
          currentPassword: z.string().max(200).optional(),
        }),
      },
    },
    async (request) => {
      const [target] = await ctx.db.select().from(users).where(superadminWhere(request.params.id));
      if (!target) throw notFound('Superadministrador');
      const body = request.body;
      const isSelf = selfId(request) === target.id;
      if (isSelf && body.active === false) throw badRequest('No puede deshabilitar su propio usuario');
      if (body.active === false && target.active) await assertAnotherActive(target.id);
      const changesCredentials = Boolean(body.password) || (body.email !== undefined && body.email !== target.email);
      if (isSelf && changesCredentials && target.hasPassword) {
        if (!body.currentPassword || !(await verifyPassword(body.currentPassword, target.passwordHash))) {
          throw badRequest('La contraseña actual no es correcta');
        }
      }
      if (body.email && body.email !== target.email) {
        const [exists] = await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.email, body.email), ne(users.id, target.id)));
        if (exists) throw conflict('Ya existe un usuario con ese email');
      }
      const patch: Partial<typeof users.$inferInsert> = {};
      if (body.name) patch.name = body.name;
      if (body.email) patch.email = body.email;
      if (body.active !== undefined) patch.active = body.active;
      if (body.password) {
        patch.passwordHash = await hashPassword(body.password);
        patch.hasPassword = true;
        patch.invitePending = false;
        patch.sessionsValidAfter = sessionsResetNow();
      }
      const [row] = Object.keys(patch).length
        ? await ctx.db.update(users).set(patch).where(eq(users.id, target.id)).returning()
        : [target];
      // Quien cambia su propia contraseña sigue conectado con un token nuevo.
      const token = isSelf && body.password ? await ctx.auth.signToken(row!) : undefined;
      return { user: toUserDTO(row!), token };
    },
  );

  app.post(
    '/platform/admins/:id/invite',
    { preHandler: superadmin, schema: { tags, summary: 'Reenviar la invitación de un superadministrador', params: idParam } },
    async (request) => {
      const [target] = await ctx.db.select().from(users).where(superadminWhere(request.params.id));
      if (!target) throw notFound('Superadministrador');
      if (!target.invitePending) throw badRequest('El usuario ya aceptó la invitación');
      return sendInvite(ctx, target.id, inviter(request));
    },
  );

  app.delete(
    '/platform/admins/:id',
    { preHandler: superadmin, schema: { tags, summary: 'Quitar un superadministrador', params: idParam } },
    async (request, reply) => {
      if (selfId(request) === request.params.id) throw badRequest('No puede eliminar su propio usuario');
      const [target] = await ctx.db.select().from(users).where(superadminWhere(request.params.id));
      if (!target) throw notFound('Superadministrador');
      await assertAnotherActive(target.id);
      await ctx.db.delete(users).where(eq(users.id, target.id));
      return reply.code(204).send();
    },
  );

  /* ------------------------- Ajustes de plataforma -------------------- */

  app.get('/platform/settings', { preHandler: superadmin, schema: { tags, summary: 'Página de inicio, acceso y marca de la plataforma' } }, async () => {
    return ctx.platform.get();
  });

  app.put(
    '/platform/settings',
    { preHandler: superadmin, schema: { tags, summary: 'Guardar los ajustes de la plataforma', body: settingsBody } },
    async (request): Promise<PlatformSettings> => {
      if (request.body.backups?.timezone) {
        try {
          new Intl.DateTimeFormat('es', { timeZone: request.body.backups.timezone });
        } catch {
          throw badRequest('Zona horaria inválida');
        }
      }
      if (request.body.homePage === 'redirect') {
        const url = request.body.homeRedirectUrl ?? (await ctx.platform.get()).homeRedirectUrl;
        if (!url) throw badRequest('Indique la dirección a la que se redirige la página principal');
      }
      return ctx.platform.update(request.body);
    },
  );

  /* ------------------------ Imágenes de la plataforma ------------------ */

  const MAX_ASSET_MB = 10;
  app.post(
    '/platform/assets',
    {
      preHandler: superadmin,
      schema: { tags, summary: 'Subir una imagen de la plataforma (logo, favicon, fondo del ingreso)', consumes: ['multipart/form-data'] },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw badRequest('Adjunte un archivo');
      if (UPLOAD_MIME_TYPES[file.mimetype] !== 'image') {
        file.file.resume();
        throw badRequest('Suba una imagen (JPG, PNG, GIF, WebP o SVG)');
      }
      const key = `platform/${randomUUID()}.${EXTENSIONS[file.mimetype] ?? 'bin'}`;
      const stored = await ctx.storage.put(key, file.file, file.mimetype);
      if (file.file.truncated || stored.size > MAX_ASSET_MB * 1024 * 1024) {
        await ctx.storage.remove(key).catch(() => undefined);
        throw new AppError(413, 'file_too_large', `La imagen supera el máximo de ${MAX_ASSET_MB} MB`);
      }
      return reply.code(201).send({ url: stored.url });
    },
  );

  /* ------------------------------- Correo ----------------------------- */

  app.get('/platform/mail', { preHandler: superadmin, schema: { tags, summary: 'Servidor de correo (SMTP) de la plataforma' } }, async () =>
    mailStatus(ctx, PLATFORM_MAIL_SCOPE, null),
  );

  app.put(
    '/platform/mail',
    { preHandler: superadmin, schema: { tags, summary: 'Guardar el servidor de correo de la plataforma', body: mailSettingsBody } },
    async (request) => saveMailSettings(ctx, PLATFORM_MAIL_SCOPE, null, request.body),
  );

  app.post(
    '/platform/mail/test',
    {
      preHandler: superadmin,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags, summary: 'Probar el servidor de correo enviando un mensaje', body: mailTestBody },
    },
    async (request) => testMailSettings(ctx, PLATFORM_MAIL_SCOPE, request.body, await ctx.emailBrand(null)),
  );
};
