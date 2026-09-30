import { lookup } from 'node:dns/promises';
import { lookup as lookupCallback, type LookupAddress, type LookupOneOptions, type LookupAllOptions } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/* ------------------------------------------------------------------ */
/* Direcciones privadas (protección SSRF)                              */
/* ------------------------------------------------------------------ */

function isPrivateIPv4Bytes([a = 0, b = 0, c = 0, d = 0]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

/** Convierte una IPv6 (con `::`, zona o IPv4 embebida) a sus 16 bytes. */
function ipv6Bytes(ip: string): number[] | null {
  let addr = ip.split('%')[0]!.toLowerCase();
  let v4: number[] = [];
  if (addr.includes('.')) {
    const cut = addr.lastIndexOf(':');
    v4 = addr.slice(cut + 1).split('.').map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    addr = `${addr.slice(0, cut + 1)}0:0`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 255];
  });
  if (v4.length) bytes.splice(12, 4, ...v4);
  return bytes;
}

function isPrivateIPv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return true;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 16)) return true; // ::
  if (zeros(0, 15) && b[15] === 1) return true; // ::1
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4Bytes(b.slice(12)); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return isPrivateIPv4Bytes(b.slice(12)); // ::a.b.c.d (compatible)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return isPrivateIPv4Bytes(b.slice(12)); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4Bytes(b.slice(2, 6)); // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentación
  // Solo las direcciones globales (2000::/3) son públicas: ULA, link-local, multicast y reservadas no.
  return (b[0]! & 0xe0) !== 0x20;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4Bytes(ip.split('.').map(Number));
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

class PrivateAddressError extends Error {
  code = 'EPRIVATE';
}

/**
 * `lookup` compatible con `net`/`http` que rechaza direcciones privadas. Se usa al conectar,
 * así que un cambio de DNS después de validar (DNS rebinding) no permite llegar a la red interna.
 */
export function publicLookup(
  hostname: string,
  options: LookupOneOptions | LookupAllOptions | number,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  const opts = typeof options === 'number' ? { family: options } : options;
  lookupCallback(hostname, { ...opts, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, [], 0);
    const list = addresses.filter((a) => !isPrivateAddress(a.address));
    if (list.length === 0 || list.length !== addresses.length) {
      return callback(new PrivateAddressError('La dirección apunta a una red privada'), [], 0);
    }
    if ('all' in opts && opts.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

function hostOf(rawUrl: string) {
  return new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
}

/** Verifica que un servidor (webhook, SMTP, proveedor de avisos) no esté en la red interna. */
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

/** Verifica que una URL no apunte a la red interna (protección SSRF). */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Solo se permiten URLs http(s)');
  try {
    await assertPublicHost(hostOf(rawUrl));
  } catch {
    throw new Error('La URL apunta a una dirección privada o no resoluble');
  }
}

/** Resuelve un servidor a una IP pública (para conectar a esa IP y no volver a resolver). */
export async function resolvePublicHost(host: string): Promise<string> {
  const hostname = host.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new PrivateAddressError('El servidor está en una red privada');
    return hostname;
  }
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new PrivateAddressError('El servidor está en una red privada');
  return addresses[0]!.address;
}

/* ------------------------------------------------------------------ */
/* Pedidos HTTP salientes seguros                                      */
/* ------------------------------------------------------------------ */

export interface OutboundResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Pedido HTTP(S) saliente sin seguir redirecciones, con tiempo límite, respuesta acotada
 * y (salvo `allowPrivate`) sin poder conectar a direcciones privadas.
 */
export function outboundRequest(
  rawUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; allowPrivate?: boolean; maxBytes?: number } = {},
): Promise<OutboundResponse> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return Promise.reject(new Error('Solo se permiten URLs http(s)'));
  const host = hostOf(rawUrl);
  if (!options.allowPrivate && net.isIP(host) && isPrivateAddress(host)) return Promise.reject(new PrivateAddressError('La dirección apunta a una red privada'));
  const client = url.protocol === 'https:' ? https : http;
  const maxBytes = options.maxBytes ?? 256 * 1024;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        timeout: options.timeoutMs ?? 10_000,
        lookup: options.allowPrivate ? undefined : (publicLookup as unknown as net.LookupFunction),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= maxBytes) chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
