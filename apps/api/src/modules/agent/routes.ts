import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { tenantIdOf } from '../../lib/auth';
import { badRequest } from '../../lib/errors';
import { idParam } from '../../lib/schemas';
import {
  callNext,
  callTicket,
  finishTicket,
  getWorkstation,
  noShowTicket,
  recallTicket,
  requeueTicket,
  setWorkstation,
  startTicket,
  transferTicket,
} from '../tickets/queue';

function actorOf(request: FastifyRequest) {
  if (request.auth?.kind !== 'user') throw badRequest('Disponible solo para usuarios');
  return { userId: request.auth.userId, role: request.auth.role, tenantId: tenantIdOf(request) };
}

export const agentRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Atención (operador)'];
  const agent = ctx.auth.require({ role: 'agent' });

  app.get('/agent/workstation', { preHandler: agent, schema: { tags, summary: 'Puesto de trabajo y turno actual' } }, async (request) => {
    const a = actorOf(request);
    return getWorkstation(ctx.db, a.tenantId, a.userId);
  });

  app.put(
    '/agent/workstation',
    {
      preHandler: agent,
      schema: {
        tags,
        summary: 'Configurar sucursal, puesto y servicios que atiende',
        body: z.object({
          branchId: z.uuid().nullable(),
          counterId: z.uuid().nullable(),
          serviceIds: z.array(z.uuid()).max(200),
          paused: z.boolean().default(false),
        }),
      },
    },
    async (request) => {
      const a = actorOf(request);
      return setWorkstation(ctx.db, a.tenantId, a, request.body);
    },
  );

  app.post('/agent/call-next', { preHandler: agent, schema: { tags, summary: 'Llamar al siguiente turno' } }, async (request) => {
    const a = actorOf(request);
    const ticket = await callNext(ctx, a.tenantId, a.userId);
    return { ticket };
  });

  app.post('/agent/tickets/:id/call', { preHandler: agent, schema: { tags, params: idParam, summary: 'Llamar un turno específico' } }, async (request) => {
    const a = actorOf(request);
    return { ticket: await callTicket(ctx, a.tenantId, a.userId, request.params.id) };
  });

  app.post('/agent/tickets/:id/recall', { preHandler: agent, schema: { tags, params: idParam, summary: 'Volver a llamar' } }, async (request) => {
    const a = actorOf(request);
    return { ticket: await recallTicket(ctx, a.tenantId, a, request.params.id) };
  });

  app.post('/agent/tickets/:id/start', { preHandler: agent, schema: { tags, params: idParam, summary: 'Iniciar atención' } }, async (request) => {
    const a = actorOf(request);
    return { ticket: await startTicket(ctx, a.tenantId, a, request.params.id) };
  });

  app.post(
    '/agent/tickets/:id/finish',
    {
      preHandler: agent,
      schema: { tags, params: idParam, summary: 'Finalizar atención', body: z.object({ notes: z.string().max(2000).optional() }).nullish() },
    },
    async (request) => {
      const a = actorOf(request);
      return { ticket: await finishTicket(ctx, a.tenantId, a, request.params.id, request.body?.notes) };
    },
  );

  app.post('/agent/tickets/:id/no-show', { preHandler: agent, schema: { tags, params: idParam, summary: 'Marcar como no se presentó' } }, async (request) => {
    const a = actorOf(request);
    return { ticket: await noShowTicket(ctx, a.tenantId, a, request.params.id) };
  });

  app.post('/agent/tickets/:id/requeue', { preHandler: agent, schema: { tags, params: idParam, summary: 'Devolver a la cola' } }, async (request) => {
    const a = actorOf(request);
    return { ticket: await requeueTicket(ctx, a.tenantId, a, request.params.id) };
  });

  app.post(
    '/agent/tickets/:id/transfer',
    {
      preHandler: agent,
      schema: {
        tags,
        params: idParam,
        summary: 'Derivar a otro servicio',
        body: z.object({ serviceId: z.uuid(), priorityId: z.uuid().nullish(), notes: z.string().max(2000).optional() }),
      },
    },
    async (request) => {
      const a = actorOf(request);
      return { ticket: await transferTicket(ctx, a.tenantId, a, request.params.id, request.body) };
    },
  );
};
