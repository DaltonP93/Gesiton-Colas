import { z } from 'zod';
import type { InvoiceLine, MonthlyCharges } from './billing';
import { CURRENCIES, type Currency } from './currency';

/* ------------------------------------------------------------------ */
/* Pagos: facturación de planes y cobros a clientes                    */
/* ------------------------------------------------------------------ */

/** Pasarelas en línea. El registro manual (efectivo, POS, transferencia) siempre está disponible. */
export const PAYMENT_GATEWAYS = ['bancard', 'pagopar', 'stripe'] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];
export type PaymentProvider = PaymentGateway | 'manual';

export const PAYMENT_GATEWAY_INFO: Record<PaymentGateway, { name: string; description: string; currencies: Currency[] }> = {
  bancard: {
    name: 'Bancard (vPOS 2.0)',
    description: 'Tarjetas de crédito y débito de Paraguay (Visa, Mastercard, Bancard, Cabal, Panal) con el checkout de Bancard.',
    currencies: ['PYG'],
  },
  pagopar: {
    name: 'PagoPar',
    description: 'Tarjetas, billeteras (Tigo Money, Personal, Zimple), transferencias y bocas de cobranza de Paraguay.',
    currencies: ['PYG'],
  },
  stripe: {
    name: 'Stripe Checkout',
    description: 'Tarjetas internacionales, Apple Pay y Google Pay. Admite guaraníes, dólares, reales, pesos y euros.',
    currencies: ['PYG', 'USD', 'ARS', 'BRL', 'EUR'],
  },
};

export const MANUAL_METHODS = ['cash', 'card', 'transfer', 'qr', 'other'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];
export const MANUAL_METHOD_LABELS: Record<ManualMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta (POS)',
  transfer: 'Transferencia',
  qr: 'QR / billetera',
  other: 'Otro',
};

/* ------------------------------ Ajustes ------------------------------- */

/** Facturación de la plataforma a las organizaciones (la define el superadministrador). */
export const billingSettingsSchema = z.object({
  /** Emitir facturas a las organizaciones y mostrarles «Plan y facturación». */
  enabled: z.boolean().default(false),
  /** Generar sola la factura del mes de cada organización con plan pago (el día 1). */
  autoGenerate: z.boolean().default(false),
  /** Días para pagar desde la emisión. */
  dueDays: z.number().int().min(0).max(90).default(10),
  /** Suspender a la organización cuando una factura lleva vencida más de `graceDays` días. */
  autoSuspend: z.boolean().default(false),
  graceDays: z.number().int().min(0).max(120).default(7),
  /** Datos del emisor que se muestran en las facturas. */
  issuerName: z.string().trim().max(160).default(''),
  issuerTaxId: z.string().trim().max(40).default(''),
  /** Instrucciones de pago (cuenta bancaria, alias, etc.). */
  instructions: z.string().trim().max(1000).default(''),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

/** Cobros de una organización a sus clientes (módulo «Pagos»). */
export const tenantPaymentSettingsSchema = z.object({
  currency: z.enum(CURRENCIES).default('PYG'),
  /** Ofrecer el pago en línea en la página de seguimiento del turno. */
  online: z.boolean().default(true),
  /** Mostrar el precio de cada servicio en el kiosco. */
  showPriceOnKiosk: z.boolean().default(true),
});
export type TenantPaymentSettings = z.infer<typeof tenantPaymentSettingsSchema>;

/** Configuración de una pasarela (plataforma u organización). Los secretos no vuelven al navegador. */
export const gatewayBodySchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(PAYMENT_GATEWAYS),
  /** Ambiente de pruebas de la pasarela. */
  sandbox: z.boolean().default(true),
  /** Clave pública (Bancard, PagoPar). */
  publicKey: z.string().trim().max(200).default(''),
  /** Solo para pruebas o proxys: reemplaza la dirección de la API de la pasarela. */
  apiUrl: z.union([z.literal(''), z.string().trim().url().max(500)]).default(''),
  /** Clave privada (Bancard, PagoPar) o clave secreta (Stripe). Sin enviar = conservar. */
  secret: z.string().max(500).optional(),
  /** Stripe: secreto de firma del webhook (whsec_…). Sin enviar = conservar. */
  webhookSecret: z.string().max(500).optional(),
});
export type GatewayBody = z.infer<typeof gatewayBodySchema>;

export interface GatewayDTO {
  enabled: boolean;
  provider: PaymentGateway;
  sandbox: boolean;
  publicKey: string;
  apiUrl: string;
  hasSecret: boolean;
  hasWebhookSecret: boolean;
  /** URL que se configura en la pasarela para las confirmaciones. */
  webhookUrl: string;
  updatedAt: string | null;
}

/* ------------------------------ Facturas ------------------------------ */

export type InvoiceStatus = 'pending' | 'paid' | 'void';
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus | 'overdue', string> = { pending: 'Pendiente', paid: 'Pagada', void: 'Anulada', overdue: 'Vencida' };

export const invoiceBodySchema = z.object({
  tenantId: z.uuid(),
  description: z.string().trim().min(1).max(300),
  /** Monto en la unidad principal (guaraníes, dólares). */
  amount: z.number().positive().max(10_000_000_000),
  currency: z.enum(CURRENCIES).default('PYG'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.string().regex(/^\d{4}-\d{2}$/).nullish(),
  notes: z.string().trim().max(1000).default(''),
  /** Avisar por correo a los administradores de la organización. */
  notify: z.boolean().default(true),
});
export type InvoiceBody = z.infer<typeof invoiceBodySchema>;

export interface InvoiceDTO {
  id: string;
  number: string;
  tenantId: string;
  tenantName: string;
  period: string | null;
  description: string;
  /** En la unidad mínima de la moneda. */
  amount: number;
  currency: Currency;
  /** Detalle (plan y módulos adicionales); vacío en las facturas de un solo concepto. */
  lines: InvoiceLine[];
  status: InvoiceStatus;
  overdue: boolean;
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  notes: string;
}

export interface BillingOverviewDTO {
  enabled: boolean;
  plan: { id: string; name: string; monthlyPrice: number; currency: Currency };
  /** Cargo mensual: plan más módulos adicionales. */
  monthly: MonthlyCharges;
  suspended: boolean;
  /** Se puede pagar en línea (la plataforma tiene una pasarela activa). */
  onlinePayment: PaymentGateway | null;
  instructions: string;
  issuer: { name: string; taxId: string };
  invoices: InvoiceDTO[];
}

export interface BillingStatsDTO {
  currency: Currency;
  issuedThisMonth: number;
  paidThisMonth: number;
  pending: number;
  overdue: number;
  overdueTenants: number;
}

/* ------------------------------ Cobros -------------------------------- */

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { pending: 'Pendiente', paid: 'Pagado', failed: 'Rechazado', cancelled: 'Cancelado' };

export interface PaymentDTO {
  id: string;
  kind: 'invoice' | 'ticket';
  invoiceId: string | null;
  ticketId: string | null;
  ticketCode: string | null;
  service: string | null;
  description: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  provider: PaymentProvider;
  method: string | null;
  reference: string | null;
  recordedBy: string | null;
  paidAt: string | null;
  createdAt: string;
}

/** Cobro del turno (consola del operador y seguimiento). */
export interface TicketChargeDTO {
  amount: number;
  currency: Currency;
  status: 'pending' | 'paid';
  method: string | null;
  paidAt: string | null;
  /** Se puede pagar en línea. */
  online: boolean;
}

export const manualPaymentSchema = z.object({
  method: z.enum(MANUAL_METHODS),
  reference: z.string().trim().max(120).default(''),
});

/** Página pública de un pago (/pago/:token). */
export interface PublicPaymentDTO {
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  description: string;
  provider: PaymentProvider;
  checkoutUrl: string | null;
  /** Bancard: el checkout se muestra en un iframe con este proceso. */
  bancard: { processId: string; scriptUrl: string } | null;
  /** A dónde volver al terminar. */
  returnUrl: string | null;
  brand: { name: string; logoUrl: string | null; primaryColor: string };
}
