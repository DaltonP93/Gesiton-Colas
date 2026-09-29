import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config';
import { createContext, type AppContext } from './context';
import { createDatabase, type Database } from './db/client';
import { runMigrations } from './db/migrate';
import { ensureSuperadmin } from './db/seed';
import { AppError } from './lib/errors';
import { agentRoutes } from './modules/agent/routes';
import { authRoutes } from './modules/auth/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { deviceRoutes } from './modules/devices/routes';
import { integrationRoutes } from './modules/integrations/routes';
import { mediaRoutes } from './modules/media/routes';
import { platformRoutes } from './modules/platform/routes';
import { publicRoutes } from './modules/public/routes';
import { reportRoutes } from './modules/reports/routes';
import { tenantRoutes } from './modules/tenant/routes';
import { ticketRoutes } from './modules/tickets/routes';
import { userRoutes } from './modules/users/routes';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export interface BuildOptions {
  config: AppConfig;
  /** Base de datos existente (tests). Si no se indica, se crea un pool nuevo. */
  db?: Database;
  logger?: boolean;
}

export async function buildApp({ config, db: externalDb, logger = true }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? {
          level: config.LOG_LEVEL,
          transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } : undefined,
        }
      : false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const pool = externalDb ? null : createDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  const db = externalDb ?? pool!.db;
  if (config.AUTO_MIGRATE && !externalDb) await runMigrations(db);

  const ctx = createContext(config, db, app.log);
  app.decorate('ctx', ctx);

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ error: 'validation_error', message: 'Datos inválidos', details: error.validation });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'Error no controlado');
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 ? 'Error interno del servidor' : (error as Error).message,
    });
  });

  await app.register(helmet, {
    // Las pantallas embeben contenido de muchas plataformas (YouTube, Vimeo, Canva...).
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: false,
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS === '*' ? true : config.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    exposedHeaders: ['content-disposition'],
  });
  await app.register(rateLimit, {
    max: 1200,
    timeWindow: '1 minute',
    allowList: () => config.NODE_ENV === 'test',
  });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Gestión de Colas API',
        description:
          'API REST para integrar Gestión de Colas con cualquier sistema. Autenticación con `Authorization: Bearer <jwt>` (usuarios) o `X-API-Key: gc_...` (integraciones).',
        version: '3.0.0',
      },
      servers: [{ url: config.PUBLIC_URL }],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
      security: [{ bearer: [] }, { apiKey: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  if (ctx.storage.localDir) {
    await mkdir(ctx.storage.localDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: ctx.storage.localDir,
      prefix: '/uploads/',
      decorateReply: false,
      maxAge: '7d',
      setHeaders(reply) {
        // Evita que un archivo subido (p. ej. SVG) ejecute scripts si se abre directamente.
        reply.header('content-security-policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
        reply.header('x-content-type-options', 'nosniff');
      },
    });
  }

  app.get('/api/health', { schema: { hide: true } }, async () => ({ status: 'ok', time: new Date().toISOString() }));

  await app.register(
    async (api) => {
      await api.register(authRoutes(ctx));
      await api.register(tenantRoutes(ctx));
      await api.register(catalogRoutes(ctx));
      await api.register(userRoutes(ctx));
      await api.register(ticketRoutes(ctx));
      await api.register(agentRoutes(ctx));
      await api.register(deviceRoutes(ctx));
      await api.register(mediaRoutes(ctx));
      await api.register(integrationRoutes(ctx));
      await api.register(reportRoutes(ctx));
      await api.register(platformRoutes(ctx));
      await api.register(publicRoutes(ctx));
    },
    { prefix: '/api/v1' },
  );

  // Frontend compilado (SPA) servido desde la misma instancia en producción.
  const webDist = config.WEB_DIST ? path.resolve(config.WEB_DIST) : null;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/') || request.raw.url?.startsWith('/uploads/')) {
        return reply.code(404).send({ error: 'not_found', message: 'Ruta no encontrada' });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html', webDist);
    });
  }

  ctx.rt.attach(app.server);
  if (config.NODE_ENV !== 'test') ctx.webhooks.start();
  await ensureSuperadmin(ctx);

  app.addHook('onClose', async () => {
    ctx.webhooks.stop();
    ctx.rt.close();
    await pool?.pool.end();
  });

  return app;
}
