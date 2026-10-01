import { z } from 'zod';
import type { PublicTenantDTO } from './types';

/* ------------------------------------------------------------------ */
/* Citas con fecha y hora (módulo «appointments»)                      */
/* ------------------------------------------------------------------ */

/**
 * Una cita llega de otro sistema (API, webhook o CSV), la carga el personal o la reserva el
 * cliente en línea. Al presentarse (kiosco, recepción o el sistema externo) se convierte en un
 * turno de la fila, ordenado por la hora de la cita.
 */
export const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Agendada',
  confirmed: 'Confirmada',
  checked_in: 'Llegó',
  completed: 'Atendida',
  cancelled: 'Cancelada',
  no_show: 'No vino',
};

/** Estados en los que la cita todavía ocupa su horario. */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['booked', 'confirmed'];

export const APPOINTMENT_SOURCES = ['manual', 'online', 'api', 'import'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  manual: 'Cargada en el panel',
  online: 'Reserva en línea',
  api: 'Sistema externo',
  import: 'Importada (CSV)',
};

/** Variables de los mensajes de citas. */
export const APPOINTMENT_VARIABLES = ['name', 'date', 'time', 'service', 'branch', 'address', 'professional', 'code', 'link', 'organization'] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

const message = (template: string, enabled = true) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      template: z.string().max(700).default(template),
    })
    .prefault({});

/** Configuración de citas de la organización. */
export const appointmentSettingsSchema = z
  .object({
    checkIn: z
      .object({
        /** Minutos antes de la hora en que ya se puede presentar. */
        before: z.number().int().min(0).max(720).default(60),
        /** Minutos de tolerancia después de la hora. */
        after: z.number().int().min(0).max(240).default(30),
        /** Prioridad del turno al presentarse (vacío = la normal). */
        priorityId: z.string().max(64).nullable().default(null),
        /**
         * En la fila se ordena por la hora de la cita: si llega antes espera su horario y si llega
         * un poco tarde no pierde su lugar frente a quienes llegaron sin cita.
         */
        byAppointmentTime: z.boolean().default(true),
      })
      .prefault({}),
    /** Minutos después de la hora para marcar «No vino» (0 = no marcar). */
    noShowAfter: z.number().int().min(0).max(1440).default(60),
    confirmation: message('Hola {{name}}, su cita en {{organization}} quedó agendada para el {{date}} a las {{time}} ({{service}}, {{branch}}). Código: {{code}}. Ver o cancelar: {{link}}'),
    reminder: message('Hola {{name}}, le recordamos su cita en {{organization}} el {{date}} a las {{time}} ({{service}}, {{branch}}). Al llegar, preséntese en el kiosco con su documento o el código {{code}}.'),
    /** Horas antes de la cita en que se envía el recordatorio. */
    reminderHours: z.number().int().min(1).max(168).default(24),
    booking: z
      .object({
        /** Página pública de reservas (/reservar/<organización>). */
        enabled: z.boolean().default(false),
        daysAhead: z.number().int().min(1).max(180).default(30),
        /** Anticipación mínima para reservar. */
        minNoticeMinutes: z.number().int().min(0).max(10_080).default(60),
        /** Hasta cuántas horas antes el cliente puede cancelar desde su enlace. */
        cancelUntilHours: z.number().int().min(0).max(168).default(2),
        requireDocument: z.boolean().default(true),
        requirePhone: z.boolean().default(true),
        requireEmail: z.boolean().default(false),
        /** Texto que se muestra en la página de reservas (indicaciones, qué traer). */
        message: z.string().max(600).default(''),
        /** Días sin atención (feriados). */
        closedDates: z.array(isoDate).max(200).default([]),
      })
      .prefault({}),
  })
  .prefault({});
export type AppointmentSettings = z.infer<typeof appointmentSettingsSchema>;

/** Horario de atención con cita para un servicio en una sucursal. */
export const bookingScheduleSchema = z
  .object({
    branchId: z.uuid(),
    serviceId: z.uuid(),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: hhmm,
    to: hhmm,
    slotMinutes: z.number().int().min(5).max(480),
    /** Citas por horario (p. ej. 2 profesionales = 2). */
    capacity: z.number().int().min(1).max(200),
    /** Se ofrece en la página pública de reservas. */
    online: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .refine((s) => s.from < s.to, { message: 'La hora de fin debe ser posterior a la de inicio', path: ['to'] });
export type BookingScheduleInput = z.infer<typeof bookingScheduleSchema>;

/** Documento para buscar sin importar puntos, guiones ni espacios. */
export const normalizeDocument = (value: string | null | undefined) => (value ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();

export interface AppointmentCustomer {
  name?: string;
  document?: string;
  phone?: string;
  email?: string;
  [key: string]: string | undefined;
}

export interface AppointmentDTO {
  id: string;
  branchId: string;
  serviceId: string;
  code: string;
  externalId: string | null;
  source: AppointmentSource;
  status: AppointmentStatus;
  scheduledAt: string;
  durationMinutes: number;
  customer: AppointmentCustomer;
  professional: string | null;
  notes: string;
  ticketId: string | null;
  ticketCode: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  service: { id: string; name: string; color: string };
  branch: { id: string; name: string };
  /** Enlace del cliente para ver o cancelar la cita. */
  manageUrl: string;
}

export interface AppointmentPageDTO {
  items: AppointmentDTO[];
  /** Cantidad por estado en el período consultado. */
  counts: Partial<Record<AppointmentStatus, number>>;
}

export interface BookingScheduleDTO extends BookingScheduleInput {
  id: string;
}

export interface SlotDTO {
  /** Hora local (HH:MM) de la sucursal. */
  time: string;
  /** Instante exacto (ISO) para reservar. */
  at: string;
  /** Lugares libres. */
  available: number;
}

export interface AvailabilityDayDTO {
  date: string;
  slots: SlotDTO[];
}

export interface BookingPageDTO {
  tenant: PublicTenantDTO;
  branches: { id: string; name: string; address: string }[];
  services: { id: string; name: string; description: string; color: string; branchIds: string[] }[];
  booking: Pick<AppointmentSettings['booking'], 'daysAhead' | 'requireDocument' | 'requirePhone' | 'requireEmail' | 'message' | 'cancelUntilHours'>;
}

export interface PublicAppointmentDTO {
  code: string;
  status: AppointmentStatus;
  scheduledAt: string;
  /** Fecha y hora legibles en la zona de la sucursal. */
  date: string;
  time: string;
  service: string;
  branch: { name: string; address: string };
  organization: { name: string; logoUrl: string | null; primaryColor: string };
  professional: string | null;
  customerName: string;
  canCancel: boolean;
  /** Seguimiento del turno cuando ya se presentó. */
  trackingUrl: string | null;
}

export interface BookingResultDTO extends PublicAppointmentDTO {
  token: string;
  manageUrl: string;
}

export interface AppointmentImportResultDTO {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

/** Citas de hoy que coinciden con lo que escribió el cliente en el kiosco. */
export interface KioskAppointmentMatchDTO {
  id: string;
  time: string;
  service: string;
  /** Nombre abreviado («María L.») para que el cliente reconozca su cita. */
  customer: string;
  professional: string | null;
  /** Se puede presentar ahora (dentro de la ventana de llegada). */
  canCheckIn: boolean;
  reason: string | null;
}
