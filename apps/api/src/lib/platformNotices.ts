import { and, count, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  PLATFORM_NOTICE_INFO,
  formatMoney,
  normalizePhone,
  type PlatformNoticeEvent,
  type PlatformNoticeTestDTO,
  type PlatformSettings,
  type TenantChannelsDTO,
} from '@gc/shared';
import type { Database } from '../db/client';
import { invoices, mailSettings, notifyProviders, platformNoticeLog, tenants, users, type Tenant } from '../db/schema';
import { tenantSettings } from './dto';
import { noticeMail, type EmailBrand } from './emails';
import type { Mailer, MailMessage } from './mailer';
import { PLATFORM_NOTIFY_SCOPE, type Notifier } from './notifier';

export interface Notice {
  subject: string;
  title: string;
  lines: string[];
  cta?: { label: string; url: string };
  outro?: string[];
  /** Texto corto para WhatsApp/SMS. */
  whatsapp: string;
}

type Result = PlatformNoticeTestDTO;

interface Deps {
  db: Database;
  log: FastifyBaseLogger;
  mailer: Mailer;
  notifier: Notifier;
  platformSettings(): Promise<PlatformSettings>;
  emailBrand(tenant: Tenant | null): Promise<EmailBrand>;
  publicUrl: string;
}

const todayISO = (now = new Date()) => now.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const errorOf = (error: unknown) => (error instanceof Error ? error.message : 'Error').slice(0, 300);

/** Celulares sin repetir (compara el número completo con el código de país) y sin vacíos. */
function uniquePhones(list: string[], countryCode: string): string[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const digits = normalizePhone(p, countryCode);
    if (!digits || digits.length < 6 || seen.has(digits)) return false;
    seen.add(digits);
    return true;
  });
}

/**
 * Avisos de la plataforma a los administradores de cada organización y a los superadministradores,
 * por correo y/o WhatsApp/SMS según lo que elija el superadministrador (Plataforma → Comunicaciones).
 */
export class PlatformNotices {
  constructor(private readonly deps: Deps) {}

  private get base() {
    return this.deps.publicUrl.replace(/\/$/, '');
  }

  /** Registra que el aviso se envió; false si ya se había enviado antes. */
  private async once(event: PlatformNoticeEvent, entityId: string) {
    const rows = await this.deps.db.insert(platformNoticeLog).values({ event, entityId }).onConflictDoNothing().returning({ id: platformNoticeLog.id });
    return rows.length > 0;
  }

  /** A los administradores de una organización (correo) y a su celular de avisos (WhatsApp/SMS). */
  async toTenant(event: PlatformNoticeEvent, tenant: Tenant, notice: Notice, options: { mail?: (admin: { email: string; name: string }) => MailMessage; force?: boolean } = {}): Promise<Result> {
    const settings = (await this.deps.platformSettings()).notices;
    const channels = options.force ? { email: true, whatsapp: true } : settings.events[event];
    const result: Result = { email: { sent: 0, error: null }, whatsapp: { sent: 0, error: null } };
    if (channels.email) {
      const admins = await this.deps.db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'admin'), eq(users.active, true)));
      const brand = await this.deps.emailBrand(null);
      for (const admin of admins) {
        try {
          await this.deps.mailer.send(options.mail ? options.mail(admin) : noticeMail(admin.email, admin.name, { ...notice, tag: `notice_${event}` }, brand), { tenantId: null });
          result.email.sent += 1;
        } catch (error) {
          result.email.error = errorOf(error);
        }
      }
    }
    if (channels.whatsapp) {
      const phone = tenantSettings(tenant).fiscal.phone;
      if (!phone) result.whatsapp.error = 'La organización no cargó un celular para avisos (Plan y facturación → Datos para su factura)';
      else {
        const sent = await this.deps.notifier.sendPlatformText(phone, notice.whatsapp, { countryCode: settings.countryCode, tenantId: tenant.id, event: `platform.${event}` });
        if (sent.ok) result.whatsapp.sent += 1;
        else result.whatsapp.error = sent.error ?? 'No se pudo enviar';
      }
    }
    if (result.email.error || result.whatsapp.error) this.deps.log.warn({ event, tenantId: tenant.id, result }, 'avisos de la plataforma: no se pudo enviar');
    return result;
  }

  /**
   * A los superadministradores: por correo y, por WhatsApp/SMS, a los celulares cargados en Comunicaciones
   * más el celular que cada uno tenga en su perfil.
   */
  async toPlatform(event: PlatformNoticeEvent, notice: Notice, options: { force?: boolean; onlyEmail?: string } = {}): Promise<Result> {
    const settings = (await this.deps.platformSettings()).notices;
    const channels = options.force ? { email: true, whatsapp: true } : settings.events[event];
    const result: Result = { email: { sent: 0, error: null }, whatsapp: { sent: 0, error: null } };
    if (!channels.email && !channels.whatsapp) return result;
    const superadmins = await this.deps.db
      .select({ email: users.email, name: users.name, phone: users.phone })
      .from(users)
      .where(and(eq(users.role, 'superadmin'), eq(users.active, true)));
    // La prueba va solo a quien la pide (y a su celular).
    const recipients = options.onlyEmail ? superadmins.filter((a) => a.email === options.onlyEmail) : superadmins;
    if (channels.email) {
      const admins = options.onlyEmail && !recipients.length ? [{ email: options.onlyEmail, name: 'Administrador' }] : recipients;
      const brand = await this.deps.emailBrand(null);
      for (const admin of admins) {
        try {
          await this.deps.mailer.send(noticeMail(admin.email, admin.name, { ...notice, tag: `notice_${event}` }, brand), { tenantId: null });
          result.email.sent += 1;
        } catch (error) {
          result.email.error = errorOf(error);
        }
      }
    }
    if (channels.whatsapp) {
      const phones = uniquePhones([...settings.adminPhones, ...recipients.map((a) => a.phone ?? '')], settings.countryCode);
      if (!phones.length) result.whatsapp.error = 'No hay celulares de superadministradores cargados';
      for (const phone of phones) {
        const sent = await this.deps.notifier.sendPlatformText(phone, notice.whatsapp, { countryCode: settings.countryCode });
        if (sent.ok) result.whatsapp.sent += 1;
        else result.whatsapp.error = sent.error ?? 'No se pudo enviar';
      }
    }
    return result;
  }

  /* ------------------------------ Eventos ------------------------------ */

  /** Una sola vez por organización activa: hay una versión nueva de los términos para aceptar. */
  async legalUpdated(title: string, version: number, note: string | null) {
    const list = await this.deps.db.select().from(tenants).where(eq(tenants.status, 'active'));
    for (const tenant of list) {
      if (!(await this.once('legal_updated', `${tenant.id}:${title}:${version}`))) continue;
      await this.toTenant('legal_updated', tenant, {
        subject: `Actualizamos «${title}»`,
        title: `Nueva versión de «${title}»`,
        lines: [`Publicamos la versión ${version} de «${title}».${note ? ` Qué cambió: ${note}.` : ''}`, 'Un administrador de su organización tiene que revisarla y aceptarla la próxima vez que ingrese al panel. Los operadores siguen atendiendo con normalidad.'],
        cta: { label: 'Revisar y aceptar', url: `${this.base}/app` },
        whatsapp: `${tenant.name}: publicamos una nueva versión de «${title}». Un administrador debe aceptarla al ingresar al panel: ${this.base}/app`,
      });
    }
  }

  async tenantCreated(tenant: Tenant, admin: { name: string; email: string }, kind: 'registro' | 'demo') {
    await this.toPlatform('tenant_created', {
      subject: kind === 'demo' ? `Nueva demo: ${tenant.name}` : `Nueva organización: ${tenant.name}`,
      title: kind === 'demo' ? 'Alguien pidió una demo' : 'Se registró una organización',
      lines: [`${tenant.name} (${tenant.slug})`, `Administrador: ${admin.name} <${admin.email}>`, `Plan: ${tenant.plan}${tenant.isDemo ? ' · demo' : ''}`],
      cta: { label: 'Ver en la plataforma', url: `${this.base}/plataforma` },
      whatsapp: `${kind === 'demo' ? 'Nueva demo' : 'Nueva organización'}: ${tenant.name} — ${admin.name} (${admin.email})`,
    });
  }

  async tenantSuspended(tenantIds: string[]) {
    if (!tenantIds.length) return;
    const list = await this.deps.db.select().from(tenants).where(inArray(tenants.id, tenantIds));
    for (const tenant of list) {
      await this.toTenant('tenant_suspended', tenant, {
        subject: `${tenant.name}: servicio suspendido por falta de pago`,
        title: 'Su organización está suspendida',
        lines: ['Suspendimos el servicio porque hay facturas vencidas sin pagar. Las pantallas, los kioscos y la atención están detenidos.', 'Un administrador puede ingresar y pagar desde «Plan y facturación»: el servicio se reactiva solo al acreditarse el pago.'],
        cta: { label: 'Ver y pagar', url: `${this.base}/app/facturacion` },
        whatsapp: `${tenant.name}: suspendimos el servicio por facturas vencidas. Pague desde ${this.base}/app/facturacion y se reactiva solo.`,
      });
    }
  }

  /** Recordatorios: facturas por vencer, vencidas y demos por vencer (lo corre el mantenimiento). */
  async runDaily(now = new Date()) {
    const settings = await this.deps.platformSettings();
    const today = todayISO(now);
    let sent = 0;
    if (settings.billing.enabled) {
      const rows = await this.deps.db
        .select({ invoice: invoices, tenant: tenants })
        .from(invoices)
        .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
        // Solo vencimientos recientes o próximos: no se avisan facturas viejas al activar la función.
        .where(and(eq(invoices.status, 'pending'), gte(invoices.dueDate, addDays(today, -7)), lte(invoices.dueDate, addDays(today, settings.notices.dueDaysBefore))));
      for (const { invoice, tenant } of rows) {
        const number = `F-${String(invoice.seq).padStart(6, '0')}`;
        const amount = formatMoney(invoice.amount, invoice.currency);
        if (invoice.dueDate >= today) {
          if (!(await this.once('invoice_due', invoice.id))) continue;
          await this.toTenant('invoice_due', tenant, {
            subject: `Recordatorio: la factura ${number} vence el ${dmy(invoice.dueDate)}`,
            title: 'Su factura está por vencer',
            lines: [`La factura ${number} (${invoice.description}) por ${amount} vence el ${dmy(invoice.dueDate)}.`, 'Si ya la pagó, no tiene que hacer nada.'],
            cta: { label: 'Ver y pagar', url: `${this.base}/app/facturacion` },
            outro: settings.billing.instructions ? [settings.billing.instructions] : [],
            whatsapp: `${tenant.name}: la factura ${number} por ${amount} vence el ${dmy(invoice.dueDate)}. Pague en ${this.base}/app/facturacion`,
          });
        } else {
          if (!(await this.once('invoice_overdue', invoice.id))) continue;
          const suspension = settings.billing.autoSuspend ? addDays(invoice.dueDate, settings.billing.graceDays + 1) : null;
          await this.toTenant('invoice_overdue', tenant, {
            subject: `La factura ${number} está vencida`,
            title: 'Tiene una factura vencida',
            lines: [
              `La factura ${number} (${invoice.description}) por ${amount} venció el ${dmy(invoice.dueDate)}.`,
              suspension ? `Si no se paga, el servicio se suspende el ${dmy(suspension)}.` : 'Por favor, regularice el pago.',
            ],
            cta: { label: 'Ver y pagar', url: `${this.base}/app/facturacion` },
            outro: settings.billing.instructions ? [settings.billing.instructions] : [],
            whatsapp: `${tenant.name}: la factura ${number} por ${amount} venció el ${dmy(invoice.dueDate)}.${suspension ? ` El servicio se suspende el ${dmy(suspension)}.` : ''} ${this.base}/app/facturacion`,
          });
        }
        sent += 1;
      }
    }
    const limit = new Date(now.getTime() + settings.notices.demoDaysBefore * 86_400_000);
    const demos = await this.deps.db.select().from(tenants).where(and(eq(tenants.isDemo, true), gte(tenants.demoExpiresAt, now), lte(tenants.demoExpiresAt, limit)));
    for (const tenant of demos) {
      if (!(await this.once('demo_expiring', `${tenant.id}:${tenant.demoExpiresAt!.toISOString().slice(0, 10)}`))) continue;
      const days = Math.max(1, Math.ceil((tenant.demoExpiresAt!.getTime() - now.getTime()) / 86_400_000));
      await this.toTenant('demo_expiring', tenant, {
        subject: `Su demo vence en ${days} ${days === 1 ? 'día' : 'días'}`,
        title: 'Su demo está por vencer',
        lines: [`La demo de ${tenant.name} vence en ${days} ${days === 1 ? 'día' : 'días'}.`, 'Para seguir usando el sistema con sus datos y configuración, contáctenos o elija un plan.'],
        cta: { label: 'Ingresar', url: `${this.base}/app` },
        whatsapp: `${tenant.name}: su demo vence en ${days} ${days === 1 ? 'día' : 'días'}. Respóndanos para seguir usando el sistema.`,
      });
      sent += 1;
    }
    return sent;
  }

  /** Aviso de prueba: va al superadministrador que lo pide y a los celulares de la plataforma. */
  async test(event: PlatformNoticeEvent, email: string): Promise<Result> {
    const info = PLATFORM_NOTICE_INFO[event];
    return this.toPlatform(
      event,
      {
        subject: `Prueba: ${info.label}`,
        title: `Prueba del aviso «${info.label}»`,
        lines: [info.description, 'Así llega este aviso. Es solo una prueba: no hace falta hacer nada.'],
        whatsapp: `Prueba del aviso «${info.label}» de la plataforma.`,
      },
      { force: true, onlyEmail: email },
    );
  }

  /** Por dónde sale el correo y el WhatsApp/SMS de cada organización. */
  async channels(modulesOf: (t: Tenant) => Promise<string[]>): Promise<TenantChannelsDTO[]> {
    const [list, mails, providers, admins, platformMail] = await Promise.all([
      this.deps.db.select().from(tenants).orderBy(tenants.name),
      this.deps.db.select({ scope: mailSettings.scope, enabled: mailSettings.enabled }).from(mailSettings),
      this.deps.db.select({ scope: notifyProviders.scope, enabled: notifyProviders.enabled }).from(notifyProviders),
      this.deps.db
        .select({ tenantId: users.tenantId, n: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.active, true)))
        .groupBy(users.tenantId),
      this.deps.mailer.resolve(null),
    ]);
    const ownMail = new Set(mails.filter((m) => m.enabled).map((m) => m.scope));
    const ownNotify = new Set(providers.filter((p) => p.enabled).map((p) => p.scope));
    const platformNotify = ownNotify.has(PLATFORM_NOTIFY_SCOPE);
    const out: TenantChannelsDTO[] = [];
    for (const t of list) {
      const modules = await modulesOf(t);
      out.push({
        tenant: { id: t.id, name: t.name, plan: t.plan, isDemo: t.isDemo },
        mail: ownMail.has(t.id) ? 'tenant' : platformMail.source !== 'none' ? 'platform' : 'none',
        whatsapp: !modules.includes('notifications') ? 'off' : ownNotify.has(t.id) ? 'tenant' : platformNotify ? 'platform' : 'none',
        phone: Boolean(tenantSettings(t).fiscal.phone),
        admins: admins.find((a) => a.tenantId === t.id)?.n ?? 0,
      });
    }
    return out;
  }
}
