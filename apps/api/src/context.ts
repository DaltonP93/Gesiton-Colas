import type { FastifyBaseLogger } from 'fastify';
import { RT, type TicketDTO, type WebhookEvent } from '@gc/shared';
import type { AppConfig } from './config';
import type { Database } from './db/client';
import { createAuth, type Auth } from './lib/auth';
import { toCallDTO } from './lib/dto';
import { createMailer, type Mailer } from './lib/mailer';
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
  log: FastifyBaseLogger;
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
  const auth = createAuth(config, db);
  const rt = new Realtime(db, auth, log, config.CORS_ORIGINS);
  const webhooks = new WebhookDispatcher(db, log, config.WEBHOOKS_ALLOW_PRIVATE);
  const storage = createStorage(config);
  const mailer = createMailer(config, log);

  return {
    config,
    db,
    auth,
    storage,
    rt,
    webhooks,
    mailer,
    log,
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
