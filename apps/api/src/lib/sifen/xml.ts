import * as xmlgenModule from 'facturacionelectronicapy-xmlgen';
import type { SifenIssueInput, SifenIssuerSettings, SifenReceiver } from '@gc/shared';

/* Generación del XML del Documento Electrónico (Manual Técnico SIFEN v150) con facturacionelectronicapy-xmlgen (MIT). */

type XmlGen = {
  generateXMLDE(params: unknown, data: unknown, config?: unknown): Promise<string>;
  generateXMLEventoCancelacion(id: number, params: unknown, data: unknown, config?: unknown): Promise<string>;
  consultarDepartamentos(): Promise<{ codigo: number; descripcion: string }[]>;
  consultarDistritos(departamento: number | null): Promise<{ codigo: number; descripcion: string; departamento: number }[]>;
  consultarCiudades(distrito: number | null): Promise<{ codigo: number; descripcion: string; distrito: number }[]>;
};
// Paquete CommonJS con `exports.default`: según quién lo cargue llega anidado o no.
const mod = xmlgenModule as unknown as { default?: XmlGen & { default?: XmlGen } } & XmlGen;
export const xmlgen: XmlGen = mod.default?.default ?? mod.default ?? mod;

export async function geography() {
  const [departamentos, distritos, ciudades] = await Promise.all([xmlgen.consultarDepartamentos(), xmlgen.consultarDistritos(null), xmlgen.consultarCiudades(null)]);
  return { departamentos, distritos, ciudades };
}

async function placeNames(s: SifenIssuerSettings) {
  const { departamentos, distritos, ciudades } = await geography();
  return {
    departamento: departamentos.find((d) => d.codigo === s.departamento)?.descripcion ?? '',
    distrito: distritos.find((d) => d.codigo === s.distrito)?.descripcion ?? '',
    ciudad: ciudades.find((c) => c.codigo === s.ciudad)?.descripcion ?? '',
  };
}

/** Datos fijos del emisor en el formato de la librería. */
export async function issuerParams(s: SifenIssuerSettings) {
  const names = await placeNames(s);
  return {
    version: 150,
    ruc: s.ruc,
    razonSocial: s.environment === 'test' ? 'DE generado en ambiente de prueba - sin valor comercial ni fiscal' : s.razonSocial,
    nombreFantasia: s.nombreFantasia || s.razonSocial,
    actividadesEconomicas: [{ codigo: s.actividadCodigo, descripcion: s.actividadDescripcion }],
    timbradoNumero: s.timbrado,
    timbradoFecha: s.timbradoFecha,
    tipoContribuyente: s.tipoContribuyente,
    ...(s.tipoRegimen ? { tipoRegimen: s.tipoRegimen } : {}),
    establecimientos: [
      {
        codigo: s.establecimiento,
        direccion: s.direccion,
        numeroCasa: s.numeroCasa || '0',
        departamento: s.departamento,
        departamentoDescripcion: names.departamento,
        distrito: s.distrito,
        distritoDescripcion: names.distrito,
        ciudad: s.ciudad,
        ciudadDescripcion: names.ciudad,
        telefono: s.telefono,
        email: s.email,
        denominacion: s.denominacion || s.nombreFantasia || s.razonSocial,
      },
    ],
  };
}

/** Receptor según el tipo: contribuyente (B2B), persona (B2C) o sin nombre. */
function cliente(r: SifenReceiver) {
  // La dirección del cliente es opcional en SIFEN y exigiría departamento, distrito y ciudad: solo va en el KuDE.
  const base = { pais: 'PRY', paisDescripcion: 'Paraguay', ...(r.email ? { email: r.email } : {}), ...(r.phone ? { celular: r.phone } : {}) };
  if (r.kind === 'ruc') {
    const [num = ''] = r.document.split('-');
    // RUC de personas jurídicas: 80.000.000 en adelante.
    return { ...base, contribuyente: true, ruc: r.document, razonSocial: r.name, tipoOperacion: 1, tipoContribuyente: Number(num) >= 80_000_000 ? 2 : 1 };
  }
  if (r.kind === 'none') return { ...base, contribuyente: false, razonSocial: 'Sin Nombre', tipoOperacion: 2, documentoTipo: 5, documentoNumero: '0' };
  return { ...base, contribuyente: false, razonSocial: r.name, tipoOperacion: 2, documentoTipo: r.kind === 'ci' ? 1 : 2, documentoNumero: r.document };
}

export interface DeInput extends SifenIssueInput {
  number: number;
  /** Código de seguridad aleatorio (9 dígitos). */
  securityCode: string;
  /** Fecha y hora de emisión en Paraguay (AAAA-MM-DDTHH:MM:SS). */
  localDate: string;
}

/** Arma el XML del DE (sin firmar) y devuelve también el CDC. */
export async function buildDeXml(s: SifenIssuerSettings, input: DeInput) {
  const total = input.items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
  const data = {
    tipoDocumento: 1,
    establecimiento: s.establecimiento,
    punto: s.punto,
    numero: String(input.number).padStart(7, '0'),
    codigoSeguridadAleatorio: input.securityCode,
    ...(input.notes ? { observacion: input.notes } : {}),
    fecha: input.localDate,
    fechaFirmaDigital: input.localDate,
    tipoEmision: 1,
    // 2 = prestación de servicios.
    tipoTransaccion: 2,
    tipoImpuesto: 1,
    moneda: input.currency,
    ...(input.currency !== 'PYG' ? { condicionTipoCambio: 1, cambio: input.exchangeRate ?? 1 } : {}),
    cliente: cliente(input.receiver),
    factura: { presencia: 1 },
    condicion:
      input.condition === 'credit'
        ? { tipo: 2, credito: { tipo: 1, plazo: `${input.creditDays ?? 30} días` } }
        : {
            tipo: 1,
            entregas: [
              {
                tipo: input.paymentType,
                monto: String(total),
                moneda: input.currency,
                ...(input.currency !== 'PYG' ? { cambio: input.exchangeRate ?? 1 } : {}),
                // Tarjetas: SIFEN pide la marca y cómo se procesó (POS).
                ...(input.paymentType === 3 || input.paymentType === 4 ? { infoTarjeta: { tipo: 99, tipoDescripcion: 'Otra', medioPago: 1 } } : {}),
                ...(input.paymentType === 2 ? { infoCheque: { numeroCheque: '0', banco: 'No informado' } } : {}),
              },
            ],
          },
    items: input.items.map((i, n) => ({
      codigo: i.code || String(n + 1),
      descripcion: i.description,
      unidadMedida: 77,
      cantidad: i.quantity,
      precioUnitario: i.unitPrice,
      ...(input.currency !== 'PYG' ? { cambio: input.exchangeRate ?? 1 } : {}),
      // 1 = gravado IVA, 3 = exento.
      ivaTipo: i.iva === 0 ? 3 : 1,
      ivaProporcion: i.iva === 0 ? 0 : 100,
      iva: i.iva,
    })),
  };
  const xml = await xmlgen.generateXMLDE(await issuerParams(s), data, { test: false });
  const cdc = /<DE Id="(\d{44})"/.exec(xml)?.[1];
  if (!cdc) throw new Error('No se pudo generar el CDC del documento');
  return { xml, cdc };
}

/** Evento de cancelación (anulación) de un DE aprobado. Devuelve el sobre SOAP sin firmar. */
export async function buildCancelXml(s: SifenIssuerSettings, cdc: string, reason: string, eventId: number, localDate: string) {
  const xml = await xmlgen.generateXMLEventoCancelacion(eventId, await issuerParams(s), { cdc, motivo: reason, fechaFirmaDigital: localDate });
  return compactXml(xml);
}

/** Quita los saltos de línea y la sangría entre etiquetas (la SET los rechaza dentro del sobre). */
export function compactXml(xml: string) {
  return xml.replace(/>\s+</g, '><').replace(/\r?\n/g, '').trim();
}

/** Valores del XML (totales) para guardar exactamente lo que se envió. */
export function readTag(xml: string, tag: string): string | null {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;
}
