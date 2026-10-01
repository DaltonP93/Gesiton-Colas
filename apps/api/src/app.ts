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
import Fastify, { LogController, type FastifyInstance } from 'fastify';
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
import { startMaintenance } from './lib/maintenance';
import { agentRoutes } from './modules/agent/routes';
import { authRoutes } from './modules/auth/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { deviceRoutes } from './modules/devices/routes';
import { integrationRoutes } from './modules/integrations/routes';
import { mediaRoutes } from './modules/media/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { numberingRoutes } from './modules/numbering/routes';
import { privacyRoutes } from './modules/privacy/routes';
import { surveyRoutes } from './modules/surveys/routes';
import { billingRoutes } from './modules/billing/routes';
import { paymentRoutes } from './modules/payments/routes';
import { auditRoutes } from './modules/audit/routes';
import { alertRoutes } from './modules/alerts/routes';
import { bookingRoutes } from './modules/appointments/public';
import { appointmentRoutes } from './modules/appointments/routes';
import { sifenRoutes } from './modules/sifen/routes';
import { backupRoutes } from './modules/backups/routes';
import { pairingRoutes } from './modules/pairing/routes';
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

/**
 * Política de contenido del panel, las pantallas y los kioscos. Solo se ejecuta código propio
 * (más la API de YouTube); imágenes, videos y páginas embebidas pueden venir de cualquier origen
 * porque la publicidad usa muchas plataformas. Limita el daño de cualquier inyección de HTML.
 */
const WEB_CSP = [
  "default-src 'self'",
  // YouTube (reproductor) y Bancard (checkout de pagos en un iframe).
  "script-src 'self' https://www.youtube.com https://s.ytimg.com https://vpos.infonet.com.py https://vpos.infonet.com.py:8888",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'frame-src *',
  "connect-src 'self' http: https: ws: wss: blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
    // Solo se confía en X-Forwarded-For si se configuró el proxy (si no, cualquiera falsificaría su IP).
    // Fastify acepta también un número (saltos de proxy) aunque sus tipos no lo declaren.
    trustProxy: config.TRUST_PROXY as boolean | string[],
    // En producción no se registra cada petición (menos ruido); los errores sí se registran.
    logController: new LogController({ disableRequestLogging: config.NODE_ENV === 'production' }),
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
      // Registro de auditoría de todos los cambios (lo hereda cada módulo).
      api.addHook('onSend', ctx.audit.hook());
      await api.register(authRoutes(ctx));
      await api.register(tenantRoutes(ctx));
      await api.register(catalogRoutes(ctx));
      await api.register(userRoutes(ctx));
      await api.register(ticketRoutes(ctx));
      await api.register(numberingRoutes(ctx));
      await api.register(privacyRoutes(ctx));
      await api.register(notificationRoutes(ctx));
      await api.register(surveyRoutes(ctx));
      await api.register(billingRoutes(ctx));
      await api.register(paymentRoutes(ctx));
      await api.register(auditRoutes(ctx));
      await api.register(alertRoutes(ctx));
      await api.register(appointmentRoutes(ctx));
      await api.register(bookingRoutes(ctx));
      await api.register(sifenRoutes(ctx));
      await api.register(agentRoutes(ctx));
      await api.register(deviceRoutes(ctx));
      await api.register(mediaRoutes(ctx));
      await api.register(integrationRoutes(ctx));
      await api.register(reportRoutes(ctx));
      await api.register(platformRoutes(ctx));
      await api.register(backupRoutes(ctx));
      await api.register(publicRoutes(ctx));
      await api.register(pairingRoutes(ctx));
    },
    { prefix: '/api/v1' },
  );

  // Frontend compilado (SPA) servido desde la misma instancia en producción.
  const webDist = config.WEB_DIST ? path.resolve(config.WEB_DIST) : null;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.header('content-security-policy', WEB_CSP);
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const path = (request.raw.url ?? '').split('?')[0]!;
      // Las rutas de la API, archivos subidos y recursos con extensión inexistentes devuelven 404.
      if (path.startsWith('/api/') || path.startsWith('/uploads/') || /\.[a-z0-9]{1,8}$/i.test(path)) {
        return reply.code(404).send({ error: 'not_found', message: 'Ruta no encontrada' });
      }
      return reply.header('cache-control', 'no-cache').header('content-security-policy', WEB_CSP).sendFile('index.html', webDist);
    });
  }

  // Solo para pruebas automatizadas: permite leer los correos enviados sin SMTP.
  if (config.DEV_OUTBOX && ctx.mailer.envDriver === 'log') {
    app.log.warn('DEV_OUTBOX activo: /api/v1/dev/outbox expone los correos sin autenticación. No lo use en una instalación real.');
    app.get('/api/v1/dev/outbox', { schema: { hide: true } }, async () => ctx.mailer.outbox());
  }
  if (config.NODE_ENV === 'production' && ctx.mailer.envDriver === 'log' && (await ctx.mailer.resolve(null)).source === 'none') {
    app.log.warn('Correo sin configurar: configúrelo en Plataforma → Ajustes → Correo. Hasta entonces los correos solo se muestran en el log.');
  }

  ctx.rt.attach(app.server);
  const stopMaintenance = config.NODE_ENV !== 'test' ? startMaintenance(ctx) : () => undefined;
  if (config.NODE_ENV !== 'test') {
    ctx.webhooks.start();
    ctx.notifier.start();
    ctx.devices.start();
    ctx.backups.start();
    ctx.appointments.start();
  }
  await ensureSuperadmin(ctx);

  app.addHook('onClose', async () => {
    stopMaintenance();
    ctx.webhooks.stop();
    ctx.notifier.stop();
    ctx.devices.stop();
    ctx.backups.stop();
    ctx.appointments.stop();
    ctx.rt.close();
    await pool?.pool.end();
  });

  return app;
}
