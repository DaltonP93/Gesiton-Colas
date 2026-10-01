import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ApiKeyScope,
  AuditActorKind,
  AuditEntity,
  CustomerData,
  DisplayConfig,
  KioskConfig,
  MediaKind,
  MediaProvider,
  MailSecurity,
  ModuleOverrides,
  NotifyMessageStatus,
  NotifyProvider,
  PlanId,
  PlatformSettings,
  Role,
  Schedule,
  Currency,
  InvoiceLine,
  InvoiceStatus,
  PaymentGateway,
  PaymentProvider,
  PaymentStatus,
  SurveyAnswers,
  SurveyQuestion,
  TenantSettings,
  TicketChannel,
  TicketStatus,
  WebhookEvent,
} from '@gc/shared';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  plan: text('plan').$type<PlanId>().notNull().default('free'),
  status: text('status').$type<'active' | 'suspended'>().notNull().default('active'),
  /** Por qué se suspendió: `billing` (falta de pago, se reactiva sola al pagar) o `manual`. */
  suspendedReason: text('suspended_reason').$type<'billing' | 'manual'>(),
  settings: jsonb('settings').$type<TenantSettings>().notNull(),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  /** Organización de demostración (se crea desde "Probar demo" y vence). */
  isDemo: boolean('is_demo').notNull().default(false),
  demoExpiresAt: timestamp('demo_expires_at', { withTimezone: true }),
  /** Módulos que el superadministrador activó o desactivó para la organización (sin clave = según el plan). */
  modules: jsonb('modules').$type<ModuleOverrides>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: text('role').$type<Role>().notNull().default('agent'),
    active: boolean('active').notNull().default(true),
    locale: text('locale'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Invitado por correo que todavía no definió su contraseña. */
    invitePending: boolean('invite_pending').notNull().default(false),
    /** Falso para cuentas creadas por invitación o demo que aún no eligieron contraseña. */
    hasPassword: boolean('has_password').notNull().default(true),
    /** Los tokens de sesión emitidos antes de esta fecha dejan de valer (cambio de contraseña). */
    sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email), index('users_tenant_idx').on(t.tenantId)],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    address: text('address').notNull().default(''),
    timezone: text('timezone'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('branches_tenant_code_idx').on(t.tenantId, t.code)],
);

export const departments = pgTable(
  'departments',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('departments_tenant_idx').on(t.tenantId)],
);

export const services = pgTable(
  'services',
  {
    id: id(),
    tenantId: tenantId(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    prefix: text('prefix').notNull().default(''),
    color: text('color').notNull().default('#2563eb'),
    icon: text('icon').notNull().default('ticket'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    estimatedMinutes: integer('estimated_minutes').notNull().default(5),
    /** Precio en la unidad mínima de la moneda de la organización (módulo «Pagos»). */
    price: bigint('price', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('services_tenant_idx').on(t.tenantId)],
);

export const branchServices = pgTable(
  'branch_services',
  {
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    prefix: text('prefix'),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.serviceId] })],
);

export const priorities = pgTable(
  'priorities',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    weight: integer('weight').notNull().default(0),
    color: text('color').notNull().default('#64748b'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('priorities_tenant_idx').on(t.tenantId)],
);

export const counters = pgTable(
  'counters',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('counters_branch_idx').on(t.branchId)],
);

export const userBranches = pgTable(
  'user_branches',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

export const userServices = pgTable(
  'user_services',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serviceId] })],
);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    priorityId: uuid('priority_id')
      .notNull()
      .references(() => priorities.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    code: text('code').notNull(),
    status: text('status').$type<TicketStatus>().notNull().default('waiting'),
    channel: text('channel').$type<TicketChannel>().notNull().default('web'),
    customer: jsonb('customer').$type<CustomerData>().notNull().default({}),
    notes: text('notes').notNull().default(''),
    counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => users.id, { onDelete: 'set null' }),
    callCount: integer('call_count').notNull().default(0),
    publicToken: text('public_token').notNull(),
    transferredFromId: uuid('transferred_from_id'),
    serviceDay: date('service_day').notNull(),
    createdAt: createdAt(),
    calledAt: timestamp('called_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tickets_public_token_idx').on(t.publicToken),
    index('tickets_queue_idx').on(t.branchId, t.status, t.createdAt),
    index('tickets_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('tickets_agent_idx').on(t.agentId, t.status),
  ],
);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: id(),
    tenantId: tenantId(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_events_ticket_idx').on(t.ticketId), index('ticket_events_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const ticketSequences = pgTable(
  'ticket_sequences',
  {
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    /** Id del servicio o `*` si la numeración es compartida por la sucursal. */
    scopeKey: text('scope_key').notNull(),
    /** Día (YYYY-MM-DD) o `all` si no se reinicia. */
    period: text('period').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.scopeKey, t.period] })],
);

export const agentWorkstations = pgTable('agent_workstations', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'set null' }),
  serviceIds: jsonb('service_ids').$type<string[]>().notNull().default([]),
  paused: boolean('paused').notNull().default(false),
  updatedAt: updatedAt(),
});

export const media = pgTable(
  'media',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    kind: text('kind').$type<MediaKind>().notNull(),
    provider: text('provider').$type<MediaProvider>().notNull(),
    url: text('url').notNull(),
    embedUrl: text('embed_url'),
    externalId: text('external_id'),
    storageKey: text('storage_key'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    duration: integer('duration'),
    thumbnailUrl: text('thumbnail_url'),
    text: jsonb('text').$type<{ content: string; subtitle?: string; background: string; color: string }>(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index('media_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const playlists = pgTable(
  'playlists',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('playlists_tenant_idx').on(t.tenantId)],
);

export const playlistItems = pgTable(
  'playlist_items',
  {
    id: id(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    duration: integer('duration'),
    muted: boolean('muted').notNull().default(false),
    volume: real('volume'),
    schedule: jsonb('schedule').$type<Schedule | null>(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('playlist_items_playlist_idx').on(t.playlistId, t.position)],
);

export const displays = pgTable(
  'displays',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull(),
    config: jsonb('config').$type<DisplayConfig>().notNull(),
    playlistId: uuid('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Se avisó que está desconectada (se limpia al volver). */
    offlineAlertedAt: timestamp('offline_alerted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('displays_token_idx').on(t.token), index('displays_tenant_idx').on(t.tenantId)],
);

export const kiosks = pgTable(
  'kiosks',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull(),
    config: jsonb('config').$type<KioskConfig>().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Se avisó que está desconectado (se limpia al volver). */
    offlineAlertedAt: timestamp('offline_alerted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('kiosks_token_idx').on(t.token), index('kiosks_tenant_idx').on(t.tenantId)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').$type<ApiKeyScope[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.keyHash), index('api_keys_tenant_idx').on(t.tenantId)],
);

export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<WebhookEvent[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('webhooks_tenant_idx').on(t.tenantId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    tenantId: tenantId(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<'pending' | 'success' | 'failed'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    error: text('error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt),
  ],
);

export type AuthTokenPurpose = 'verify_email' | 'reset_password' | 'email_login' | 'invite';

/** Enlaces y códigos de un solo uso enviados por correo (se guardan con hash). */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<AuthTokenPurpose>().notNull(),
    tokenHash: text('token_hash').notNull(),
    /** Código numérico alternativo al enlace (acceso por código). */
    codeHash: text('code_hash'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_hash_idx').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId, t.purpose)],
);

/** Vinculación de TVs / tablets con un código de 6 dígitos (sin escribir URLs largas). */
export const devicePairings = pgTable(
  'device_pairings',
  {
    id: id(),
    code: text('code').notNull(),
    secretHash: text('secret_hash').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<'display' | 'kiosk'>(),
    targetId: uuid('target_id'),
    userAgent: text('user_agent').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('device_pairings_code_idx').on(t.code, t.expiresAt)],
);

/** Ajustes globales de la plataforma que define el superadministrador (una fila por clave). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<PlatformSettings>().notNull(),
  updatedAt: updatedAt(),
});

/**
 * Servidor de correo saliente (SMTP). `scope` es `platform` (para toda la instalación)
 * o el id de una organización que envía con su propio servidor.
 */
export const mailSettings = pgTable('mail_settings', {
  scope: text('scope').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  host: text('host').notNull().default(''),
  port: integer('port').notNull().default(587),
  security: text('security').$type<MailSecurity>().notNull().default('starttls'),
  username: text('username').notNull().default(''),
  /** Contraseña cifrada con AES-256-GCM (clave derivada de JWT_SECRET). */
  passwordEnc: text('password_enc').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  replyTo: text('reply_to').notNull().default(''),
  updatedAt: updatedAt(),
});

/**
 * Proveedor de avisos (WhatsApp / SMS). `scope` es `platform` (para todas las organizaciones)
 * o el id de una organización con su propio proveedor. El token o clave va cifrado.
 */
export const notifyProviders = pgTable('notify_providers', {
  scope: text('scope').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  provider: text('provider').$type<NotifyProvider>().notNull().default('waha'),
  /** Datos no secretos (URL, sesión, número, cuerpo...). */
  config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
  secretEnc: text('secret_enc').notNull().default(''),
  updatedAt: updatedAt(),
});

/** Mensajes enviados (o por enviar) al cliente, con reintentos. */
export const notifyMessages = pgTable(
  'notify_messages',
  {
    id: id(),
    tenantId: tenantId(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    to: text('to').notNull(),
    body: text('body').notNull(),
    /** Parámetros de la plantilla de Meta. */
    params: jsonb('params').$type<string[]>().notNull().default([]),
    provider: text('provider').$type<NotifyProvider>(),
    status: text('status').$type<NotifyMessageStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    providerRef: text('provider_ref'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notify_messages_due_idx').on(t.status, t.nextAttemptAt),
    index('notify_messages_tenant_idx').on(t.tenantId, t.createdAt),
    // Cada aviso se envía una sola vez por turno.
    uniqueIndex('notify_messages_ticket_event_idx').on(t.ticketId, t.event),
  ],
);

export const surveys = pgTable(
  'surveys',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    title: text('title').notNull().default(''),
    intro: text('intro').notNull().default(''),
    thanks: text('thanks').notNull().default(''),
    active: boolean('active').notNull().default(true),
    /** Servicios y sucursales donde se usa (vacío = todos). */
    serviceIds: jsonb('service_ids').$type<string[]>().notNull().default([]),
    branchIds: jsonb('branch_ids').$type<string[]>().notNull().default([]),
    questions: jsonb('questions').$type<SurveyQuestion[]>().notNull().default([]),
    expiresDays: integer('expires_days').notNull().default(7),
    allowAnonymous: boolean('allow_anonymous').notNull().default(true),
    /** Enlace general (QR) para responder sin turno. */
    publicToken: text('public_token').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('surveys_public_token_idx').on(t.publicToken), index('surveys_tenant_idx').on(t.tenantId)],
);

export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: id(),
    tenantId: tenantId(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => users.id, { onDelete: 'set null' }),
    counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'set null' }),
    /** `ticket` (enlace del turno) o `link` (enlace general / QR). */
    channel: text('channel').$type<'ticket' | 'link'>().notNull().default('ticket'),
    answers: jsonb('answers').$type<SurveyAnswers>().notNull().default({}),
    nps: integer('nps'),
    rating: integer('rating'),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    // Una respuesta por turno.
    uniqueIndex('survey_responses_ticket_idx').on(t.ticketId),
    index('survey_responses_tenant_idx').on(t.tenantId, t.createdAt),
    index('survey_responses_survey_idx').on(t.surveyId, t.createdAt),
  ],
);

/** Facturas de la plataforma a las organizaciones (planes). */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantId(),
    /** Número correlativo de la plataforma (F-000001). */
    seq: serial('seq').notNull(),
    /** Mes facturado (YYYY-MM) en las facturas del plan. */
    period: text('period'),
    description: text('description').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    /** Detalle: plan y módulos adicionales. */
    lines: jsonb('lines').$type<InvoiceLine[]>().notNull().default([]),
    status: text('status').$type<InvoiceStatus>().notNull().default('pending'),
    dueDate: date('due_date').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    method: text('method'),
    reference: text('reference'),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_seq_idx').on(t.seq),
    // Una factura del plan por mes y organización.
    uniqueIndex('invoices_period_idx').on(t.tenantId, t.period),
    index('invoices_status_idx').on(t.status, t.dueDate),
  ],
);

/** Pagos: de facturas (a la plataforma) y de turnos (a la organización). */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    /** Número correlativo (lo usan Bancard y PagoPar como id del pedido). */
    seq: serial('seq').notNull(),
    tenantId: tenantId(),
    kind: text('kind').$type<'invoice' | 'ticket'>().notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    description: text('description').notNull().default(''),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').$type<Currency>().notNull(),
    status: text('status').$type<PaymentStatus>().notNull().default('pending'),
    provider: text('provider').$type<PaymentProvider>().notNull(),
    /** Forma de pago (efectivo, tarjeta…) o la que informa la pasarela. */
    method: text('method'),
    reference: text('reference'),
    /** Identificador en la pasarela (sesión de Stripe, hash de PagoPar, proceso de Bancard). */
    providerRef: text('provider_ref'),
    checkoutUrl: text('checkout_url'),
    /** Token de la página pública del pago. */
    publicToken: text('public_token').notNull(),
    returnUrl: text('return_url'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_seq_idx').on(t.seq),
    uniqueIndex('payments_public_token_idx').on(t.publicToken),
    index('payments_tenant_idx').on(t.tenantId, t.createdAt),
    index('payments_ticket_idx').on(t.ticketId),
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_provider_ref_idx').on(t.provider, t.providerRef),
  ],
);

/** Pasarela de pagos de la plataforma (`platform`) o de cada organización (su id). */
export const paymentGateways = pgTable(
  'payment_gateways',
  {
    scope: text('scope').primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<PaymentGateway>().notNull(),
    enabled: boolean('enabled').notNull().default(false),
    sandbox: boolean('sandbox').notNull().default(true),
    config: jsonb('config').$type<{ publicKey?: string; apiUrl?: string }>().notNull().default({}),
    secretEnc: text('secret_enc').notNull().default(''),
    webhookSecretEnc: text('webhook_secret_enc').notNull().default(''),
    /** Parte secreta de la URL de confirmaciones. */
    webhookToken: text('webhook_token').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('payment_gateways_webhook_idx').on(t.webhookToken)],
);

/** Registro de auditoría: quién cambió qué (organización o plataforma). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    /** null = acción de la plataforma (superadministrador). */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorKind: text('actor_kind').$type<AuditActorKind>().notNull(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name').notNull(),
    actorEmail: text('actor_email'),
    actorRole: text('actor_role'),
    support: boolean('support').notNull().default(false),
    action: text('action').notNull(),
    entity: text('entity').$type<AuditEntity>().notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt), index('audit_logs_entity_idx').on(t.entity, t.entityId), index('audit_logs_created_idx').on(t.createdAt)],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Priority = typeof priorities.$inferSelect;
export type Counter = typeof counters.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Display = typeof displays.$inferSelect;
export type Kiosk = typeof kiosks.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistItem = typeof playlistItems.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type MailSettingsRow = typeof mailSettings.$inferSelect;
export type NotifyProviderRow = typeof notifyProviders.$inferSelect;
export type NotifyMessageRow = typeof notifyMessages.$inferSelect;
export type Survey = typeof surveys.$inferSelect;
export type SurveyResponse = typeof surveyResponses.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentGatewayRow = typeof paymentGateways.$inferSelect;
