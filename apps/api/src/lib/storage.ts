import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { AppConfig } from '../config';

export interface StoredObject {
  url: string;
  size: number;
}

export interface Storage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Readable, contentType: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  /** Carpeta local servida en /uploads (solo driver local). */
  localDir?: string;
}

function byteCounter() {
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  return { stream, size: () => bytes };
}

function safeKey(key: string) {
  const normalized = path.posix.normalize(key).replace(/^(\.\.(\/|$))+/, '');
  if (normalized.startsWith('/') || normalized.includes('..')) throw new Error('Clave de archivo inválida');
  return normalized;
}

export function createLocalStorage(dir: string): Storage {
  const root = path.resolve(dir);
  return {
    driver: 'local',
    localDir: root,
    async put(key, body) {
      const clean = safeKey(key);
      const target = path.join(root, clean);
      await mkdir(path.dirname(target), { recursive: true });
      const counter = byteCounter();
      try {
        await pipeline(body, counter.stream, createWriteStream(target));
      } catch (error) {
        await rm(target, { force: true });
        throw error;
      }
      const { size } = await stat(target);
      return { url: `/uploads/${clean}`, size };
    },
    async remove(key) {
      await rm(path.join(root, safeKey(key)), { force: true });
    },
  };
}

export function createS3Storage(config: AppConfig): Storage {
  if (!config.S3_BUCKET) throw new Error('S3_BUCKET es obligatorio con STORAGE_DRIVER=s3');
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY && config.S3_SECRET_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
        : undefined,
  });
  const bucket = config.S3_BUCKET;
  const publicBase = (
    config.S3_PUBLIC_URL ?? (config.S3_ENDPOINT ? `${config.S3_ENDPOINT.replace(/\/$/, '')}/${bucket}` : `https://${bucket}.s3.${config.S3_REGION}.amazonaws.com`)
  ).replace(/\/$/, '');

  return {
    driver: 's3',
    async put(key, body, contentType) {
      const clean = safeKey(key);
      const counter = byteCounter();
      body.pipe(counter.stream);
      await new Upload({
        client,
        params: { Bucket: bucket, Key: clean, Body: counter.stream, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' },
      }).done();
      return { url: `${publicBase}/${clean}`, size: counter.size() };
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
    },
  };
}

export function createStorage(config: AppConfig): Storage {
  return config.STORAGE_DRIVER === 's3' ? createS3Storage(config) : createLocalStorage(config.UPLOAD_DIR);
}
