import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DeviceAlertSettings, ModuleId, OfflineDeviceDTO } from '@gc/shared';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { branches, displays, kiosks, tenants, users, type Tenant } from '../db/schema';
import { tenantSettings } from './dto';
import { deviceAlertMail, type EmailBrand } from './emails';
import type { Mailer } from './mailer';
import type { Notifier } from './notifier';

interface MonitorDeps {
  config: AppConfig;
  db: Database;
  log: FastifyBaseLogger;
  mailer: Mailer;
  notifier: Notifier;
  modulesOf(tenant: Pick<Tenant, 'plan' | 'modules'>): Promise<ModuleId[]>;
  emailBrand(tenant: Tenant | null): Promise<EmailBrand>;
  /** Avisa al panel (tiempo real) que cambió el estado de los equipos. */
  onChange?(tenantId: string): void;
}

type Kind = 'display' | 'kiosk';
interface DeviceRow {
  id: string;
  kind: Kind;
  name: string;
  branch: string;
  lastSeenAt: Date;
  offlineAlertedAt: Date | null;
  tenant: Tenant;
}

const KIND_LABEL: Record<Kind, string> = { display: 'Pantalla', kiosk: 'Kiosco' };

/** ¿Estamos dentro del horario en que se avisa (en la zona horaria de la organización)? */
export function withinAlertWindow(now: Date, timezone: string, s: Pick<DeviceAlertSettings, 'days' | 'from' | 'to'>) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const from = toMin(s.from);
  const to = toMin(s.to);
  const inHours = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  return s.days.includes(day) && inHours;
}

/** Revisa cada minuto qué TVs y kioscos dejaron de responder y avisa (una sola vez por desconexión). */
export class DeviceMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: MonitorDeps) {}

  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check().catch((error) => this.deps.log.error({ err: error }, 'equipos: error al revisar')), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async devices(): Promise<DeviceRow[]> {
    const pick = (table: typeof displays | typeof kiosks, kind: Kind) =>
      this.deps.db
        .select({ id: table.id, name: table.name, lastSeenAt: table.lastSeenAt, offlineAlertedAt: table.offlineAlertedAt, branch: branches.name, tenant: tenants })
        .from(table)
        .innerJoin(tenants, eq(tenants.id, table.tenantId))
        .innerJoin(branches, eq(branches.id, table.branchId))
        .where(and(isNotNull(table.lastSeenAt), eq(tenants.status, 'active')))
        .then((rows) => rows.map((r) => ({ ...r, kind, lastSeenAt: r.lastSeenAt! })));
    const [d, k] = await Promise.all([pick(displays, 'display'), pick(kiosks, 'kiosk')]);
    return [...d, ...k];
  }

  /** Equipos de una organización que están marcados como desconectados. */
  async offline(tenantId: string): Promise<OfflineDeviceDTO[]> {
    const pick = (table: typeof displays | typeof kiosks, kind: Kind) =>
      this.deps.db
        .select({ id: table.id, name: table.name, lastSeenAt: table.lastSeenAt, branch: branches.name })
        .from(table)
        .innerJoin(branches, eq(branches.id, table.branchId))
        .where(and(eq(table.tenantId, tenantId), isNotNull(table.offlineAlertedAt)))
        .then((rows) => rows.map((r) => ({ id: r.id, kind, name: r.name, branch: r.branch, lastSeenAt: (r.lastSeenAt ?? new Date()).toISOString() })));
    const [d, k] = await Promise.all([pick(displays, 'display'), pick(kiosks, 'kiosk')]);
    return [...d, ...k];
  }

  async check(now = new Date()) {
    if (this.running) return { offline: 0, recovered: 0 };
    this.running = true;
    try {
      const byTenant = new Map<string, { tenant: Tenant; offline: DeviceRow[]; recovered: DeviceRow[] }>();
      const modules = new Map<string, ModuleId[]>();
      for (const device of await this.devices()) {
        const s = tenantSettings(device.tenant).alerts.devices;
        if (!modules.has(device.tenant.id)) modules.set(device.tenant.id, await this.deps.modulesOf(device.tenant));
        const enabledModule = modules.get(device.tenant.id)!.includes(device.kind === 'display' ? 'displays' : 'kiosks');
        const table = device.kind === 'display' ? displays : kiosks;
        const entry = byTenant.get(device.tenant.id) ?? { tenant: device.tenant, offline: [], recovered: [] };

        if (device.offlineAlertedAt) {
          // Volvió: el último latido es posterior a la alerta.
          if (device.lastSeenAt > device.offlineAlertedAt) {
            const [row] = await this.deps.db
              .update(table)
              .set({ offlineAlertedAt: null })
              .where(and(eq(table.id, device.id), isNotNull(table.offlineAlertedAt)))
              .returning({ id: table.id });
            if (row && s.enabled && s.recovery) entry.recovered.push(device);
            if (row) byTenant.set(device.tenant.id, entry);
          }
          continue;
        }
        if (!s.enabled || !enabledModule) continue;
        if (now.getTime() - device.lastSeenAt.getTime() < s.minutes * 60_000) continue;
        if (!withinAlertWindow(now, tenantSettings(device.tenant).timezone, s)) continue;
        // Se marca primero (atómico): aunque haya varias instancias, se avisa una sola vez.
        const [row] = await this.deps.db
          .update(table)
          .set({ offlineAlertedAt: now })
          .where(and(eq(table.id, device.id), isNull(table.offlineAlertedAt)))
          .returning({ id: table.id });
        if (row) {
          entry.offline.push(device);
          byTenant.set(device.tenant.id, entry);
        }
      }

      let offline = 0;
      let recovered = 0;
      for (const { tenant, offline: down, recovered: up } of byTenant.values()) {
        offline += down.length;
        recovered += up.length;
        this.deps.onChange?.(tenant.id);
        if (down.length || up.length) await this.notify(tenant, down, up);
      }
      return { offline, recovered };
    } finally {
      this.running = false;
    }
  }

  /** Avisa por correo y, si hay teléfonos y el módulo de avisos, por WhatsApp/SMS. */
  async notify(tenant: Tenant, down: Pick<DeviceRow, 'kind' | 'name' | 'branch' | 'lastSeenAt'>[], up: Pick<DeviceRow, 'kind' | 'name' | 'branch'>[]) {
    const settings = tenantSettings(tenant);
    const s = settings.alerts.devices;
    const fmt = new Intl.DateTimeFormat('es', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
    const recipients = s.emails.length
      ? s.emails.map((email) => ({ email, name: '' }))
      : await this.deps.db
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'admin'), eq(users.active, true), ne(users.email, '')));
    const brand = await this.deps.emailBrand(tenant);
    const url = `${this.deps.config.PUBLIC_URL.replace(/\/$/, '')}/app/pantallas`;
    const alert = {
      organization: tenant.name,
      offline: down.map((d) => ({ name: d.name, kind: KIND_LABEL[d.kind], branch: d.branch, since: fmt.format(d.lastSeenAt) })),
      recovered: up.map((d) => ({ name: d.name, kind: KIND_LABEL[d.kind], branch: d.branch })),
    };
    for (const r of recipients) {
      try {
        await this.deps.mailer.send(deviceAlertMail(r.email, r.name, alert, url, brand), { tenantId: tenant.id });
      } catch (error) {
        this.deps.log.warn({ err: error, tenantId: tenant.id }, 'equipos: no se pudo enviar la alerta por correo');
      }
    }
    if (s.phones.length && (await this.deps.modulesOf(tenant)).includes('notifications')) {
      const lines = [
        ...alert.offline.map((d) => `⚠️ ${d.kind} «${d.name}» (${d.branch}) sin conexión desde ${d.since}.`),
        ...alert.recovered.map((d) => `✅ ${d.kind} «${d.name}» (${d.branch}) volvió a conectarse.`),
      ];
      const text = `${tenant.name}: ${lines.join(' ')}`.slice(0, 700);
      for (const phone of s.phones) await this.deps.notifier.sendText(tenant, phone, text);
    }
  }
}

