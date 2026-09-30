import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Token aleatorio legible (sin caracteres ambiguos). */
export function randomToken(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Clave AES-256 derivada de un secreto de la instalación (JWT_SECRET) y un propósito. */
function deriveKey(secret: string, purpose: string) {
  return createHash('sha256').update(`${purpose}:${secret}`).digest();
}

/** Cifra un secreto para guardarlo en la base (AES-256-GCM, formato v1.iv.tag.datos en base64url). */
export function encryptSecret(secret: string, plaintext: string, purpose = 'secrets'): string {
  if (!plaintext) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Descifra un valor de encryptSecret. Devuelve null si no se puede (p. ej. cambió JWT_SECRET). */
export function decryptSecret(secret: string, value: string, purpose = 'secrets'): string | null {
  if (!value) return '';
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, purpose), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
