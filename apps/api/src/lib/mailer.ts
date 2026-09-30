import nodemailer, { type Transporter } from 'nodemailer';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { MailSecurity, MailSource } from '@gc/shared';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { mailSettings, type MailSettingsRow } from '../db/schema';
import { decryptSecret } from './crypto';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Categoría para registros y pruebas (p. ej. reset_password). */
  tag?: string;
  /** Nombre de remitente sugerido (la marca de la organización) si el servidor no define uno. */
  fromName?: string;
}

export interface SentMail extends MailMessage {
  id: string;
  sentAt: string;
}

/** Datos de conexión de un servidor SMTP (con la contraseña ya descifrada). */
export interface SmtpConfig {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

export interface SendOptions {
  /** Organización que envía: si tiene servidor propio se usa ese; si no, el de la plataforma. */
  tenantId?: string | null;
}

/** Error al enviar: `detail` explica la causa (se muestra solo a administradores). */
export class MailError extends Error {
  constructor(
    readonly detail: string,
    cause?: unknown,
  ) {
    super(detail, { cause });
  }
}

export interface Mailer {
  /** Envío configurado por variables de entorno (SMTP_* o, si no hay, solo registro en consola). */
  readonly envDriver: 'smtp' | 'log';
  send(message: MailMessage, options?: SendOptions): Promise<{ via: MailSource }>;
  /** Servidor que se usaría hoy para una organización (o para la plataforma sin `tenantId`). */
  resolve(tenantId?: string | null): Promise<{ source: MailSource; from: string | null }>;
  /** Verifica la conexión con un servidor y envía un correo de prueba. */
  test(config: SmtpConfig, message: MailMessage): Promise<void>;
  /** Descarta la configuración en memoria después de guardarla. */
  invalidate(scope?: string): void;
  /** Últimos correos que no salieron por SMTP (desarrollo y pruebas). */
  outbox(): SentMail[];
}

export const PLATFORM_MAIL_SCOPE = 'platform';

/** Traduce los errores de nodemailer a un mensaje que ayude a corregir la configuración. */
export function describeMailError(error: unknown, config?: Pick<SmtpConfig, 'host' | 'port'>): string {
  const e = error as { code?: string; responseCode?: number; response?: string; message?: string };
  const where = config ? `${config.host}:${config.port}` : 'el servidor de correo';
  switch (e.code) {
    case 'EAUTH':
      return `El servidor rechazó el usuario o la contraseña${e.response ? ` (${e.response.slice(0, 160)})` : ''}. En Gmail y Microsoft 365 use una contraseña de aplicación.`;
    case 'EDNS':
    case 'ENOTFOUND':
      return `No se encontró el servidor ${config?.host ?? ''}. Revise el nombre del servidor.`;
    case 'ECONNECTION':
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EHOSTUNREACH':
      return `No se pudo conectar a ${where}. Revise el puerto y el cifrado (587 = STARTTLS, 465 = SSL) y que este servidor tenga salida a internet por ese puerto.`;
    case 'EENVELOPE':
      return `El servidor no aceptó el remitente o el destinatario${e.response ? ` (${e.response.slice(0, 160)})` : ''}. Use como remitente una dirección que la cuenta pueda enviar.`;
    default:
      return e.message ? `Error del servidor de correo: ${e.message.slice(0, 240)}` : 'No se pudo enviar el correo.';
  }
}

function transportFor(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'ssl',
    requireTLS: config.security === 'starttls',
    ignoreTLS: config.security === 'none',
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

function fromAddress(config: SmtpConfig, message: MailMessage) {
  const address = config.fromEmail || config.username;
  return { name: config.fromName || message.fromName || 'Gestión de Colas', address };
}

const formatFrom = (from: { name: string; address: string }) => `${from.name} <${from.address}>`;

/**
 * Envío de correos. Orden: servidor propio de la organización → servidor de la plataforma
 * (ambos se configuran desde el panel) → variables SMTP_* → consola (sin envío real).
 * Funciona con cualquier proveedor: Gmail/Workspace, Microsoft 365, Amazon SES, Brevo, un Exchange propio...
 */
export function createMailer(config: AppConfig, db: Database, log: FastifyBaseLogger): Mailer {
  const envDriver = config.MAIL_DRIVER ?? (config.SMTP_URL || config.SMTP_HOST ? 'smtp' : 'log');
  const envTransport =
    envDriver === 'smtp'
      ? config.SMTP_URL
        ? nodemailer.createTransport(config.SMTP_URL)
        : nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: config.SMTP_SECURE,
            auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
          })
      : null;

  const rows = new Map<string, { row: MailSettingsRow | null; at: number }>();
  const transports = new Map<string, { key: string; transport: Transporter }>();
  const sent: SentMail[] = [];
  const TTL = 60_000;

  async function load(scope: string): Promise<SmtpConfig | null> {
    let cached = rows.get(scope);
    if (!cached || Date.now() - cached.at > TTL) {
      const [row] = await db.select().from(mailSettings).where(eq(mailSettings.scope, scope)).limit(1);
      cached = { row: row ?? null, at: Date.now() };
      rows.set(scope, cached);
    }
    const row = cached.row;
    if (!row?.enabled || !row.host) return null;
    const password = decryptSecret(config.JWT_SECRET, row.passwordEnc, 'smtp');
    if (password === null) {
      log.warn({ scope }, 'No se pudo descifrar la contraseña SMTP (¿cambió JWT_SECRET?). Vuelva a guardarla.');
    }
    return {
      host: row.host,
      port: row.port,
      security: row.security,
      username: row.username,
      password: password ?? '',
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      replyTo: row.replyTo,
    };
  }

  async function pick(tenantId?: string | null): Promise<{ source: MailSource; smtp: SmtpConfig | null; scope: string | null }> {
    if (tenantId) {
      const own = await load(tenantId);
      if (own) return { source: 'tenant', smtp: own, scope: tenantId };
    }
    const platform = await load(PLATFORM_MAIL_SCOPE);
    if (platform) return { source: 'platform', smtp: platform, scope: PLATFORM_MAIL_SCOPE };
    return { source: envTransport ? 'env' : 'none', smtp: null, scope: null };
  }

  function cachedTransport(scope: string, smtp: SmtpConfig) {
    const key = JSON.stringify(smtp);
    const current = transports.get(scope);
    if (current?.key === key) return current.transport;
    current?.transport.close();
    const transport = transportFor(smtp);
    transports.set(scope, { key, transport });
    return transport;
  }

  return {
    envDriver,

    async send(message, options = {}) {
      const { source, smtp, scope } = await pick(options.tenantId);
      if (smtp && scope) {
        const from = fromAddress(smtp, message);
        try {
          await cachedTransport(scope, smtp).sendMail({
            from,
            replyTo: smtp.replyTo || undefined,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
        } catch (error) {
          log.error({ err: error, to: message.to, tag: message.tag, source }, 'No se pudo enviar el correo');
          throw new MailError(describeMailError(error, smtp), error);
        }
        log.info({ to: message.to, tag: message.tag, source }, 'correo enviado');
        return { via: source };
      }
      if (envTransport) {
        try {
          await envTransport.sendMail({ from: config.MAIL_FROM, to: message.to, subject: message.subject, html: message.html, text: message.text });
        } catch (error) {
          log.error({ err: error, to: message.to, tag: message.tag }, 'No se pudo enviar el correo');
          throw new MailError(describeMailError(error), error);
        }
        log.info({ to: message.to, tag: message.tag }, 'correo enviado');
        return { via: 'env' };
      }
      const mail: SentMail = { ...message, id: `${Date.now()}-${sent.length}`, sentAt: new Date().toISOString() };
      sent.unshift(mail);
      sent.length = Math.min(sent.length, 50);
      if (config.NODE_ENV !== 'test') {
        log.info({ to: message.to, subject: message.subject, tag: message.tag }, `✉️  Correo (sin SMTP configurado):\n${message.text}`);
      }
      return { via: 'none' };
    },

    async resolve(tenantId) {
      const { source, smtp } = await pick(tenantId);
      if (smtp) return { source, from: formatFrom(fromAddress(smtp, { to: '', subject: '', html: '', text: '' })) };
      return { source, from: source === 'env' ? config.MAIL_FROM : null };
    },

    async test(smtp, message) {
      const transport = transportFor(smtp);
      try {
        await transport.verify();
        await transport.sendMail({
          from: fromAddress(smtp, message),
          replyTo: smtp.replyTo || undefined,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
      } catch (error) {
        throw new MailError(describeMailError(error, smtp), error);
      } finally {
        transport.close();
      }
    },

    invalidate(scope) {
      if (scope) rows.delete(scope);
      else rows.clear();
    },

    outbox: () => sent,
  };
}
