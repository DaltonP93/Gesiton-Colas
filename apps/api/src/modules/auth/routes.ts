import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LOCALES, PLANS, type MeDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { createDemoOrganization } from '../../db/demo';
import { createTenantWithDefaults } from '../../db/seed';
import { tenants, users, type Tenant, type User } from '../../db/schema';
import { assertTenantAvailable, hashPassword, sessionsResetNow, verifyPassword } from '../../lib/auth';
import { toTenantDTO, toUserDTO } from '../../lib/dto';
import { demoMail, emailLoginMail, resetPasswordMail, verifyEmailMail } from '../../lib/emails';
import { MailError, type MailMessage } from '../../lib/mailer';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../../lib/errors';
import { consumeCode, consumeToken, issueToken, peekToken } from '../../lib/tokens';
import { userScope } from '../tickets/queue';

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);
const token = z.string().min(20).max(200);

/** Respuesta idéntica exista o no la cuenta: evita revelar qué correos están registrados. */
const SENT = { ok: true, message: 'Si el correo está registrado, recibirá un mensaje en unos minutos.' };

export const authRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Autenticación'];
  const authLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
  const mailLimit = { rateLimit: { max: 5, timeWindow: '1 minute' } };
  const base = ctx.config.PUBLIC_URL.replace(/\/$/, '');

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
      modules: tenant ? await ctx.modulesOf(tenant) : [],
    };
  }

  async function findUser(address: string) {
    const [row] = await ctx.db
      .select({ user: users, tenant: tenants })
      .from(users)
      .leftJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.email, address))
      .limit(1);
    return row ?? null;
  }

  async function loadUser(userId: string) {
    const [row] = await ctx.db
      .select({ user: users, tenant: tenants })
      .from(users)
      .leftJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw unauthorized();
    return row;
  }

  const brandOf = (tenant: Tenant | null) => ctx.emailBrand(tenant);

  /** Envía con el servidor de la organización (o el de la plataforma) sin exponer detalles técnicos. */
  async function mail(message: MailMessage, tenantId: string | null) {
    try {
      await ctx.mailer.send(message, { tenantId });
    } catch (error) {
      if (error instanceof MailError) {
        throw new AppError(502, 'mail_failed', 'No pudimos enviar el correo en este momento. Intente más tarde o contacte al administrador.');
      }
      throw error;
    }
  }

  /** Verifica que la cuenta pueda iniciar sesión y devuelve el token + datos de sesión. */
  async function startSession(user: User, tenant: Tenant | null, options: { markVerified?: boolean } = {}) {
    if (!user.active) throw forbidden('El usuario está deshabilitado');
    if (tenant && user.role !== 'superadmin') assertTenantAvailable(tenant);
    const patch: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() };
    if (options.markVerified && !user.emailVerifiedAt) patch.emailVerifiedAt = new Date();
    await ctx.db.update(users).set(patch).where(eq(users.id, user.id));
    const sessionToken = await ctx.auth.signToken(user);
    return { token: sessionToken, ...(await me(user.id)) };
  }

  async function sendVerification(user: User, tenant: Tenant | null) {
    const { token: link } = await issueToken(ctx.db, user.id, 'verify_email');
    await mail(verifyEmailMail(user.email, user.name, `${base}/verificar?token=${link}`, await brandOf(tenant)), user.tenantId);
  }

  /* ------------------------------ Registro ---------------------------- */

  app.post(
    '/auth/register',
    {
      config: authLimit,
      schema: {
        tags,
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
      if (!ctx.config.ALLOW_SIGNUP || !(await ctx.platform.get()).allowSignup) {
        throw forbidden('El registro de nuevas organizaciones está deshabilitado');
      }
      const body = request.body;
      const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (exists) throw conflict('Ya existe una cuenta con ese email. Inicie sesión o recupere su contraseña.');
      const verification = ctx.config.EMAIL_VERIFICATION;
      const { admin, tenant } = await ctx.db.transaction((tx) =>
        createTenantWithDefaults(tx, {
          organizationName: body.organizationName,
          adminName: body.name,
          adminEmail: body.email,
          adminPassword: body.password,
          timezone: body.timezone,
          locale: body.locale,
          emailVerified: verification === 'off',
        }),
      );
      if (verification !== 'off') {
        // La cuenta ya existe: si el correo falla se puede reenviar la verificación después.
        await sendVerification(admin, tenant).catch((error) => request.log.warn({ err: error }, 'No se pudo enviar la verificación'));
      }
      if (verification === 'required') {
        return reply.code(201).send({ verificationRequired: true, email: admin.email });
      }
      return reply.code(201).send(await startSession(admin, tenant));
    },
  );

  /* ------------------------------- Demo ------------------------------- */

  app.post(
    '/auth/demo',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Solicitar una demo: crea una organización de ejemplo y envía el acceso por correo',
        security: [],
        body: z.object({
          email,
          name: z.string().trim().min(2).max(120),
          organizationName: z.string().trim().max(120).optional(),
          timezone: z.string().max(64).optional(),
        }),
      },
    },
    async (request) => {
      if (!ctx.config.ALLOW_DEMO || !(await ctx.platform.get()).allowDemo) throw forbidden('Las demos están deshabilitadas en esta instalación');
      const body = request.body;
      const existing = await findUser(body.email);
      if (existing) {
        // Ya tiene cuenta: se le envía un acceso por correo en lugar de crear otra demo.
        if (existing.user.active) {
          const { token: link, code } = await issueToken(ctx.db, existing.user.id, 'email_login', { withCode: true });
          await mail(emailLoginMail(existing.user.email, existing.user.name, `${base}/acceso?token=${link}`, code!, await brandOf(existing.tenant)), existing.user.tenantId);
        }
        return { ok: true, message: 'Le enviamos un correo con el acceso a su demo.' };
      }
      const days = ctx.config.DEMO_DAYS;
      const { admin, tenant } = await ctx.db.transaction((tx) =>
        createDemoOrganization(tx, { email: body.email, name: body.name, organizationName: body.organizationName, timezone: body.timezone, days }),
      );
      const { token: link, code } = await issueToken(ctx.db, admin.id, 'email_login', { withCode: true, ttlMs: 7 * 24 * 3600 * 1000 });
      await mail(demoMail(admin.email, admin.name, `${base}/acceso?token=${link}`, code!, days, await brandOf(tenant)), tenant.id);
      return { ok: true, message: 'Le enviamos un correo con el acceso a su demo.' };
    },
  );

  /* ------------------------------ Ingreso ----------------------------- */

  app.post(
    '/auth/login',
    { config: authLimit, schema: { tags, summary: 'Iniciar sesión con contraseña', security: [], body: z.object({ email, password: z.string().min(1).max(200) }) } },
    async (request) => {
      const found = await findUser(request.body.email);
      const valid = found && found.user.hasPassword && (await verifyPassword(request.body.password, found.user.passwordHash));
      if (found && !found.user.hasPassword && !found.user.invitePending) {
        throw new AppError(400, 'no_password', 'Esta cuenta todavía no tiene contraseña. Ingrese con un código por correo o elija una con «¿Olvidó su contraseña?».');
      }
      if (found?.user.invitePending) {
        throw new AppError(403, 'invite_pending', 'Acepte la invitación que le enviamos por correo para elegir su contraseña.');
      }
      if (!found || !valid) throw unauthorized('Email o contraseña incorrectos');
      if (ctx.config.EMAIL_VERIFICATION === 'required' && !found.user.emailVerifiedAt && found.user.role !== 'superadmin') {
        throw new AppError(403, 'email_not_verified', 'Confirme su correo electrónico para ingresar. Revise su bandeja de entrada.');
      }
      return startSession(found.user, found.tenant);
    },
  );

  app.post(
    '/auth/email-login',
    {
      config: mailLimit,
      schema: { tags, summary: 'Enviar un enlace y un código de acceso por correo (sin contraseña)', security: [], body: z.object({ email }) },
    },
    async (request) => {
      if (!(await ctx.platform.get()).allowEmailLogin) throw forbidden('El ingreso con código por correo está deshabilitado');
      const found = await findUser(request.body.email);
      if (found?.user.active) {
        const { token: link, code } = await issueToken(ctx.db, found.user.id, 'email_login', { withCode: true });
        await mail(emailLoginMail(found.user.email, found.user.name, `${base}/acceso?token=${link}`, code!, await brandOf(found.tenant)), found.user.tenantId);
      }
      return SENT;
    },
  );

  app.post(
    '/auth/email-login/verify',
    {
      config: authLimit,
      schema: {
        tags,
        summary: 'Ingresar con el enlace o el código recibido por correo',
        security: [],
        body: z.union([z.object({ token }), z.object({ email, code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') })]),
      },
    },
    async (request) => {
      const body = request.body;
      let userId: string;
      if ('token' in body) {
        userId = await consumeToken(ctx.db, body.token, 'email_login');
      } else {
        const found = await findUser(body.email);
        if (!found) throw badRequest('El código no es válido o venció. Solicite uno nuevo.');
        await consumeCode(ctx.db, found.user.id, body.code);
        userId = found.user.id;
      }
      const { user, tenant } = await loadUser(userId);
      return startSession(user, tenant, { markVerified: true });
    },
  );

  /* ----------------------- Verificación de correo --------------------- */

  app.post(
    '/auth/verify-email',
    { config: authLimit, schema: { tags, summary: 'Confirmar el correo con el enlace recibido', security: [], body: z.object({ token }) } },
    async (request) => {
      const userId = await consumeToken(ctx.db, request.body.token, 'verify_email');
      const { user, tenant } = await loadUser(userId);
      return startSession(user, tenant, { markVerified: true });
    },
  );

  app.post(
    '/auth/resend-verification',
    { config: mailLimit, schema: { tags, summary: 'Reenviar el correo de verificación', security: [], body: z.object({ email }) } },
    async (request) => {
      const found = await findUser(request.body.email);
      if (found && found.user.active && !found.user.emailVerifiedAt) await sendVerification(found.user, found.tenant);
      return SENT;
    },
  );

  app.post(
    '/auth/me/resend-verification',
    { config: mailLimit, preHandler: ctx.auth.require(), schema: { tags, summary: 'Reenviar la verificación al usuario actual' } },
    async (request) => {
      if (request.auth?.kind !== 'user') throw badRequest('Disponible solo para usuarios');
      if (request.auth.user.emailVerifiedAt) return { ok: true, message: 'Su correo ya está verificado.' };
      await sendVerification(request.auth.user, request.auth.tenant);
      return { ok: true, message: `Le enviamos un correo a ${request.auth.user.email}.` };
    },
  );

  /* ------------------------ Olvidé mi contraseña ---------------------- */

  app.post(
    '/auth/forgot-password',
    { config: mailLimit, schema: { tags, summary: 'Enviar un enlace para restablecer la contraseña', security: [], body: z.object({ email }) } },
    async (request) => {
      const found = await findUser(request.body.email);
      if (found?.user.active) {
        const { token: link } = await issueToken(ctx.db, found.user.id, 'reset_password');
        await mail(resetPasswordMail(found.user.email, found.user.name, `${base}/restablecer?token=${link}`, await brandOf(found.tenant)), found.user.tenantId);
      }
      return SENT;
    },
  );

  app.post(
    '/auth/reset-password',
    { config: authLimit, schema: { tags, summary: 'Elegir una nueva contraseña con el enlace recibido', security: [], body: z.object({ token, password }) } },
    async (request) => {
      const userId = await consumeToken(ctx.db, request.body.token, 'reset_password');
      await ctx.db
        .update(users)
        .set({
          passwordHash: await hashPassword(request.body.password),
          hasPassword: true,
          invitePending: false,
          // Cierra las sesiones abiertas en otros dispositivos.
          sessionsValidAfter: sessionsResetNow(),
        })
        .where(eq(users.id, userId));
      const { user, tenant } = await loadUser(userId);
      return startSession(user, tenant, { markVerified: true });
    },
  );

  /* ---------------------------- Invitaciones -------------------------- */

  app.get(
    '/auth/invite/:token',
    { config: authLimit, schema: { tags, summary: 'Datos de una invitación pendiente', security: [], params: z.object({ token }) } },
    async (request) => {
      const row = await peekToken(ctx.db, request.params.token, 'invite');
      const { user, tenant } = await loadUser(row.userId);
      return { email: user.email, name: user.name, organization: tenant?.name ?? '', appName: (await brandOf(tenant)).appName };
    },
  );

  app.post(
    '/auth/accept-invite',
    {
      config: authLimit,
      schema: {
        tags,
        summary: 'Aceptar una invitación y elegir la contraseña',
        security: [],
        body: z.object({ token, password, name: z.string().trim().min(2).max(120).optional() }),
      },
    },
    async (request) => {
      const userId = await consumeToken(ctx.db, request.body.token, 'invite');
      await ctx.db
        .update(users)
        .set({
          passwordHash: await hashPassword(request.body.password),
          hasPassword: true,
          invitePending: false,
          ...(request.body.name ? { name: request.body.name } : {}),
        })
        .where(eq(users.id, userId));
      const { user, tenant } = await loadUser(userId);
      return startSession(user, tenant, { markVerified: true });
    },
  );

  /* ---------------------------- Perfil propio ------------------------- */

  app.get('/auth/me', { preHandler: ctx.auth.require(), schema: { tags, summary: 'Usuario actual, organización y límites del plan' } }, async (request) => {
    if (request.auth?.kind !== 'user') throw badRequest('Disponible solo para usuarios');
    return me(request.auth.userId, request.auth.tenantId);
  });

  app.put(
    '/auth/me',
    {
      preHandler: ctx.auth.require(),
      schema: {
        tags,
        summary: 'Actualizar perfil propio',
        description: 'Al cambiar la contraseña se cierran las demás sesiones y la respuesta incluye un token nuevo.',
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
        // Quien ingresó por correo y aún no tiene contraseña puede definirla sin la actual.
        if (user.hasPassword && (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.passwordHash)))) {
          throw badRequest('La contraseña actual no es correcta');
        }
        patch.passwordHash = await hashPassword(body.newPassword);
        patch.hasPassword = true;
        patch.sessionsValidAfter = sessionsResetNow();
      }
      if (Object.keys(patch).length > 0) await ctx.db.update(users).set(patch).where(eq(users.id, user.id));
      const data = await me(user.id, request.auth.tenantId);
      if (!body.newPassword) return data;
      const [fresh] = await ctx.db.select().from(users).where(eq(users.id, user.id));
      return { ...data, token: await ctx.auth.signToken(fresh!) };
    },
  );
};
