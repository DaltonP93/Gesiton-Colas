import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cloud, FolderSync, Pencil, Plus, Server, Trash2, Wifi, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  BACKUP_TARGET_KINDS,
  BACKUP_TARGET_LABELS,
  S3_PROVIDERS,
  WEBDAV_PROVIDERS,
  type BackupStatusDTO,
  type BackupTargetDTO,
  type BackupTargetKind,
  type BackupTargetTestDTO,
  type PlatformSettings,
  type S3TargetConfig,
  type SftpTargetConfig,
  type WebdavTargetConfig,
} from '@gc/shared';
import { Badge, Button, Field, IconButton, Input, Menu, Modal, Textarea, Toggle, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

const KIND_ICONS: Record<BackupTargetKind, ReactNode> = { s3: <Cloud />, sftp: <Server />, webdav: <FolderSync /> };

type Draft =
  | { kind: 's3'; name: string; enabled: boolean; config: S3TargetConfig; secrets: { accessKeyId: string; secretAccessKey: string } }
  | { kind: 'sftp'; name: string; enabled: boolean; config: SftpTargetConfig; secrets: { password: string; privateKey: string; passphrase: string } }
  | { kind: 'webdav'; name: string; enabled: boolean; config: WebdavTargetConfig; secrets: { password: string } };

function newDraft(kind: BackupTargetKind): Draft {
  if (kind === 's3') {
    const p = S3_PROVIDERS[0];
    return { kind, name: p.label, enabled: true, config: { provider: p.id, endpoint: p.endpoint, region: p.region, bucket: '', prefix: 'backups/', pathStyle: p.pathStyle }, secrets: { accessKeyId: '', secretAccessKey: '' } };
  }
  if (kind === 'sftp') return { kind, name: 'Servidor SFTP', enabled: true, config: { host: '', port: 22, username: '', path: 'copias-gestion-colas', hostFingerprint: '' }, secrets: { password: '', privateKey: '', passphrase: '' } };
  const p = WEBDAV_PROVIDERS[0];
  return { kind, name: p.label, enabled: true, config: { provider: p.id, url: '', username: '' }, secrets: { password: '' } };
}

function draftOf(t: BackupTargetDTO): Draft {
  const empty = newDraft(t.kind);
  return { ...empty, name: t.name, enabled: t.enabled, config: { ...empty.config, ...t.config } } as Draft;
}

/** Copias fuera del servidor: S3 y compatibles, SFTP y WebDAV, configurados desde el panel. */
export function BackupTargetsCard({ data }: { data: BackupStatusDTO }) {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ target: BackupTargetDTO | null; kind: BackupTargetKind } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'backups'] });

  const toggle = useMutation({
    mutationFn: (t: BackupTargetDTO) => api.put(`/platform/backups/targets/${t.id}`, { ...draftOf(t), enabled: !t.enabled, secrets: {} }),
    onSuccess: () => void refresh(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const envS3 = useMutation({
    mutationFn: (s3: boolean) => api.put<PlatformSettings>('/platform/settings', { backups: { s3 } }),
    onSuccess: (settings) => {
      qc.setQueryData(['platform', 'settings'], settings);
      void refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  async function test(t: BackupTargetDTO) {
    setTesting(t.id);
    try {
      const r = await api.post<BackupTargetTestDTO>('/platform/backups/targets/test', { ...draftOf(t), secrets: {}, id: t.id });
      toast(r.ok ? `${t.name}: ${r.message}` : `${t.name}: ${r.message}`, r.ok ? 'success' : 'error');
      void refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setTesting(null);
    }
  }

  async function remove(t: BackupTargetDTO) {
    const ok = await confirm({
      title: `¿Quitar «${t.name}»?`,
      message: 'Las próximas copias ya no se suben allí. Las copias que ya se subieron quedan en el destino.',
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/platform/backups/targets/${t.id}`);
      void refresh();
      toast('Destino quitado');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const nothing = !data.targets.length && !data.s3Available;

  return (
    <section className="gc-card gc-pad space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="text-lg font-semibold">Copias fuera del servidor</h2>
          <p className="text-sm text-muted">Cada copia se sube además a estos destinos. Si el servidor se pierde, la copia sigue a salvo. Las claves se guardan cifradas.</p>
        </div>
        {!nothing && (
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ target: null, kind: 's3' })}>
            Agregar destino
          </Button>
        )}
      </div>

      {nothing ? (
        <div className="grid gap-3 md:grid-cols-3">
          {BACKUP_TARGET_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setEditing({ target: null, kind })}
              className="flex items-start gap-3 rounded-ui border border-dashed border-border p-4 text-left transition hover:border-primary hover:bg-primary/5"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary [&_svg]:size-5">{KIND_ICONS[kind]}</span>
              <span className="min-w-0">
                <span className="block font-medium">{BACKUP_TARGET_LABELS[kind].title}</span>
                <span className="block text-xs text-muted">{BACKUP_TARGET_LABELS[kind].description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-ui border border-border">
          {data.s3Available && (
            <li className="flex flex-wrap items-center gap-3 p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-subtle text-muted [&_svg]:size-5">
                <Cloud />
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-medium">S3 del servidor</p>
                <p className="text-xs text-muted">Configurado con variables (S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY). Carpeta backups/ del bucket.</p>
              </div>
              <Toggle checked={data.settings.s3} onChange={(v) => envS3.mutate(v)} ariaLabel="Subir al S3 del servidor" />
            </li>
          )}
          {data.targets.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className={cx('grid size-10 shrink-0 place-items-center rounded-ui [&_svg]:size-5', t.enabled ? 'bg-primary/10 text-primary' : 'bg-subtle text-muted')}>{KIND_ICONS[t.kind]}</span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-medium">
                  {t.name} <span className="text-xs font-normal text-muted">· {BACKUP_TARGET_LABELS[t.kind].title}</span>
                </p>
                <p className="truncate text-xs text-muted" title={t.summary}>
                  {t.summary}
                </p>
                <TargetHealth target={t} />
              </div>
              <div className="flex items-center gap-1">
                <Toggle checked={t.enabled} onChange={() => toggle.mutate(t)} ariaLabel={`Usar ${t.name}`} />
                <Button size="sm" variant="ghost" icon={<Wifi className="size-4" />} loading={testing === t.id} onClick={() => void test(t)}>
                  Probar
                </Button>
                <IconButton label="Editar" icon={<Pencil className="size-4" />} onClick={() => setEditing({ target: t, kind: t.kind })} />
                <Menu items={[{ label: 'Quitar destino', icon: <Trash2 />, danger: true, onSelect: () => void remove(t) }]} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <TargetModal target={editing.target} initialKind={editing.kind} onClose={() => setEditing(null)} onSaved={() => void refresh()} />}
    </section>
  );
}

function TargetHealth({ target }: { target: BackupTargetDTO }) {
  const last = [target.lastUpload, target.lastTest].filter(Boolean).sort((a, b) => b!.at.localeCompare(a!.at))[0];
  if (!last) return <p className="mt-0.5 text-xs text-muted">Sin probar todavía.</p>;
  const label = last === target.lastUpload ? 'Última subida' : 'Última prueba';
  return (
    <p className={cx('mt-0.5 flex items-start gap-1 text-xs', last.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600')}>
      {last.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <XCircle className="mt-px size-3.5 shrink-0" />}
      <span>
        {label} {formatDateTime(last.at)}
        {!last.ok && `: ${last.message}`}
      </span>
    </p>
  );
}

function ProviderChips<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: string; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx('rounded-full border px-3 py-1 text-sm transition', value === o.id ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const secretPlaceholder = (saved: boolean | undefined) => (saved ? '•••••••• (guardada; escriba para cambiarla)' : '');

function TargetModal({ target, initialKind, onClose, onSaved }: { target: BackupTargetDTO | null; initialKind: BackupTargetKind; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Draft>(() => (target ? draftOf(target) : newDraft(initialKind)));
  const [result, setResult] = useState<BackupTargetTestDTO | null>(null);
  const [sftpAuth, setSftpAuth] = useState<'password' | 'key'>(() => (target?.secrets.privateKey ? 'key' : 'password'));
  const saved = target?.secrets ?? {};

  const setConfig = (patch: Record<string, unknown>) => {
    setResult(null);
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }) as Draft);
  };
  const setSecret = (key: string, value: string) => {
    setResult(null);
    setDraft((d) => ({ ...d, secrets: { ...d.secrets, [key]: value } }) as Draft);
  };
  /** Solo se envían las claves escritas (las vacías conservan las guardadas). */
  const body = () => {
    const secrets = Object.fromEntries(
      Object.entries(draft.secrets).filter(([k, v]) => v.trim() && (draft.kind !== 'sftp' || (sftpAuth === 'password' ? k === 'password' : k !== 'password'))),
    );
    return { ...draft, secrets };
  };

  const test = useMutation({
    mutationFn: () => api.post<BackupTargetTestDTO>('/platform/backups/targets/test', { ...body(), ...(target ? { id: target.id } : {}) }),
    onSuccess: (r) => {
      setResult(r);
      // La primera conexión SFTP muestra la huella del servidor: se guarda con el destino.
      if (r.ok && r.fingerprint && draft.kind === 'sftp' && !draft.config.hostFingerprint) setConfig({ hostFingerprint: r.fingerprint });
    },
    onError: (e) => setResult({ ok: false, message: errorMessage(e) }),
  });
  const save = useMutation({
    mutationFn: () => (target ? api.put(`/platform/backups/targets/${target.id}`, body()) : api.post('/platform/backups/targets', body())),
    onSuccess: () => {
      toast(target ? 'Destino guardado' : 'Destino agregado: la próxima copia también se sube allí');
      onSaved();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const s3Provider = draft.kind === 's3' ? S3_PROVIDERS.find((p) => p.id === draft.config.provider) : undefined;
  const davProvider = draft.kind === 'webdav' ? WEBDAV_PROVIDERS.find((p) => p.id === draft.config.provider) : undefined;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={target ? `Editar «${target.name}»` : 'Agregar un destino para las copias'}
      description="Pruebe la conexión antes de guardar: se escribe y se borra un archivo de prueba."
      footer={
        <>
          <Button variant="secondary" className="mr-auto" icon={<Wifi className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
            Probar conexión
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!target && (
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de destino">
            {BACKUP_TARGET_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={draft.kind === kind}
                onClick={() => {
                  setResult(null);
                  setDraft(newDraft(kind));
                }}
                className={cx('flex items-center gap-2 rounded-ui border p-3 text-left text-sm transition [&_svg]:size-5', draft.kind === kind ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border hover:bg-subtle')}
              >
                {KIND_ICONS[kind]}
                {BACKUP_TARGET_LABELS[kind].title}
              </button>
            ))}
          </div>
        )}

        {draft.kind === 's3' && (
          <>
            <Field label="Proveedor">
              <ProviderChips
                options={S3_PROVIDERS}
                value={draft.config.provider}
                onChange={(id) => {
                  const p = S3_PROVIDERS.find((x) => x.id === id)!;
                  setDraft((d) => ({ ...d, name: !target && S3_PROVIDERS.some((x) => x.label === d.name) ? p.label : d.name }));
                  setConfig({ provider: p.id, endpoint: p.endpoint.includes('<') ? '' : p.endpoint, region: p.region.includes('<') ? '' : p.region, pathStyle: p.pathStyle });
                }}
              />
            </Field>
            {s3Provider && <Help>{s3Provider.help}</Help>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bucket">
                <Input value={draft.config.bucket} onChange={(e) => setConfig({ bucket: e.target.value })} placeholder="copias-gestion-colas" />
              </Field>
              <Field label="Carpeta dentro del bucket">
                <Input value={draft.config.prefix} onChange={(e) => setConfig({ prefix: e.target.value })} placeholder="backups/" />
              </Field>
              <Field label="Endpoint" hint={draft.config.provider === 'aws' ? 'Vacío para Amazon S3.' : s3Provider?.endpoint ? `Formato: ${s3Provider.endpoint}` : undefined}>
                <Input value={draft.config.endpoint} onChange={(e) => setConfig({ endpoint: e.target.value.trim() })} placeholder={s3Provider?.endpoint || 'https://…'} />
              </Field>
              <Field label="Región">
                <Input value={draft.config.region} onChange={(e) => setConfig({ region: e.target.value })} placeholder={s3Provider?.region} />
              </Field>
              <Field label="Clave de acceso (Access key ID)">
                <Input value={draft.secrets.accessKeyId} onChange={(e) => setSecret('accessKeyId', e.target.value)} placeholder={secretPlaceholder(saved.accessKeyId)} autoComplete="off" />
              </Field>
              <Field label="Clave secreta (Secret access key)">
                <Input type="password" value={draft.secrets.secretAccessKey} onChange={(e) => setSecret('secretAccessKey', e.target.value)} placeholder={secretPlaceholder(saved.secretAccessKey)} autoComplete="new-password" />
              </Field>
            </div>
            <Toggle checked={draft.config.pathStyle} onChange={(v) => setConfig({ pathStyle: v })} label="Direcciones de estilo ruta" hint="Necesario para MinIO y la mayoría de los compatibles (servidor/bucket/archivo)." />
          </>
        )}

        {draft.kind === 'sftp' && (
          <>
            <Help>Use un usuario con permiso de escritura en la carpeta. La carpeta se crea si no existe; puede ser relativa al inicio del usuario o absoluta (/srv/copias).</Help>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <Field label="Servidor">
                <Input value={draft.config.host} onChange={(e) => setConfig({ host: e.target.value.trim(), hostFingerprint: '' })} placeholder="nas.suempresa.com o 192.168.1.20" />
              </Field>
              <Field label="Puerto">
                <Input type="number" min={1} max={65535} value={draft.config.port} onChange={(e) => setConfig({ port: Number(e.target.value) || 22 })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Usuario">
                <Input value={draft.config.username} onChange={(e) => setConfig({ username: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Carpeta">
                <Input value={draft.config.path} onChange={(e) => setConfig({ path: e.target.value })} />
              </Field>
            </div>
            <Field label="Acceso">
              <ProviderChips
                options={[
                  { id: 'password', label: 'Contraseña' },
                  { id: 'key', label: 'Clave privada SSH' },
                ]}
                value={sftpAuth}
                onChange={(v) => setSftpAuth(v)}
              />
            </Field>
            {sftpAuth === 'password' ? (
              <Field label="Contraseña">
                <Input type="password" value={draft.secrets.password} onChange={(e) => setSecret('password', e.target.value)} placeholder={secretPlaceholder(saved.password)} autoComplete="new-password" />
              </Field>
            ) : (
              <div className="grid gap-4">
                <Field label="Clave privada" hint="Contenido del archivo (por ejemplo id_ed25519), desde -----BEGIN hasta -----END.">
                  <Textarea rows={5} className="font-mono text-xs" value={draft.secrets.privateKey} onChange={(e) => setSecret('privateKey', e.target.value)} placeholder={saved.privateKey ? 'Clave guardada; pegue otra para cambiarla.' : '-----BEGIN OPENSSH PRIVATE KEY-----'} />
                </Field>
                <Field label="Frase de la clave (si tiene)">
                  <Input type="password" value={draft.secrets.passphrase} onChange={(e) => setSecret('passphrase', e.target.value)} placeholder={secretPlaceholder(saved.passphrase)} autoComplete="new-password" />
                </Field>
              </div>
            )}
            {draft.config.hostFingerprint && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                Huella del servidor: <code className="break-all">{draft.config.hostFingerprint}</code>
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setConfig({ hostFingerprint: '' })}>
                  Olvidar
                </button>
              </p>
            )}
          </>
        )}

        {draft.kind === 'webdav' && (
          <>
            <Field label="Servicio">
              <ProviderChips
                options={WEBDAV_PROVIDERS}
                value={draft.config.provider}
                onChange={(id) => {
                  const p = WEBDAV_PROVIDERS.find((x) => x.id === id)!;
                  setDraft((d) => ({ ...d, name: !target && WEBDAV_PROVIDERS.some((x) => x.label === d.name) ? p.label : d.name }));
                  setConfig({ provider: p.id });
                }}
              />
            </Field>
            {davProvider && <Help>{davProvider.help}</Help>}
            <Field label="Dirección de la carpeta" hint={davProvider ? `Ejemplo: ${davProvider.url}` : undefined}>
              <Input value={draft.config.url} onChange={(e) => setConfig({ url: e.target.value.trim() })} placeholder={davProvider?.url} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Usuario">
                <Input value={draft.config.username} onChange={(e) => setConfig({ username: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Contraseña (o de aplicación)">
                <Input type="password" value={draft.secrets.password} onChange={(e) => setSecret('password', e.target.value)} placeholder={secretPlaceholder(saved.password)} autoComplete="new-password" />
              </Field>
            </div>
          </>
        )}

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Nombre del destino">
            <Input value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>
          <Toggle checked={draft.enabled} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} label="Activo" />
        </div>

        {result && (
          <div className={cx('flex gap-2 rounded-ui p-3 text-sm', result.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300')} role="status">
            {result.ok ? <CheckCircle2 className="size-5 shrink-0" /> : <XCircle className="size-5 shrink-0" />}
            <p>{result.message}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Help({ children }: { children: ReactNode }) {
  return <p className="rounded-ui bg-subtle px-3 py-2 text-xs leading-relaxed text-muted">{children}</p>;
}

/** Estado de la subida de una copia a cada destino. */
export function RemoteBadges({ remotes }: { remotes: BackupStatusDTO['items'][number]['remotes'] }) {
  if (!remotes.length) return null;
  return (
    <>
      {remotes.map((r, i) => (
        <Badge key={`${r.targetId}-${i}`} color={r.ok ? '#2563eb' : '#dc2626'}>
          <span title={r.ok ? (r.location ?? '') : (r.error ?? '')} className="inline-flex items-center gap-1">
            {r.ok ? <Cloud className="size-3" /> : <XCircle className="size-3" />}
            {r.ok ? `En ${r.name}` : `No se subió a ${r.name}`}
          </span>
        </Badge>
      ))}
    </>
  );
}
