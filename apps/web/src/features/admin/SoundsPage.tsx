import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Link2, Mic, Music, Pause, Play, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ALERT_SOUNDS, ALERT_SOUND_LABELS, type DisplayDTO, type MediaDTO } from '@gc/shared';
import { Badge, Button, Card, EmptyState, IconButton, Input, Loading, Modal, PageHeader, Select, useFeedback } from '../../components/ui';
import { api, assetUrl, errorMessage, upload } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useDisplays, useMedia } from '../../lib/queries';
import { soundUrl } from '../display/useAnnouncer';

const AUDIO_ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/opus,audio/mp4,audio/x-m4a,audio/aac,audio/flac,audio/webm';
const CATEGORIES = ['Suaves', 'Llamativos', 'Musicales', 'Clásicos'] as const;

/** Reproductor único: al tocar otro sonido se detiene el anterior. */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (id: string, url: string) => {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const el = new Audio(url);
    audio.current = el;
    el.onended = () => setPlaying(null);
    void el.play().catch(() => setPlaying(null));
    setPlaying(id);
  };
  return { playing, toggle };
}

export default function SoundsPage() {
  const media = useMedia();
  const displays = useDisplays();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const preview = usePreview();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [assign, setAssign] = useState<{ file: string; label: string } | null>(null);

  const custom = useMemo(() => (media.data ?? []).filter((m) => m.kind === 'audio'), [media.data]);
  const usedBy = (file: string) => (displays.data ?? []).filter((d) => d.config.sound.enabled && d.config.sound.file === file);

  async function uploadFiles(files: FileList) {
    for (const file of Array.from(files)) {
      setUploading(0);
      try {
        await upload<MediaDTO>('/media/upload', file, { name: file.name.replace(/\.[^.]+$/, ''), tags: 'sonido' }, setUploading);
        toast(`«${file.name}» agregado`);
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }
    setUploading(null);
    void qc.invalidateQueries({ queryKey: ['media'] });
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/media/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      toast('Audio eliminado');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sonidos de llamado"
        description="Elija el tono que suena antes de anunciar cada turno. Puede escucharlos, descargarlos, subir sus propios audios (MP3, WAV, OGG, M4A) y usarlos también como música ambiental."
        actions={
          <>
            <Button icon={<UploadCloud className="size-4" />} onClick={() => input.current?.click()} loading={uploading !== null}>
              {uploading !== null ? `Subiendo ${Math.round(uploading * 100)}%` : 'Subir audio'}
            </Button>
            <input
              ref={input}
              type="file"
              accept={AUDIO_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        }
      />

      {CATEGORIES.map((category) => {
        const sounds = ALERT_SOUNDS.filter((s) => ALERT_SOUND_LABELS[s].category === category);
        return (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{category}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sounds.map((id) => (
                <SoundCard
                  key={id}
                  label={ALERT_SOUND_LABELS[id].label}
                  playing={preview.playing === id}
                  onPlay={() => preview.toggle(id, soundUrl(id))}
                  downloadUrl={soundUrl(id)}
                  downloadName={`${id}.wav`}
                  usedBy={usedBy(id)}
                  onAssign={() => setAssign({ file: id, label: ALERT_SOUND_LABELS[id].label })}
                />
              ))}
            </div>
          </section>
        );
      })}

      <Card title="Sus audios" description="Audios subidos por su organización. Sirven como sonido de llamado o como música ambiental de las pantallas." padded={false}>
        {media.isLoading ? (
          <Loading />
        ) : custom.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Music />}
              title="Todavía no subió audios"
              description="Suba un jingle, una voz grabada («Turno, por favor acérquese») o música para la sala de espera."
              action={
                <Button icon={<UploadCloud className="size-4" />} onClick={() => input.current?.click()}>
                  Subir audio
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {custom.map((m) => {
              const url = m.url;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <IconButton
                    label={preview.playing === m.id ? 'Pausar' : 'Escuchar'}
                    icon={preview.playing === m.id ? <Pause className="size-4" /> : <Play className="size-4" />}
                    onClick={() => preview.toggle(m.id, assetUrl(url))}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="text-xs text-muted">
                      {m.provider === 'upload' ? formatBytes(m.sizeBytes) : 'Audio por URL'}
                      {usedBy(url).length > 0 && ` · en ${usedBy(url).map((d) => d.name).join(', ')}`}
                    </p>
                  </div>
                  <a href={assetUrl(url)} download>
                    <IconButton label="Descargar" icon={<Download className="size-4" />} />
                  </a>
                  <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setAssign({ file: url, label: m.name })}>
                    Usar en pantalla
                  </Button>
                  <IconButton
                    label="Eliminar"
                    icon={<Trash2 className="size-4" />}
                    onClick={async () => {
                      if (await confirm({ title: `¿Eliminar «${m.name}»?`, danger: true, confirmLabel: 'Eliminar' })) remove.mutate(m.id);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border px-5 py-3 text-sm text-muted">
          ¿Radio o música por streaming? Agréguela como URL en la{' '}
          <Link to="/app/contenido" className="font-medium text-primary hover:underline">
            biblioteca de medios
          </Link>{' '}
          y actívela en <strong>Pantallas → Publicidad → Música ambiental</strong>.
        </div>
      </Card>

      <VoicesCard />

      {assign && <AssignModal sound={assign} displays={displays.data ?? []} onClose={() => setAssign(null)} />}
    </div>
  );
}

function SoundCard({
  label,
  playing,
  onPlay,
  downloadUrl,
  downloadName,
  usedBy,
  onAssign,
}: {
  label: string;
  playing: boolean;
  onPlay: () => void;
  downloadUrl: string;
  downloadName: string;
  usedBy: DisplayDTO[];
  onAssign: () => void;
}) {
  return (
    <div className="gc-card flex items-center gap-3 p-3">
      <button
        type="button"
        onClick={onPlay}
        aria-label={playing ? `Detener ${label}` : `Escuchar ${label}`}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition hover:brightness-110"
      >
        {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {usedBy.length > 0 ? (
          <p className="flex items-center gap-1 truncate text-xs text-emerald-600">
            <Check className="size-3" /> {usedBy.map((d) => d.name).join(', ')}
          </p>
        ) : (
          <p className="text-xs text-muted">WAV · libre uso</p>
        )}
      </div>
      <a href={downloadUrl} download={downloadName}>
        <IconButton label="Descargar" icon={<Download className="size-4" />} />
      </a>
      <Button size="sm" variant="ghost" onClick={onAssign}>
        Usar
      </Button>
    </div>
  );
}

function AssignModal({ sound, displays, onClose }: { sound: { file: string; label: string }; displays: DisplayDTO[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [displayId, setDisplayId] = useState(displays[0]?.id ?? 'all');
  const save = useMutation({
    mutationFn: async () => {
      const targets = displayId === 'all' ? displays : displays.filter((d) => d.id === displayId);
      await Promise.all(targets.map((d) => api.put(`/displays/${d.id}`, { config: { sound: { enabled: true, file: sound.file } } })));
      return targets.length;
    },
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ['displays'] });
      toast(`«${sound.label}» se usará en ${n} pantalla(s)`);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Usar «${sound.label}»`}
      description="El cambio se aplica al instante en la TV."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={displays.length === 0}>
            Aplicar
          </Button>
        </>
      }
    >
      {displays.length === 0 ? (
        <p className="text-sm text-muted">No hay pantallas creadas.</p>
      ) : (
        <Select value={displayId} onChange={(e) => setDisplayId(e.target.value)} aria-label="Pantalla">
          <option value="all">Todas las pantallas ({displays.length})</option>
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      )}
    </Modal>
  );
}

/** Voces instaladas en este equipo y cómo sumar más. */
function VoicesCard() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [text, setText] = useState('Turno A 0 1 5, por favor diríjase a ventanilla 2');
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const spanish = voices.filter((v) => /^(es|pt|en)/i.test(v.lang)).sort((a, b) => a.lang.localeCompare(b.lang));
  const speak = (voice: SpeechSynthesisVoice) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Mic className="size-5 text-primary" /> Voces para anunciar
        </span>
      }
      description="La voz la genera el equipo donde está la pantalla (sin costo y sin internet). Estas son las voces disponibles en este navegador."
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} className="mb-4" aria-label="Texto de prueba" />
      {spanish.length === 0 ? (
        <p className="text-sm text-muted">Este navegador no informó voces. Pruebe en Chrome, Edge o Safari.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {spanish.map((v) => (
            <button key={`${v.name}-${v.lang}`} type="button" onClick={() => speak(v)} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-subtle">
              <Play className="size-3.5 text-primary" /> {v.name} <Badge>{v.lang}</Badge>
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 grid gap-3 text-sm text-muted sm:grid-cols-3">
        <p>
          <strong className="text-fg">Windows:</strong> Configuración → Hora e idioma → Voz → Agregar voces (p. ej. Español México / España).
        </p>
        <p>
          <strong className="text-fg">Android / Google TV:</strong> Ajustes → Accesibilidad → Salida de texto a voz → Motor de Google → Instalar datos de voz.
        </p>
        <p>
          <strong className="text-fg">macOS / iPad:</strong> Accesibilidad → Contenido leído → Voces del sistema → Administrar voces.
        </p>
      </div>
      <p className="mt-3 text-sm text-muted">
        ¿Prefiere una voz grabada? Suba un audio arriba y úselo como sonido de llamado, y desactive la voz en la pantalla.
      </p>
    </Card>
  );
}
