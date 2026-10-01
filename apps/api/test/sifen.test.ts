import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyXml } from '../src/lib/sifen/sign';
import { api, createTestApp, registerTenant, type TenantSession } from './helpers';

const ROOT = { email: 'root@plataforma.test', password: 'rootClave123' };
const CSC = 'ABCD0000000000000000000000000000';

let app: FastifyInstance;
let root: { headers: Record<string, string> };
let org: TenantSession;
let server: http.Server;
let certPem = '';
let p12Base64 = '';
const received: { path: string; body: string }[] = [];
let mode: 'approve' | 'reject' | 'down' = 'approve';

/** Certificado de prueba autofirmado en PKCS#12 (como los que emiten las certificadoras). */
function testCertificate(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'CLINICA DE PRUEBA S.A.' }, { name: 'serialNumber', value: 'RUC80012345-6' }, { shortName: 'C', value: 'PY' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })).getBytes();
  return { p12: Buffer.from(der, 'binary').toString('base64'), certPem: forge.pki.certificateToPem(cert) };
}

const soap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>${body}</env:Body></env:Envelope>`;

/** Simulador de los servicios web de la SET. */
function fakeSet(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ path: req.url ?? '', body });
    if (mode === 'down') return req.socket.destroy();
    res.setHeader('content-type', 'application/soap+xml');
    if (req.url?.includes('/sync/recibe')) {
      const cdc = /<DE Id="(\d{44})"/.exec(body)?.[1] ?? '';
      const ok = mode === 'approve';
      return res.end(
        soap(
          `<ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe><ns2:Id>${cdc}</ns2:Id><ns2:dEstRes>${ok ? 'Aprobado' : 'Rechazado'}</ns2:dEstRes><ns2:dProtAut>${ok ? '123456789' : ''}</ns2:dProtAut><ns2:gResProc><ns2:dCodRes>${ok ? '0260' : '1001'}</ns2:dCodRes><ns2:dMsgRes>${ok ? 'Autorización del DE satisfactoria' : 'CDC duplicado'}</ns2:dMsgRes></ns2:gResProc></ns2:rProtDe></ns2:rRetEnviDe>`,
        ),
      );
    }
    if (req.url?.includes('/eventos/evento')) {
      return res.end(soap(`<ns2:rRetEnviEventoDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:gResProcEVe><ns2:dEstRes>Aprobado</ns2:dEstRes><ns2:gResProc><ns2:dCodRes>0600</ns2:dCodRes><ns2:dMsgRes>Evento registrado correctamente</ns2:dMsgRes></ns2:gResProc></ns2:gResProcEVe></ns2:rRetEnviEventoDe>`));
    }
    if (req.url?.includes('/consultas/consulta-ruc')) {
      return res.end(soap(`<ns2:rResEnviConsRUC xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:dCodRes>0502</ns2:dCodRes><ns2:dMsgRes>RUC encontrado</ns2:dMsgRes><ns2:xContRUC><ns2:dRazCons>EMPRESA CLIENTE S.A.</ns2:dRazCons><ns2:dDesEstCons>ACTIVO</ns2:dDesEstCons></ns2:xContRUC></ns2:rResEnviConsRUC>`));
    }
    if (req.url?.includes('/consultas/consulta')) {
      return res.end(soap(`<ns2:rEnviConsDeResponse xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:dCodRes>0422</ns2:dCodRes><ns2:dMsgRes>CDC encontrado</ns2:dMsgRes></ns2:rEnviConsDeResponse>`));
    }
    res.statusCode = 404;
    res.end('no');
  });
}

const issuer = {
  enabled: true,
  environment: 'test',
  ruc: '80012345-6',
  razonSocial: 'Clínica de Prueba S.A.',
  nombreFantasia: 'Clínica Prueba',
  tipoContribuyente: 2,
  actividadCodigo: '86100',
  actividadDescripcion: 'Actividades de hospitales',
  timbrado: '12345678',
  timbradoFecha: '2026-01-01',
  direccion: 'Avda. España',
  numeroCasa: '1234',
  departamento: 1,
  distrito: 1,
  ciudad: 1,
  telefono: '021-123456',
  email: 'facturas@clinica.test',
};

const invoice = (name = 'María López') => ({
  receiver: { kind: 'ci', document: '1234567', name, email: 'maria@cliente.test' },
  items: [
    { description: 'Consulta médica', quantity: 1, unitPrice: 150000, iva: 10 },
    { description: 'Certificado', quantity: 2, unitPrice: 25000, iva: 0 },
  ],
  condition: 'cash',
  paymentType: 1,
});

beforeAll(async () => {
  server = http.createServer(fakeSet);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  app = await createTestApp({ SUPERADMIN_EMAIL: ROOT.email, SUPERADMIN_PASSWORD: ROOT.password, SIFEN_BASE_URL: `http://127.0.0.1:${port}` });
  const login = await api(app, null, 'POST', '/auth/login', ROOT);
  root = { headers: { authorization: `Bearer ${login.body.token}` } };
  org = await registerTenant(app, 'Clínica SIFEN');
  const cert = testCertificate('clave-p12');
  certPem = cert.certPem;
  p12Base64 = cert.p12;
});

afterAll(async () => {
  await app.close();
  server.close();
});

describe('factura electrónica SIFEN', () => {
  it('requiere el módulo y avisa qué falta configurar', async () => {
    expect((await api(app, org, 'GET', '/invoicing/issuer')).status).toBe(403);
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { invoicing: true } });
    const empty = await api(app, org, 'GET', '/invoicing/issuer');
    expect(empty.status).toBe(200);
    expect(empty.body.missing).toEqual(expect.arrayContaining(['RUC', 'certificado digital (.p12)', 'código de seguridad (CSC)']));
    expect((await api(app, org, 'POST', '/invoicing/documents', invoice())).status).toBe(400);
  });

  it('guarda el emisor, el certificado (cifrado) y el CSC', async () => {
    expect((await api(app, org, 'PUT', '/invoicing/issuer', issuer)).status).toBe(200);
    const wrong = await api(app, org, 'POST', '/invoicing/issuer/certificate', { p12: p12Base64, password: 'otra' });
    expect(wrong.status).toBe(400);
    const cert = await api(app, org, 'POST', '/invoicing/issuer/certificate', { p12: p12Base64, password: 'clave-p12' });
    expect(cert.status).toBe(200);
    expect(cert.body.certificate.subject).toContain('CLINICA DE PRUEBA S.A.');
    const csc = await api(app, org, 'PUT', '/invoicing/issuer/csc', { csc: CSC });
    expect(csc.body).toMatchObject({ hasCsc: true, missing: [] });
    // Nunca se devuelven ni el certificado ni la clave ni el CSC.
    expect(JSON.stringify(csc.body)).not.toContain(CSC);
    expect(JSON.stringify(csc.body)).not.toContain('clave-p12');
  });

  it('emite, firma, arma el QR y la SET la aprueba', async () => {
    received.length = 0;
    const res = await api(app, org, 'POST', '/invoicing/documents', invoice());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'approved', number: '001-001-0000001', setCode: '0260', environment: 'test' });
    expect(res.body.cdc).toMatch(/^01800123456001001000000122\d{18}$/);
    expect(res.body.totals).toMatchObject({ total: 200000, iva10: 13636, subtotalExento: 50000 });

    const sent = received.find((r) => r.path.includes('/sync/recibe'))!.body;
    expect(sent).toContain('<rEnviDe xmlns="http://ekuatia.set.gov.py/sifen/xsd">');
    const de = /<xDE>([\s\S]*)<\/xDE>/.exec(sent)![1]!;
    expect(verifyXml(de, certPem)).toBe(true);
    expect(de).toContain('<dNomEmi>DE generado en ambiente de prueba - sin valor comercial ni fiscal</dNomEmi>');

    // QR: el hash es SHA-256 de los parámetros más el CSC.
    const qr = /<dCarQR>([^<]+)<\/dCarQR>/.exec(de)![1]!.replace(/&amp;/g, '&');
    expect(qr.startsWith('https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=')).toBe(true);
    const [params, hash] = qr.split('?')[1]!.split('&cHashQR=');
    expect(createHash('sha256').update(params! + CSC).digest('hex')).toBe(hash);
    expect(params).toContain('dNumIDRec=1234567');
    expect(params).toContain('IdCSC=0001');

    // El KuDE es público por su enlace.
    const token = res.body.kudeUrl.split('/factura/')[1];
    const kude = await api(app, null, 'GET', `/public/invoices/${token}`);
    expect(kude.status).toBe(200);
    expect(kude.body).toMatchObject({ number: '001-001-0000001', type: 'Factura electrónica', qrUrl: qr, issuer: { ruc: '80012345-6', timbrado: '12345678' } });
    expect(kude.body.items).toHaveLength(2);
    // Y se le envió al cliente por correo.
    await new Promise((r) => setTimeout(r, 50));
    expect(app.ctx.mailer.outbox().some((m) => m.tag === 'sifen_invoice' && m.to === 'maria@cliente.test')).toBe(true);

    const xml = await app.inject({ method: 'GET', url: `/api/v1/invoicing/documents/${res.body.id}/xml`, headers: org.headers });
    expect(xml.headers['content-type']).toContain('application/xml');
    expect(xml.body).toContain('<gCamFuFD>');
  });

  it('si la SET la rechaza se corrige con el mismo número; si no hay conexión queda para reenviar', async () => {
    mode = 'reject';
    const rejected = await api(app, org, 'POST', '/invoicing/documents', invoice('Juan Pérez'));
    expect(rejected.body).toMatchObject({ status: 'rejected', number: '001-001-0000002', setCode: '1001', setMessage: 'CDC duplicado' });
    // Rechazada: no tiene KuDE público.
    expect((await api(app, null, 'GET', `/public/invoices/${rejected.body.kudeUrl.split('/factura/')[1]}`)).status).toBe(404);
    mode = 'approve';
    const fixed = await api(app, org, 'POST', `/invoicing/documents/${rejected.body.id}/retry`);
    expect(fixed.body).toMatchObject({ status: 'approved', number: '001-001-0000002' });
    expect(fixed.body.cdc).not.toBe(rejected.body.cdc);

    mode = 'down';
    const offline = await api(app, org, 'POST', '/invoicing/documents', invoice('Ana Torres'));
    expect(offline.body).toMatchObject({ status: 'error', number: '001-001-0000003' });
    expect(offline.body.setMessage).toContain('No se pudo conectar con la SET');
    mode = 'approve';
    // Se consulta: la SET la tiene (se aprobó aunque la respuesta no llegó).
    const refreshed = await api(app, org, 'POST', `/invoicing/documents/${offline.body.id}/refresh`);
    expect(refreshed.body.document.status).toBe('approved');
  });

  it('anula ante la SET con el evento firmado', async () => {
    const list = await api(app, org, 'GET', '/invoicing/documents?status=approved');
    const doc = list.body.find((d: { number: string }) => d.number === '001-001-0000001');
    received.length = 0;
    expect((await api(app, org, 'POST', `/invoicing/documents/${doc.id}/cancel`, { reason: 'no' })).status).toBe(400);
    const cancelled = await api(app, org, 'POST', `/invoicing/documents/${doc.id}/cancel`, { reason: 'Error en los datos del cliente' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Error en los datos del cliente', canCancel: false });
    const event = received.find((r) => r.path.includes('/eventos/evento'))!.body;
    expect(event).toContain(`<Id>${doc.cdc}</Id>`);
    expect(verifyXml(event, certPem)).toBe(true);
    expect((await api(app, org, 'POST', `/invoicing/documents/${doc.id}/cancel`, { reason: 'Otra vez el motivo' })).status).toBe(409);
  });

  it('consulta el RUC del cliente y no deja volver a un número usado', async () => {
    const ruc = await api(app, org, 'POST', '/invoicing/ruc', { ruc: '80099999-1' });
    expect(ruc.body).toMatchObject({ found: true, name: 'EMPRESA CLIENTE S.A.', status: 'ACTIVO' });
    expect((await api(app, org, 'PUT', '/invoicing/issuer', { nextNumber: 2 })).status).toBe(400);
    expect((await api(app, org, 'PUT', '/invoicing/issuer', { nextNumber: 50 })).body.nextNumber).toBe(50);
  });

  it('factura sola al registrar el cobro de un turno (si se activa)', async () => {
    await api(app, root, 'PUT', `/platform/tenants/${org.tenantId}`, { modules: { invoicing: true, payments: true } });
    await api(app, org, 'PUT', '/invoicing/issuer', { autoIssue: true });
    const branch = (await api(app, org, 'GET', '/branches')).body[0];
    const service = (await api(app, org, 'GET', '/services')).body[0];
    await api(app, org, 'PUT', `/services/${service.id}`, { price: 80000 });
    const ticket = (await api(app, org, 'POST', '/tickets', { branchId: branch.id, serviceId: service.id, customer: { name: 'Carlos Gómez', document: '3.456.789' } })).body.ticket;
    const paid = await api(app, org, 'POST', `/tickets/${ticket.id}/charge/manual`, { method: 'card' });
    expect(paid.body.charge.status).toBe('paid');
    const payment = (await api(app, org, 'GET', '/payments')).body.items.find((p: { ticketId: string }) => p.ticketId === ticket.id);
    let docs: { receiver: { kind: string; document: string }; totals: { total: number }; status: string }[] = [];
    for (let i = 0; i < 30 && !docs.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      docs = (await api(app, org, 'GET', `/invoicing/documents?sourceType=payment&sourceId=${payment.id}`)).body;
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ status: 'approved', receiver: { kind: 'ci', document: '3456789' }, totals: { total: 80000 } });
    const sent = received.filter((r) => r.path.includes('/sync/recibe')).at(-1)!.body;
    expect(sent).toContain('<iTiPago>3</iTiPago>');
  });

  it('la plataforma tiene su propio emisor y numeración', async () => {
    expect((await api(app, org, 'GET', '/platform/invoicing/issuer')).status).toBe(403);
    await api(app, root, 'PUT', '/platform/invoicing/issuer', { ...issuer, ruc: '80055555-5', razonSocial: 'Gestión de Colas S.A.' });
    await api(app, root, 'POST', '/platform/invoicing/issuer/certificate', { p12: p12Base64, password: 'clave-p12' });
    await api(app, root, 'PUT', '/platform/invoicing/issuer/csc', { csc: CSC });
    const doc = await api(app, root, 'POST', '/platform/invoicing/documents', {
      receiver: { kind: 'ruc', document: '80012345-6', name: 'Clínica SIFEN S.A.' },
      items: [{ description: 'Plan Profesional · octubre 2026', quantity: 1, unitPrice: 350000, iva: 10 }],
      source: { type: 'manual' },
    });
    expect(doc.status).toBe(201);
    expect(doc.body).toMatchObject({ status: 'approved', number: '001-001-0000001' });
    const sent = received.filter((r) => r.path.includes('/sync/recibe')).at(-1)!.body;
    expect(sent).toContain('<dRucRec>80012345</dRucRec>');
    expect((await api(app, org, 'GET', '/invoicing/documents')).body.map((d: { id: string }) => d.id)).not.toContain(doc.body.id);
  });
});

describe('variantes del documento', () => {
  it('genera el XML para cada tipo de cliente, moneda y condición', async () => {
    const { buildDeXml } = await import('../src/lib/sifen/xml');
    const { normalizeConfig, sifenIssuerSchema } = await import('@gc/shared');
    const settings = normalizeConfig(sifenIssuerSchema, issuer);
    const base = { items: [{ code: '', description: 'Servicio', quantity: 1, unitPrice: 100000, iva: 10 as const }], notes: '', source: { type: 'manual' as const }, number: 9, securityCode: '000000123', localDate: '2026-10-05T10:30:00' };
    const variants = [
      { receiver: { kind: 'none' as const, document: '', name: '', email: '', phone: '', address: '' }, currency: 'PYG' as const, condition: 'cash' as const, paymentType: 3 as const },
      { receiver: { kind: 'passport' as const, document: 'AB123456', name: 'John Smith', email: '', phone: '', address: '' }, currency: 'USD' as const, exchangeRate: 7300, condition: 'cash' as const, paymentType: 4 as const },
      { receiver: { kind: 'ruc' as const, document: '4567890-1', name: 'Juan Gómez', email: 'juan@x.test', phone: '0981123456', address: 'Calle 1' }, currency: 'PYG' as const, condition: 'credit' as const, paymentType: 1 as const, creditDays: 30 },
      { receiver: { kind: 'ci' as const, document: '1234567', name: 'Ana Ruiz', email: '', phone: '', address: '' }, currency: 'PYG' as const, condition: 'cash' as const, paymentType: 5 as const },
    ];
    for (const v of variants) {
      const { xml, cdc } = await buildDeXml(settings, { ...base, ...v });
      expect(cdc).toHaveLength(44);
      expect(xml).toContain('<dFeEmiDE>2026-10-05T10:30:00</dFeEmiDE>');
      expect(xml).toContain('<dFecFirma>2026-10-05T10:30:00</dFecFirma>');
    }
  });
});
