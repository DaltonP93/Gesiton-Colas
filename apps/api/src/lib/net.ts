import { lookup } from 'node:dns/promises';
import net from 'node:net';

function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7));
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/** Verifica que una URL de webhook no apunte a la red interna (protección SSRF). */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Solo se permiten URLs http(s)');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('La URL apunta a una dirección privada o no resoluble');
  }
}

/** Verifica que un servidor (p. ej. SMTP) no esté en la red interna. */
export async function assertPublicHost(host: string): Promise<void> {
  const hostname = host.replace(/^\[|\]$/g, '');
  let addresses: { address: string }[];
  try {
    addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  } catch {
    throw new Error(`No se encontró el servidor ${host}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('El servidor está en una red privada');
  }
}
