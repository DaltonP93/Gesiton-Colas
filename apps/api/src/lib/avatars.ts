import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { MultipartFile } from '@fastify/multipart';
import type { Storage } from './storage';
import { AppError, badRequest } from './errors';

/** Tamaño máximo de una foto de perfil (el navegador ya la recorta y achica a 512 px). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

type ImageKind = { mime: string; ext: string };

/**
 * Tipo real de la imagen según sus primeros bytes (no el que declara el navegador).
 * Solo JPG, PNG y WebP: un SVG puede llevar scripts y un GIF animado no tiene sentido como foto.
 */
export function sniffImage(head: Buffer): ImageKind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Lee el archivo subido con un tope de tamaño. */
async function readLimited(file: MultipartFile, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of file.file as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) {
      file.file.resume();
      throw new AppError(413, 'file_too_large', `La foto supera el máximo de ${Math.round(max / 1024 / 1024)} MB`);
    }
    chunks.push(chunk);
  }
  if (file.file.truncated) throw new AppError(413, 'file_too_large', `La foto supera el máximo de ${Math.round(max / 1024 / 1024)} MB`);
  return Buffer.concat(chunks);
}

/** Guarda la foto de perfil de un usuario y devuelve su dirección pública. */
export async function storeAvatar(storage: Storage, userId: string, file: MultipartFile): Promise<string> {
  const data = await readLimited(file, AVATAR_MAX_BYTES);
  const kind = sniffImage(data);
  if (!kind) throw badRequest('Suba una foto JPG, PNG o WebP');
  const stored = await storage.put(`avatars/${userId}/${randomUUID()}.${kind.ext}`, Readable.from(data), kind.mime);
  return stored.url;
}

/** Borra el archivo de una foto de perfil anterior (sin fallar si ya no existe). */
export async function removeAvatar(storage: Storage, url: string | null | undefined) {
  if (!url) return;
  const at = url.indexOf('avatars/');
  if (at < 0) return;
  await storage.remove(url.slice(at)).catch(() => undefined);
}
