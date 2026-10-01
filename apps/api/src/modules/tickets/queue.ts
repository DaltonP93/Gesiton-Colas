import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  RT,
  formatTicketCode,
  numberingPeriod,
  ticketNumberFor,
  hasRole,
  type AgentWorkstationDTO,
  type CustomerData,
  type QueueSnapshotDTO,
  type Role,
  type TicketChannel,
  type TicketDTO,
  type TicketStatus,
  type WebhookEvent,
} from '@gc/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import {
  agentWorkstations,
  branches,
  branchServices,
  counters,
  priorities,
  services,
  tenants,
  ticketEvents,
  tickets,
  ticketSequences,
  userBranches,
  userServices,
  users,
  type Ticket,
} from '../../db/schema';
import { randomToken } from '../../lib/crypto';
import { tenantSettings, toTicketDTO } from '../../lib/dto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { dayInTimezone } from '../../lib/tz';
import { rooms } from '../../realtime';

export interface Actor {
  userId: string | null;
  role: Role;
}

type QueueCtx = Pick<AppContext, 'db' | 'publishTicket'>;

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

function selectTickets(db: DbOrTx) {
  return db
    .select({
      t: tickets,
      s: { id: services.id, name: services.name, color: services.color },
      p: { id: priorities.id, name: priorities.name, weight: priorities.weight, color: priorities.color },
      c: { id: counters.id, name: counters.name },
      a: { id: users.id, name: users.name },
    })
    .from(tickets)
    .leftJoin(services, eq(services.id, tickets.serviceId))
    .leftJoin(priorities, eq(priorities.id, tickets.priorityId))
    .leftJoin(counters, eq(counters.id, tickets.counterId))
    .leftJoin(users, eq(users.id, tickets.agentId));
}

type TicketRow = Awaited<ReturnType<ReturnType<typeof selectTickets>['execute']>>[number];
const rowToDTO = (r: TicketRow) => toTicketDTO(r.t, { service: r.s, priority: r.p, counter: r.c, agent: r.a });

export async function findTickets(db: DbOrTx, where: SQL | undefined, order: SQL[] = [asc(tickets.createdAt)], limit = 500) {
  const rows = await selectTickets(db)
    .where(where)
    .orderBy(...order)
    .limit(limit);
  return rows.map(rowToDTO);
}

export async function loadTicket(db: DbOrTx, tenantId: string, ticketId: string): Promise<TicketDTO> {
  const [row] = await selectTickets(db)
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
    .limit(1);
  if (!row) throw notFound('Turno');
  return rowToDTO(row);
}

/** Cantidad de turnos que se atenderán antes que este (misma sucursal y servicio). */
export async function countAhead(db: DbOrTx, ticket: Pick<TicketDTO, 'id' | 'branchId' | 'serviceId' | 'createdAt' | 'priority'>) {
  const weight = ticket.priority?.weight ?? 0;
  const result = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM tickets t JOIN priorities p ON p.id = t.priority_id
    WHERE t.branch_id = ${ticket.branchId} AND t.service_id = ${ticket.serviceId}
      AND t.status = 'waiting' AND t.id <> ${ticket.id}
      AND (p.weight > ${weight} OR (p.weight = ${weight} AND t.created_at < ${ticket.createdAt}))`);
  return result.rows[0]?.n ?? 0;
}

async function loadTenantSettings(db: DbOrTx, tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw notFound('Organización');
  return tenantSettings(tenant);
}

async function branchDay(db: DbOrTx, tenantId: string, branchId: string) {
  const [branch] = await db
    .select({ timezone: branches.timezone })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
    .limit(1);
  if (!branch) throw notFound('Sucursal');
  const settings = await loadTenantSettings(db, tenantId);
  return dayInTimezone(new Date(), branch.timezone ?? settings.timezone);
}

const waitingOrder = [desc(priorities.weight), asc(tickets.createdAt)];

export async function queueSnapshot(
  db: DbOrTx,
  tenantId: string,
  branchId: string,
  serviceIds?: string[],
): Promise<QueueSnapshotDTO> {
  const day = await branchDay(db, tenantId, branchId);
  const base = and(
    eq(tickets.tenantId, tenantId),
    eq(tickets.branchId, branchId),
    serviceIds && serviceIds.length > 0 ? inArray(tickets.serviceId, serviceIds) : undefined,
  );
  const [waiting, active, counts] = await Promise.all([
    findTickets(db, and(base, eq(tickets.status, 'waiting')), waitingOrder),
    findTickets(db, and(base, inArray(tickets.status, ['called', 'in_service'])), [desc(tickets.calledAt)]),
    db.execute<{ status: TicketStatus; n: number }>(sql`
      SELECT status, count(*)::int AS n FROM tickets
      WHERE ${base} AND (status IN ('waiting','called','in_service') OR service_day = ${day})
      GROUP BY status`),
  ]);
  const by = Object.fromEntries(counts.rows.map((r) => [r.status, r.n])) as Partial<Record<TicketStatus, number>>;
  return {
    waiting,
    active,
    counts: {
      waiting: by.waiting ?? 0,
      called: by.called ?? 0,
      inService: by.in_service ?? 0,
      finishedToday: by.finished ?? 0,
      noShowToday: by.no_show ?? 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Emisión                                                             */
/* ------------------------------------------------------------------ */

export interface IssueInput {
  tenantId: string;
  branchId: string;
  serviceId: string;
  priorityId?: string | null;
  customer?: CustomerData;
  notes?: string;
  channel: TicketChannel;
  userId?: string | null;
}

function sanitizeCustomer(customer: CustomerData | undefined): CustomerData {
  const out: CustomerData = {};
  if (!customer) return out;
  for (const [key, value] of Object.entries(customer).slice(0, 40)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    out[key] = String(value).slice(0, 300);
  }
  return out;
}

export async function issueTicket(ctx: QueueCtx, input: IssueInput) {
  const { ticketId, announceName } = await ctx.db.transaction(async (tx) => {
    const settings = await loadTenantSettings(tx, input.tenantId);
    const [row] = await tx
      .select({ branch: branches, service: services, bs: branchServices })
      .from(branchServices)
      .innerJoin(branches, eq(branches.id, branchServices.branchId))
      .innerJoin(services, eq(services.id, branchServices.serviceId))
      .where(
        and(
          eq(branchServices.tenantId, input.tenantId),
          eq(branchServices.branchId, input.branchId),
          eq(branchServices.serviceId, input.serviceId),
        ),
      )
      .limit(1);
    if (!row) throw notFound('Servicio en la sucursal');
    if (!row.branch.active) throw badRequest('La sucursal está inactiva');
    if (!row.service.active || !row.bs.enabled) throw badRequest('El servicio no está disponible en esta sucursal');

    const priorityRows = await tx
      .select()
      .from(priorities)
      .where(
        and(
          eq(priorities.tenantId, input.tenantId),
          eq(priorities.active, true),
          input.priorityId ? eq(priorities.id, input.priorityId) : undefined,
        ),
      )
      .orderBy(asc(priorities.weight), asc(priorities.sortOrder))
      .limit(1);
    const priority = priorityRows[0];
    if (!priority) throw input.priorityId ? notFound('Prioridad') : badRequest('No hay prioridades configuradas');

    const now = new Date();
    const day = dayInTimezone(now, row.branch.timezone ?? settings.timezone);
    const period = numberingPeriod(day, settings.tickets.reset);
    const scopeKey = settings.tickets.scope === 'service' ? input.serviceId : '*';
    // El contador siempre crece dentro del período; el número visible respeta el inicio y el tope de dígitos.
    const seq = await tx.execute<{ value: number }>(sql`
      INSERT INTO ticket_sequences (tenant_id, branch_id, scope_key, period, value)
      VALUES (${input.tenantId}, ${input.branchId}, ${scopeKey}, ${period}, 1)
      ON CONFLICT (branch_id, scope_key, period) DO UPDATE SET value = ticket_sequences.value + 1
      RETURNING value`);
    const number = ticketNumberFor(Number(seq.rows[0]!.value), settings.tickets);
    const prefix = row.bs.prefix ?? row.service.prefix;

    const [ticket] = await tx
      .insert(tickets)
      .values({
        tenantId: input.tenantId,
        branchId: input.branchId,
        serviceId: input.serviceId,
        priorityId: priority.id,
        number,
        code: formatTicketCode(prefix, number, settings.tickets.digits),
        channel: input.channel,
        customer: sanitizeCustomer(input.customer),
        notes: input.notes?.slice(0, 2000) ?? '',
        publicToken: randomToken(20),
        serviceDay: day,
        createdAt: now,
      })
      .returning({ id: tickets.id });
    await tx.insert(ticketEvents).values({
      tenantId: input.tenantId,
      ticketId: ticket!.id,
      type: 'created',
      userId: input.userId ?? null,
      data: { channel: input.channel },
    });
    return { ticketId: ticket!.id, announceName: settings.tickets.announceCustomerName };
  });

  const ticket = await loadTicket(ctx.db, input.tenantId, ticketId);
  const waitingAhead = await countAhead(ctx.db, ticket);
  ctx.publishTicket(input.tenantId, 'ticket.created', ticket, { waitingAhead }, { announceName });
  return { ticket, waitingAhead };
}

/* ------------------------------------------------------------------ */
/* Puesto de trabajo del operador                                      */
/* ------------------------------------------------------------------ */

async function activeTicketOf(db: DbOrTx, tenantId: string, userId: string) {
  const [row] = await selectTickets(db)
    .where(and(eq(tickets.tenantId, tenantId), eq(tickets.agentId, userId), inArray(tickets.status, ['called', 'in_service'])))
    .orderBy(desc(tickets.calledAt))
    .limit(1);
  return row ? rowToDTO(row) : null;
}

export async function getWorkstation(db: DbOrTx, tenantId: string, userId: string): Promise<AgentWorkstationDTO> {
  const [ws] = await db
    .select()
    .from(agentWorkstations)
    .where(and(eq(agentWorkstations.userId, userId), eq(agentWorkstations.tenantId, tenantId)))
    .limit(1);
  return {
    branchId: ws?.branchId ?? null,
    counterId: ws?.counterId ?? null,
    serviceIds: ws?.serviceIds ?? [],
    paused: ws?.paused ?? false,
    current: await activeTicketOf(db, tenantId, userId),
  };
}

/** Sucursales y servicios que puede atender un usuario (sin asignaciones = todos). */
export async function userScope(db: DbOrTx, userId: string) {
  const [b, s] = await Promise.all([
    db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId)),
    db.select({ id: userServices.serviceId }).from(userServices).where(eq(userServices.userId, userId)),
  ]);
  return { branchIds: b.map((r) => r.id), serviceIds: s.map((r) => r.id) };
}

export async function setWorkstation(
  db: DbOrTx,
  tenantId: string,
  actor: { userId: string; role: Role },
  input: { branchId: string | null; counterId: string | null; serviceIds: string[]; paused: boolean },
): Promise<AgentWorkstationDTO> {
  const scope = await userScope(db, actor.userId);
  const restricted = !hasRole(actor.role, 'manager');
  let serviceIds = [...new Set(input.serviceIds)];

  if (input.branchId) {
    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, input.branchId), eq(branches.tenantId, tenantId)))
      .limit(1);
    if (!branch) throw notFound('Sucursal');
    if (restricted && scope.branchIds.length > 0 && !scope.branchIds.includes(branch.id)) {
      throw forbidden('No está asignado a esta sucursal');
    }
    if (input.counterId) {
      const [counter] = await db
        .select()
        .from(counters)
        .where(and(eq(counters.id, input.counterId), eq(counters.branchId, branch.id)))
        .limit(1);
      if (!counter) throw notFound('Puesto de atención');
    }
    if (serviceIds.length > 0) {
      const enabled = await db
        .select({ id: branchServices.serviceId })
        .from(branchServices)
        .where(and(eq(branchServices.branchId, branch.id), eq(branchServices.enabled, true), inArray(branchServices.serviceId, serviceIds)));
      const enabledIds = new Set(enabled.map((r) => r.id));
      serviceIds = serviceIds.filter((id) => enabledIds.has(id));
      if (restricted && scope.serviceIds.length > 0) serviceIds = serviceIds.filter((id) => scope.serviceIds.includes(id));
    }
  } else if (input.counterId) {
    throw badRequest('Seleccione una sucursal');
  }

  const values = {
    userId: actor.userId,
    tenantId,
    branchId: input.branchId,
    counterId: input.branchId ? input.counterId : null,
    serviceIds,
    paused: input.paused,
  };
  await db
    .insert(agentWorkstations)
    .values(values)
    .onConflictDoUpdate({ target: agentWorkstations.userId, set: { ...values, updatedAt: new Date() } });
  return getWorkstation(db, tenantId, actor.userId);
}

/* ------------------------------------------------------------------ */
/* Llamados y cambios de estado                                        */
/* ------------------------------------------------------------------ */

async function requireReadyWorkstation(db: DbOrTx, tenantId: string, userId: string) {
  const [ws] = await db
    .select()
    .from(agentWorkstations)
    .where(and(eq(agentWorkstations.userId, userId), eq(agentWorkstations.tenantId, tenantId)))
    .limit(1);
  if (!ws?.branchId || !ws.counterId) throw badRequest('Configure su sucursal y puesto de atención antes de llamar');
  if (ws.serviceIds.length === 0) throw badRequest('Seleccione al menos un servicio para atender');
  if (ws.paused) throw badRequest('Está en pausa. Reanude la atención para llamar turnos.');
  return { branchId: ws.branchId, counterId: ws.counterId, serviceIds: ws.serviceIds };
}

async function assertNoActiveTicket(db: DbOrTx, tenantId: string, userId: string) {
  const current = await activeTicketOf(db, tenantId, userId);
  if (current) throw conflict(`Finalice el turno ${current.code} antes de llamar a otro`, { ticketId: current.id });
}

async function publishLoaded(ctx: QueueCtx, tenantId: string, event: WebhookEvent, ticketId: string, extra?: Record<string, unknown>) {
  const [ticket, settings] = await Promise.all([loadTicket(ctx.db, tenantId, ticketId), loadTenantSettings(ctx.db, tenantId)]);
  ctx.publishTicket(tenantId, event, ticket, extra, { announceName: settings.tickets.announceCustomerName });
  return ticket;
}

/** Llama al siguiente turno según prioridad y orden de llegada. Devuelve null si no hay turnos. */
export async function callNext(ctx: QueueCtx, tenantId: string, userId: string): Promise<TicketDTO | null> {
  const ticketId = await ctx.db.transaction(async (tx) => {
    const ws = await requireReadyWorkstation(tx, tenantId, userId);
    await assertNoActiveTicket(tx, tenantId, userId);
    const settings = await loadTenantSettings(tx, tenantId);
    const serviceList = sql.join(ws.serviceIds.map((id) => sql`${id}::uuid`), sql`, `);

    // Evita que la cola normal quede bloqueada si hay muchos turnos preferenciales.
    let preferNormal = false;
    const ratio = settings.tickets.priorityRatio;
    if (ratio > 0) {
      const recent = await tx.execute<{ weight: number }>(sql`
        SELECT p.weight FROM tickets t JOIN priorities p ON p.id = t.priority_id
        WHERE t.branch_id = ${ws.branchId} AND t.service_id IN (${serviceList}) AND t.called_at IS NOT NULL
        ORDER BY t.called_at DESC LIMIT ${ratio}`);
      preferNormal = recent.rows.length === ratio && recent.rows.every((r) => r.weight > 0);
    }

    const candidate = await tx.execute<{ id: string }>(sql`
      SELECT t.id FROM tickets t JOIN priorities p ON p.id = t.priority_id
      WHERE t.tenant_id = ${tenantId} AND t.branch_id = ${ws.branchId}
        AND t.status = 'waiting' AND t.service_id IN (${serviceList})
      ORDER BY ${preferNormal ? sql`(p.weight = 0) DESC,` : sql``} p.weight DESC, t.created_at ASC
      LIMIT 1
      FOR UPDATE OF t SKIP LOCKED`);
    const id = candidate.rows[0]?.id;
    if (!id) return null;
    await markCalled(tx, tenantId, id, userId, ws.counterId);
    return id;
  });
  if (!ticketId) return null;
  return publishLoaded(ctx, tenantId, 'ticket.called', ticketId);
}

async function markCalled(tx: DbOrTx, tenantId: string, ticketId: string, userId: string, counterId: string) {
  await tx
    .update(tickets)
    .set({ status: 'called', counterId, agentId: userId, calledAt: new Date(), callCount: sql`${tickets.callCount} + 1` })
    .where(eq(tickets.id, ticketId));
  await tx.insert(ticketEvents).values({ tenantId, ticketId, type: 'called', userId, counterId });
}

/** Llama un turno específico de la lista de espera. */
export async function callTicket(ctx: QueueCtx, tenantId: string, userId: string, ticketId: string) {
  await ctx.db.transaction(async (tx) => {
    const ws = await requireReadyWorkstation(tx, tenantId, userId);
    await assertNoActiveTicket(tx, tenantId, userId);
    const locked = await tx.execute<{ id: string; status: TicketStatus; branch_id: string }>(sql`
      SELECT id, status, branch_id FROM tickets WHERE id = ${ticketId} AND tenant_id = ${tenantId} FOR UPDATE`);
    const row = locked.rows[0];
    if (!row) throw notFound('Turno');
    if (row.branch_id !== ws.branchId) throw badRequest('El turno pertenece a otra sucursal');
    if (row.status !== 'waiting') throw conflict('El turno ya no está en espera');
    await markCalled(tx, tenantId, ticketId, userId, ws.counterId);
  });
  return publishLoaded(ctx, tenantId, 'ticket.called', ticketId);
}

interface TransitionSpec {
  from: TicketStatus[];
  set: (t: Ticket) => Partial<typeof tickets.$inferInsert>;
  eventType: string;
  webhookEvent: WebhookEvent;
  data?: Record<string, unknown>;
}

async function transition(ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string, spec: TransitionSpec) {
  await ctx.db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!ticket) throw notFound('Turno');
    if (!spec.from.includes(ticket.status)) throw conflict(`No se puede realizar esta acción: el turno está "${ticket.status}"`);
    assertOwner(ticket, actor);
    await tx.update(tickets).set(spec.set(ticket)).where(eq(tickets.id, ticketId));
    await tx.insert(ticketEvents).values({
      tenantId,
      ticketId,
      type: spec.eventType,
      userId: actor.userId,
      counterId: ticket.counterId,
      data: spec.data ?? {},
    });
  });
  return publishLoaded(ctx, tenantId, spec.webhookEvent, ticketId);
}

function assertOwner(ticket: Ticket, actor: Actor) {
  if (hasRole(actor.role, 'manager')) return;
  if (ticket.agentId && ticket.agentId !== actor.userId) throw forbidden('El turno está siendo atendido por otro operador');
}

export async function recallTicket(ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string) {
  const settings = await loadTenantSettings(ctx.db, tenantId);
  const limit = settings.tickets.autoNoShowAfterCalls;
  const [current] = await ctx.db.select().from(tickets).where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)));
  if (current && limit > 0 && current.status === 'called' && current.callCount >= limit) {
    return noShowTicket(ctx, tenantId, actor, ticketId, { auto: true });
  }
  return transition(ctx, tenantId, actor, ticketId, {
    from: ['called'],
    set: (t) => ({ calledAt: new Date(), callCount: t.callCount + 1 }),
    eventType: 'recalled',
    webhookEvent: 'ticket.recalled',
  });
}

export const startTicket = (ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string) =>
  transition(ctx, tenantId, actor, ticketId, {
    from: ['called'],
    set: () => ({ status: 'in_service', startedAt: new Date() }),
    eventType: 'started',
    webhookEvent: 'ticket.started',
  });

export const finishTicket = (ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string, notes?: string) =>
  transition(ctx, tenantId, actor, ticketId, {
    from: ['called', 'in_service'],
    set: (t) => ({
      status: 'finished',
      startedAt: t.startedAt ?? new Date(),
      finishedAt: new Date(),
      ...(notes !== undefined ? { notes: notes.slice(0, 2000) } : {}),
    }),
    eventType: 'finished',
    webhookEvent: 'ticket.finished',
  });

export const noShowTicket = (ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string, data: Record<string, unknown> = {}) =>
  transition(ctx, tenantId, actor, ticketId, {
    from: ['called'],
    set: () => ({ status: 'no_show', finishedAt: new Date() }),
    eventType: 'no_show',
    webhookEvent: 'ticket.no_show',
    data,
  });

export const cancelTicket = (ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string, reason = '') =>
  transition(ctx, tenantId, actor, ticketId, {
    from: ['waiting', 'called'],
    set: () => ({ status: 'cancelled', finishedAt: new Date() }),
    eventType: 'cancelled',
    webhookEvent: 'ticket.cancelled',
    data: reason ? { reason: reason.slice(0, 300) } : {},
  });

/** Devuelve un turno llamado a la cola (p. ej. llamado por error). */
export const requeueTicket = (ctx: QueueCtx, tenantId: string, actor: Actor, ticketId: string) =>
  transition(ctx, tenantId, actor, ticketId, {
    from: ['called'],
    set: () => ({ status: 'waiting', counterId: null, agentId: null, calledAt: null }),
    eventType: 'requeued',
    webhookEvent: 'ticket.requeued',
  });

/**
 * Deriva el turno a otro servicio: el original queda como "transferred" y se crea un turno
 * nuevo con el mismo código que conserva el enlace de seguimiento del cliente.
 */
export async function transferTicket(
  ctx: QueueCtx,
  tenantId: string,
  actor: Actor,
  ticketId: string,
  input: { serviceId: string; priorityId?: string | null; notes?: string },
) {
  const { newId, fromId } = await ctx.db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!original) throw notFound('Turno');
    if (!['called', 'in_service'].includes(original.status)) throw conflict('Solo se pueden derivar turnos en atención');
    assertOwner(original, actor);

    const [bs] = await tx
      .select({ enabled: branchServices.enabled, active: services.active })
      .from(branchServices)
      .innerJoin(services, eq(services.id, branchServices.serviceId))
      .where(and(eq(branchServices.branchId, original.branchId), eq(branchServices.serviceId, input.serviceId)))
      .limit(1);
    if (!bs || !bs.enabled || !bs.active) throw badRequest('El servicio destino no está disponible en la sucursal');

    let priorityId = original.priorityId;
    if (input.priorityId) {
      const [p] = await tx
        .select({ id: priorities.id })
        .from(priorities)
        .where(and(eq(priorities.id, input.priorityId), eq(priorities.tenantId, tenantId)))
        .limit(1);
      if (!p) throw notFound('Prioridad');
      priorityId = p.id;
    }

    const now = new Date();
    await tx
      .update(tickets)
      .set({ status: 'transferred', startedAt: original.startedAt ?? now, finishedAt: now, publicToken: randomToken(20) })
      .where(eq(tickets.id, original.id));
    const [created] = await tx
      .insert(tickets)
      .values({
        tenantId,
        branchId: original.branchId,
        serviceId: input.serviceId,
        priorityId,
        number: original.number,
        code: original.code,
        channel: 'agent',
        customer: original.customer,
        notes: input.notes?.slice(0, 2000) ?? original.notes,
        publicToken: original.publicToken,
        transferredFromId: original.id,
        serviceDay: original.serviceDay,
        createdAt: now,
      })
      .returning({ id: tickets.id });
    await tx.insert(ticketEvents).values([
      {
        tenantId,
        ticketId: original.id,
        type: 'transferred',
        userId: actor.userId,
        counterId: original.counterId,
        data: { toServiceId: input.serviceId, newTicketId: created!.id },
      },
      { tenantId, ticketId: created!.id, type: 'created', userId: actor.userId, data: { transferredFrom: original.id } },
    ]);
    return { newId: created!.id, fromId: original.id };
  });
  return publishLoaded(ctx, tenantId, 'ticket.transferred', newId, { fromTicketId: fromId });
}

/** Cierra la jornada: cancela los turnos pendientes y reinicia la numeración de la sucursal. */
export async function resetBranchQueue(ctx: AppContext, tenantId: string, branchId: string, actor: Actor) {
  const cancelled = await ctx.db.transaction(async (tx) => {
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
      .limit(1);
    if (!branch) throw notFound('Sucursal');
    const rows = await tx
      .update(tickets)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(tickets.branchId, branchId), inArray(tickets.status, ['waiting', 'called', 'in_service'])))
      .returning({ id: tickets.id });
    if (rows.length > 0) {
      await tx.insert(ticketEvents).values(
        rows.map((r) => ({ tenantId, ticketId: r.id, type: 'cancelled', userId: actor.userId, data: { reason: 'reset' } })),
      );
    }
    await tx.delete(ticketSequences).where(eq(ticketSequences.branchId, branchId));
    return rows.length;
  });
  ctx.rt.emit([rooms.branch(branchId), rooms.kioskBranch(branchId), rooms.staff(branchId)], RT.queueChanged, { branchId, reset: true });
  void ctx.webhooks.dispatch(tenantId, 'queue.reset', { branchId, cancelled });
  return cancelled;
}
