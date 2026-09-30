import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BranchDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { branches, branchServices, counters, departments, priorities, services, tickets, type Branch } from '../../db/schema';
import { tenantIdOf } from '../../lib/auth';
import { toCounterDTO, toDepartmentDTO, toPriorityDTO, toServiceDTO } from '../../lib/dto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { assertWithinLimit } from '../../lib/plans';
import { hexColor, idParam, optionalText, updateSchema } from '../../lib/schemas';
import { isValidTimezone } from '../../lib/tz';

const branchServiceInput = z.object({
  serviceId: z.uuid(),
  enabled: z.boolean().default(true),
  prefix: z.string().trim().max(5).nullable().default(null),
});

const branchBody = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(20),
  address: optionalText(300).default(''),
  timezone: z.string().max(64).nullable().default(null),
  active: z.boolean().default(true),
  services: z.array(branchServiceInput).optional(),
});

const departmentBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(500).default(''),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const serviceBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(500).default(''),
  departmentId: z.uuid().nullable().default(null),
  prefix: z.string().trim().max(5).default(''),
  color: hexColor.default('#2563eb'),
  /** Clave de la biblioteca de íconos o imagen propia (/uploads/... o URL). */
  icon: z.string().max(2048).default('ticket'),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  estimatedMinutes: z.number().int().min(1).max(600).default(5),
  /** Precio en la unidad mínima de la moneda (guaraníes, centavos). null = sin cobro. */
  price: z.number().int().min(0).max(1_000_000_000_000).nullable().default(null),
});

const priorityBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(300).default(''),
  weight: z.number().int().min(0).max(100).default(0),
  color: hexColor.default('#64748b'),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const counterBody = z.object({
  branchId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

async function toBranchDTO(db: DbOrTx, branch: Branch): Promise<BranchDTO> {
  const rows = await db.select().from(branchServices).where(eq(branchServices.branchId, branch.id));
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    timezone: branch.timezone,
    active: branch.active,
    services: rows.map((r) => ({ serviceId: r.serviceId, enabled: r.enabled, prefix: r.prefix })),
    createdAt: branch.createdAt.toISOString(),
  };
}

async function syncBranchServices(db: DbOrTx, tenantId: string, branchId: string, list: z.infer<typeof branchServiceInput>[]) {
  if (list.length === 0) return;
  const ids = list.map((s) => s.serviceId);
  const valid = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), inArray(services.id, ids)));
  const validIds = new Set(valid.map((v) => v.id));
  for (const item of list) {
    if (!validIds.has(item.serviceId)) throw badRequest('Servicio inválido en la sucursal');
    await db
      .insert(branchServices)
      .values({ tenantId, branchId, serviceId: item.serviceId, enabled: item.enabled, prefix: item.prefix || null })
      .onConflictDoUpdate({
        target: [branchServices.branchId, branchServices.serviceId],
        set: { enabled: item.enabled, prefix: item.prefix || null },
      });
  }
}

async function hasTickets(db: DbOrTx, column: typeof tickets.branchId | typeof tickets.serviceId | typeof tickets.priorityId, id: string) {
  const [row] = await db.select({ n: count() }).from(tickets).where(eq(column, id));
  return (row?.n ?? 0) > 0;
}

export const catalogRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const read = ctx.auth.require({ scope: 'catalog:read' });
  const write = ctx.auth.require({ role: 'admin', scope: 'catalog:write' });

  /* ---------------------------- Sucursales ---------------------------- */
  const btags = ['Sucursales'];

  app.get('/branches', { preHandler: read, schema: { tags: btags, summary: 'Listar sucursales' } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(branches)
      .where(eq(branches.tenantId, tenantIdOf(request)))
      .orderBy(asc(branches.code));
    return Promise.all(rows.map((b) => toBranchDTO(ctx.db, b)));
  });

  app.get('/branches/:id', { preHandler: read, schema: { tags: btags, params: idParam } }, async (request) => {
    const [branch] = await ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.id, request.params.id), eq(branches.tenantId, tenantIdOf(request))));
    if (!branch) throw notFound('Sucursal');
    return toBranchDTO(ctx.db, branch);
  });

  app.post('/branches', { preHandler: write, schema: { tags: btags, summary: 'Crear sucursal', body: branchBody } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    const { services: list, ...data } = request.body;
    if (data.timezone && !isValidTimezone(data.timezone)) throw badRequest('Zona horaria inválida');
    await assertWithinLimit(ctx.db, tenantId, 'branches');
    const dto = await ctx.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.code, data.code)));
      if (dup) throw conflict('Ya existe una sucursal con ese código');
      const [branch] = await tx.insert(branches).values({ ...data, tenantId }).returning();
      // Por defecto habilita todos los servicios activos.
      const all = await tx.select({ id: services.id }).from(services).where(eq(services.tenantId, tenantId));
      await syncBranchServices(tx, tenantId, branch!.id, list ?? all.map((s) => ({ serviceId: s.id, enabled: true, prefix: null })));
      return toBranchDTO(tx, branch!);
    });
    return reply.code(201).send(dto);
  });

  app.put('/branches/:id', { preHandler: write, schema: { tags: btags, params: idParam, body: updateSchema(branchBody) } }, async (request) => {
    const tenantId = tenantIdOf(request);
    const { services: list, ...data } = request.body;
    if (data.timezone && !isValidTimezone(data.timezone)) throw badRequest('Zona horaria inválida');
    return ctx.db.transaction(async (tx) => {
      const [branch] = await tx
        .update(branches)
        .set(data)
        .where(and(eq(branches.id, request.params.id), eq(branches.tenantId, tenantId)))
        .returning();
      if (!branch) throw notFound('Sucursal');
      if (list) await syncBranchServices(tx, tenantId, branch.id, list);
      ctx.refreshDevices(tenantId);
      return toBranchDTO(tx, branch);
    });
  });

  app.delete('/branches/:id', { preHandler: write, schema: { tags: btags, params: idParam } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (await hasTickets(ctx.db, tickets.branchId, request.params.id)) {
      throw conflict('La sucursal tiene historial de turnos. Desactívela en lugar de eliminarla.');
    }
    const deleted = await ctx.db
      .delete(branches)
      .where(and(eq(branches.id, request.params.id), eq(branches.tenantId, tenantId)))
      .returning({ id: branches.id });
    if (deleted.length === 0) throw notFound('Sucursal');
    return reply.code(204).send();
  });

  /* --------------------------- Departamentos -------------------------- */
  const dtags = ['Departamentos'];

  app.get('/departments', { preHandler: read, schema: { tags: dtags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(departments)
      .where(eq(departments.tenantId, tenantIdOf(request)))
      .orderBy(asc(departments.sortOrder), asc(departments.name));
    return rows.map(toDepartmentDTO);
  });

  app.post('/departments', { preHandler: write, schema: { tags: dtags, body: departmentBody } }, async (request, reply) => {
    const [row] = await ctx.db
      .insert(departments)
      .values({ ...request.body, tenantId: tenantIdOf(request) })
      .returning();
    return reply.code(201).send(toDepartmentDTO(row!));
  });

  app.put('/departments/:id', { preHandler: write, schema: { tags: dtags, params: idParam, body: updateSchema(departmentBody) } }, async (request) => {
    const [row] = await ctx.db
      .update(departments)
      .set(request.body)
      .where(and(eq(departments.id, request.params.id), eq(departments.tenantId, tenantIdOf(request))))
      .returning();
    if (!row) throw notFound('Departamento');
    ctx.refreshDevices(row.tenantId);
    return toDepartmentDTO(row);
  });

  app.delete('/departments/:id', { preHandler: write, schema: { tags: dtags, params: idParam } }, async (request, reply) => {
    const deleted = await ctx.db
      .delete(departments)
      .where(and(eq(departments.id, request.params.id), eq(departments.tenantId, tenantIdOf(request))))
      .returning({ id: departments.id });
    if (deleted.length === 0) throw notFound('Departamento');
    return reply.code(204).send();
  });

  /* ----------------------------- Servicios ---------------------------- */
  const stags = ['Servicios'];

  async function assertDepartment(tenantId: string, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const [d] = await ctx.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
    if (!d) throw notFound('Departamento');
  }

  app.get('/services', { preHandler: read, schema: { tags: stags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(services)
      .where(eq(services.tenantId, tenantIdOf(request)))
      .orderBy(asc(services.sortOrder), asc(services.name));
    return rows.map(toServiceDTO);
  });

  app.post(
    '/services',
    { preHandler: write, schema: { tags: stags, summary: 'Crear servicio (se habilita en todas las sucursales)', body: serviceBody } },
    async (request, reply) => {
      const tenantId = tenantIdOf(request);
      await assertDepartment(tenantId, request.body.departmentId);
      const row = await ctx.db.transaction(async (tx) => {
        const [service] = await tx
          .insert(services)
          .values({ ...request.body, prefix: request.body.prefix.toUpperCase(), tenantId })
          .returning();
        const allBranches = await tx.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId));
        if (allBranches.length > 0) {
          await tx
            .insert(branchServices)
            .values(allBranches.map((b) => ({ tenantId, branchId: b.id, serviceId: service!.id, enabled: true })));
        }
        return service!;
      });
      ctx.refreshDevices(tenantId);
      return reply.code(201).send(toServiceDTO(row));
    },
  );

  app.put('/services/:id', { preHandler: write, schema: { tags: stags, params: idParam, body: updateSchema(serviceBody) } }, async (request) => {
    const tenantId = tenantIdOf(request);
    await assertDepartment(tenantId, request.body.departmentId);
    const patch = { ...request.body, ...(request.body.prefix !== undefined ? { prefix: request.body.prefix.toUpperCase() } : {}) };
    const [row] = await ctx.db
      .update(services)
      .set(patch)
      .where(and(eq(services.id, request.params.id), eq(services.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound('Servicio');
    ctx.refreshDevices(tenantId);
    return toServiceDTO(row);
  });

  app.delete('/services/:id', { preHandler: write, schema: { tags: stags, params: idParam } }, async (request, reply) => {
    if (await hasTickets(ctx.db, tickets.serviceId, request.params.id)) {
      throw conflict('El servicio tiene historial de turnos. Desactívelo en lugar de eliminarlo.');
    }
    const deleted = await ctx.db
      .delete(services)
      .where(and(eq(services.id, request.params.id), eq(services.tenantId, tenantIdOf(request))))
      .returning({ id: services.id });
    if (deleted.length === 0) throw notFound('Servicio');
    return reply.code(204).send();
  });

  /* ---------------------------- Prioridades --------------------------- */
  const ptags = ['Prioridades'];

  app.get('/priorities', { preHandler: read, schema: { tags: ptags } }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(priorities)
      .where(eq(priorities.tenantId, tenantIdOf(request)))
      .orderBy(asc(priorities.sortOrder), asc(priorities.weight));
    return rows.map(toPriorityDTO);
  });

  app.post('/priorities', { preHandler: write, schema: { tags: ptags, body: priorityBody } }, async (request, reply) => {
    const [row] = await ctx.db
      .insert(priorities)
      .values({ ...request.body, tenantId: tenantIdOf(request) })
      .returning();
    return reply.code(201).send(toPriorityDTO(row!));
  });

  app.put('/priorities/:id', { preHandler: write, schema: { tags: ptags, params: idParam, body: updateSchema(priorityBody) } }, async (request) => {
    const [row] = await ctx.db
      .update(priorities)
      .set(request.body)
      .where(and(eq(priorities.id, request.params.id), eq(priorities.tenantId, tenantIdOf(request))))
      .returning();
    if (!row) throw notFound('Prioridad');
    ctx.refreshDevices(row.tenantId);
    return toPriorityDTO(row);
  });

  app.delete('/priorities/:id', { preHandler: write, schema: { tags: ptags, params: idParam } }, async (request, reply) => {
    if (await hasTickets(ctx.db, tickets.priorityId, request.params.id)) {
      throw conflict('La prioridad tiene historial de turnos. Desactívela en lugar de eliminarla.');
    }
    const deleted = await ctx.db
      .delete(priorities)
      .where(and(eq(priorities.id, request.params.id), eq(priorities.tenantId, tenantIdOf(request))))
      .returning({ id: priorities.id });
    if (deleted.length === 0) throw notFound('Prioridad');
    return reply.code(204).send();
  });

  /* ------------------------ Puestos de atención ----------------------- */
  const ctags = ['Puestos de atención'];

  async function assertBranch(tenantId: string, branchId: string) {
    const [b] = await ctx.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
    if (!b) throw notFound('Sucursal');
  }

  app.get(
    '/counters',
    { preHandler: read, schema: { tags: ctags, querystring: z.object({ branchId: z.uuid().optional() }) } },
    async (request) => {
      const rows = await ctx.db
        .select()
        .from(counters)
        .where(
          and(
            eq(counters.tenantId, tenantIdOf(request)),
            request.query.branchId ? eq(counters.branchId, request.query.branchId) : undefined,
          ),
        )
        .orderBy(asc(counters.sortOrder), asc(counters.name));
      return rows.map(toCounterDTO);
    },
  );

  app.post('/counters', { preHandler: write, schema: { tags: ctags, body: counterBody } }, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    await assertBranch(tenantId, request.body.branchId);
    const [row] = await ctx.db
      .insert(counters)
      .values({ ...request.body, tenantId })
      .returning();
    return reply.code(201).send(toCounterDTO(row!));
  });

  app.put(
    '/counters/:id',
    { preHandler: write, schema: { tags: ctags, params: idParam, body: updateSchema(counterBody.omit({ branchId: true })) } },
    async (request) => {
      const [row] = await ctx.db
        .update(counters)
        .set(request.body)
        .where(and(eq(counters.id, request.params.id), eq(counters.tenantId, tenantIdOf(request))))
        .returning();
      if (!row) throw notFound('Puesto de atención');
      return toCounterDTO(row);
    },
  );

  app.delete('/counters/:id', { preHandler: write, schema: { tags: ctags, params: idParam } }, async (request, reply) => {
    const deleted = await ctx.db
      .delete(counters)
      .where(and(eq(counters.id, request.params.id), eq(counters.tenantId, tenantIdOf(request))))
      .returning({ id: counters.id });
    if (deleted.length === 0) throw notFound('Puesto de atención');
    return reply.code(204).send();
  });
};
