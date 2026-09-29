import {
  displayConfigSchema,
  kioskConfigSchema,
  normalizeConfig,
  tenantSettingsSchema,
  type ApiKeyDTO,
  type CallDTO,
  type CounterDTO,
  type DepartmentDTO,
  type DisplayDTO,
  type KioskDTO,
  type MediaDTO,
  type PlaylistDTO,
  type PlaylistItemDTO,
  type PriorityDTO,
  type PublicTenantDTO,
  type ServiceDTO,
  type TenantDTO,
  type TicketDTO,
  type UserDTO,
  type WebhookDTO,
  type WebhookDeliveryDTO,
} from '@gc/shared';
import type {
  ApiKey,
  Counter,
  Department,
  Display,
  Kiosk,
  Media,
  Playlist,
  PlaylistItem,
  Priority,
  Service,
  Tenant,
  Ticket,
  User,
  Webhook,
  WebhookDelivery,
} from '../db/schema';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function tenantSettings(tenant: Tenant) {
  return normalizeConfig(tenantSettingsSchema, tenant.settings);
}

export function toTenantDTO(t: Tenant): TenantDTO {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    plan: t.plan,
    status: t.status,
    settings: tenantSettings(t),
    isDemo: t.isDemo,
    demoExpiresAt: iso(t.demoExpiresAt),
    createdAt: t.createdAt.toISOString(),
  };
}

export function toPublicTenantDTO(t: Tenant): PublicTenantDTO {
  const settings = tenantSettings(t);
  return {
    name: t.name,
    slug: t.slug,
    branding: settings.branding,
    terminology: settings.terminology,
    locale: settings.locale,
    timezone: settings.timezone,
  };
}

export function toUserDTO(u: User, branchIds: string[] = [], serviceIds: string[] = []): UserDTO {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    locale: (u.locale as UserDTO['locale']) ?? null,
    branchIds,
    serviceIds,
    emailVerified: Boolean(u.emailVerifiedAt),
    invitePending: u.invitePending,
    hasPassword: u.hasPassword,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export const toDepartmentDTO = (d: Department): DepartmentDTO => ({
  id: d.id,
  name: d.name,
  description: d.description,
  active: d.active,
  sortOrder: d.sortOrder,
});

export const toServiceDTO = (s: Service): ServiceDTO => ({
  id: s.id,
  departmentId: s.departmentId,
  name: s.name,
  description: s.description,
  prefix: s.prefix,
  color: s.color,
  icon: s.icon,
  active: s.active,
  sortOrder: s.sortOrder,
  estimatedMinutes: s.estimatedMinutes,
});

export const toPriorityDTO = (p: Priority): PriorityDTO => ({
  id: p.id,
  name: p.name,
  description: p.description,
  weight: p.weight,
  color: p.color,
  active: p.active,
  sortOrder: p.sortOrder,
});

export const toCounterDTO = (c: Counter): CounterDTO => ({
  id: c.id,
  branchId: c.branchId,
  name: c.name,
  active: c.active,
  sortOrder: c.sortOrder,
});

export interface TicketRelations {
  service?: Pick<Service, 'id' | 'name' | 'color'> | null;
  priority?: Pick<Priority, 'id' | 'name' | 'weight' | 'color'> | null;
  counter?: Pick<Counter, 'id' | 'name'> | null;
  agent?: Pick<User, 'id' | 'name'> | null;
}

export function toTicketDTO(t: Ticket, rel: TicketRelations = {}): TicketDTO {
  return {
    id: t.id,
    branchId: t.branchId,
    serviceId: t.serviceId,
    priorityId: t.priorityId,
    number: t.number,
    code: t.code,
    status: t.status,
    channel: t.channel,
    customer: t.customer ?? {},
    notes: t.notes,
    counterId: t.counterId,
    agentId: t.agentId,
    callCount: t.callCount,
    publicToken: t.publicToken,
    transferredFromId: t.transferredFromId,
    createdAt: t.createdAt.toISOString(),
    calledAt: iso(t.calledAt),
    startedAt: iso(t.startedAt),
    finishedAt: iso(t.finishedAt),
    service: rel.service ? { id: rel.service.id, name: rel.service.name, color: rel.service.color } : null,
    priority: rel.priority
      ? { id: rel.priority.id, name: rel.priority.name, weight: rel.priority.weight, color: rel.priority.color }
      : null,
    counter: rel.counter ? { id: rel.counter.id, name: rel.counter.name } : null,
    agent: rel.agent ? { id: rel.agent.id, name: rel.agent.name } : null,
  };
}

export function toCallDTO(t: TicketDTO): CallDTO {
  return {
    ticketId: t.id,
    code: t.code,
    serviceId: t.serviceId,
    service: t.service?.name ?? '',
    serviceColor: t.service?.color ?? '#2563eb',
    counter: t.counter?.name ?? '',
    priority: t.priority?.name ?? '',
    priorityWeight: t.priority?.weight ?? 0,
    priorityColor: t.priority?.color ?? '#64748b',
    customerName: t.customer?.name ?? null,
    calledAt: t.calledAt ?? new Date().toISOString(),
    callCount: t.callCount,
  };
}

export function toMediaDTO(m: Media): MediaDTO {
  return {
    id: m.id,
    name: m.name,
    kind: m.kind,
    provider: m.provider,
    url: m.url,
    embedUrl: m.embedUrl,
    externalId: m.externalId,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    duration: m.duration,
    thumbnailUrl: m.thumbnailUrl,
    text: m.text ?? null,
    tags: m.tags ?? [],
    createdAt: m.createdAt.toISOString(),
  };
}

export function toPlaylistItemDTO(i: PlaylistItem, m?: Media): PlaylistItemDTO {
  return {
    id: i.id,
    mediaId: i.mediaId,
    position: i.position,
    duration: i.duration,
    muted: i.muted,
    volume: i.volume,
    schedule: i.schedule ?? null,
    active: i.active,
    media: m ? toMediaDTO(m) : undefined,
  };
}

export function toPlaylistDTO(p: Playlist, items: PlaylistItemDTO[]): PlaylistDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    items,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export const toDisplayDTO = (d: Display): DisplayDTO => ({
  id: d.id,
  branchId: d.branchId,
  name: d.name,
  token: d.token,
  config: normalizeConfig(displayConfigSchema, d.config),
  playlistId: d.playlistId,
  lastSeenAt: iso(d.lastSeenAt),
  createdAt: d.createdAt.toISOString(),
});

export const toKioskDTO = (k: Kiosk): KioskDTO => ({
  id: k.id,
  branchId: k.branchId,
  name: k.name,
  token: k.token,
  config: normalizeConfig(kioskConfigSchema, k.config),
  lastSeenAt: iso(k.lastSeenAt),
  createdAt: k.createdAt.toISOString(),
});

export const toApiKeyDTO = (k: ApiKey): ApiKeyDTO => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  lastUsedAt: iso(k.lastUsedAt),
  createdAt: k.createdAt.toISOString(),
  revokedAt: iso(k.revokedAt),
});

export const toWebhookDTO = (w: Webhook): WebhookDTO => ({
  id: w.id,
  name: w.name,
  url: w.url,
  events: w.events,
  active: w.active,
  createdAt: w.createdAt.toISOString(),
});

export const toWebhookDeliveryDTO = (d: WebhookDelivery): WebhookDeliveryDTO => ({
  id: d.id,
  webhookId: d.webhookId,
  event: d.event,
  status: d.status,
  attempts: d.attempts,
  responseStatus: d.responseStatus,
  error: d.error,
  createdAt: d.createdAt.toISOString(),
  deliveredAt: iso(d.deliveredAt),
});
