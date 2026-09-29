import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  FileVideo,
  Globe,
  Image as ImageIcon,
  Link2,
  Music,
  Pencil,
  Play,
  Radio,
  Search,
  Trash2,
  Type,
  UploadCloud,
  Video,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  PROVIDER_LABELS,
  UPLOAD_MIME_TYPES,
  audioFromUrl,
  defaultDisplayConfig,
  detectMedia,
  type MediaDTO,
  type PlaylistItemDTO,
} from '@gc/shared';
import {
  Badge,
  Button,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Tabs,
  Textarea,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { api, assetUrl, errorMessage, upload } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBytes, formatDuration } from '../../lib/format';
import { useMedia } from '../../lib/queries';
import { MediaPlayer } from '../display/MediaPlayer';

type Filter = 'all' | 'video' | 'image' | 'audio' | 'platform' | 'text';

const PLATFORM_KINDS = new Set(['youtube', 'vimeo', 'embed', 'hls']);

export const PLATFORMS = [
  'YouTube',
  'Vimeo',
  'TikTok',
  'Instagram',
  'Facebook',
  'Twitch',
  'Dailymotion',
  'Google Drive',
  'Google Slides',
  'Canva',
  'Loom',
  'HLS / m3u8',
  'MP4 / WebM',
  'MP3 / radios',
  'Páginas web',
];

export function MediaThumb({ media, className }: { media: MediaDTO; className?: string }) {
  const icon =
    media.kind === 'hls' ? <Radio /> : media.kind === 'embed' ? <Globe /> : media.kind === 'video' ? <FileVideo /> : <Play />;
  if (media.kind === 'audio') {
    return (
      <div className={cx('grid place-items-center bg-gradient-to-br from-fuchsia-600 to-indigo-700 text-white/90 [&_svg]:size-9', className)}>
        <Music />
      </div>
    );
  }
  if (media.kind === 'text' && media.text) {
    return (
      <div className={cx('flex items-center justify-center p-3 text-center text-sm font-bold', className)} style={{ background: media.text.background, color: media.text.color }}>
        <span className="line-clamp-3">{media.text.content}</span>
      </div>
    );
  }
  if (media.thumbnailUrl) return <img src={assetUrl(media.thumbnailUrl)} alt="" loading="lazy" className={cx('object-cover', className)} />;
  if (media.kind === 'video' && media.provider === 'upload') {
    return <video src={`${assetUrl(media.url)}#t=1`} muted preload="metadata" className={cx('bg-black object-cover', className)} />;
  }
  return <div className={cx('grid place-items-center bg-gradient-to-br from-slate-700 to-slate-900 text-white/80 [&_svg]:size-8', className)}>{icon}</div>;
}

function asPreviewItem(media: MediaDTO): PlaylistItemDTO {
  return { id: `preview-${media.id}`, mediaId: media.id, position: 0, duration: null, muted: false, volume: null, schedule: null, active: true, media };
}

export function MediaPreview({ media, onClose }: { media: MediaDTO | null; onClose: () => void }) {
  const settings = useMemo(() => defaultDisplayConfig().media, []);
  const items = useMemo(() => (media ? [asPreviewItem(media)] : []), [media]);
  return (
    <Modal open={Boolean(media)} onClose={onClose} title={media?.name} description={media ? PROVIDER_LABELS[media.provider] : undefined} size="lg">
      {media && (
        <div className="aspect-video overflow-hidden rounded-ui bg-black">
          <MediaPlayer items={items} settings={{ ...settings, fitMode: 'contain' }} />
        </div>
      )}
    </Modal>
  );
}

export default function MediaPage() {
  const media = useMedia();
  const { can } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<null | 'upload' | 'url' | 'text'>(null);
  const [editing, setEditing] = useState<MediaDTO | null>(null);
  const [preview, setPreview] = useState<MediaDTO | null>(null);
  const usage = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: () => api.get<{ limits: { storageMb: number | null; maxUploadMb: number }; usage: { storageBytes: number } }>('/tenant/usage'),
    enabled: can('admin'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/media/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      void qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      toast('Contenido eliminado');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (media.data ?? []).filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.tags.some((t) => t.toLowerCase().includes(q))) return false;
      if (filter === 'video') return m.kind === 'video';
      if (filter === 'image') return m.kind === 'image';
      if (filter === 'text') return m.kind === 'text';
      if (filter === 'audio') return m.kind === 'audio';
      if (filter === 'platform') return PLATFORM_KINDS.has(m.kind);
      return true;
    });
  }, [media.data, filter, search]);

  return (
    <div>
      <PageHeader
        title="Biblioteca de medios"
        description="Suba videos e imágenes o integre contenido de cualquier plataforma. Luego agréguelo a una lista de reproducción y asígnela a sus pantallas."
        actions={
          <>
            <Button icon={<UploadCloud className="size-4" />} onClick={() => setModal('upload')}>
              Subir archivos
            </Button>
            <Button variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setModal('url')}>
              Desde URL
            </Button>
            <Button variant="secondary" icon={<Type className="size-4" />} onClick={() => setModal('text')}>
              Anuncio de texto
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {PLATFORMS.map((p) => (
          <Badge key={p}>{p}</Badge>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'Todo' },
              { value: 'video', label: 'Videos', icon: <Video className="size-4" /> },
              { value: 'image', label: 'Imágenes', icon: <ImageIcon className="size-4" /> },
              { value: 'audio', label: 'Audio', icon: <Music className="size-4" /> },
              { value: 'platform', label: 'Plataformas', icon: <Globe className="size-4" /> },
              { value: 'text', label: 'Textos', icon: <Type className="size-4" /> },
            ]}
          />
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o etiqueta" className="pl-9" />
        </div>
      </div>

      {media.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Video />}
          title={media.data?.length ? 'No hay resultados' : 'Su biblioteca está vacía'}
          description="Suba un video promocional, agregue un video de YouTube o cree un anuncio de texto."
          action={
            <Button icon={<UploadCloud className="size-4" />} onClick={() => setModal('upload')}>
              Subir archivos
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((m) => (
            <article key={m.id} className="group overflow-hidden rounded-ui border border-border bg-surface shadow-sm">
              <button type="button" onClick={() => setPreview(m)} className="relative block aspect-video w-full overflow-hidden bg-black">
                <MediaThumb media={m} className="size-full" />
                <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                  <Eye className="size-8" />
                </span>
                <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">{PROVIDER_LABELS[m.provider]}</span>
              </button>
              <div className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={m.name}>
                    {m.name}
                  </p>
                  <p className="text-xs text-muted">
                    {m.duration ? formatDuration(m.duration) : 'Hasta terminar'}
                    {m.sizeBytes > 0 && ` · ${formatBytes(m.sizeBytes)}`}
                  </p>
                  {m.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <IconButton label="Editar" icon={<Pencil className="size-4" />} onClick={() => setEditing(m)} />
                <IconButton
                  label="Eliminar"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => {
                    if (await confirm({ title: `¿Eliminar «${m.name}»?`, message: 'También se quitará de las listas de reproducción.', danger: true, confirmLabel: 'Eliminar' })) {
                      remove.mutate(m.id);
                    }
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {usage.data && (
        <p className="mt-6 text-sm text-muted">
          Almacenamiento usado: <strong>{formatBytes(usage.data.usage.storageBytes)}</strong>
          {usage.data.limits.storageMb !== null && ` de ${formatBytes(usage.data.limits.storageMb * 1024 * 1024)}`} · Máximo por archivo:{' '}
          {usage.data.limits.maxUploadMb} MB
        </p>
      )}

      <UploadModal open={modal === 'upload'} onClose={() => setModal(null)} />
      <UrlModal open={modal === 'url'} onClose={() => setModal(null)} />
      <TextModal open={modal === 'text'} onClose={() => setModal(null)} />
      <EditModal media={editing} onClose={() => setEditing(null)} />
      <MediaPreview media={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface UploadItem {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [imageDuration, setImageDuration] = useState(10);
  const [tags, setTags] = useState('');
  const [dragging, setDragging] = useState(false);
  const busy = items.some((i) => i.status === 'uploading');

  const add = (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => UPLOAD_MIME_TYPES[f.type]);
    if (accepted.length < Array.from(files).length) toast('Algunos archivos no son compatibles (use MP4, WebM, JPG, PNG, GIF, WebP, SVG, MP3, WAV u OGG)', 'error');
    setItems((prev) => [...prev, ...accepted.map((file) => ({ file, progress: 0, status: 'pending' as const }))]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  async function start() {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.status === 'done') continue;
      const update = (patch: Partial<UploadItem>) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      update({ status: 'uploading', progress: 0 });
      try {
        const fields: Record<string, string> = { name: item.file.name.replace(/\.[^.]+$/, '') };
        if (tags.trim()) fields.tags = tags;
        if (UPLOAD_MIME_TYPES[item.file.type] === 'image') fields.duration = String(imageDuration);
        await upload<MediaDTO>('/media/upload', item.file, fields, (p) => update({ progress: p }));
        update({ status: 'done', progress: 1 });
      } catch (error) {
        update({ status: 'error', error: errorMessage(error) });
      }
    }
    void qc.invalidateQueries({ queryKey: ['media'] });
    void qc.invalidateQueries({ queryKey: ['tenant-usage'] });
  }

  const close = () => {
    if (busy) return;
    const done = items.filter((i) => i.status === 'done').length;
    if (done) toast(`${done} archivo(s) subido(s)`);
    setItems([]);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Subir videos, imágenes y audios"
      description="MP4, WebM, MOV, JPG, PNG, GIF, WebP, SVG, MP3, WAV, OGG o M4A. Videos y audios se reproducen completos; las imágenes durante el tiempo indicado."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cerrar
          </Button>
          <Button onClick={() => void start()} loading={busy} disabled={!items.some((i) => i.status === 'pending' || i.status === 'error')}>
            Subir {items.filter((i) => i.status !== 'done').length || ''}
          </Button>
        </>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center rounded-ui border-2 border-dashed px-6 py-10 text-center transition',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-subtle',
        )}
      >
        <UploadCloud className="size-10 text-primary" />
        <p className="mt-3 font-medium">Arrastre archivos aquí o haga clic para seleccionar</p>
        <p className="text-sm text-muted">Puede subir varios a la vez</p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={Object.keys(UPLOAD_MIME_TYPES).join(',')}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Duración de las imágenes (segundos)">
          <Input type="number" min={1} value={imageDuration} onChange={(e) => setImageDuration(Number(e.target.value) || 10)} />
        </Field>
        <Field label="Etiquetas (opcional)" hint="Separadas por comas, p. ej. promo, verano">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-ui border border-border">
          {items.map((item, i) => (
            <li key={`${item.file.name}-${i}`} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {formatBytes(item.file.size)} ·{' '}
                  {item.status === 'done' ? 'Listo' : item.status === 'error' ? 'Error' : item.status === 'uploading' ? `${Math.round(item.progress * 100)}%` : 'Pendiente'}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                <div
                  className={cx('h-full rounded-full transition-all', item.status === 'error' ? 'bg-red-500' : item.status === 'done' ? 'bg-emerald-500' : 'bg-primary')}
                  style={{ width: `${Math.max(item.progress, item.status === 'error' ? 1 : 0) * 100}%` }}
                />
              </div>
              {item.error && <p className="mt-1 text-xs text-red-600">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function UrlModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('');
  const [asAudio, setAsAudio] = useState(false);
  const detected = useMemo(() => (url.trim().length > 4 ? (asAudio ? audioFromUrl(url) : detectMedia(url)) : null), [url, asAudio]);
  const needsDuration = detected && ['embed', 'image', 'hls'].includes(detected.kind);

  const save = useMutation({
    mutationFn: () =>
      api.post<MediaDTO>('/media', {
        url,
        asAudio: asAudio || undefined,
        name: name || undefined,
        duration: duration ? Number(duration) : needsDuration ? (detected?.suggestedDuration ?? 30) : null,
      }),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      toast(`«${m.name}» agregado`);
      setUrl('');
      setName('');
      setDuration('');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const previewSrc = detected?.embedUrl?.replace(/\{\{host\}\}/g, window.location.hostname);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar desde una URL"
      description="Pegue el enlace de YouTube, Vimeo, TikTok, Instagram, Facebook, Twitch, Dailymotion, Google Drive, Google Slides, Canva, Loom, una transmisión HLS, un video/imagen o cualquier página web."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!detected}>
            Agregar a la biblioteca
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="URL">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
        </Field>
        <Toggle checked={asAudio} onChange={setAsAudio} label="Es una radio o audio por streaming" hint="Actívelo para enlaces de radios online (Icecast/Shoutcast) que no terminan en .mp3." />
        {detected && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge color="#2563eb">{PROVIDER_LABELS[detected.provider]}</Badge>
              <span className="text-muted">
                {detected.kind === 'audio'
                  ? 'Audio: úselo como música ambiental, sonido de llamado o dentro de una lista.'
                  : detected.kind === 'embed'
                  ? 'Se mostrará embebido durante el tiempo indicado.'
                  : ['youtube', 'vimeo', 'video'].includes(detected.kind)
                    ? 'Se reproducirá hasta terminar (o durante el tiempo indicado).'
                    : detected.kind === 'hls'
                      ? 'Transmisión en vivo: indique cuánto tiempo mostrarla.'
                      : 'Se mostrará durante el tiempo indicado.'}
              </span>
            </div>
            <div className="aspect-video overflow-hidden rounded-ui border border-border bg-black">
              {detected.kind === 'audio' ? (
                <div className="grid size-full place-items-center">
                  <audio src={detected.url} controls className="w-3/4" />
                </div>
              ) : detected.kind === 'image' ? (
                <img src={detected.url} alt="" className="size-full object-contain" />
              ) : detected.kind === 'video' ? (
                <video src={detected.url} controls muted className="size-full" />
              ) : previewSrc ? (
                <iframe src={previewSrc} title="Vista previa" className="size-full border-0" allow="autoplay; encrypted-media" sandbox="allow-scripts allow-same-origin allow-presentation" />
              ) : (
                <div className="grid size-full place-items-center text-sm text-white/70">Vista previa no disponible</div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={detected.suggestedName} />
              </Field>
              <Field label="Duración (segundos)" hint={needsDuration ? `Sugerido: ${detected.suggestedDuration ?? 30}` : 'Vacío = hasta que termine'}>
                <Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={needsDuration ? String(detected.suggestedDuration ?? 30) : 'Automática'} />
              </Field>
            </div>
          </>
        )}
        {url.trim().length > 4 && !detected && <p className="text-sm text-red-600">La URL no es válida.</p>}
      </div>
    </Modal>
  );
}

function TextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ content: '', subtitle: '', background: '#1e3a8a', color: '#ffffff', duration: 10 });
  const save = useMutation({
    mutationFn: () =>
      api.post<MediaDTO>('/media', {
        text: { content: form.content, subtitle: form.subtitle || undefined, background: form.background, color: form.color },
        duration: form.duration,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      toast('Anuncio creado');
      setForm((f) => ({ ...f, content: '', subtitle: '' }));
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Anuncio de texto"
      description="Ideal para promociones, avisos, horarios o mensajes institucionales."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.content.trim()}>
            Crear anuncio
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Texto principal" required>
            <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} maxLength={500} rows={3} />
          </Field>
          <Field label="Subtítulo">
            <Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} maxLength={300} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <ColorInput label="Fondo" value={form.background} onChange={(background) => setForm({ ...form, background })} />
            <ColorInput label="Texto" value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </div>
          <Field label="Duración (segundos)">
            <Input type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) || 10 })} />
          </Field>
        </div>
        <div className="flex aspect-video flex-col items-center justify-center self-start rounded-ui p-6 text-center" style={{ background: form.background, color: form.color }}>
          <p className="text-2xl leading-tight font-extrabold">{form.content || 'Vista previa'}</p>
          {form.subtitle && <p className="mt-2 opacity-85">{form.subtitle}</p>}
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ media, onClose }: { media: MediaDTO | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: '', duration: '', tags: '', content: '', subtitle: '', background: '#1e3a8a', color: '#ffffff' });
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (media && loadedId !== media.id) {
    setLoadedId(media.id);
    setForm({
      name: media.name,
      duration: media.duration ? String(media.duration) : '',
      tags: media.tags.join(', '),
      content: media.text?.content ?? '',
      subtitle: media.text?.subtitle ?? '',
      background: media.text?.background ?? '#1e3a8a',
      color: media.text?.color ?? '#ffffff',
    });
  }
  const save = useMutation({
    mutationFn: () =>
      api.put(`/media/${media!.id}`, {
        name: form.name,
        duration: form.duration ? Number(form.duration) : null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        ...(media?.kind === 'text' ? { text: { content: form.content, subtitle: form.subtitle || undefined, background: form.background, color: form.color } } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      toast('Cambios guardados');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open={Boolean(media)}
      onClose={onClose}
      title="Editar contenido"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Duración por defecto (segundos)" hint="Vacío = hasta que termine (videos). Cada lista puede definir su propia duración.">
          <Input type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
        </Field>
        <Field label="Etiquetas" hint="Separadas por comas">
          <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
        {media?.kind === 'text' && (
          <>
            <Field label="Texto principal">
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </Field>
            <Field label="Subtítulo">
              <Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <ColorInput label="Fondo" value={form.background} onChange={(background) => setForm({ ...form, background })} />
              <ColorInput label="Texto" value={form.color} onChange={(color) => setForm({ ...form, color })} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
