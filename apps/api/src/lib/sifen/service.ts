import { randomInt } from 'node:crypto';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  SIFEN_PAYMENT_TYPES,
  deepMerge,
  fromMinor,
  normalizeConfig,
  sifenIssuerSchema,
  sifenTotals,
  type ModuleId,
  type SifenDocumentDTO,
  type SifenIssueInput,
  type SifenIssuerDTO,
  type SifenIssuerSettings,
  type SifenKudeDTO,
  type SifenTotals,
} from '@gc/shared';
import type { AppConfig } from '../../config';
import type { Database } from '../../db/client';
import { sifenDocuments, sifenIssuers, tenants, tickets, type Payment, type SifenDocument, type SifenIssuer, type Tenant } from '../../db/schema';
import { decryptSecret, encryptSecret, randomToken } from '../crypto';
import { sifenMail, type EmailBrand } from '../emails';
import { AppError, badRequest, conflict, notFound } from '../errors';
import type { Mailer } from '../mailer';
import { localParts } from '../tz';
import { qrUrl, withQr } from './qr';
import { SetClient, type SetResult } from './set';
import { openP12, signXml, type Certificate } from './sign';
import { buildCancelXml, buildDeXml, geography, readTag } from './xml';

/** Emisor de la plataforma (facturas de los planes a las organizaciones). */
export const PLATFORM_SCOPE = 'platform';
const TZ = 'America/Asuncion';
/** La SET permite anular una factura hasta 48 h después de aprobada. */
const CANCEL_HOURS = 48;

interface Deps {
  config: AppConfig;
  db: Database;
  log: FastifyBaseLogger;
  mailer: Mailer;
  emailBrand(tenant: Tenant | null): Promise<EmailBrand>;
  modulesOf(tenant: Pick<Tenant, 'plan' | 'modules'>): Promise<ModuleId[]>;
}

/** Forma de pago de SIFEN según cómo se cobró. */
function paymentTypeOf(payment: Pick<Payment, 'provider' | 'method'>): SifenIssueInput['paymentType'] {
  if (payment.provider !== 'manual') return 21;
  return ({ cash: 1, card: 3, transfer: 5, qr: 21 } as Record<string, SifenIssueInput['paymentType']>)[payment.method ?? ''] ?? 99;
}

/** Fecha y hora de Paraguay en el formato de SIFEN (AAAA-MM-DDTHH:MM:SS). */
function paraguayNow(now = new Date()) {
  const p = localParts(now, TZ);
  const seconds = new Intl.DateTimeFormat('en-US', { timeZone: TZ, second: '2-digit' }).format(now).padStart(2, '0');
  return `${p.day}T${p.time}:${seconds}`;
}

const formatNumber = (d: Pick<SifenDocument, 'establishment' | 'point' | 'number'>) => `${d.establishment}-${d.point}-${String(d.number).padStart(7, '0')}`;

export class Sifen {
  readonly set: SetClient;

  constructor(private readonly deps: Deps) {
    this.set = new SetClient({ baseUrl: deps.config.SIFEN_BASE_URL });
  }

  private get secret() {
    return this.deps.config.JWT_SECRET;
  }

  /* ------------------------------ Emisor ------------------------------ */

  async issuerRow(scope: string): Promise<SifenIssuer | null> {
    const [row] = await this.deps.db.select().from(sifenIssuers).where(eq(sifenIssuers.scope, scope)).limit(1);
    return row ?? null;
  }

  private async ensureIssuer(scope: string, tenantId: string | null) {
    const existing = await this.issuerRow(scope);
    if (existing) return existing;
    const [row] = await this.deps.db
      .insert(sifenIssuers)
      .values({ scope, tenantId, settings: normalizeConfig(sifenIssuerSchema, {}) })
      .onConflictDoNothing()
      .returning();
    return row ?? (await this.issuerRow(scope))!;
  }

  settingsOf(row: SifenIssuer | null): SifenIssuerSettings {
    return normalizeConfig(sifenIssuerSchema, row?.settings ?? {});
  }

  /** Qué falta para poder emitir. */
  missing(row: SifenIssuer | null): string[] {
    const s = this.settingsOf(row);
    const out: string[] = [];
    if (!s.ruc) out.push('RUC');
    if (!s.razonSocial) out.push('razón social');
    if (!s.timbrado || !s.timbradoFecha) out.push('timbrado y su fecha de inicio');
    if (!s.actividadCodigo || !s.actividadDescripcion) out.push('actividad económica');
    if (!s.direccion) out.push('dirección');
    if (!s.telefono) out.push('teléfono');
    if (!s.email) out.push('correo');
    if (!row?.certEnc) out.push('certificado digital (.p12)');
    else if (row.certInfo && new Date(row.certInfo.validTo) < new Date()) out.push('certificado vigente (el cargado venció)');
    if (!row?.cscEnc) out.push('código de seguridad (CSC)');
    return out;
  }

  async issuerDTO(scope: string): Promise<SifenIssuerDTO> {
    const row = await this.issuerRow(scope);
    return { ...this.settingsOf(row), certificate: row?.certInfo ?? null, hasCsc: Boolean(row?.cscEnc), nextNumber: row?.nextNumber ?? 1, missing: this.missing(row) };
  }

  async saveIssuer(scope: string, tenantId: string | null, patch: Partial<SifenIssuerSettings> & { nextNumber?: number }) {
    const row = await this.ensureIssuer(scope, tenantId);
    const { nextNumber, ...settingsPatch } = patch;
    const settings = normalizeConfig(sifenIssuerSchema, deepMerge(this.settingsOf(row), settingsPatch));
    if (nextNumber !== undefined) {
      // No se puede volver a un número ya usado.
      const [last] = await this.deps.db
        .select({ max: sql<number>`coalesce(max(${sifenDocuments.number}), 0)::int` })
        .from(sifenDocuments)
        .where(and(eq(sifenDocuments.scope, scope), eq(sifenDocuments.establishment, settings.establecimiento), eq(sifenDocuments.point, settings.punto)));
      if (nextNumber <= (last?.max ?? 0)) throw badRequest(`El próximo número debe ser mayor que ${last?.max ?? 0} (ya emitido)`);
    }
    await this.deps.db
      .update(sifenIssuers)
      .set({ settings, ...(nextNumber !== undefined ? { nextNumber } : {}), updatedAt: new Date() })
      .where(eq(sifenIssuers.id, row.id));
    return this.issuerDTO(scope);
  }

  async setCertificate(scope: string, tenantId: string | null, p12: Buffer, password: string) {
    let cert: Certificate;
    try {
      cert = openP12(p12, password);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Certificado inválido');
    }
    if (cert.validTo < new Date()) throw badRequest(`El certificado venció el ${cert.validTo.toISOString().slice(0, 10)}`);
    const row = await this.ensureIssuer(scope, tenantId);
    await this.deps.db
      .update(sifenIssuers)
      .set({
        certEnc: encryptSecret(this.secret, p12.toString('base64'), 'sifen'),
        certPasswordEnc: encryptSecret(this.secret, password, 'sifen'),
        certInfo: { subject: cert.subject, validFrom: cert.validFrom.toISOString(), validTo: cert.validTo.toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(sifenIssuers.id, row.id));
    return this.issuerDTO(scope);
  }

  async removeCertificate(scope: string) {
    await this.deps.db.update(sifenIssuers).set({ certEnc: '', certPasswordEnc: '', certInfo: null, updatedAt: new Date() }).where(eq(sifenIssuers.scope, scope));
    return this.issuerDTO(scope);
  }

  async setCsc(scope: string, tenantId: string | null, csc: string | null) {
    const row = await this.ensureIssuer(scope, tenantId);
    await this.deps.db
      .update(sifenIssuers)
      .set({ cscEnc: csc ? encryptSecret(this.secret, csc, 'sifen') : '', updatedAt: new Date() })
      .where(eq(sifenIssuers.id, row.id));
    return this.issuerDTO(scope);
  }

  private certificate(row: SifenIssuer): Certificate {
    const p12 = decryptSecret(this.secret, row.certEnc, 'sifen');
    const password = decryptSecret(this.secret, row.certPasswordEnc, 'sifen');
    if (!p12 || password === null) throw badRequest('No se pudo leer el certificado: vuelva a cargarlo');
    return openP12(Buffer.from(p12, 'base64'), password);
  }

  private csc(row: SifenIssuer) {
    const csc = row.cscEnc ? decryptSecret(this.secret, row.cscEnc, 'sifen') : null;
    if (!csc) throw badRequest('Falta el código de seguridad (CSC)');
    return csc;
  }

  /* ----------------------------- Emisión ------------------------------ */

  private validate(input: SifenIssueInput) {
    const r = input.receiver;
    if (r.kind === 'ruc' && !/^\d{1,8}-\d$/.test(r.document)) throw badRequest('RUC del cliente inválido (ej.: 80012345-6)');
    if ((r.kind === 'ci' || r.kind === 'passport') && !r.document) throw badRequest('Indique el documento del cliente');
    if (r.kind !== 'none' && r.name.length < 4) throw badRequest('Indique el nombre o la razón social del cliente (al menos 4 letras)');
    if (input.currency === 'USD' && !input.exchangeRate) throw badRequest('Indique el tipo de cambio');
    if (!(input.paymentType in SIFEN_PAYMENT_TYPES)) throw badRequest('Forma de pago inválida');
  }

  /** XML firmado con QR y totales, para un número dado. */
  private async build(row: SifenIssuer, input: SifenIssueInput, number: number) {
    const settings = this.settingsOf(row);
    const cert = this.certificate(row);
    const localDate = paraguayNow();
    let built: Awaited<ReturnType<typeof buildDeXml>>;
    try {
      built = await buildDeXml(settings, { ...input, number, securityCode: String(randomInt(1, 999_999_999)).padStart(9, '0'), localDate });
    } catch (error) {
      // Validaciones del manual técnico (largos, campos obligatorios…).
      throw badRequest(`Datos inválidos para SIFEN: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { xml, cdc } = built;
    const signed = signXml(xml, 'DE', cert);
    const url = qrUrl(signed, settings.environment, settings.cscId, this.csc(row));
    const num = (tag: string) => {
      const v = readTag(signed, tag);
      return v === null ? null : Number(v);
    };
    const computed = sifenTotals(input.items, input.currency);
    const totals: SifenTotals = {
      subtotalExento: num('dSubExe') ?? computed.subtotalExento,
      subtotal5: num('dSub5') ?? computed.subtotal5,
      subtotal10: num('dSub10') ?? computed.subtotal10,
      iva5: num('dIVA5') ?? computed.iva5,
      iva10: num('dIVA10') ?? computed.iva10,
      totalIva: num('dTotIVA') ?? computed.totalIva,
      total: num('dTotGralOpe') ?? computed.total,
    };
    const { ciudades } = await geography();
    const issuer: SifenKudeDTO['issuer'] = {
      ruc: settings.ruc,
      razonSocial: settings.razonSocial,
      nombreFantasia: settings.nombreFantasia,
      direccion: settings.direccion,
      numeroCasa: settings.numeroCasa,
      telefono: settings.telefono,
      email: settings.email,
      actividadDescripcion: settings.actividadDescripcion,
      timbrado: settings.timbrado,
      timbradoFecha: settings.timbradoFecha,
      ciudad: ciudades.find((c) => c.codigo === settings.ciudad)?.descripcion ?? '',
      logoUrl: null,
    };
    return { xml: withQr(signed, url), cdc, qrUrl: url, totals, issuer, issuedAt: new Date(), cert, settings };
  }

  async issue(scope: string, tenantId: string | null, input: SifenIssueInput, userId: string | null, logoUrl: string | null = null) {
    this.validate(input);
    const row = await this.issuerRow(scope);
    const settings = this.settingsOf(row);
    if (!row || !settings.enabled) throw badRequest('La factura electrónica no está habilitada');
    const missing = this.missing(row);
    if (missing.length) throw badRequest(`Para emitir falta: ${missing.join(', ')}`);

    // Se reserva el número (atómico): dos emisiones a la vez nunca comparten número.
    const [reserved] = await this.deps.db
      .update(sifenIssuers)
      .set({ nextNumber: sql`${sifenIssuers.nextNumber} + 1` })
      .where(eq(sifenIssuers.id, row.id))
      .returning({ number: sql<number>`${sifenIssuers.nextNumber} - 1` });
    const number = Number(reserved!.number);
    if (number > 9_999_999) throw badRequest('Se agotó la numeración del punto de expedición: use otro punto o timbrado');

    let built: Awaited<ReturnType<Sifen['build']>>;
    try {
      built = await this.build(row, input, number);
    } catch (error) {
      // Datos inválidos: se devuelve el número si nadie emitió otro mientras tanto (no quedan huecos).
      await this.deps.db
        .update(sifenIssuers)
        .set({ nextNumber: number })
        .where(and(eq(sifenIssuers.id, row.id), eq(sifenIssuers.nextNumber, number + 1)));
      throw error;
    }
    const [doc] = await this.deps.db
      .insert(sifenDocuments)
      .values({
        scope,
        tenantId,
        cdc: built.cdc,
        establishment: settings.establecimiento,
        point: settings.punto,
        number,
        environment: settings.environment,
        issuedAt: built.issuedAt,
        receiver: input.receiver,
        items: input.items,
        currency: input.currency,
        exchangeRate: input.exchangeRate ?? null,
        condition: input.condition,
        paymentType: input.paymentType,
        creditDays: input.creditDays ?? null,
        notes: input.notes,
        totals: built.totals,
        xml: built.xml,
        qrUrl: built.qrUrl,
        issuer: { ...built.issuer, logoUrl },
        sourceType: input.source.type,
        sourceId: input.source.id ?? null,
        publicToken: randomToken(20),
        createdBy: userId,
      })
      .returning();
    return this.send(doc!, built.cert);
  }

  /** Envía a la SET y guarda la respuesta. Un error de conexión deja la factura «Sin enviar» para reintentar. */
  async send(doc: SifenDocument, cert?: Certificate): Promise<SifenDocument> {
    const row = await this.issuerRow(doc.scope);
    if (!row) throw notFound('Emisor');
    let result: SetResult | null = null;
    let error: string | null = null;
    try {
      result = await this.set.send(doc.environment, Date.now() % 1e12, doc.xml, cert ?? this.certificate(row));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Error al enviar';
    }
    const approved = result?.status?.toLowerCase().startsWith('aprobado') ?? false;
    const rejected = result?.status?.toLowerCase().startsWith('rechazado') ?? false;
    const status = approved ? 'approved' : rejected ? 'rejected' : 'error';
    const [updated] = await this.deps.db
      .update(sifenDocuments)
      .set({
        status,
        setCode: result?.code ?? null,
        setMessage: (result ? (result.message ?? result.status) : error)?.slice(0, 1000) ?? null,
        setProtocol: result?.protocol ?? null,
        sentAt: new Date(),
        ...(approved ? { approvedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(sifenDocuments.id, doc.id))
      .returning();
    if (approved) void this.mailReceiver(updated!);
    else this.deps.log.warn({ cdc: doc.cdc, code: result?.code, message: result?.message ?? error }, 'sifen: el documento no se aprobó');
    return updated!;
  }

  /** Reintento: si la SET la rechazó se vuelve a generar con el mismo número (CDC nuevo); si no llegó, se reenvía. */
  async retry(doc: SifenDocument) {
    if (doc.status === 'approved' || doc.status === 'cancelled') throw conflict('La factura ya fue aprobada');
    const row = await this.issuerRow(doc.scope);
    if (!row) throw notFound('Emisor');
    if (doc.status === 'rejected') {
      const input: SifenIssueInput = {
        receiver: doc.receiver,
        items: doc.items,
        currency: doc.currency,
        exchangeRate: doc.exchangeRate ?? undefined,
        condition: doc.condition,
        paymentType: doc.paymentType as SifenIssueInput['paymentType'],
        creditDays: doc.creditDays ?? undefined,
        notes: doc.notes,
        source: { type: doc.sourceType, ...(doc.sourceId ? { id: doc.sourceId } : {}) },
      };
      const built = await this.build(row, input, doc.number);
      const [updated] = await this.deps.db
        .update(sifenDocuments)
        .set({ cdc: built.cdc, xml: built.xml, qrUrl: built.qrUrl, totals: built.totals, issuedAt: built.issuedAt, status: 'pending', updatedAt: new Date() })
        .where(eq(sifenDocuments.id, doc.id))
        .returning();
      return this.send(updated!, built.cert);
    }
    return this.send(doc);
  }

  /** Consulta el estado en la SET (p. ej. si se cortó la conexión al enviar). */
  async refresh(doc: SifenDocument) {
    const row = await this.issuerRow(doc.scope);
    if (!row) throw notFound('Emisor');
    const result = await this.set.query(doc.environment, Date.now() % 1e12, doc.cdc, this.certificate(row));
    // 0422 = CDC encontrado (el documento está aprobado en la SET).
    if (result.code === '0422' && (doc.status === 'error' || doc.status === 'pending')) {
      const [updated] = await this.deps.db
        .update(sifenDocuments)
        .set({ status: 'approved', setCode: result.code, setMessage: result.message, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(sifenDocuments.id, doc.id))
        .returning();
      return { document: updated!, result };
    }
    return { document: doc, result };
  }

  /** Anulación ante la SET (evento de cancelación). */
  async cancel(doc: SifenDocument, reason: string) {
    if (doc.status !== 'approved') throw conflict('Solo se pueden anular facturas aprobadas');
    if (doc.approvedAt && Date.now() - doc.approvedAt.getTime() > CANCEL_HOURS * 3_600_000) {
      throw conflict(`Pasaron más de ${CANCEL_HOURS} horas desde la aprobación: corresponde una nota de crédito`);
    }
    const row = await this.issuerRow(doc.scope);
    if (!row) throw notFound('Emisor');
    const cert = this.certificate(row);
    const envelope = await buildCancelXml(this.settingsOf(row), doc.cdc, reason, Date.now() % 1e9, paraguayNow());
    const result = await this.set.event(doc.environment, signXml(envelope, 'rEve', cert), cert);
    if (!result.status?.toLowerCase().startsWith('aprobado')) {
      throw new AppError(409, 'sifen_rejected', `La SET no aceptó la anulación: ${result.message ?? result.status ?? 'sin respuesta'}${result.code ? ` (${result.code})` : ''}`);
    }
    const [updated] = await this.deps.db
      .update(sifenDocuments)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, setCode: result.code, setMessage: result.message, updatedAt: new Date() })
      .where(eq(sifenDocuments.id, doc.id))
      .returning();
    return updated!;
  }

  /* --------------------------- Consultas --------------------------- */

  async get(scope: string, id: string) {
    const [doc] = await this.deps.db.select().from(sifenDocuments).where(and(eq(sifenDocuments.scope, scope), eq(sifenDocuments.id, id))).limit(1);
    if (!doc) throw notFound('Factura');
    return doc;
  }

  async list(scope: string, filter: { from?: Date; to?: Date; status?: SifenDocument['status']; q?: string; sourceType?: SifenDocument['sourceType']; sourceId?: string }, limit = 200) {
    const q = filter.q?.trim();
    const where: (SQL | undefined)[] = [
      eq(sifenDocuments.scope, scope),
      filter.from ? gte(sifenDocuments.createdAt, filter.from) : undefined,
      filter.to ? lt(sifenDocuments.createdAt, filter.to) : undefined,
      filter.status ? eq(sifenDocuments.status, filter.status) : undefined,
      filter.sourceType ? eq(sifenDocuments.sourceType, filter.sourceType) : undefined,
      filter.sourceId ? eq(sifenDocuments.sourceId, filter.sourceId) : undefined,
      q
        ? sql`(${sifenDocuments.cdc} = ${q.replace(/\s/g, '')} OR ${sifenDocuments.receiver}->>'name' ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`} OR ${sifenDocuments.receiver}->>'document' = ${q} OR (${sifenDocuments.establishment} || '-' || ${sifenDocuments.point} || '-' || lpad(${sifenDocuments.number}::text, 7, '0')) = ${q})`
        : undefined,
    ];
    const rows = await this.deps.db
      .select()
      .from(sifenDocuments)
      .where(and(...where))
      .orderBy(desc(sifenDocuments.createdAt))
      .limit(limit);
    return rows.map((d) => this.toDTO(d));
  }

  kudeUrl(doc: Pick<SifenDocument, 'publicToken'>) {
    return `${this.deps.config.PUBLIC_URL.replace(/\/$/, '')}/factura/${doc.publicToken}`;
  }

  toDTO(d: SifenDocument): SifenDocumentDTO {
    return {
      id: d.id,
      cdc: d.cdc,
      number: formatNumber(d),
      status: d.status,
      environment: d.environment,
      issuedAt: d.issuedAt.toISOString(),
      receiver: d.receiver,
      items: d.items,
      currency: d.currency,
      totals: d.totals,
      condition: d.condition,
      setCode: d.setCode,
      setMessage: d.setMessage,
      source: { type: d.sourceType, ...(d.sourceId ? { id: d.sourceId } : {}) },
      kudeUrl: this.kudeUrl(d),
      sentAt: d.sentAt?.toISOString() ?? null,
      cancelledAt: d.cancelledAt?.toISOString() ?? null,
      cancelReason: d.cancelReason,
      canCancel: d.status === 'approved' && (!d.approvedAt || Date.now() - d.approvedAt.getTime() <= CANCEL_HOURS * 3_600_000),
      createdAt: d.createdAt.toISOString(),
    };
  }

  kude(d: SifenDocument): SifenKudeDTO {
    const decimals = d.currency === 'PYG' ? 0 : 2;
    return {
      issuer: d.issuer,
      type: 'Factura electrónica',
      number: formatNumber(d),
      cdc: d.cdc,
      status: d.status,
      environment: d.environment,
      issuedAt: d.issuedAt.toISOString(),
      condition: d.condition === 'credit' ? `Crédito${d.creditDays ? ` (${d.creditDays} días)` : ''}` : `Contado · ${SIFEN_PAYMENT_TYPES[d.paymentType as keyof typeof SIFEN_PAYMENT_TYPES] ?? 'Otro'}`,
      currency: d.currency,
      exchangeRate: d.exchangeRate,
      receiver: d.receiver,
      items: d.items.map((i) => ({ ...i, total: Math.round(i.quantity * i.unitPrice * 10 ** decimals) / 10 ** decimals })),
      totals: d.totals,
      qrUrl: d.qrUrl,
      notes: d.notes,
    };
  }

  /**
   * Emisión automática al cobrar un turno (si la organización la activó): al cliente del turno
   * (RUC o cédula) o, sin datos, como consumidor final.
   */
  async autoIssueForPayment(payment: Payment) {
    if (!payment.ticketId || payment.currency !== 'PYG') return null;
    const [tenant] = await this.deps.db.select().from(tenants).where(eq(tenants.id, payment.tenantId));
    if (!tenant || !(await this.deps.modulesOf(tenant)).includes('invoicing')) return null;
    const row = await this.issuerRow(tenant.id);
    const settings = this.settingsOf(row);
    if (!row || !settings.enabled || !settings.autoIssue || this.missing(row).length) return null;
    const [existing] = await this.deps.db
      .select({ id: sifenDocuments.id })
      .from(sifenDocuments)
      .where(and(eq(sifenDocuments.scope, tenant.id), eq(sifenDocuments.sourceType, 'payment'), eq(sifenDocuments.sourceId, payment.id)))
      .limit(1);
    if (existing) return null;
    const [ticket] = await this.deps.db.select({ customer: tickets.customer }).from(tickets).where(eq(tickets.id, payment.ticketId));
    const name = String(ticket?.customer?.name ?? '').trim();
    const document = String(ticket?.customer?.document ?? '').replace(/[.\s]/g, '');
    const email = String(ticket?.customer?.email ?? '');
    const receiver: SifenIssueInput['receiver'] =
      document && name.length >= 4
        ? { kind: /^\d{1,8}-\d$/.test(document) ? 'ruc' : 'ci', document, name, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '', phone: '', address: '' }
        : { kind: 'none', document: '', name: '', email: '', phone: '', address: '' };
    const doc = await this.issue(
      tenant.id,
      tenant.id,
      {
        receiver,
        items: [{ code: '', description: (payment.description || 'Servicio').slice(0, 120), quantity: 1, unitPrice: fromMinor(payment.amount, 'PYG'), iva: settings.defaultIva }],
        currency: 'PYG',
        condition: 'cash',
        paymentType: paymentTypeOf(payment),
        notes: '',
        source: { type: 'payment', id: payment.id },
      },
      null,
    );
    this.deps.log.info({ cdc: doc.cdc, status: doc.status, paymentId: payment.id }, 'sifen: factura emitida al cobrar');
    return doc;
  }

  /** Nombre y estado de un contribuyente en la SET. */
  async lookupRuc(row: SifenIssuer, ruc: string) {
    const result = await this.set.ruc(this.settingsOf(row).environment, Date.now() % 1e12, ruc, this.certificate(row));
    return { found: result.code === '0502', name: result.name, status: result.status, message: result.message };
  }

  async findByToken(token: string) {
    const [doc] = await this.deps.db.select().from(sifenDocuments).where(eq(sifenDocuments.publicToken, token)).limit(1);
    return doc ?? null;
  }

  /** Envía el KuDE al correo del cliente cuando la SET aprueba. */
  private async mailReceiver(doc: SifenDocument) {
    if (!doc.receiver.email) return;
    try {
      const [tenant] = doc.tenantId ? await this.deps.db.select().from(tenants).where(eq(tenants.id, doc.tenantId)) : [null];
      const brand = await this.deps.emailBrand(tenant ?? null);
      await this.deps.mailer.send(sifenMail(doc.receiver.email, doc.receiver.name, { issuer: doc.issuer.razonSocial, number: formatNumber(doc), cdc: doc.cdc }, this.kudeUrl(doc), brand), { tenantId: doc.tenantId });
    } catch (error) {
      this.deps.log.warn({ err: error, cdc: doc.cdc }, 'sifen: no se pudo enviar la factura por correo');
    }
  }
}
