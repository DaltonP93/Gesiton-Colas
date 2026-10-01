import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cloud, DatabaseBackup, Download, Loader2, Play, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BackupDTO, BackupSettings, BackupStatusDTO, PlatformSettings } from '@gc/shared';
import { Badge, Button, EmptyState, Field, IconButton, Loading, Select, Table, Toggle, cx, useFeedback } from '../../components/ui';
import { api, download, errorMessage } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { COMMON_TIMEZONES } from '../admin/customization/presets';
import { BackupTargetsCard, RemoteBadges } from './BackupTargets';

const KEEP_OPTIONS = [3, 7, 14, 30, 60, 90, 180, 365];
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Plataforma → Copias: copias de seguridad automáticas de la base y los archivos. */
export function BackupsTab() {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['platform', 'backups'],
    queryFn: () => api.get<BackupStatusDTO>('/platform/backups'),
    // Mientras una copia está en curso se actualiza solo.
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'running') ? 3000 : false),
  });
  const [form, setForm] = useState<BackupSettings | null>(null);
  useEffect(() => {
    if (status.data && !form) setForm(status.data.settings);
  }, [status.data, form]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'backups'] });
  const save = useMutation({
    mutationFn: (backups: BackupSettings) => api.put<PlatformSettings>('/platform/settings', { backups }),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'settings'], data);
      setForm(data.backups);
      void refresh();
      toast('Configuración de las copias guardada');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const runNow = useMutation({
    mutationFn: () => api.post<BackupDTO>('/platform/backups'),
    onSuccess: () => {
      void refresh();
      toast('Copia iniciada: puede seguir trabajando mientras se crea.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/platform/backups/${id}`), onSuccess: () => void refresh() });
  const retry = useMutation({
    mutationFn: (id: string) => api.post<BackupDTO>(`/platform/backups/${id}/upload`),
    onSuccess: (b) => {
      void refresh();
      const failed = b.remotes.filter((r) => !r.ok);
      toast(failed.length ? `No se pudo subir a ${failed.map((r) => r.name).join(', ')}` : 'Copia subida a los destinos', failed.length ? 'error' : 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (status.isLoading || !form) return <Loading />;
  if (status.isError || !status.data) return <p className="text-sm text-red-600">{errorMessage(status.error)}</p>;
  const data = status.data;
  const dirty = !sameJson(form, data.settings);
  const set = <K extends keyof BackupSettings>(k: K, v: BackupSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const running = data.items.some((b) => b.status === 'running');
  const lastOk = data.items.find((b) => b.status === 'ok');
  const lastFailed = data.items[0]?.status === 'failed' ? data.items[0] : null;
  const timezones = COMMON_TIMEZONES.includes(form.timezone) ? COMMON_TIMEZONES : [form.timezone, ...COMMON_TIMEZONES];

  async function handleDelete(b: BackupDTO) {
    const ok = await confirm({
      title: '¿Borrar esta copia de seguridad?',
      message: `Se borra ${b.file || 'el registro'} del servidor${b.s3Key || b.remotes.some((r) => r.ok) ? ' y de los destinos externos' : ''}. No se puede deshacer.`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(b.id);
      toast('Copia borrada');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function handleDownload(b: BackupDTO) {
    try {
      await download(`/platform/backups/${b.id}/download`, b.file);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="space-y-6">
      {!data.ready && (
        <div className="flex gap-3 rounded-ui border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-5 shrink-0" />
          <p>
            El servidor no tiene <code>pg_dump</code>: las copias no se pueden crear. Con Docker ya viene incluido; sin Docker instale el cliente de PostgreSQL (misma versión que la
            base) o indique su carpeta en <code>PG_BIN_DIR</code>.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard
          tone={lastFailed ? 'bad' : lastOk ? 'good' : 'none'}
          title={lastFailed ? 'La última copia falló' : lastOk ? 'Última copia correcta' : 'Todavía no hay copias'}
          text={lastFailed ? (lastFailed.error ?? 'Error desconocido') : lastOk ? `${formatDateTime(lastOk.finishedAt ?? lastOk.startedAt)} · ${formatBytes(lastOk.sizeBytes)}` : 'Cree la primera ahora.'}
        />
        <StatusCard
          tone={form.enabled ? 'good' : 'none'}
          title={data.settings.enabled ? `Automática todos los días a las ${String(data.settings.hour).padStart(2, '0')}:00` : 'Copia automática desactivada'}
          text={`Se guardan ${data.settings.keepDays} días · ${data.settings.timezone}`}
        />
        <div className="gc-card gc-pad flex flex-col justify-between gap-3">
          <p className="text-sm text-muted">
            Carpeta: <code className="break-all">{data.dir}</code>
          </p>
          <Button icon={running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} disabled={!data.ready || running} loading={runNow.isPending} onClick={() => runNow.mutate()}>
            {running ? 'Copia en curso…' : 'Crear una copia ahora'}
          </Button>
        </div>
      </div>

      <section className="gc-card gc-pad space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Programación</h2>
          <p className="text-sm text-muted">Una copia completa por día: la base de datos (todas las organizaciones) y los archivos subidos.</p>
        </div>
        <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Hacer una copia automática todos los días" />
        <div className={cx('grid gap-5 sm:grid-cols-2 lg:grid-cols-4', !form.enabled && 'pointer-events-none opacity-50')}>
          <Field label="Hora" hint="Elija una hora de poco uso.">
            <Select value={form.hour} onChange={(e) => set('hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zona horaria">
            <Select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </Select>
          </Field>
          <Field label="Guardar durante" hint="Las más viejas se borran solas.">
            <Select value={form.keepDays} onChange={(e) => set('keepDays', Number(e.target.value))}>
              {(KEEP_OPTIONS.includes(form.keepDays) ? KEEP_OPTIONS : [...KEEP_OPTIONS, form.keepDays].sort((a, b) => a - b)).map((d) => (
                <option key={d} value={d}>
                  {d} días
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <Toggle
            checked={form.includeUploads}
            onChange={(v) => set('includeUploads', v)}
            label="Incluir los archivos subidos (videos, imágenes, sonidos)"
            hint="Solo si se guardan en el servidor. Con almacenamiento S3 los archivos ya quedan en el bucket."
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" disabled={!dirty} onClick={() => setForm(data.settings)}>
            Descartar
          </Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(form)}>
            Guardar
          </Button>
        </div>
      </section>

      <BackupTargetsCard data={data} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Copias guardadas</h2>
          <p className="text-sm text-muted">
            Contienen todos los datos, también las claves de las pasarelas: guarde las descargas en un lugar seguro. Para restaurar, vea DESPLIEGUE.md → Copias de seguridad.
          </p>
        </div>
        {!data.items.length ? (
          <EmptyState icon={<DatabaseBackup />} title="Todavía no hay copias" description="La primera se crea a la hora programada, o ahora con «Crear una copia ahora»." />
        ) : (
          <div className="gc-card overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Tipo</th>
                  <th className="text-right">Tamaño</th>
                  <th className="w-full">Archivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap tabular-nums">{formatDateTime(b.startedAt)}</td>
                    <td>
                      <BackupStatus backup={b} />
                    </td>
                    <td className="whitespace-nowrap text-muted">{b.trigger === 'auto' ? 'Automática' : 'Manual'}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{b.status === 'ok' ? formatBytes(b.sizeBytes) : ''}</td>
                    <td className="min-w-64">
                      <span className="font-mono text-xs break-all">{b.file}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5">
                        {b.includesUploads && b.status === 'ok' && <Badge>Con archivos</Badge>}
                        {b.s3Key && !b.remotes.some((r) => r.targetId === null) && (
                          <Badge color="#2563eb">
                            <Cloud className="size-3" /> En S3
                          </Badge>
                        )}
                        <RemoteBadges remotes={b.remotes} />
                        {b.status === 'ok' && !b.available && <Badge color="#b45309">No está en el servidor</Badge>}
                      </span>
                      {b.status === 'failed' && b.error && <p className="mt-1 text-xs text-red-600">{b.error}</p>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        {b.available && b.remotes.some((r) => !r.ok && r.targetId) && (
                          <IconButton label="Volver a subir a los destinos" loading={retry.isPending && retry.variables === b.id} onClick={() => retry.mutate(b.id)}>
                            <UploadCloud className="size-4" />
                          </IconButton>
                        )}
                        <IconButton label="Descargar" disabled={!b.available} onClick={() => void handleDownload(b)}>
                          <Download className="size-4" />
                        </IconButton>
                        <IconButton label="Borrar" disabled={b.status === 'running'} onClick={() => void handleDelete(b)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function BackupStatus({ backup }: { backup: BackupDTO }) {
  if (backup.status === 'running')
    return (
      <Badge color="#2563eb">
        <Loader2 className="size-3 animate-spin" /> En curso
      </Badge>
    );
  if (backup.status === 'failed')
    return (
      <Badge color="#dc2626">
        <XCircle className="size-3" /> Falló
      </Badge>
    );
  return (
    <Badge color="#16a34a">
      <CheckCircle2 className="size-3" /> Correcta
    </Badge>
  );
}

function StatusCard({ tone, title, text }: { tone: 'good' | 'bad' | 'none'; title: string; text: string }) {
  const Icon = tone === 'bad' ? XCircle : tone === 'good' ? CheckCircle2 : DatabaseBackup;
  return (
    <div className="gc-card gc-pad flex gap-3">
      <Icon className={cx('size-6 shrink-0', tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-green-600' : 'text-muted')} />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className={cx('mt-0.5 text-sm break-words', tone === 'bad' ? 'text-red-600' : 'text-muted')}>{text}</p>
      </div>
    </div>
  );
}
