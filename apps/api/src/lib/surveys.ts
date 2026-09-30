import { and, desc, eq } from 'drizzle-orm';
import type { SurveyDTO, TicketDTO } from '@gc/shared';
import type { DbOrTx } from '../db/client';
import { surveyResponses, surveys, type Survey, type Tenant } from '../db/schema';

export function toSurveyDTO(row: Survey, stats: { responses: number; lastResponseAt: Date | null } = { responses: 0, lastResponseAt: null }): SurveyDTO {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    intro: row.intro,
    thanks: row.thanks,
    active: row.active,
    serviceIds: row.serviceIds,
    branchIds: row.branchIds,
    questions: row.questions,
    expiresDays: row.expiresDays,
    allowAnonymous: row.allowAnonymous,
    publicToken: row.publicToken,
    responses: stats.responses,
    lastResponseAt: stats.lastResponseAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type TicketScope = Pick<TicketDTO, 'serviceId' | 'branchId'>;

/**
 * Encuesta que corresponde a un turno: la activa más específica
 * (servicio y sucursal > solo servicio > solo sucursal > todas) y, a igualdad, la más reciente.
 */
export async function surveyForTicket(db: DbOrTx, tenantId: string, ticket: TicketScope): Promise<Survey | null> {
  const rows = await db
    .select()
    .from(surveys)
    .where(and(eq(surveys.tenantId, tenantId), eq(surveys.active, true)))
    .orderBy(desc(surveys.updatedAt));
  let best: Survey | null = null;
  let bestScore = -1;
  for (const s of rows) {
    const serviceOk = !s.serviceIds.length || s.serviceIds.includes(ticket.serviceId);
    const branchOk = !s.branchIds.length || s.branchIds.includes(ticket.branchId);
    if (!serviceOk || !branchOk) continue;
    const score = (s.serviceIds.length ? 2 : 0) + (s.branchIds.length ? 1 : 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

export async function ticketAnswered(db: DbOrTx, ticketId: string) {
  const [row] = await db.select({ id: surveyResponses.id }).from(surveyResponses).where(eq(surveyResponses.ticketId, ticketId)).limit(1);
  return Boolean(row);
}

/** Enlace de la encuesta de un turno, o null si no hay una que corresponda. */
export async function surveyLinkFor(db: DbOrTx, base: string, tenant: Tenant, ticket: TicketScope & { publicToken: string }) {
  const survey = await surveyForTicket(db, tenant.id, ticket);
  return survey ? `${base.replace(/\/$/, '')}/encuesta/${ticket.publicToken}` : null;
}
