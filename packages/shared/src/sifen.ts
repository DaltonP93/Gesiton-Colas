import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Factura electrónica SIFEN (Paraguay) — módulo «invoicing»           */
/* ------------------------------------------------------------------ */

/**
 * Documentos electrónicos según el Manual Técnico SIFEN v150 de la SET. La organización (o la
 * plataforma, para facturar sus planes) carga su timbrado, su certificado digital (.p12) y su
 * código de seguridad (CSC); cada factura se firma, se envía a la SET y queda con su CDC y su KuDE.
 */
export const SIFEN_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'error'] as const;
export type SifenStatus = (typeof SIFEN_STATUSES)[number];

export const SIFEN_STATUS_LABELS: Record<SifenStatus, string> = {
  pending: 'Enviando',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Anulada',
  error: 'Sin enviar',
};

export const SIFEN_ENVIRONMENTS = ['test', 'prod'] as const;
export type SifenEnvironment = (typeof SIFEN_ENVIRONMENTS)[number];

/** Tasas de IVA de los ítems (0 = exento). */
export const IVA_RATES = [10, 5, 0] as const;
export type IvaRate = (typeof IVA_RATES)[number];

/** Formas de pago de la condición contado (tabla de SIFEN, las más usadas). */
export const SIFEN_PAYMENT_TYPES = {
  1: 'Efectivo',
  2: 'Cheque',
  3: 'Tarjeta de crédito',
  4: 'Tarjeta de débito',
  5: 'Transferencia',
  7: 'Billetera electrónica',
  21: 'Pago electrónico',
  99: 'Otro',
} as const;
export type SifenPaymentType = keyof typeof SIFEN_PAYMENT_TYPES;
export const SIFEN_PAYMENT_TYPE_IDS = Object.keys(SIFEN_PAYMENT_TYPES).map(Number) as SifenPaymentType[];

/** Receptor: contribuyente (RUC), persona con cédula o pasaporte, o sin nombre (consumidor final). */
export const SIFEN_RECEIVER_KINDS = ['ruc', 'ci', 'passport', 'none'] as const;
export type SifenReceiverKind = (typeof SIFEN_RECEIVER_KINDS)[number];

export const SIFEN_RECEIVER_LABELS: Record<SifenReceiverKind, string> = {
  ruc: 'Contribuyente (RUC)',
  ci: 'Cédula de identidad',
  passport: 'Pasaporte',
  none: 'Sin nombre (consumidor final)',
};

const ruc = z
  .string()
  .trim()
  .regex(/^\d{1,8}-\d$/, 'RUC inválido (ej.: 80012345-6)');

/** Datos del emisor (sin secretos: el certificado, su clave y el CSC se guardan cifrados aparte). */
export const sifenIssuerSchema = z
  .object({
    enabled: z.boolean().default(false),
    environment: z.enum(SIFEN_ENVIRONMENTS).default('test'),
    ruc: z.union([z.literal(''), ruc]).default(''),
    razonSocial: z.string().trim().max(255).default(''),
    nombreFantasia: z.string().trim().max(255).default(''),
    /** 1 = persona física, 2 = persona jurídica. */
    tipoContribuyente: z.union([z.literal(1), z.literal(2)]).default(2),
    /** Régimen (tabla de SIFEN), opcional. */
    tipoRegimen: z.number().int().min(1).max(99).nullable().default(null),
    actividadCodigo: z.string().trim().max(8).default(''),
    actividadDescripcion: z.string().trim().max(300).default(''),
    timbrado: z.union([z.literal(''), z.string().regex(/^\d{8}$/, 'El timbrado tiene 8 dígitos')]).default(''),
    timbradoFecha: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''),
    establecimiento: z.string().regex(/^\d{3}$/, 'Tres dígitos (ej.: 001)').default('001'),
    punto: z.string().regex(/^\d{3}$/, 'Tres dígitos (ej.: 001)').default('001'),
    direccion: z.string().trim().max(255).default(''),
    numeroCasa: z.string().trim().max(6).default('0'),
    departamento: z.number().int().min(1).max(99).default(1),
    distrito: z.number().int().min(1).max(9999).default(1),
    ciudad: z.number().int().min(1).max(99999).default(1),
    telefono: z.string().trim().max(15).default(''),
    email: z.union([z.literal(''), z.email().max(80)]).default(''),
    denominacion: z.string().trim().max(255).default(''),
    /** Identificador del código de seguridad (CSC) que dio la SET (ej.: 0001). */
    cscId: z.string().regex(/^\d{1,4}$/).default('0001'),
    /** IVA de los servicios si no se indica otro. */
    defaultIva: z.union([z.literal(10), z.literal(5), z.literal(0)]).default(10),
    /** Emitir la factura sola al registrar un cobro (organizaciones con el módulo de cobros). */
    autoIssue: z.boolean().default(false),
  })
  .prefault({});
export type SifenIssuerSettings = z.infer<typeof sifenIssuerSchema>;

export interface SifenIssuerDTO extends SifenIssuerSettings {
  certificate: { subject: string; validFrom: string; validTo: string } | null;
  hasCsc: boolean;
  nextNumber: number;
  /** Lo que falta para poder emitir. */
  missing: string[];
}

export const sifenReceiverSchema = z.object({
  kind: z.enum(SIFEN_RECEIVER_KINDS),
  /** RUC (kind = ruc) o número de documento. */
  document: z.string().trim().max(20).default(''),
  name: z.string().trim().max(255).default(''),
  email: z.union([z.literal(''), z.email().max(80)]).default(''),
  phone: z.string().trim().max(20).default(''),
  address: z.string().trim().max(255).default(''),
});
export type SifenReceiver = z.infer<typeof sifenReceiverSchema>;

export const sifenItemSchema = z.object({
  code: z.string().trim().max(20).default(''),
  description: z.string().trim().min(1, 'Describa el ítem').max(120),
  quantity: z.number().positive().max(1_000_000),
  /** Precio unitario con IVA incluido, en unidades de la moneda (no centavos). */
  unitPrice: z.number().min(0).max(1e12),
  iva: z.union([z.literal(10), z.literal(5), z.literal(0)]),
});
export type SifenItem = z.infer<typeof sifenItemSchema>;

export const sifenIssueSchema = z.object({
  receiver: sifenReceiverSchema,
  items: z.array(sifenItemSchema).min(1, 'Agregue al menos un ítem').max(100),
  currency: z.enum(['PYG', 'USD']).default('PYG'),
  /** Tipo de cambio (solo USD). */
  exchangeRate: z.number().positive().max(1_000_000).optional(),
  condition: z.enum(['cash', 'credit']).default('cash'),
  paymentType: z
    .number()
    .int()
    .refine((n) => SIFEN_PAYMENT_TYPE_IDS.includes(n as SifenPaymentType), 'Forma de pago inválida')
    .default(1),
  creditDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(500).default(''),
  /** De qué viene: un cobro de turno, una factura de plan o carga manual. */
  source: z.object({ type: z.enum(['payment', 'invoice', 'manual']), id: z.uuid().optional() }).default({ type: 'manual' }),
});
export type SifenIssueInput = z.infer<typeof sifenIssueSchema>;

export interface SifenTotals {
  subtotalExento: number;
  subtotal5: number;
  subtotal10: number;
  iva5: number;
  iva10: number;
  totalIva: number;
  total: number;
}

export interface SifenDocumentDTO {
  id: string;
  cdc: string;
  /** 001-001-0000123 */
  number: string;
  status: SifenStatus;
  environment: SifenEnvironment;
  issuedAt: string;
  receiver: SifenReceiver;
  items: SifenItem[];
  currency: 'PYG' | 'USD';
  totals: SifenTotals;
  condition: 'cash' | 'credit';
  setCode: string | null;
  setMessage: string | null;
  source: { type: 'payment' | 'invoice' | 'manual'; id?: string };
  /** Representación gráfica (KuDE) para imprimir o enviar al cliente. */
  kudeUrl: string;
  sentAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Se puede anular ante la SET (aprobada, dentro de las 48 h). */
  canCancel: boolean;
  createdAt: string;
}

/** KuDE: lo que se imprime o se muestra al cliente. */
export interface SifenKudeDTO {
  issuer: Pick<SifenIssuerSettings, 'ruc' | 'razonSocial' | 'nombreFantasia' | 'direccion' | 'numeroCasa' | 'telefono' | 'email' | 'actividadDescripcion' | 'timbrado' | 'timbradoFecha'> & {
    ciudad: string;
    logoUrl: string | null;
  };
  type: string;
  number: string;
  cdc: string;
  status: SifenStatus;
  environment: SifenEnvironment;
  issuedAt: string;
  condition: string;
  currency: 'PYG' | 'USD';
  exchangeRate: number | null;
  receiver: SifenReceiver;
  items: (SifenItem & { total: number })[];
  totals: SifenTotals;
  qrUrl: string;
  notes: string;
}

/** Datos de la organización para la factura que le emite la plataforma. */
export const fiscalProfileSchema = z
  .object({
    ruc: z.string().trim().max(20).default(''),
    name: z.string().trim().max(255).default(''),
    email: z.union([z.literal(''), z.email().max(80)]).default(''),
    address: z.string().trim().max(255).default(''),
    /** Celular para los avisos de la plataforma por WhatsApp/SMS (facturas, vencimientos). */
    phone: z.string().trim().max(30).default(''),
  })
  .prefault({});
export type FiscalProfile = z.infer<typeof fiscalProfileSchema>;

/** «0180…» → «0180 0695 63…» (grupos de 4, como en el KuDE). */
export const formatCdc = (cdc: string) => cdc.replace(/(.{4})/g, '$1 ').trim();

/** Totales de los ítems (IVA incluido en el precio), redondeados según la moneda. */
export function sifenTotals(items: Pick<SifenItem, 'quantity' | 'unitPrice' | 'iva'>[], currency: 'PYG' | 'USD' = 'PYG'): SifenTotals {
  const decimals = currency === 'PYG' ? 0 : 2;
  const round = (n: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;
  const t = { subtotalExento: 0, subtotal5: 0, subtotal10: 0, iva5: 0, iva10: 0, totalIva: 0, total: 0 };
  for (const i of items) {
    const total = round(i.quantity * i.unitPrice);
    if (i.iva === 10) {
      t.subtotal10 += total;
      t.iva10 += total / 11;
    } else if (i.iva === 5) {
      t.subtotal5 += total;
      t.iva5 += total / 21;
    } else t.subtotalExento += total;
    t.total += total;
  }
  t.iva10 = round(t.iva10);
  t.iva5 = round(t.iva5);
  t.totalIva = round(t.iva10 + t.iva5);
  t.total = round(t.total);
  return t;
}
