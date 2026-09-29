import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Categoría para registros y pruebas (p. ej. reset_password). */
  tag?: string;
}

export interface SentMail extends MailMessage {
  id: string;
  sentAt: string;
}

export interface Mailer {
  readonly driver: 'smtp' | 'log';
  send(message: MailMessage): Promise<void>;
  /** Últimos correos enviados (solo driver `log`, para desarrollo y pruebas). */
  outbox(): SentMail[];
}

/**
 * Envío de correos. Con SMTP funciona con cualquier proveedor (Gmail/Workspace, Microsoft 365,
 * Amazon SES, SendGrid, Mailgun, Brevo, Resend...). Sin SMTP, los correos se muestran en consola.
 */
export function createMailer(config: AppConfig, log: FastifyBaseLogger): Mailer {
  const driver = config.MAIL_DRIVER ?? (config.SMTP_URL || config.SMTP_HOST ? 'smtp' : 'log');

  if (driver === 'smtp') {
    const transport = config.SMTP_URL
      ? nodemailer.createTransport(config.SMTP_URL)
      : nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
        });
    return {
      driver,
      async send(message) {
        await transport.sendMail({ from: config.MAIL_FROM, to: message.to, subject: message.subject, html: message.html, text: message.text });
        log.info({ to: message.to, tag: message.tag }, 'correo enviado');
      },
      outbox: () => [],
    };
  }

  const sent: SentMail[] = [];
  return {
    driver,
    async send(message) {
      const mail: SentMail = { ...message, id: `${Date.now()}-${sent.length}`, sentAt: new Date().toISOString() };
      sent.unshift(mail);
      sent.length = Math.min(sent.length, 50);
      if (config.NODE_ENV !== 'test') {
        log.info({ to: message.to, subject: message.subject, tag: message.tag }, `✉️  Correo (sin SMTP configurado):\n${message.text}`);
      }
    },
    outbox: () => sent,
  };
}
