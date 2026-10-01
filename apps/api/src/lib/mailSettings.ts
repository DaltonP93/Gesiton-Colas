import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAIL_SECURITY, type MailSettingsDTO, type MailStatusDTO } from '@gc/shared';
import type { AppContext } from '../context';
import { mailSettings, type MailSettingsRow } from '../db/schema';
import { decryptSecret, encryptSecret } from './crypto';
import { testMail, type EmailBrand } from './emails';
import { badRequest } from './errors';
import { MailError, PLATFORM_MAIL_SCOPE, type SmtpConfig } from './mailer';
import { assertPublicHost } from './net';

const emailOrEmpty = z.union([z.literal(''), z.string().trim().toLowerCase().email().max(255)]);

export const mailSettingsBody = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(MAIL_SECURITY),
  username: z.string().trim().max(255),
  /** Sin enviar = conservar la guardada; vacío = borrarla. */
  password: z.string().max(500).optional(),
  fromName: z.string().trim().max(120),
  fromEmail: emailOrEmpty,
  replyTo: emailOrEmpty,
});
export type MailSettingsBody = z.infer<typeof mailSettingsBody>;

export const mailTestBody = mailSettingsBody.extend({ to: z.string().trim().toLowerCase().email().max(255) });

const EMPTY: MailSettingsDTO = {
  enabled: false,
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  hasPassword: false,
  fromName: '',
  fromEmail: '',
  replyTo: '',
  updatedAt: null,
};

function toDTO(row: MailSettingsRow | undefined): MailSettingsDTO {
  if (!row) return EMPTY;
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    hasPassword: Boolean(row.passwordEnc),
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyTo: row.replyTo,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadRow(ctx: AppContext, scope: string) {
  const [row] = await ctx.db.select().from(mailSettings).where(eq(mailSettings.scope, scope)).limit(1);
  return row;
}

/** Configuración guardada + servidor que se usa hoy (propio, de la plataforma, variables o ninguno). */
export async function mailStatus(ctx: AppContext, scope: string, tenantId: string | null): Promise<MailStatusDTO> {
  const [row, resolved] = await Promise.all([loadRow(ctx, scope), ctx.mailer.resolve(tenantId)]);
  return { settings: toDTO(row), active: resolved.source, from: resolved.from };
}

async function assertUsable(ctx: AppContext, scope: string, body: MailSettingsBody) {
  if (!body.host) throw badRequest('Indique el servidor SMTP (p. ej. smtp.gmail.com)');
  if (!body.fromEmail && !z.email().safeParse(body.username).success) {
    throw badRequest('Indique el correo del remitente (la dirección desde la que salen los correos)');
  }
  // Una organización no puede apuntar a equipos de la red interna del servidor (evita usar la
  // prueba de correo para explorarla). El superadministrador sí, y también las instalaciones propias.
  if (scope !== PLATFORM_MAIL_SCOPE && !ctx.config.WEBHOOKS_ALLOW_PRIVATE) {
    try {
      await assertPublicHost(body.host);
    } catch (error) {
      throw badRequest(
        `${error instanceof Error ? error.message : 'Servidor inválido'}. Use un servidor de correo público o el correo de la plataforma (en instalaciones propias se habilita con WEBHOOKS_ALLOW_PRIVATE=true).`,
      );
    }
  }
}

export async function saveMailSettings(ctx: AppContext, scope: string, tenantId: string | null, body: MailSettingsBody) {
  if (body.enabled) await assertUsable(ctx, scope, body);
  const current = await loadRow(ctx, scope);
  const passwordEnc =
    body.password === undefined ? (current?.passwordEnc ?? '') : encryptSecret(ctx.config.JWT_SECRET, body.password, 'smtp');
  const values = {
    enabled: body.enabled,
    host: body.host,
    port: body.port,
    security: body.security,
    username: body.username,
    passwordEnc,
    fromName: body.fromName,
    fromEmail: body.fromEmail,
    replyTo: body.replyTo,
  };
  await ctx.db
    .insert(mailSettings)
    .values({ scope, tenantId, ...values })
    .onConflictDoUpdate({ target: mailSettings.scope, set: { ...values, updatedAt: new Date() } });
  ctx.mailer.invalidate(scope);
  return mailStatus(ctx, scope, tenantId);
}

/** Prueba la configuración del formulario (aunque no esté guardada) enviando un correo real. */
export async function testMailSettings(ctx: AppContext, scope: string, body: z.infer<typeof mailTestBody>, brand: EmailBrand) {
  await assertUsable(ctx, scope, body);
  let password = body.password;
  if (password === undefined) {
    const current = await loadRow(ctx, scope);
    // La contraseña guardada solo se usa con el mismo servidor y usuario: no se puede «enviar» a otro host.
    if (current?.passwordEnc && (current.host !== body.host || current.port !== body.port || current.username !== body.username)) {
      throw badRequest('Cambió el servidor, el puerto o el usuario: escriba la contraseña para probar.');
    }
    password = current ? (decryptSecret(ctx.config.JWT_SECRET, current.passwordEnc, 'smtp') ?? '') : '';
  }
  const smtp: SmtpConfig = { ...body, password };
  try {
    await ctx.mailer.test(smtp, testMail(body.to, `${body.host}:${body.port}`, brand), { publicOnly: scope !== PLATFORM_MAIL_SCOPE });
  } catch (error) {
    if (error instanceof MailError) throw badRequest(error.detail);
    throw error;
  }
  return { ok: true, message: `Correo de prueba enviado a ${body.to}. Revise la bandeja de entrada (y la de spam).` };
}
