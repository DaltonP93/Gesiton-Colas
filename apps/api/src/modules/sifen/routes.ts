import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SIFEN_ENVIRONMENTS, SIFEN_STATUSES, sifenIssueSchema, type SifenDocumentDTO, type SifenKudeDTO } from '@gc/shared';
import type { AppContext } from '../../context';
import { tenantIdOf, userIdOf } from '../../lib/auth';
import { tenantSettings } from '../../lib/dto';
import { badRequest, notFound } from '../../lib/errors';
import { PLATFORM_SCOPE } from '../../lib/sifen/service';
import { geography } from '../../lib/sifen/xml';

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface ScopeOptions {
  prefix: string;
  tags: string[];
  scopeOf(request: FastifyRequest): { scope: string; tenantId: string | null };
  /** Logo del KuDE. */
  logoOf(request: FastifyRequest): Promise<string | null>;
  admin: PreHandler;
  issue: PreHandler;
  manage: PreHandler;
}

const idParam = z.object({ id: z.uuid() });
const ruc = z.union([z.literal(''), z.string().trim().regex(/^\d{1,8}-\d$/, 'RUC inválido (ej.: 80012345-6)')]);

// Sin valores por defecto: lo que no se envía queda como está.
const issuerPatch = z
  .object({
    enabled: z.boolean(),
    environment: z.enum(SIFEN_ENVIRONMENTS),
    ruc,
    razonSocial: z.string().trim().max(255),
    nombreFantasia: z.string().trim().max(255),
    tipoContribuyente: z.union([z.literal(1), z.literal(2)]),
    tipoRegimen: z.number().int().min(1).max(99).nullable(),
    actividadCodigo: z.string().trim().max(8),
    actividadDescripcion: z.string().trim().max(300),
    timbrado: z.union([z.literal(''), z.string().regex(/^\d{8}$/, 'El timbrado tiene 8 dígitos')]),
    timbradoFecha: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
    establecimiento: z.string().regex(/^\d{3}$/),
    punto: z.string().regex(/^\d{3}$/),
    direccion: z.string().trim().max(255),
    numeroCasa: z.string().trim().max(6),
    departamento: z.number().int().min(1).max(99),
    distrito: z.number().int().min(1).max(9999),
    ciudad: z.number().int().min(1).max(99999),
    telefono: z.string().trim().max(15),
    email: z.union([z.literal(''), z.email().max(80)]),
    denominacion: z.string().trim().max(255),
    cscId: z.string().regex(/^\d{1,4}$/),
    defaultIva: z.union([z.literal(10), z.literal(5), z.literal(0)]),
    autoIssue: z.boolean(),
    nextNumber: z.number().int().min(1).max(9_999_999),
  })
  .partial();

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(SIFEN_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  sourceType: z.enum(['payment', 'invoice', 'manual']).optional(),
  sourceId: z.uuid().optional(),
});

let geoCache: Awaited<ReturnType<typeof geography>> | null = null;

/** Rutas de factura electrónica para un emisor (una organización o la plataforma). */
function scopedRoutes(ctx: AppContext, o: ScopeOptions): FastifyPluginAsyncZod {
  return async (app) => {
    const { prefix: p, tags } = o;

    app.get(`${p}/issuer`, { preHandler: o.admin, schema: { tags, summary: 'Datos del emisor, certificado y timbrado' } }, async (request) => ctx.sifen.issuerDTO(o.scopeOf(request).scope));

    app.put(`${p}/issuer`, { preHandler: o.admin, schema: { tags, summary: 'Guardar los datos del emisor', body: issuerPatch } }, async (request) => {
      const { scope, tenantId } = o.scopeOf(request);
      return ctx.sifen.saveIssuer(scope, tenantId, request.body);
    });

    app.post(
      `${p}/issuer/certificate`,
      {
        preHandler: o.admin,
        bodyLimit: 512 * 1024,
        config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
        schema: { tags, summary: 'Cargar el certificado digital (.p12 / .pfx en base64) y su contraseña', body: z.object({ p12: z.string().min(100).max(400_000), password: z.string().max(200) }) },
      },
      async (request) => {
        const { scope, tenantId } = o.scopeOf(request);
        let buffer: Buffer;
        try {
          buffer = Buffer.from(request.body.p12.replace(/^data:[^,]*,/, ''), 'base64');
        } catch {
          throw badRequest('Archivo inválido');
        }
        return ctx.sifen.setCertificate(scope, tenantId, buffer, request.body.password);
      },
    );

    app.delete(`${p}/issuer/certificate`, { preHandler: o.admin, schema: { tags, summary: 'Quitar el certificado digital' } }, async (request) => ctx.sifen.removeCertificate(o.scopeOf(request).scope));

    app.put(
      `${p}/issuer/csc`,
      { preHandler: o.admin, schema: { tags, summary: 'Guardar el código de seguridad (CSC) que dio la SET', body: z.object({ csc: z.string().trim().min(8).max(64).nullable() }) } },
      async (request) => {
        const { scope, tenantId } = o.scopeOf(request);
        return ctx.sifen.setCsc(scope, tenantId, request.body.csc);
      },
    );

    app.get(`${p}/geo`, { preHandler: o.admin, schema: { tags, summary: 'Departamentos, distritos y ciudades (tablas de SIFEN)' } }, async (_request, reply) => {
      geoCache ??= await geography();
      reply.header('cache-control', 'private, max-age=86400');
      return geoCache;
    });

    app.get(`${p}/documents`, { preHandler: o.issue, schema: { tags, summary: 'Facturas electrónicas emitidas', querystring: listQuery } }, async (request): Promise<SifenDocumentDTO[]> => {
      const { scope } = o.scopeOf(request);
      const q = request.query;
      const day = (d: string, add = 0) => new Date(new Date(`${d}T00:00:00-03:00`).getTime() + add * 86_400_000);
      return ctx.sifen.list(scope, { ...q, from: q.from ? day(q.from) : undefined, to: q.to ? day(q.to, 1) : undefined });
    });

    app.post(
      `${p}/documents`,
      { preHandler: o.issue, config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags, summary: 'Emitir una factura electrónica (se firma y se envía a la SET)', body: sifenIssueSchema } },
      async (request, reply) => {
        const { scope, tenantId } = o.scopeOf(request);
        const doc = await ctx.sifen.issue(scope, tenantId, request.body, userIdOf(request), await o.logoOf(request));
        return reply.code(201).send(ctx.sifen.toDTO(doc));
      },
    );

    app.get(`${p}/documents/:id`, { preHandler: o.issue, schema: { tags, summary: 'Detalle de una factura', params: idParam } }, async (request) =>
      ctx.sifen.toDTO(await ctx.sifen.get(o.scopeOf(request).scope, request.params.id)),
    );

    app.get(`${p}/documents/:id/xml`, { preHandler: o.issue, schema: { tags, summary: 'Descargar el XML firmado', params: idParam } }, async (request, reply) => {
      const doc = await ctx.sifen.get(o.scopeOf(request).scope, request.params.id);
      return reply.header('content-type', 'application/xml; charset=utf-8').header('content-disposition', `attachment; filename="${doc.cdc}.xml"`).send(doc.xml);
    });

    app.post(`${p}/documents/:id/retry`, { preHandler: o.issue, schema: { tags, summary: 'Reintentar el envío (o regenerar si la SET la rechazó)', params: idParam } }, async (request) =>
      ctx.sifen.toDTO(await ctx.sifen.retry(await ctx.sifen.get(o.scopeOf(request).scope, request.params.id))),
    );

    app.post(`${p}/documents/:id/refresh`, { preHandler: o.issue, schema: { tags, summary: 'Consultar el estado en la SET', params: idParam } }, async (request) => {
      const { document, result } = await ctx.sifen.refresh(await ctx.sifen.get(o.scopeOf(request).scope, request.params.id));
      return { document: ctx.sifen.toDTO(document), set: { code: result.code, message: result.message } };
    });

    app.post(
      `${p}/documents/:id/cancel`,
      { preHandler: o.manage, schema: { tags, summary: 'Anular ante la SET (evento de cancelación, hasta 48 h)', params: idParam, body: z.object({ reason: z.string().trim().min(5, 'Explique el motivo').max(500) }) } },
      async (request) => ctx.sifen.toDTO(await ctx.sifen.cancel(await ctx.sifen.get(o.scopeOf(request).scope, request.params.id), request.body.reason)),
    );

    app.post(
      `${p}/ruc`,
      { preHandler: o.issue, config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags, summary: 'Consultar un RUC en la SET (nombre y estado)', body: z.object({ ruc: z.string().trim().regex(/^\d{1,8}(-\d)?$/) }) } },
      async (request) => {
        const row = await ctx.sifen.issuerRow(o.scopeOf(request).scope);
        if (!row?.certEnc) throw badRequest('Cargue el certificado digital para consultar la SET');
        return ctx.sifen.lookupRuc(row, request.body.ruc);
      },
    );
  };
}

/** Factura electrónica de cada organización (módulo «invoicing») y de la plataforma (superadministrador). */
export const sifenRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  const module = 'invoicing' as const;
  await app.register(
    scopedRoutes(ctx, {
      prefix: '/invoicing',
      tags: ['Factura electrónica'],
      scopeOf: (request) => ({ scope: tenantIdOf(request), tenantId: tenantIdOf(request) }),
      logoOf: async (request) => (request.auth?.tenant ? tenantSettings(request.auth.tenant).branding.logoUrl : null),
      admin: ctx.auth.require({ role: 'admin', module }),
      issue: ctx.auth.require({ role: 'agent', module }),
      manage: ctx.auth.require({ role: 'manager', module }),
    }),
  );
  const superadmin = ctx.auth.require({ role: 'superadmin' });
  await app.register(
    scopedRoutes(ctx, {
      prefix: '/platform/invoicing',
      tags: ['Plataforma (superadmin)'],
      scopeOf: () => ({ scope: PLATFORM_SCOPE, tenantId: null }),
      logoOf: async () => (await ctx.platform.get()).brand.logoUrl,
      admin: superadmin,
      issue: superadmin,
      manage: superadmin,
    }),
  );

  // KuDE: el cliente lo abre con el enlace (o el QR del correo) sin iniciar sesión.
  app.get(
    '/public/invoices/:token',
    { schema: { tags: ['Público (factura electrónica)'], summary: 'Representación gráfica (KuDE) de una factura', params: z.object({ token: z.string().min(10).max(64) }), security: [] } },
    async (request): Promise<SifenKudeDTO> => {
      const doc = await ctx.sifen.findByToken(request.params.token);
      if (!doc || doc.status === 'error' || doc.status === 'rejected') throw notFound('Factura');
      return ctx.sifen.kude(doc);
    },
  );
};
