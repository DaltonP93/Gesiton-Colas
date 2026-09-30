import type { FastifyBaseLogger } from 'fastify';
import { RT, effectiveModules, type ModuleId, type TicketDTO, type WebhookEvent } from '@gc/shared';
import type { AppConfig } from './config';
import type { Database } from './db/client';
import { eq } from 'drizzle-orm';
import { tenants, type Tenant } from './db/schema';
import { createAuth, type Auth } from './lib/auth';
import { tenantSettings, toCallDTO } from './lib/dto';
import { brandFrom, type EmailBrand } from './lib/emails';
import { createMailer, type Mailer } from './lib/mailer';
import { createPlatformSettings, type PlatformSettingsStore } from './lib/platformSettings';
import { createStorage, type Storage } from './lib/storage';
import { WebhookDispatcher } from './modules/webhooks/dispatcher';
import { Realtime, rooms } from './realtime';

export interface AppContext {
  config: AppConfig;
  db: Database;
  auth: Auth;
  storage: Storage;
  rt: Realtime;
  webhooks: WebhookDispatcher;
  mailer: Mailer;
  /** Ajustes globales del superadministrador (página de inicio, registro, marca del ingreso). */
  platform: PlatformSettingsStore;
  log: FastifyBaseLogger;
  /** Marca de los correos: la de la organización o, sin organización, la de la plataforma. */
  emailBrand(tenant: Tenant | null | undefined): Promise<EmailBrand>;
  /** Módulos activos de una organización: los de su plan con los ajustes del superadministrador. */
  modulesOf(tenant: Pick<Tenant, 'plan' | 'modules'>): Promise<ModuleId[]>;
  /** Notifica un cambio de turno a pantallas, operadores, seguimiento público y webhooks. */
  publishTicket(
    tenantId: string,
    event: WebhookEvent,
    ticket: TicketDTO,
    extra?: Record<string, unknown>,
    options?: { announceName?: boolean },
  ): void;
  /** Pide a las pantallas / kioscos que recarguen su configuración. */
  refreshDevices(tenantId: string, target?: { displayId?: string; kioskId?: string }): void;
}

/** Versión sin datos personales ni token de seguimiento, para pantallas y kioscos. */
export function toPublicTicketEvent(t: TicketDTO) {
  return {
    id: t.id,
    code: t.code,
    status: t.status,
    branchId: t.branchId,
    serviceId: t.serviceId,
    calledAt: t.calledAt,
    callCount: t.callCount,
    service: t.service ?? null,
    priority: t.priority ?? null,
    counter: t.counter ?? null,
  };
}

export function createContext(config: AppConfig, db: Database, log: FastifyBaseLogger): AppContext {
  const platform = createPlatformSettings(db);
  const modulesOf = async (tenant: Pick<Tenant, 'plan' | 'modules'>) => {
    const { plans } = await platform.get();
    return effectiveModules(plans[tenant.plan]?.modules ?? plans.free.modules, tenant.modules);
  };
  const auth = createAuth(config, db, modulesOf);
  const rt = new Realtime(db, auth, log, config.CORS_ORIGINS);
  const webhooks = new WebhookDispatcher(db, log, config.WEBHOOKS_ALLOW_PRIVATE, async (tenantId) => {
    const [tenant] = await db.select({ plan: tenants.plan, modules: tenants.modules }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return tenant ? (await modulesOf(tenant)).includes('integrations') : false;
  });
  const storage = createStorage(config);
  const mailer = createMailer(config, db, log);
  const publicUrl = config.PUBLIC_URL.replace(/\/$/, '');

  return {
    config,
    db,
    auth,
    storage,
    rt,
    webhooks,
    mailer,
    platform,
    modulesOf,
    log,
    async emailBrand(tenant) {
      if (tenant) return brandFrom(tenantSettings(tenant).branding, publicUrl);
      const { brand } = await platform.get();
      return brandFrom({ appName: brand.appName, logoUrl: brand.logoUrl, primaryColor: brand.primaryColor }, publicUrl);
    },
    publishTicket(tenantId, event, ticket, extra = {}, options = {}) {
      const call = toCallDTO(ticket);
      if (!options.announceName) call.customerName = null;
      const publicTicket = toPublicTicketEvent(ticket);
      const deviceRoom = rooms.branch(ticket.branchId);
      const staffRoom = rooms.staff(ticket.branchId);
      if (event === 'ticket.called' || event === 'ticket.recalled') {
        const recall = event === 'ticket.recalled';
        rt.emit(deviceRoom, RT.ticketCalled, { call, ticket: publicTicket, recall });
        rt.emit(staffRoom, RT.ticketCalled, { call: toCallDTO(ticket), ticket, recall });
      } else if (event === 'ticket.created') {
        rt.emit(deviceRoom, RT.ticketCreated, { ticket: publicTicket });
        rt.emit(staffRoom, RT.ticketCreated, { ticket });
      }
      rt.emit(deviceRoom, RT.ticketUpdated, { event, ticket: publicTicket });
      rt.emit(staffRoom, RT.ticketUpdated, { event, ticket });
      rt.emit(rooms.track(ticket.publicToken), RT.ticketUpdated, { event, status: ticket.status });
      webhooks
        .dispatch(tenantId, event, { ticket, ...extra })
        .catch((error) => log.error({ err: error }, 'webhooks: dispatch'));
    },
    refreshDevices(tenantId, target) {
      if (target?.displayId) rt.emit(rooms.display(target.displayId), RT.displayConfig, {});
      else if (target?.kioskId) rt.emit(rooms.kiosk(target.kioskId), RT.kioskConfig, {});
      else {
        rt.emit(rooms.devices(tenantId), RT.displayConfig, {});
        rt.emit(rooms.devices(tenantId), RT.kioskConfig, {});
      }
    },
  };
}
