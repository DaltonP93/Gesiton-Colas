import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LEGAL_KINDS, legalHolderPatchSchema, type LegalAdminDTO, type LegalDocumentDTO, type LegalStatusDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { badRequest, forbidden } from '../../lib/errors';

const kindParam = z.object({ kind: z.enum(LEGAL_KINDS) });

export const legalRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const tags = ['Legal'];
  const superadmin = ctx.auth.require({ role: 'superadmin' });

  /* ------------------------------ Público ------------------------------ */

  app.get(
    '/public/legal/:kind',
    {
      schema: {
        tags,
        summary: 'Texto publicado de los términos, la política de privacidad o el acuerdo de tratamiento de datos',
        security: [],
        params: kindParam,
        querystring: z.object({ version: z.coerce.number().int().min(1).optional() }),
      },
    },
    async (request): Promise<LegalDocumentDTO> => ctx.legal.document(request.params.kind, request.query.version),
  );

  /* --------------------------- Organización --------------------------- */

  app.get(
    '/legal/status',
    { preHandler: ctx.auth.require({ role: 'admin', allowBillingSuspended: true }), schema: { tags, summary: 'Documentos vigentes y lo que aceptó la organización' } },
    async (request): Promise<LegalStatusDTO> => {
      if (!request.auth?.tenantId) throw badRequest('Disponible dentro de una organización');
      return ctx.legal.statusFor(request.auth.tenantId);
    },
  );

  app.post(
    '/legal/accept',
    {
      preHandler: ctx.auth.require({ role: 'admin', allowBillingSuspended: true }),
      schema: {
        tags,
        summary: 'Aceptar la versión vigente de los términos en nombre de la organización',
        description: 'Queda registrado quién aceptó, cuándo y desde qué IP. Hay que indicar la versión que se leyó.',
        body: z.object({ documents: z.array(z.object({ kind: z.enum(LEGAL_KINDS), version: z.number().int().min(1) })).min(1).max(LEGAL_KINDS.length) }),
      },
    },
    async (request) => {
      const auth = request.auth;
      if (auth?.kind !== 'user' || !auth.tenant) throw badRequest('Disponible para los administradores de la organización');
      // El soporte de la plataforma no puede aceptar un contrato en nombre del cliente.
      if (auth.user.role === 'superadmin') throw forbidden('El soporte no puede aceptar los términos en nombre de la organización');
      const accepted = await ctx.legal.accept({
        tenant: { id: auth.tenant.id, name: auth.tenant.name },
        user: { id: auth.user.id, name: auth.user.name, email: auth.user.email },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        documents: request.body.documents,
      });
      return { accepted, pending: await ctx.legal.pendingFor(auth.tenant.id) };
    },
  );

  /* ----------------------------- Plataforma ----------------------------- */

  app.get('/platform/legal', { preHandler: superadmin, schema: { tags, summary: 'Datos del titular, documentos publicados y aceptaciones' } }, async (): Promise<LegalAdminDTO> => ctx.legal.admin());

  app.put(
    '/platform/legal/settings',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Datos del titular y aceptación obligatoria de los términos',
        body: z.object({ holder: legalHolderPatchSchema.optional(), requireAcceptance: z.boolean().optional() }),
      },
    },
    async (request): Promise<LegalAdminDTO> => {
      await ctx.platform.update({ legal: request.body });
      return ctx.legal.admin();
    },
  );

  app.post(
    '/platform/legal/:kind/publish',
    {
      preHandler: superadmin,
      schema: {
        tags,
        summary: 'Publicar una versión nueva de un documento',
        description: 'Se guarda el texto con los datos actuales del titular. Con `requiresAcceptance`, las organizaciones deben aceptarla de nuevo.',
        params: kindParam,
        body: z.object({ source: z.string().max(100_000), requiresAcceptance: z.boolean().default(true), note: z.string().trim().max(500).nullish() }),
      },
    },
    async (request) => {
      const auth = request.auth;
      if (auth?.kind !== 'user') throw badRequest('Disponible solo para usuarios');
      return ctx.legal.publish({ kind: request.params.kind, ...request.body, user: { id: auth.user.id, name: auth.user.name } });
    },
  );

  app.get(
    '/platform/legal/:kind/versions',
    { preHandler: superadmin, schema: { tags, summary: 'Versiones publicadas de un documento', params: kindParam } },
    async (request) => ctx.legal.history(request.params.kind),
  );

  app.get('/platform/legal/tenants', { preHandler: superadmin, schema: { tags, summary: 'Qué aceptó cada organización' } }, async () => ctx.legal.tenants());

};
