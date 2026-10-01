import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Destinos externos de las copias de seguridad                         */
/* ------------------------------------------------------------------ */

/** S3 y compatibles, un servidor SFTP (Linux, NAS) o una nube WebDAV (Nextcloud, ownCloud…). */
export const BACKUP_TARGET_KINDS = ['s3', 'sftp', 'webdav'] as const;
export type BackupTargetKind = (typeof BACKUP_TARGET_KINDS)[number];

export const BACKUP_TARGET_LABELS: Record<BackupTargetKind, { title: string; description: string }> = {
  s3: { title: 'S3 y compatibles', description: 'Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, Google Cloud Storage o MinIO.' },
  sftp: { title: 'Servidor SFTP', description: 'Otro servidor Linux, un NAS (Synology, QNAP) o un hosting con acceso SSH.' },
  webdav: { title: 'Nube WebDAV', description: 'Nextcloud, ownCloud, Synology, pCloud, Koofr, Yandex Disk u otro servicio WebDAV.' },
};

/** Proveedores S3: completan el endpoint y la región, y explican de dónde sacar las claves. */
export const S3_PROVIDERS = [
  { id: 'aws', label: 'Amazon S3', endpoint: '', region: 'us-east-1', pathStyle: false, help: 'Deje el endpoint vacío y use la región del bucket (por ejemplo sa-east-1, São Paulo). Claves: IAM → Usuarios → Credenciales de seguridad → Crear clave de acceso, con permiso s3:PutObject y s3:DeleteObject sobre el bucket.' },
  { id: 'r2', label: 'Cloudflare R2', endpoint: 'https://<ID-de-cuenta>.r2.cloudflarestorage.com', region: 'auto', pathStyle: true, help: 'R2 → Administrar tokens de API de R2 → Crear token con permiso «Lectura y escritura de objetos» para el bucket. El ID de cuenta figura en la página de R2.' },
  { id: 'b2', label: 'Backblaze B2', endpoint: 'https://s3.<región>.backblazeb2.com', region: '<región>', pathStyle: true, help: 'Buckets → el endpoint S3 figura en el bucket (por ejemplo s3.us-west-004.backblazeb2.com; la región es us-west-004). Claves: Application Keys → Add a New Application Key.' },
  { id: 'wasabi', label: 'Wasabi', endpoint: 'https://s3.<región>.wasabisys.com', region: 'us-east-1', pathStyle: true, help: 'Access Keys → Create New Access Key. Use el endpoint de la región del bucket.' },
  { id: 'spaces', label: 'DigitalOcean Spaces', endpoint: 'https://<región>.digitaloceanspaces.com', region: 'us-east-1', pathStyle: false, help: 'API → Spaces Keys → Generate New Key. El endpoint es el de la región del Space (por ejemplo nyc3).' },
  { id: 'gcs', label: 'Google Cloud Storage', endpoint: 'https://storage.googleapis.com', region: 'auto', pathStyle: true, help: 'Cloud Storage → Configuración → Interoperabilidad → Crear una clave HMAC para una cuenta de servicio con permiso sobre el bucket.' },
  { id: 'minio', label: 'MinIO u otro compatible', endpoint: 'https://minio.suempresa.com', region: 'us-east-1', pathStyle: true, help: 'Use la dirección del servidor y una clave de acceso con permiso de escritura en el bucket.' },
] as const;
export type S3ProviderId = (typeof S3_PROVIDERS)[number]['id'];

/** Ejemplos de dirección WebDAV de los servicios más usados. */
export const WEBDAV_PROVIDERS = [
  { id: 'nextcloud', label: 'Nextcloud', url: 'https://nube.suempresa.com/remote.php/dav/files/<usuario>/Copias/', help: 'Cree una contraseña de aplicación en Configuración personal → Seguridad → Dispositivos y sesiones.' },
  { id: 'owncloud', label: 'ownCloud', url: 'https://nube.suempresa.com/remote.php/webdav/Copias/', help: 'Use su usuario y una contraseña de aplicación.' },
  { id: 'synology', label: 'Synology NAS', url: 'https://nas.suempresa.com:5006/Copias/', help: 'Active WebDAV en el Centro de paquetes → WebDAV Server (puerto 5006 con HTTPS).' },
  { id: 'pcloud', label: 'pCloud', url: 'https://webdav.pcloud.com/Copias/', help: 'Cuentas de Europa: https://ewebdav.pcloud.com. Use su correo y contraseña de pCloud.' },
  { id: 'koofr', label: 'Koofr', url: 'https://app.koofr.net/dav/Koofr/Copias/', help: 'Cree una contraseña de aplicación en Preferencias → Contraseñas.' },
  { id: 'yandex', label: 'Yandex Disk', url: 'https://webdav.yandex.com/Copias/', help: 'Cree una contraseña de aplicación para «Archivos» en la cuenta de Yandex.' },
  { id: 'other', label: 'Otro', url: 'https://servidor/carpeta/', help: 'La dirección de la carpeta donde guardar las copias.' },
] as const;

const httpUrl = z.url({ protocol: /^https?$/, message: 'Dirección http(s) inválida' }).max(2048);

const s3Config = z.object({
  provider: z.string().max(20).default('aws'),
  endpoint: z.union([z.literal(''), httpUrl]).default(''),
  region: z.string().trim().min(1, 'Indique la región').max(40).default('us-east-1'),
  bucket: z.string().trim().min(3, 'Indique el bucket').max(63),
  /** Carpeta dentro del bucket. */
  prefix: z.string().trim().max(200).default('backups/'),
  pathStyle: z.boolean().default(false),
});
const sftpConfig = z.object({
  host: z.string().trim().min(1, 'Indique el servidor').max(253),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1, 'Indique el usuario').max(100),
  /** Carpeta en el servidor (relativa al inicio del usuario o absoluta). */
  path: z.string().trim().max(500).default('copias-gestion-colas'),
  /** Huella SHA-256 del servidor: se guarda en la primera conexión y se verifica después. */
  hostFingerprint: z.string().trim().max(200).default(''),
});
const webdavConfig = z.object({
  provider: z.string().max(20).default('other'),
  url: httpUrl,
  username: z.string().trim().max(200).default(''),
});

export type S3TargetConfig = z.infer<typeof s3Config>;
export type SftpTargetConfig = z.infer<typeof sftpConfig>;
export type WebdavTargetConfig = z.infer<typeof webdavConfig>;

const name = z.string().trim().min(1, 'Indique un nombre').max(80);
/** Las claves vacías u omitidas conservan las guardadas. */
const secret = (max = 500) => z.string().max(max).optional();

export const backupTargetInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('s3'), name, enabled: z.boolean().default(true), config: s3Config, secrets: z.object({ accessKeyId: secret(200), secretAccessKey: secret() }).default({}) }),
  z.object({
    kind: z.literal('sftp'),
    name,
    enabled: z.boolean().default(true),
    config: sftpConfig,
    secrets: z.object({ password: secret(), privateKey: secret(20_000), passphrase: secret() }).default({}),
  }),
  z.object({ kind: z.literal('webdav'), name, enabled: z.boolean().default(true), config: webdavConfig, secrets: z.object({ password: secret() }).default({}) }),
]);
export type BackupTargetInput = z.infer<typeof backupTargetInputSchema>;

export type BackupTargetConfig = S3TargetConfig | SftpTargetConfig | WebdavTargetConfig;

export interface BackupTargetDTO {
  id: string;
  kind: BackupTargetKind;
  name: string;
  enabled: boolean;
  config: BackupTargetConfig;
  /** Qué claves hay guardadas (nunca se devuelven). */
  secrets: Record<string, boolean>;
  /** Resumen legible: bucket, servidor o dirección. */
  summary: string;
  lastTest: { at: string; ok: boolean; message: string } | null;
  lastUpload: { at: string; ok: boolean; message: string } | null;
  createdAt: string;
}

/** Resultado de la subida de una copia a cada destino. */
export interface BackupRemoteDTO {
  /** null = S3 configurado con variables del servidor. */
  targetId: string | null;
  name: string;
  kind: BackupTargetKind;
  ok: boolean;
  /** Dónde quedó (clave del bucket, ruta o dirección). */
  location: string | null;
  error: string | null;
  at: string;
}

export interface BackupTargetTestDTO {
  ok: boolean;
  message: string;
  /** SFTP: huella del servidor vista en la conexión. */
  fingerprint?: string;
}

/** Texto corto que describe un destino. */
export function backupTargetSummary(kind: BackupTargetKind, config: BackupTargetConfig): string {
  if (kind === 's3') {
    const c = config as S3TargetConfig;
    const provider = S3_PROVIDERS.find((p) => p.id === c.provider)?.label ?? 'S3';
    return `${provider} · ${c.bucket}${c.prefix ? `/${c.prefix.replace(/^\/+|\/+$/g, '')}` : ''}`;
  }
  if (kind === 'sftp') {
    const c = config as SftpTargetConfig;
    return `${c.username}@${c.host}${c.port !== 22 ? `:${c.port}` : ''}:${c.path || '~'}`;
  }
  const c = config as WebdavTargetConfig;
  return c.url.replace(/^https?:\/\//, '');
}
