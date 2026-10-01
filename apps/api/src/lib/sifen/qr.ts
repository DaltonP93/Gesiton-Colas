import { createHash } from 'node:crypto';
import type { SifenEnvironment } from '@gc/shared';
import { readTag } from './xml';

/* Código QR del KuDE (Manual Técnico SIFEN v150, sección del QR): parámetros + hash SHA-256 con el CSC. */

const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

export function qrUrl(signedXml: string, env: SifenEnvironment, cscId: string, csc: string): string {
  const id = /<DE Id="(\d{44})"/.exec(signedXml)?.[1];
  const digest = readTag(signedXml, 'DigestValue');
  if (!id || !digest) throw new Error('El XML debe estar firmado para generar el QR');
  const nat = readTag(signedXml, 'iNatRec');
  const params = [
    `nVersion=${readTag(signedXml, 'dVerFor') ?? '150'}`,
    `Id=${id}`,
    `dFeEmiDE=${hex(readTag(signedXml, 'dFeEmiDE') ?? '')}`,
    nat === '1' ? `dRucRec=${readTag(signedXml, 'dRucRec') ?? ''}` : `dNumIDRec=${readTag(signedXml, 'dNumIDRec') ?? ''}`,
    `dTotGralOpe=${readTag(signedXml, 'dTotGralOpe') ?? '0'}`,
    `dTotIVA=${readTag(signedXml, 'dTotIVA') ?? '0'}`,
    `cItems=${(signedXml.match(/<gCamItem>/g) ?? []).length}`,
    `DigestValue=${hex(digest)}`,
    `IdCSC=${cscId.padStart(4, '0')}`,
  ].join('&');
  const hash = createHash('sha256').update(params + csc).digest('hex');
  const base = env === 'test' ? 'https://ekuatia.set.gov.py/consultas-test/qr?' : 'https://ekuatia.set.gov.py/consultas/qr?';
  return `${base}${params}&cHashQR=${hash}`;
}

/** Agrega <gCamFuFD><dCarQR> después de la firma (sin tocar lo firmado). */
export function withQr(signedXml: string, url: string): string {
  const escaped = url.replace(/&/g, '&amp;');
  return signedXml.replace('</Signature>', `</Signature><gCamFuFD><dCarQR>${escaped}</dCarQR></gCamFuFD>`);
}
