import { and, count, desc, eq, gte, ilike, isNull, lte, or, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AUDIT_ENTITIES, type AuditEntity, type AuditLogDTO, type AuditPageDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { auditLogs, tenants, type AuditLog } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { dateOnly } from '../../lib/schemas';
import { csvCell } from '../../lib/csv';

const query = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  entity: z.enum(Object.keys(AUDIT_ENTITIES) as [AuditEntity, ...AuditEntity[]]).optional(),
  actorId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
type Query = z.infer<typeof query>;

const toDTO = (row: AuditLog, tenantName: string | null = null): AuditLogDTO => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  tenantId: row.tenantId,
  tenantName,
  actor: { kind: row.actorKind, id: row.actorId, name: row.actorName, email: row.actorEmail, role: row.actorRole },
  support: row.support,
  action: row.action,
  entity: row.entity,
  entityId: row.entityId,
  summary: row.summary,
  changes: row.changes,
  ip: row.ip,
});

export const auditRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Auditoría'];
  const admin = ctx.auth.require({ role: 'admin' });
  const superadmin = ctx.auth.require({ role: 'superadmin' });

  function filters(q: Query): SQL[] {
    const f: SQL[] = [];
    // Días calendario en UTC.
    if (q.from) f.push(gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00Z`)));
    if (q.to) f.push(lte(auditLogs.createdAt, new Date(`${q.to}T23:59:59.999Z`)));
    if (q.entity) f.push(eq(auditLogs.entity, q.entity));
    if (q.actorId) f.push(eq(auditLogs.actorId, q.actorId));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      f.push(or(ilike(auditLogs.summary, like), ilike(auditLogs.actorName, like), ilike(auditLogs.actorEmail, like))!);
    }
    return f;
  }

  async function page(where: SQL | undefined, q: Query): Promise<AuditPageDTO> {
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select({ log: auditLogs, tenantName: tenants.name })
        .from(auditLogs)
        .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      ctx.db.select({ n: count() }).from(auditLogs).where(where),
    ]);
    return { items: rows.map((r) => toDTO(r.log, r.tenantName)), total: total?.n ?? 0 };
  }

  async function csv(where: SQL | undefined) {
    const rows = await ctx.db
      .select({ log: auditLogs, tenantName: tenants.name })
      .from(auditLogs)
      .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(50_000);
    const header = ['Fecha (UTC)', 'Organización', 'Quién', 'Email', 'Rol', 'Soporte', 'Tipo', 'Acción', 'Detalle', 'IP', 'Datos'];
    const lines = rows.map(({ log, tenantName }) =>
      [
        log.createdAt.toISOString(),
        tenantName ?? 'Plataforma',
        log.actorName,
        log.actorEmail,
        log.actorRole,
        log.support ? 'Sí' : '',
        AUDIT_ENTITIES[log.entity] ?? log.entity,
        log.action,
        log.summary,
        log.ip,
        log.changes,
      ]
        .map(csvCell)
        .join(','),
    );
    return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}`;
  }

  /* ---------------------------- Organización --------------------------- */

  app.get('/audit', { preHandler: admin, schema: { tags, summary: 'Registro de actividad de la organización', querystring: query } }, async (request) =>
    page(and(eq(auditLogs.tenantId, tenantIdOf(request)), ...filters(request.query)), request.query),
  );

  app.get('/audit.csv', { preHandler: admin, schema: { tags, summary: 'Exportar el registro de actividad (CSV)', querystring: query } }, async (request, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="actividad.csv"');
    return csv(and(eq(auditLogs.tenantId, tenantIdOf(request)), ...filters(request.query)));
  });

  /* ----------------------------- Plataforma ---------------------------- */

  const platformQuery = query.extend({ tenantId: z.union([z.uuid(), z.literal('platform')]).optional() });

  const platformWhere = (q: z.infer<typeof platformQuery>) =>
    and(...(q.tenantId === 'platform' ? [isNull(auditLogs.tenantId)] : q.tenantId ? [eq(auditLogs.tenantId, q.tenantId)] : []), ...filters(q));

  app.get('/platform/audit', { preHandler: superadmin, schema: { tags, summary: 'Registro de actividad de toda la plataforma', querystring: platformQuery } }, async (request) =>
    page(platformWhere(request.query), request.query),
  );

  app.get('/platform/audit.csv', { preHandler: superadmin, schema: { tags, summary: 'Exportar el registro de la plataforma (CSV)', querystring: platformQuery } }, async (request, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="actividad-plataforma.csv"');
    return csv(platformWhere(request.query));
  });

};
