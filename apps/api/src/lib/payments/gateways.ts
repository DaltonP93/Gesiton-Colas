import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fromMinor, type Currency, type PaymentGateway } from '@gc/shared';
import { outboundRequest } from '../net';

/*
 * Pasarelas de pago. Implementadas según la documentación pública de cada una:
 * - Stripe Checkout: https://docs.stripe.com/api/checkout/sessions
 * - PagoPar (API de comercios 2.0): https://soporte.pagopar.com/portal/es/kb/articles/api-integracion-medios-pagos
 * - Bancard vPOS 2.0 (single_buy): documentación que Bancard entrega a cada comercio
 * Antes de producción, pruebe cada una en su ambiente de pruebas (sandbox / staging).
 */

export interface GatewayRuntime {
  provider: PaymentGateway;
  sandbox: boolean;
  publicKey: string;
  secret: string;
  webhookSecret: string;
  /** Reemplaza la dirección de la API (pruebas o proxy). */
  apiUrl: string;
  allowPrivate: boolean;
}

export interface CheckoutInput {
  /** Número correlativo del pago (id del pedido en Bancard y PagoPar). */
  seq: number;
  token: string;
  amount: number;
  currency: Currency;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  email?: string | null;
  name?: string | null;
}

export interface CheckoutResult {
  providerRef: string;
  checkoutUrl: string | null;
  /** Bancard: proceso para el iframe. */
  processId?: string;
}

export type GatewayStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export interface WebhookResult {
  /** Cómo encontrar el pago. */
  match: { providerRef?: string; seq?: number };
  status: GatewayStatus;
  method?: string | null;
  reference?: string | null;
  /** Lo que se responde a la pasarela. */
  respond: unknown;
  raw: Record<string, unknown>;
}

export class GatewayError extends Error {}

const sha1 = (v: string) => createHash('sha1').update(v).digest('hex');
const md5 = (v: string) => createHash('md5').update(v).digest('hex');
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function parseJson(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function post(rt: GatewayRuntime, url: string, body: string, headers: Record<string, string>) {
  const res = await outboundRequest(url, { method: 'POST', headers, body, allowPrivate: rt.allowPrivate, timeoutMs: 20_000 });
  return { status: res.status, json: parseJson(res.body), body: res.body };
}

/* ------------------------------ Stripe -------------------------------- */

const stripeBase = (rt: GatewayRuntime) => (rt.apiUrl || 'https://api.stripe.com').replace(/\/$/, '');

function form(data: Record<string, string | number>) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function stripeCheckout(rt: GatewayRuntime, input: CheckoutInput): Promise<CheckoutResult> {
  const data: Record<string, string | number> = {
    mode: 'payment',
    success_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.token,
    'metadata[payment]': input.token,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': input.currency.toLowerCase(),
    // Stripe usa la unidad mínima (PYG no tiene decimales, USD en centavos), igual que nosotros.
    'line_items[0][price_data][unit_amount]': input.amount,
    'line_items[0][price_data][product_data][name]': input.description.slice(0, 250),
  };
  if (input.email) data.customer_email = input.email;
  const res = await post(rt, `${stripeBase(rt)}/v1/checkout/sessions`, form(data), {
    authorization: `Bearer ${rt.secret}`,
    'content-type': 'application/x-www-form-urlencoded',
  });
  const session = res.json as { id?: string; url?: string; error?: { message?: string } };
  if (res.status >= 300 || !session.id || !session.url) throw new GatewayError(`Stripe: ${session.error?.message ?? `respuesta ${res.status}`}`);
  return { providerRef: session.id, checkoutUrl: session.url };
}

async function stripeStatus(rt: GatewayRuntime, providerRef: string): Promise<GatewayStatus> {
  const res = await outboundRequest(`${stripeBase(rt)}/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, {
    headers: { authorization: `Bearer ${rt.secret}` },
    allowPrivate: rt.allowPrivate,
  });
  const s = parseJson(res.body) as { payment_status?: string; status?: string };
  if (s.payment_status === 'paid') return 'paid';
  if (s.status === 'expired') return 'cancelled';
  return 'pending';
}

/** Verifica la firma `Stripe-Signature` (HMAC-SHA256 de `t.cuerpo`, tolerancia de 5 minutos). */
export function verifyStripeSignature(header: string | undefined, rawBody: string, secret: string, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !signatures.length || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return signatures.some((s) => safeEqual(s, expected));
}

function stripeWebhook(rt: GatewayRuntime, headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookResult {
  const sig = headers['stripe-signature'];
  if (!verifyStripeSignature(Array.isArray(sig) ? sig[0] : sig, rawBody, rt.webhookSecret)) throw new GatewayError('Firma de Stripe inválida');
  const event = parseJson(rawBody) as { type?: string; data?: { object?: { id?: string; payment_status?: string; payment_intent?: string } } };
  const session = event.data?.object ?? {};
  const status: GatewayStatus =
    (event.type === 'checkout.session.completed' && session.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded'
      ? 'paid'
      : event.type === 'checkout.session.async_payment_failed'
        ? 'failed'
        : event.type === 'checkout.session.expired'
          ? 'cancelled'
          : 'pending';
  return { match: { providerRef: session.id }, status, method: 'Stripe', reference: session.payment_intent ?? session.id ?? null, respond: { received: true }, raw: { type: event.type, id: session.id } };
}

/* ------------------------------ PagoPar ------------------------------- */

const pagoparBase = (rt: GatewayRuntime) => (rt.apiUrl || 'https://api.pagopar.com').replace(/\/$/, '');
const pagoparCheckoutBase = (rt: GatewayRuntime) => (rt.apiUrl ? `${rt.apiUrl.replace(/\/$/, '')}` : 'https://www.pagopar.com');

function pagoparDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function pagoparCheckout(rt: GatewayRuntime, input: CheckoutInput): Promise<CheckoutResult> {
  const amount = fromMinor(input.amount, input.currency);
  const orderId = String(input.seq);
  const body = {
    token: sha1(`${rt.secret}${orderId}${String(amount)}`),
    public_key: rt.publicKey,
    monto_total: amount,
    tipo_pedido: 'VENTA-COMERCIO',
    compras_items: [
      {
        ciudad: '1',
        nombre: input.description.slice(0, 120),
        cantidad: 1,
        categoria: '909',
        public_key: rt.publicKey,
        url_imagen: '',
        descripcion: input.description.slice(0, 120),
        id_producto: input.seq,
        precio_total: amount,
        vendedor_telefono: '',
        vendedor_direccion: '',
        vendedor_direccion_referencia: '',
        vendedor_direccion_coordenadas: '',
      },
    ],
    fecha_maxima_pago: pagoparDate(new Date(Date.now() + 2 * 24 * 3600 * 1000)),
    id_pedido_comercio: orderId,
    descripcion_resumen: input.description.slice(0, 120),
    comprador: {
      ruc: '',
      email: input.email ?? '',
      ciudad: null,
      nombre: input.name || 'Cliente',
      telefono: '',
      direccion: '',
      documento: '',
      coordenadas: '',
      razon_social: '',
      tipo_documento: 'CI',
      direccion_referencia: null,
    },
  };
  const res = await post(rt, `${pagoparBase(rt)}/api/comercios/2.0/iniciar-transaccion`, JSON.stringify(body), { 'content-type': 'application/json' });
  const data = res.json as { respuesta?: boolean; resultado?: { data?: string }[] | string };
  const hash = Array.isArray(data.resultado) ? data.resultado[0]?.data : undefined;
  if (!data.respuesta || !hash) throw new GatewayError(`PagoPar: ${typeof data.resultado === 'string' ? data.resultado : `respuesta ${res.status}`}`);
  return { providerRef: hash, checkoutUrl: `${pagoparCheckoutBase(rt)}/pagos/${hash}` };
}

function pagoparState(item: { pagado?: boolean; cancelado?: boolean } | undefined): GatewayStatus {
  if (item?.pagado) return 'paid';
  if (item?.cancelado) return 'cancelled';
  return 'pending';
}

async function pagoparStatus(rt: GatewayRuntime, providerRef: string): Promise<GatewayStatus> {
  const res = await post(
    rt,
    `${pagoparBase(rt)}/api/pedidos/1.1/traer`,
    JSON.stringify({ hash_pedido: providerRef, token: sha1(`${rt.secret}CONSULTA`), token_publico: rt.publicKey }),
    { 'content-type': 'application/json' },
  );
  const data = res.json as { respuesta?: boolean; resultado?: { pagado?: boolean; cancelado?: boolean }[] };
  return data.respuesta && Array.isArray(data.resultado) ? pagoparState(data.resultado[0]) : 'pending';
}

/** PagoPar avisa a la «URL de respuesta»: se valida `token = sha1(clave privada + hash del pedido)` y se devuelve el mismo resultado. */
function pagoparWebhook(rt: GatewayRuntime, rawBody: string): WebhookResult {
  const data = parseJson(rawBody) as { resultado?: { hash_pedido?: string; token?: string; pagado?: boolean; cancelado?: boolean; forma_pago?: string; numero_pedido?: string | number }[] };
  const item = Array.isArray(data.resultado) ? data.resultado[0] : undefined;
  if (!item?.hash_pedido || !item.token || !safeEqual(item.token, sha1(`${rt.secret}${item.hash_pedido}`))) throw new GatewayError('Token de PagoPar inválido');
  return {
    match: { providerRef: item.hash_pedido },
    status: pagoparState(item),
    method: item.forma_pago ?? 'PagoPar',
    reference: item.numero_pedido != null ? String(item.numero_pedido) : item.hash_pedido,
    respond: data.resultado,
    raw: { pagado: item.pagado, cancelado: item.cancelado, forma_pago: item.forma_pago, numero_pedido: item.numero_pedido },
  };
}

/* ------------------------------ Bancard ------------------------------- */

export const bancardBase = (rt: Pick<GatewayRuntime, 'apiUrl' | 'sandbox'>) =>
  (rt.apiUrl || (rt.sandbox ? 'https://vpos.infonet.com.py:8888' : 'https://vpos.infonet.com.py')).replace(/\/$/, '');
export const bancardScript = (rt: Pick<GatewayRuntime, 'apiUrl' | 'sandbox'>) => `${bancardBase(rt)}/checkout/javascript/dist/bancard-checkout-4.0.0.js`;

const bancardAmount = (minor: number, currency: Currency) => fromMinor(minor, currency).toFixed(2);

async function bancardCheckout(rt: GatewayRuntime, input: CheckoutInput): Promise<CheckoutResult> {
  const amount = bancardAmount(input.amount, input.currency);
  const body = {
    public_key: rt.publicKey,
    operation: {
      token: md5(`${rt.secret}${input.seq}${amount}${input.currency}`),
      shop_process_id: input.seq,
      amount,
      currency: input.currency,
      additional_data: '',
      description: input.description.slice(0, 20),
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
    },
  };
  const res = await post(rt, `${bancardBase(rt)}/vpos/api/0.3/single_buy`, JSON.stringify(body), { 'content-type': 'application/json' });
  const data = res.json as { status?: string; process_id?: string; messages?: { dsc?: string }[] };
  if (data.status !== 'success' || !data.process_id) throw new GatewayError(`Bancard: ${data.messages?.[0]?.dsc ?? `respuesta ${res.status}`}`);
  return { providerRef: String(input.seq), checkoutUrl: null, processId: data.process_id };
}

async function bancardStatus(rt: GatewayRuntime, seq: number): Promise<GatewayStatus> {
  const res = await post(
    rt,
    `${bancardBase(rt)}/vpos/api/0.3/single_buy/confirmations`,
    JSON.stringify({ public_key: rt.publicKey, operation: { token: md5(`${rt.secret}${seq}get_confirmation`), shop_process_id: seq } }),
    { 'content-type': 'application/json' },
  );
  const data = res.json as { status?: string; confirmation?: { response?: string; response_code?: string } };
  if (data.status === 'success' && data.confirmation) return data.confirmation.response === 'S' && data.confirmation.response_code === '00' ? 'paid' : 'failed';
  return 'pending';
}

/** Bancard confirma en la «URL de confirmación»: `token = md5(clave privada + shop_process_id + "confirm" + monto + moneda)`. */
function bancardWebhook(rt: GatewayRuntime, rawBody: string): WebhookResult {
  const data = parseJson(rawBody) as {
    operation?: { token?: string; shop_process_id?: number | string; response?: string; response_code?: string; amount?: string; currency?: string; authorization_number?: string; ticket_number?: string; response_description?: string };
  };
  const op = data.operation;
  if (!op?.token || op.shop_process_id === undefined) throw new GatewayError('Confirmación de Bancard incompleta');
  const expected = md5(`${rt.secret}${op.shop_process_id}confirm${op.amount ?? ''}${op.currency ?? ''}`);
  if (!safeEqual(op.token, expected)) throw new GatewayError('Token de Bancard inválido');
  return {
    match: { seq: Number(op.shop_process_id) },
    status: op.response === 'S' && op.response_code === '00' ? 'paid' : 'failed',
    method: 'Tarjeta (Bancard)',
    reference: op.authorization_number ?? op.ticket_number ?? null,
    respond: { status: 'success' },
    raw: { response: op.response, response_code: op.response_code, response_description: op.response_description, authorization_number: op.authorization_number, ticket_number: op.ticket_number },
  };
}

/* ------------------------------ Común --------------------------------- */

export function createCheckout(rt: GatewayRuntime, input: CheckoutInput): Promise<CheckoutResult> {
  if (rt.provider === 'stripe') return stripeCheckout(rt, input);
  if (rt.provider === 'pagopar') return pagoparCheckout(rt, input);
  return bancardCheckout(rt, input);
}

export function fetchStatus(rt: GatewayRuntime, payment: { providerRef: string | null; seq: number }): Promise<GatewayStatus> {
  if (rt.provider === 'stripe') return payment.providerRef ? stripeStatus(rt, payment.providerRef) : Promise.resolve('pending');
  if (rt.provider === 'pagopar') return payment.providerRef ? pagoparStatus(rt, payment.providerRef) : Promise.resolve('pending');
  return bancardStatus(rt, payment.seq);
}

export function parseWebhook(rt: GatewayRuntime, headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookResult {
  if (rt.provider === 'stripe') return stripeWebhook(rt, headers, rawBody);
  if (rt.provider === 'pagopar') return pagoparWebhook(rt, rawBody);
  return bancardWebhook(rt, rawBody);
}

/** Helpers expuestos para las pruebas (firmas de ejemplo). */
export const signatures = { sha1, md5 };
