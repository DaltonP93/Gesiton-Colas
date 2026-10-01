import { DOMParser } from '@xmldom/xmldom';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/* Firma digital XML-DSig (RSA-SHA256, c14n exclusiva, envolvente) con el certificado .p12 del emisor. */

export interface Certificate {
  keyPem: string;
  certPem: string;
  /** Certificado en base64 (sin encabezados) para <X509Certificate>. */
  certBase64: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
}

/** Abre un .p12 / .pfx (también los que usan algoritmos antiguos, que OpenSSL 3 ya no lee). */
export function openP12(p12: Buffer, password: string): Certificate {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(p12.toString('binary'))), false, password);
  } catch {
    throw new Error('No se pudo abrir el certificado: revise el archivo y la contraseña');
  }
  const keyBag =
    parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    parsed.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certs = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  if (!keyBag?.key) throw new Error('El certificado no tiene la clave privada');
  // El certificado del firmante es el que corresponde a la clave (puede venir con la cadena).
  const publicKey = forge.pki.setRsaPublicKey((keyBag.key as forge.pki.rsa.PrivateKey).n, (keyBag.key as forge.pki.rsa.PrivateKey).e);
  const own = certs.find((c) => c.cert && forge.pki.publicKeyToPem(c.cert.publicKey) === forge.pki.publicKeyToPem(publicKey))?.cert ?? certs[0]?.cert;
  if (!own) throw new Error('El archivo no contiene el certificado');
  const certPem = forge.pki.certificateToPem(own);
  const cn = own.subject.getField('CN')?.value as string | undefined;
  const serial = own.subject.getField({ name: 'serialNumber' })?.value as string | undefined;
  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem,
    certBase64: certPem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''),
    subject: [cn, serial].filter(Boolean).join(' · ') || own.subject.attributes.map((a) => `${a.shortName ?? a.name}=${String(a.value)}`).join(', '),
    validFrom: own.validity.notBefore,
    validTo: own.validity.notAfter,
  };
}

/**
 * Firma el elemento `tag` (DE o rEve): la firma queda a continuación del elemento, como pide la SET.
 * El XML no se vuelve a formatear después de firmar.
 */
export function signXml(xml: string, tag: 'DE' | 'rEve', cert: Certificate): string {
  const sig = new SignedXml({
    privateKey: cert.keyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    getKeyInfoContent: () => `<X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data>`,
  });
  const xpath = `//*[local-name(.)='${tag}']`;
  sig.addReference({
    xpath,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  sig.computeSignature(xml, { location: { reference: xpath, action: 'after' } });
  return sig.getSignedXml();
}

/** Verifica la firma (pruebas y diagnóstico). */
export function verifyXml(xml: string, certPem: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  if (!signature) return false;
  const v = new SignedXml({ publicCert: certPem });
  v.loadSignature(signature as unknown as Node);
  return v.checkSignature(xml);
}
