import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { BackupTargetKind, S3TargetConfig, SftpTargetConfig, WebdavTargetConfig } from '@gc/shared';

/* ------------------------------------------------------------------ */
/* Subida de copias a S3, SFTP y WebDAV                                 */
/* ------------------------------------------------------------------ */

export interface TargetSecrets {
  accessKeyId?: string;
  secretAccessKey?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface Uploader {
  /** Sube el archivo y devuelve dónde quedó (clave, ruta o dirección). */
  upload(localPath: string, name: string): Promise<string>;
  remove(location: string): Promise<void>;
  /** Escribe y borra un archivo de prueba. */
  test(): Promise<{ message: string; fingerprint?: string }>;
}

const TEST_NAME = () => `.prueba-gestion-colas-${Date.now()}.txt`;
const TEST_BODY = 'Prueba de escritura de Gestión de Colas. Se puede borrar.\n';

/** Mensaje claro para los errores más comunes de cada servicio. */
export function friendlyTargetError(error: unknown): string {
  // fetch envuelve el error de red en `cause` («fetch failed»).
  let inner = error as { cause?: unknown; message?: string } | undefined;
  while (inner && inner.message === 'fetch failed' && inner.cause) inner = inner.cause as typeof inner;
  error = inner;
  const e = error as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number }; level?: string };
  const code = e.code ?? e.name ?? '';
  const status = e.$metadata?.httpStatusCode;
  const messages: Record<string, string> = {
    ENOTFOUND: 'No se encontró el servidor: revise la dirección.',
    EAI_AGAIN: 'No se pudo resolver la dirección del servidor (DNS).',
    ECONNREFUSED: 'El servidor rechazó la conexión: revise la dirección y el puerto.',
    ETIMEDOUT: 'El servidor no respondió a tiempo.',
    ECONNRESET: 'Se cortó la conexión con el servidor.',
    CERT_HAS_EXPIRED: 'El certificado HTTPS del servidor venció.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'El servidor usa un certificado HTTPS no confiable (autofirmado).',
    NoSuchBucket: 'El bucket no existe o el endpoint no corresponde a la región.',
    InvalidAccessKeyId: 'La clave de acceso no existe.',
    SignatureDoesNotMatch: 'La clave secreta no es correcta.',
    AccessDenied: 'La clave no tiene permiso para escribir en el bucket.',
    PermanentRedirect: 'El bucket está en otra región: corrija la región o el endpoint.',
    AuthorizationHeaderMalformed: 'La región no corresponde al bucket.',
    HOST_FINGERPRINT: 'La huella del servidor SFTP cambió: si cambió el servidor, borre la huella guardada y pruebe de nuevo.',
  };
  if (messages[code]) return messages[code]!;
  if (e.message === 'bad port') return 'Ese puerto no está permitido: use otro.';
  if (e.level === 'client-authentication') return 'Usuario, contraseña o clave privada incorrectos.';
  if (status === 401 || status === 403) return 'Usuario o contraseña incorrectos, o sin permiso de escritura.';
  if (status === 404) return 'La carpeta no existe.';
  if (status === 409) return 'La carpeta superior no existe: créela primero.';
  if (status === 507) return 'No hay espacio en el destino.';
  return (e.message ?? 'Error desconocido').slice(0, 300);
}

/* -------------------------------- S3 -------------------------------- */

function s3Uploader(config: S3TargetConfig, secrets: TargetSecrets): Uploader {
  const prefix = config.prefix.replace(/^\/+/, '').replace(/\/*$/, config.prefix ? '/' : '');
  const client = async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: config.region || 'us-east-1',
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.pathStyle,
      credentials: { accessKeyId: secrets.accessKeyId ?? '', secretAccessKey: secrets.secretAccessKey ?? '' },
      // Algunos compatibles (B2, Wasabi, MinIO viejos) no aceptan las sumas de verificación nuevas.
      ...(config.endpoint ? { requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const } : {}),
    });
  };
  return {
    async upload(localPath, name) {
      const { Upload } = await import('@aws-sdk/lib-storage');
      const key = `${prefix}${name}`;
      await new Upload({ client: await client(), params: { Bucket: config.bucket, Key: key, Body: createReadStream(localPath), ContentType: 'application/gzip' } }).done();
      return key;
    },
    async remove(key) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await (await client()).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async test() {
      const { DeleteObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const c = await client();
      const key = `${prefix}${TEST_NAME()}`;
      await c.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: TEST_BODY, ContentType: 'text/plain' }));
      await c.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      return { message: `Se escribió y se borró un archivo de prueba en ${config.bucket}/${prefix}` };
    },
  };
}

/* ------------------------------- SFTP ------------------------------- */

type SftpSession = { sftp: import('ssh2').SFTPWrapper; end: () => void; fingerprint: string };

function sftpUploader(config: SftpTargetConfig, secrets: TargetSecrets): Uploader {
  const dir = config.path.replace(/\/+$/, '') || '.';

  async function connect(): Promise<SftpSession> {
    const { Client } = await import('ssh2');
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let fingerprint = '';
      conn
        .on('ready', () =>
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end();
              reject(err);
            } else resolve({ sftp, end: () => conn.end(), fingerprint });
          }),
        )
        .on('error', reject)
        .connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password: secrets.password || undefined,
          privateKey: secrets.privateKey || undefined,
          passphrase: secrets.passphrase || undefined,
          readyTimeout: 20_000,
          // Se guarda la huella del servidor en la primera conexión y luego se exige la misma.
          hostVerifier: (key: Buffer) => {
            fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
            if (config.hostFingerprint && config.hostFingerprint !== fingerprint) {
              reject(Object.assign(new Error('La huella del servidor cambió'), { code: 'HOST_FINGERPRINT' }));
              return false;
            }
            return true;
          },
        });
    });
  }

  const call = <T>(fn: (cb: (err: Error | null | undefined, value?: T) => void) => void) =>
    new Promise<T>((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value as T))));

  /** Crea la carpeta (y las intermedias) si no existe. */
  async function ensureDir(sftp: SftpSession['sftp']) {
    if (dir === '.') return;
    const parts = dir.split('/');
    let current = dir.startsWith('/') ? '' : '.';
    for (const part of parts) {
      if (!part) continue;
      current = current === '' ? `/${part}` : `${current}/${part}`;
      const exists = await call((cb) => sftp.stat(current, cb)).then(
        () => true,
        () => false,
      );
      if (!exists) await call((cb) => sftp.mkdir(current, cb));
    }
  }

  return {
    async upload(localPath, name) {
      const session = await connect();
      try {
        await ensureDir(session.sftp);
        const remote = path.posix.join(dir, name);
        await call((cb) => session.sftp.fastPut(localPath, remote, (err) => cb(err)));
        return remote;
      } finally {
        session.end();
      }
    },
    async remove(remote) {
      const session = await connect();
      try {
        await call((cb) => session.sftp.unlink(remote, cb)).catch((error: { code?: number }) => {
          if (error.code !== 2) throw error; // 2 = no existe
        });
      } finally {
        session.end();
      }
    },
    async test() {
      const session = await connect();
      try {
        await ensureDir(session.sftp);
        const remote = path.posix.join(dir, TEST_NAME());
        await call((cb) => session.sftp.writeFile(remote, TEST_BODY, (err) => cb(err)));
        await call((cb) => session.sftp.unlink(remote, cb));
        return { message: `Conectado a ${config.host}: se escribió y se borró un archivo de prueba en ${dir}`, fingerprint: session.fingerprint };
      } finally {
        session.end();
      }
    },
  };
}

/* ------------------------------ WebDAV ------------------------------ */

function webdavUploader(config: WebdavTargetConfig, secrets: TargetSecrets): Uploader {
  const base = config.url.endsWith('/') ? config.url : `${config.url}/`;
  const headers: Record<string, string> = config.username ? { authorization: `Basic ${Buffer.from(`${config.username}:${secrets.password ?? ''}`).toString('base64')}` } : {};
  const fail = (res: Response) => Object.assign(new Error(`El servidor respondió ${res.status} ${res.statusText}`), { $metadata: { httpStatusCode: res.status } });

  async function ensureFolder() {
    const res = await fetch(base, { method: 'MKCOL', headers, signal: AbortSignal.timeout(30_000) });
    // 201 = creada; 405 = ya existe; algunos servidores responden 301/302 o 409 si ya está.
    if (!res.ok && ![301, 302, 405].includes(res.status)) throw fail(res);
  }

  async function put(url: string, body: BodyInit, extra: Record<string, string> = {}) {
    const res = await fetch(url, { method: 'PUT', headers: { ...headers, ...extra }, body, duplex: 'half', signal: AbortSignal.timeout(6 * 3_600_000) } as RequestInit);
    if (!res.ok) throw fail(res);
  }

  async function del(url: string) {
    const res = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && res.status !== 404) throw fail(res);
  }

  return {
    async upload(localPath, name) {
      await ensureFolder();
      const url = base + encodeURIComponent(name);
      const { size } = await stat(localPath);
      await put(url, Readable.toWeb(createReadStream(localPath)) as unknown as BodyInit, { 'content-type': 'application/gzip', 'content-length': String(size) });
      return url;
    },
    remove: del,
    async test() {
      await ensureFolder();
      const url = base + TEST_NAME();
      await put(url, TEST_BODY, { 'content-type': 'text/plain' });
      await del(url);
      return { message: `Se escribió y se borró un archivo de prueba en ${base}` };
    },
  };
}

export function uploaderFor(kind: BackupTargetKind, config: unknown, secrets: TargetSecrets): Uploader {
  if (kind === 's3') return s3Uploader(config as S3TargetConfig, secrets);
  if (kind === 'sftp') return sftpUploader(config as SftpTargetConfig, secrets);
  return webdavUploader(config as WebdavTargetConfig, secrets);
}
