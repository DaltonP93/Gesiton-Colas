import { z } from 'zod';
import type { PrivacySettings } from './config';

/* ------------------------------------------------------------------ */
/* Documentos legales: términos, privacidad y tratamiento de datos      */
/* ------------------------------------------------------------------ */

/** Documentos que se publican en el sistema (el contrato de licencia se imprime y se firma aparte). */
export const LEGAL_KINDS = ['terms', 'privacy', 'dpa'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export const LEGAL_DOCS: Record<LegalKind, { title: string; short: string; path: string; /** La organización lo acepta (contrato); la privacidad solo se informa. */ accept: boolean }> = {
  terms: { title: 'Términos y condiciones del servicio', short: 'Términos del servicio', path: '/terminos', accept: true },
  privacy: { title: 'Política de privacidad', short: 'Privacidad', path: '/privacidad', accept: false },
  dpa: { title: 'Acuerdo de tratamiento de datos personales', short: 'Tratamiento de datos', path: '/tratamiento-de-datos', accept: true },
};

/** Documentos que la organización acepta al registrarse y en cada versión importante. */
export const LEGAL_ACCEPTED_KINDS = LEGAL_KINDS.filter((k) => LEGAL_DOCS[k].accept);

const holderFields = {
  name: z.string().trim().max(200),
  taxId: z.string().trim().max(40),
  address: z.string().trim().max(300),
  email: z.union([z.literal(''), z.email().max(200)]),
  city: z.string().trim().max(80),
  /** Dirección pública del servicio (vacío = la de la instalación). */
  website: z.string().trim().max(300),
  availability: z.string().trim().max(20),
  supportHours: z.string().trim().max(200),
  /** Días que tiene la organización para exportar sus datos al terminar el contrato. */
  exportDays: z.number().int().min(7).max(365),
};

/** Datos del titular del software que completan los documentos. */
export const legalHolderSchema = z
  .object({
    name: holderFields.name.default(''),
    taxId: holderFields.taxId.default(''),
    address: holderFields.address.default(''),
    email: holderFields.email.default(''),
    city: holderFields.city.default('Asunción'),
    website: holderFields.website.default(''),
    availability: holderFields.availability.default('99,5 %'),
    supportHours: holderFields.supportHours.default('de lunes a viernes de 8:00 a 18:00 (hora de Paraguay)'),
    exportDays: holderFields.exportDays.default(30),
  })
  .prefault({});
/** Cambios parciales (sin valores por defecto: lo que no se envía no cambia). */
export const legalHolderPatchSchema = z.object(holderFields).partial();
export type LegalHolder = z.infer<typeof legalHolderSchema>;

export const legalSettingsSchema = z
  .object({
    holder: legalHolderSchema,
    /** Pedir que cada organización acepte los términos al registrarse y cuando cambian. */
    requireAcceptance: z.boolean().default(true),
  })
  .prefault({});
export type LegalSettings = z.infer<typeof legalSettingsSchema>;

/** Datos obligatorios para publicar. */
const REQUIRED: [keyof LegalHolder, string][] = [
  ['name', 'razón social o nombre'],
  ['taxId', 'RUC'],
  ['address', 'domicilio'],
  ['email', 'correo de contacto'],
  ['city', 'ciudad de la jurisdicción'],
];

export function legalMissing(holder: LegalHolder): string[] {
  return REQUIRED.filter(([k]) => !String(holder[k] ?? '').trim()).map(([, label]) => label);
}

/** Variables que se pueden usar en los documentos: {{titular}}, {{ruc}}… */
export const LEGAL_VARIABLES = [
  { key: 'producto', label: 'Nombre del producto (marca de la plataforma)' },
  { key: 'titular', label: 'Razón social o nombre del titular' },
  { key: 'ruc', label: 'RUC del titular' },
  { key: 'domicilio', label: 'Domicilio del titular' },
  { key: 'correo', label: 'Correo de contacto' },
  { key: 'ciudad', label: 'Ciudad de la jurisdicción' },
  { key: 'sitio', label: 'Dirección del sitio' },
  { key: 'disponibilidad', label: 'Disponibilidad comprometida' },
  { key: 'soporte', label: 'Horario de soporte' },
  { key: 'dias_exportacion', label: 'Días para exportar los datos al terminar' },
  { key: 'version', label: 'Número de versión' },
  { key: 'fecha', label: 'Fecha de vigencia' },
] as const;

/** Datos del licenciatario para el contrato de licencia (instalación propia). */
export const LICENSE_VARIABLES = [
  { key: 'licenciatario', label: 'Licenciatario (razón social)' },
  { key: 'licenciatario_ruc', label: 'RUC del licenciatario' },
  { key: 'licenciatario_domicilio', label: 'Domicilio del licenciatario' },
  { key: 'licenciatario_representante', label: 'Representante (nombre y cargo)' },
  { key: 'modulos', label: 'Módulos licenciados' },
  { key: 'alcance', label: 'Alcance (organizaciones, sucursales, pantallas, kioscos)' },
  { key: 'plazo', label: 'Modalidad y plazo (perpetua, anual…)' },
  { key: 'precio', label: 'Precio y forma de pago' },
  { key: 'mantenimiento', label: 'Mantenimiento y soporte' },
  { key: 'instalacion', label: 'Instalación y capacitación' },
  { key: 'inicio', label: 'Fecha de inicio' },
] as const;
export type LicenseVariable = (typeof LICENSE_VARIABLES)[number]['key'];

/** Fecha legible: «1 de octubre de 2026». */
export function formatLegalDate(date: Date | string, timeZone = 'America/Asuncion'): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(date));
}

/** Valores de las variables a partir de los datos del titular. */
export function legalVars(holder: LegalHolder, options: { appName: string; publicUrl: string; version?: number | string; date?: Date | string }): Record<string, string> {
  return {
    producto: options.appName,
    titular: holder.name,
    ruc: holder.taxId,
    domicilio: holder.address,
    correo: holder.email,
    ciudad: holder.city,
    sitio: (holder.website || options.publicUrl).replace(/\/+$/, ''),
    disponibilidad: holder.availability,
    soporte: holder.supportHours,
    dias_exportacion: String(holder.exportDays),
    version: options.version === undefined ? '' : String(options.version),
    fecha: options.date ? formatLegalDate(options.date) : '',
  };
}

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Reemplaza las variables del texto. Las desconocidas quedan como están y se informan;
 * las conocidas sin valor se reemplazan por `blank`.
 */
export function renderLegal(source: string, vars: Record<string, string>, blank = '[completar]'): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const text = source.replace(VARIABLE, (match, key: string) => {
    if (!(key in vars)) {
      unknown.add(key);
      return match;
    }
    return vars[key]?.trim() ? vars[key]! : blank;
  });
  return { text, unknown: [...unknown] };
}

/* ------------------- Aviso de privacidad de la organización ------------------- */

function retentionPhrase(days: number): string {
  if (days <= 0) return 'Se conservan solo mientras sean necesarios para su atención.';
  if (days % 365 === 0) return `Se borran automáticamente a ${days === 365 ? 'un año' : `los ${days / 365} años`}.`;
  if (days % 30 === 0 && days < 365) return `Se borran automáticamente a ${days === 30 ? 'los 30 días' : `los ${days / 30} meses`}.`;
  return `Se borran automáticamente a los ${days} días.`;
}

/** Texto estándar del aviso, armado con el nombre de la organización y su plazo de conservación. */
export function defaultPrivacyNotice(organization: string, privacy: Pick<PrivacySettings, 'retentionDays'> & { notice: Pick<PrivacySettings['notice'], 'contact'> }): string {
  const contact = privacy.notice.contact.trim();
  return [
    `${organization} es responsable de los datos que usted ingresa (como su nombre, documento, teléfono o correo) y los usa solo para gestionar su atención: emitir y llamar su turno o su cita, avisarle y mejorar el servicio.`,
    retentionPhrase(privacy.retentionDays),
    `Puede pedir el acceso, la corrección o el borrado de sus datos ${contact ? `en ${contact}` : `a ${organization}`}.`,
  ].join(' ');
}

/** Aviso que se muestra a los clientes (null = desactivado). */
export function privacyNoticeOf(organization: string, privacy: PrivacySettings): { text: string; url: string | null } | null {
  if (!privacy.notice.enabled) return null;
  return { text: privacy.notice.text.trim() || defaultPrivacyNotice(organization, privacy), url: privacy.notice.url || null };
}

/* ------------------------------ DTOs ------------------------------ */

/** Documentos publicados (página pública y casilla del registro). */
export interface LegalIndexDTO {
  /** Se pide aceptar los términos al registrarse (hay documentos para aceptar publicados). */
  acceptance: boolean;
  documents: { kind: LegalKind; title: string; path: string; version: number; publishedAt: string }[];
}

export interface LegalDocumentDTO {
  kind: LegalKind;
  title: string;
  path: string;
  version: number;
  publishedAt: string;
  /** Texto publicado (Markdown), con los datos del titular. */
  content: string;
  /** Es la versión vigente. */
  current: boolean;
  versions: { version: number; publishedAt: string; note: string | null }[];
}

/** Documento que la organización debe aceptar. */
export interface LegalPendingDTO {
  kind: LegalKind;
  title: string;
  path: string;
  version: number;
  /** Qué cambió (lo escribe quien publica). */
  note: string | null;
}

export interface LegalVersionDTO {
  id: string;
  kind: LegalKind;
  version: number;
  publishedAt: string;
  publishedBy: string | null;
  requiresAcceptance: boolean;
  note: string | null;
  /** Organizaciones que aceptaron esta versión. */
  accepted: number;
}

export interface LegalAdminDTO {
  settings: LegalSettings;
  /** Datos del titular que faltan para publicar. */
  missing: string[];
  /** Dirección pública de la instalación ({{sitio}} si no se indica otra). */
  publicUrl: string;
  appName: string;
  documents: {
    kind: LegalKind;
    title: string;
    path: string;
    /** Texto con variables de la última versión (o la plantilla si no hay ninguna). */
    source: string;
    template: string;
    current: LegalVersionDTO | null;
    /** La versión publicada quedó con datos del titular anteriores: conviene publicar de nuevo. */
    outdated: boolean;
  }[];
  /** Organizaciones activas que todavía no aceptaron la versión vigente. */
  pendingTenants: number;
  tenants: number;
}

/** Aceptaciones por organización (Plataforma → Legal). */
export interface LegalTenantStatusDTO {
  tenant: { id: string; name: string; slug: string; isDemo: boolean; status: string };
  accepted: Partial<Record<LegalKind, { version: number; acceptedAt: string; userName: string; userEmail: string; ip: string | null }>>;
  pending: LegalKind[];
}

/** Estado para la organización (Configuración y aviso de nueva versión). */
export interface LegalStatusDTO {
  documents: {
    kind: LegalKind;
    title: string;
    path: string;
    version: number;
    publishedAt: string;
    accepted: { version: number; acceptedAt: string; userName: string } | null;
    pending: boolean;
  }[];
}
