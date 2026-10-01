import http from 'node:http';
import https from 'node:https';
import { DOMParser } from '@xmldom/xmldom';
import type { SifenEnvironment } from '@gc/shared';
import type { Certificate } from './sign';
import { compactXml } from './xml';

/*
 * Servicios web de la SET (SOAP 1.2 con certificado de cliente). Producción: sifen.set.gov.py;
 * pruebas: sifen-test.set.gov.py. En las pruebas automáticas se usa un simulador (SIFEN_BASE_URL).
 */

const HOSTS: Record<SifenEnvironment, string> = { test: 'https://sifen-test.set.gov.py', prod: 'https://sifen.set.gov.py' };
const PATHS = {
  recibe: '/de/ws/sync/recibe.wsdl',
  consulta: '/de/ws/consultas/consulta.wsdl',
  evento: '/de/ws/eventos/evento.wsdl',
  ruc: '/de/ws/consultas/consulta-ruc.wsdl',
} as const;

const NS = 'http://ekuatia.set.gov.py/sifen/xsd';

export interface SetResult {
  /** Aprobado, Aprobado con observación, Rechazado… */
  status: string | null;
  code: string | null;
  message: string | null;
  protocol: string | null;
  raw: string;
}

const envelope = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>${body}</env:Body></env:Envelope>`;

/** Primer texto de un elemento por su nombre local (la SET responde con prefijos ns2:). */
function first(doc: Document, name: string): string | null {
  const el = doc.getElementsByTagNameNS('*', name)[0];
  return el?.textContent?.trim() ?? null;
}

export function parseSetResponse(raw: string): SetResult {
  if (!raw.trimStart().startsWith('<')) throw new Error(`Respuesta inesperada de la SET: ${raw.slice(0, 200)}`);
  if (/^\s*<html/i.test(raw)) throw new Error('La SET devolvió una página en lugar del servicio (¿certificado no aceptado?)');
  const doc = new DOMParser().parseFromString(raw, 'text/xml') as unknown as Document;
  return {
    status: first(doc, 'dEstRes'),
    code: first(doc, 'dCodRes'),
    message: first(doc, 'dMsgRes'),
    protocol: first(doc, 'dProtAut') ?? first(doc, 'dProtConsLote'),
    raw: raw.slice(0, 20_000),
  };
}

export class SetClient {
  constructor(private readonly options: { baseUrl?: string; timeoutMs?: number } = {}) {}

  private post(env: SifenEnvironment, path: string, body: string, cert: Certificate): Promise<string> {
    const base = this.options.baseUrl ?? HOSTS[env];
    const url = new URL(path, base);
    const lib = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/xml; charset=utf-8', 'content-length': Buffer.byteLength(body), 'user-agent': 'gestion-colas' },
          // TLS mutuo: la SET identifica al emisor por su certificado.
          ...(url.protocol === 'https:' ? { key: cert.keyPem, cert: cert.certPem } : {}),
          timeout: this.options.timeoutMs ?? 60_000,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
            if (data.length > 5_000_000) req.destroy(new Error('Respuesta demasiado grande'));
          });
          res.on('end', () => resolve(data));
        },
      );
      req.on('timeout', () => req.destroy(new Error('La SET no respondió a tiempo')));
      req.on('error', (error) => reject(new Error(`No se pudo conectar con la SET: ${error.message}`)));
      req.end(body);
    });
  }

  /** Envío sincrónico de un DE firmado (siRecepDE): la respuesta ya dice si se aprobó. */
  async send(env: SifenEnvironment, id: number, signedXml: string, cert: Certificate): Promise<SetResult> {
    const de = compactXml(signedXml).replace(/^<\?xml[^>]*\?>/, '');
    return parseSetResponse(await this.post(env, PATHS.recibe, envelope(`<rEnviDe xmlns="${NS}"><dId>${id}</dId><xDE>${de}</xDE></rEnviDe>`), cert));
  }

  /** Consulta un DE por su CDC (siConsDE). */
  async query(env: SifenEnvironment, id: number, cdc: string, cert: Certificate): Promise<SetResult> {
    return parseSetResponse(await this.post(env, PATHS.consulta, envelope(`<rEnviConsDeRequest xmlns="${NS}"><dId>${id}</dId><dCDC>${cdc}</dCDC></rEnviConsDeRequest>`), cert));
  }

  /** Envía un evento ya firmado (el sobre SOAP lo arma el generador). */
  async event(env: SifenEnvironment, signedEnvelope: string, cert: Certificate): Promise<SetResult> {
    return parseSetResponse(await this.post(env, PATHS.evento, compactXml(signedEnvelope), cert));
  }

  /** Consulta un RUC (siConsRUC): nombre y estado del contribuyente. */
  async ruc(env: SifenEnvironment, id: number, ruc: string, cert: Certificate) {
    const raw = await this.post(env, PATHS.ruc, envelope(`<rEnviConsRUC xmlns="${NS}"><dId>${id}</dId><dRUCCons>${ruc.split('-')[0]}</dRUCCons></rEnviConsRUC>`), cert);
    const doc = new DOMParser().parseFromString(raw, 'text/xml') as unknown as Document;
    return { code: first(doc, 'dCodRes'), message: first(doc, 'dMsgRes'), name: first(doc, 'dRazCons'), status: first(doc, 'dDesEstCons') };
  }
}
