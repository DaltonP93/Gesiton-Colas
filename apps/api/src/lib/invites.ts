import { eq } from 'drizzle-orm';
import type { InviteResultDTO } from '@gc/shared';
import type { AppContext } from '../context';
import { tenants, users } from '../db/schema';
import { inviteMail } from './emails';
import { notFound } from './errors';
import { MailError } from './mailer';
import { issueToken } from './tokens';

/**
 * Genera el enlace de invitación y lo envía por correo. Si no hay servidor de correo (o falla),
 * devuelve igual el enlace para que el administrador lo comparta por otro medio (WhatsApp, chat...).
 */
export async function sendInvite(ctx: AppContext, userId: string, inviter: string): Promise<InviteResultDTO> {
  const [row] = await ctx.db
    .select({ user: users, tenant: tenants })
    .from(users)
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, userId));
  if (!row) throw notFound('Usuario');
  const base = ctx.config.PUBLIC_URL.replace(/\/$/, '');
  const { token } = await issueToken(ctx.db, userId, 'invite');
  const inviteUrl = `${base}/invitacion?token=${token}`;
  const brand = await ctx.emailBrand(row.tenant);
  const organization = row.tenant?.name ?? brand.appName;
  try {
    const { via } = await ctx.mailer.send(inviteMail(row.user.email, row.user.name, inviter, organization, inviteUrl, brand), {
      tenantId: row.user.tenantId,
    });
    if (via === 'none') {
      return { inviteUrl, emailSent: false, emailError: 'No hay un servidor de correo configurado: comparta el enlace por otro medio.' };
    }
    return { inviteUrl, emailSent: true, emailError: null };
  } catch (error) {
    if (error instanceof MailError) return { inviteUrl, emailSent: false, emailError: error.detail };
    throw error;
  }
}
