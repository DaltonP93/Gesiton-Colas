import type { DisplayConfig, KioskConfig, TenantSettings, Branding, Terminology, CustomerField } from './config';
import type {
  ApiKeyScope,
  Locale,
  MediaKind,
  MediaProvider,
  Role,
  TicketChannel,
  TicketStatus,
  WebhookEvent,
} from './enums';
import type { PlanId, PlanLimits } from './plans';
import type { Schedule } from './schedule';

/** Fechas serializadas en ISO-8601. */
type ISODate = string;

export interface TenantDTO {
  id: string;
  slug: string;
  name: string;
  plan: PlanId;
  status: 'active' | 'suspended';
  settings: TenantSettings;
  /** Organización de demostración creada desde "Probar demo". */
  isDemo: boolean;
  demoExpiresAt: ISODate | null;
  createdAt: ISODate;
}

export interface UserDTO {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  locale: Locale | null;
  branchIds: string[];
  serviceIds: string[];
  emailVerified: boolean;
  /** Invitado por correo que todavía no aceptó. */
  invitePending: boolean;
  /** Falso si la cuenta todavía no tiene contraseña (ingresa por enlace/código). */
  hasPassword: boolean;
  lastLoginAt: ISODate | null;
  createdAt: ISODate;
}

export interface MeDTO {
  user: UserDTO;
  tenant: TenantDTO | null;
  limits: PlanLimits | null;
}

export interface BranchDTO {
  id: string;
  name: string;
  code: string;
  address: string;
  timezone: string | null;
  active: boolean;
  /** Servicios habilitados en la sucursal. */
  services: { serviceId: string; enabled: boolean; prefix: string | null }[];
  createdAt: ISODate;
}

export interface DepartmentDTO {
  id: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
}

export interface ServiceDTO {
  id: string;
  departmentId: string | null;
  name: string;
  description: string;
  prefix: string;
  color: string;
  icon: string;
  active: boolean;
  sortOrder: number;
  /** Minutos estimados por atención (para calcular la espera). */
  estimatedMinutes: number;
}

export interface PriorityDTO {
  id: string;
  name: string;
  description: string;
  /** 0 = normal. Mayor peso = se atiende antes. */
  weight: number;
  color: string;
  active: boolean;
  sortOrder: number;
}

export interface CounterDTO {
  id: string;
  branchId: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface CustomerData {
  name?: string | null;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  [key: string]: string | null | undefined;
}

export interface TicketDTO {
  id: string;
  branchId: string;
  serviceId: string;
  priorityId: string;
  number: number;
  code: string;
  status: TicketStatus;
  channel: TicketChannel;
  customer: CustomerData;
  notes: string;
  counterId: string | null;
  agentId: string | null;
  callCount: number;
  publicToken: string;
  transferredFromId: string | null;
  createdAt: ISODate;
  calledAt: ISODate | null;
  startedAt: ISODate | null;
  finishedAt: ISODate | null;
  service?: { id: string; name: string; color: string } | null;
  priority?: { id: string; name: string; weight: number; color: string } | null;
  counter?: { id: string; name: string } | null;
  agent?: { id: string; name: string } | null;
}

export interface TicketEventDTO {
  id: string;
  ticketId: string;
  type: string;
  userId: string | null;
  counterId: string | null;
  data: Record<string, unknown>;
  createdAt: ISODate;
}

/** Llamado que se muestra en pantallas. */
export interface CallDTO {
  ticketId: string;
  code: string;
  serviceId: string;
  service: string;
  serviceColor: string;
  counter: string;
  priority: string;
  priorityWeight: number;
  priorityColor: string;
  customerName: string | null;
  calledAt: ISODate;
  callCount: number;
}

export interface QueueSnapshotDTO {
  waiting: TicketDTO[];
  active: TicketDTO[];
  counts: { waiting: number; called: number; inService: number; finishedToday: number; noShowToday: number };
}

export interface AgentWorkstationDTO {
  branchId: string | null;
  counterId: string | null;
  serviceIds: string[];
  paused: boolean;
  current: TicketDTO | null;
}

export interface MediaDTO {
  id: string;
  name: string;
  kind: MediaKind;
  provider: MediaProvider;
  /** URL pública del archivo o recurso externo. */
  url: string;
  embedUrl: string | null;
  externalId: string | null;
  mimeType: string | null;
  sizeBytes: number;
  /** Duración por defecto en segundos (null = hasta que termine el video). */
  duration: number | null;
  thumbnailUrl: string | null;
  /** Para anuncios de texto. */
  text: { content: string; subtitle?: string; background: string; color: string } | null;
  tags: string[];
  createdAt: ISODate;
}

export interface PlaylistItemDTO {
  id: string;
  mediaId: string;
  position: number;
  duration: number | null;
  muted: boolean;
  volume: number | null;
  schedule: Schedule | null;
  active: boolean;
  media?: MediaDTO;
}

export interface PlaylistDTO {
  id: string;
  name: string;
  description: string;
  items: PlaylistItemDTO[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface DisplayDTO {
  id: string;
  branchId: string;
  name: string;
  token: string;
  config: DisplayConfig;
  playlistId: string | null;
  lastSeenAt: ISODate | null;
  createdAt: ISODate;
}

export interface KioskDTO {
  id: string;
  branchId: string;
  name: string;
  token: string;
  config: KioskConfig;
  lastSeenAt: ISODate | null;
  createdAt: ISODate;
}

export interface PublicTenantDTO {
  name: string;
  slug: string;
  branding: Branding;
  terminology: Terminology;
  locale: Locale;
  timezone: string;
}

export interface DisplayBootstrapDTO {
  display: DisplayDTO;
  tenant: PublicTenantDTO;
  branch: { id: string; name: string };
  playlist: PlaylistDTO | null;
  /** Audios de la música ambiental configurada. */
  music: MediaDTO[];
  recentCalls: CallDTO[];
}

export interface KioskBootstrapDTO {
  kiosk: KioskDTO;
  tenant: PublicTenantDTO;
  branch: { id: string; name: string };
  departments: DepartmentDTO[];
  services: (ServiceDTO & { effectivePrefix: string; waiting: number })[];
  priorities: PriorityDTO[];
  customerFields: CustomerField[];
}

export interface IssuedTicketDTO {
  ticket: TicketDTO;
  waitingAhead: number;
  trackingUrl: string;
}

export interface PublicTicketDTO {
  code: string;
  status: TicketStatus;
  service: string;
  priority: string;
  branch: string;
  counter: string | null;
  waitingAhead: number;
  estimatedMinutes: number | null;
  createdAt: ISODate;
  calledAt: ISODate | null;
  finishedAt: ISODate | null;
  tenant: PublicTenantDTO;
}

export interface PairingDTO {
  id: string;
  code: string;
  /** Secreto que solo conoce el dispositivo, para consultar el resultado. */
  secret: string;
  expiresAt: ISODate;
}

export interface PairingStatusDTO {
  status: 'pending' | 'claimed' | 'expired';
  target?: { type: 'display' | 'kiosk'; token: string; name: string };
}

export interface ApiKeyDTO {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: ISODate | null;
  createdAt: ISODate;
  revokedAt: ISODate | null;
}

export interface WebhookDTO {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: ISODate;
}

export interface WebhookDeliveryDTO {
  id: string;
  webhookId: string;
  event: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: ISODate;
  deliveredAt: ISODate | null;
}

export interface StatsSummaryDTO {
  from: ISODate;
  to: ISODate;
  totals: {
    issued: number;
    finished: number;
    noShow: number;
    cancelled: number;
    waiting: number;
    inService: number;
    avgWaitSeconds: number | null;
    avgServiceSeconds: number | null;
  };
  byService: { serviceId: string; name: string; color: string; issued: number; finished: number; avgWaitSeconds: number | null; avgServiceSeconds: number | null }[];
  byAgent: { agentId: string; name: string; finished: number; avgServiceSeconds: number | null }[];
  byHour: { hour: number; issued: number; finished: number }[];
  byDay: { day: string; issued: number; finished: number }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
