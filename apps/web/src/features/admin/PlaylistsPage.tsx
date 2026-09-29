import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  GripVertical,
  ListVideo,
  MonitorPlay,
  Play,
  Plus,
  Save,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  PROVIDER_LABELS,
  defaultDisplayConfig,
  type MediaDTO,
  type PlaylistDTO,
  type PlaylistItemDTO,
  type Schedule,
} from '@gc/shared';
import {
  Badge,
  Button,
  Card,
  ChipSelect,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  RangeInput,
  Textarea,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import { useDisplays, useMedia, usePlaylists } from '../../lib/queries';
import { MediaPlayer } from '../display/MediaPlayer';
import { MediaThumb } from './MediaPage';

type DraftItem = PlaylistItemDTO & { media: MediaDTO; key: string };

const DAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function scheduleSummary(s: Schedule | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.days?.length) parts.push(DAYS.filter((d) => s.days!.includes(d.value)).map((d) => d.label).join(' '));
  if (s.startTime || s.endTime) parts.push(`${s.startTime ?? '00:00'}–${s.endTime ?? '24:00'}`);
  if (s.startDate || s.endDate) parts.push(`${s.startDate ?? '…'} → ${s.endDate ?? '…'}`);
  return parts.length ? parts.join(' · ') : null;
}

export default function PlaylistsPage() {
  const playlists = usePlaylists();
  const displays = useDisplays();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && playlists.data?.length) setSelectedId(playlists.data[0]!.id);
  }, [playlists.data, selectedId]);

  const create = useMutation({
    mutationFn: () => api.post<PlaylistDTO>('/playlists', { name: `Lista ${(playlists.data?.length ?? 0) + 1}`, items: [] }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      setSelectedId(p.id);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const selected = playlists.data?.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Listas de reproducción"
        description="Ordene su publicidad, defina cuánto dura cada contenido y en qué días u horarios se muestra. Asigne la lista a una o más pantallas."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => create.mutate()} loading={create.isPending}>
            Nueva lista
          </Button>
        }
      />
      {playlists.isLoading ? (
        <Loading />
      ) : !playlists.data?.length ? (
        <EmptyState
          icon={<ListVideo />}
          title="Todavía no hay listas"
          description="Cree una lista y agregue videos, imágenes o contenido de otras plataformas."
          action={<Button onClick={() => create.mutate()}>Crear lista</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card padded={false} className="self-start">
            <ul className="divide-y divide-border">
              {playlists.data.map((p) => {
                const used = displays.data?.filter((d) => d.playlistId === p.id).length ?? 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={cx('w-full px-4 py-3 text-left transition hover:bg-subtle', p.id === selectedId && 'bg-primary/10')}
                    >
                      <p className={cx('truncate text-sm font-semibold', p.id === selectedId && 'text-primary')}>{p.name}</p>
                      <p className="text-xs text-muted">
                        {p.items.length} contenido(s) · {used ? `${used} pantalla(s)` : 'sin asignar'}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          {selected && <PlaylistEditor key={selected.id} playlist={selected} onDeleted={() => setSelectedId(null)} />}
        </div>
      )}
    </div>
  );
}

function PlaylistEditor({ playlist, onDeleted }: { playlist: PlaylistDTO; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const displays = useDisplays();
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description);
  const [items, setItems] = useState<DraftItem[]>(() =>
    playlist.items.filter((i): i is PlaylistItemDTO & { media: MediaDTO } => Boolean(i.media)).map((i) => ({ ...i, key: newKey() })),
  );
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const change = (fn: (list: DraftItem[]) => DraftItem[]) => {
    setItems(fn);
    setDirty(true);
  };
  const patch = (key: string, value: Partial<DraftItem>) => change((list) => list.map((i) => (i.key === key ? { ...i, ...value } : i)));
  const move = (from: number, to: number) =>
    change((list) => {
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item!);
      return copy;
    });

  const save = useMutation({
    mutationFn: () =>
      api.put<PlaylistDTO>(`/playlists/${playlist.id}`, {
        name,
        description,
        items: items.map((i) => ({ mediaId: i.mediaId, duration: i.duration, muted: i.muted, volume: i.volume, schedule: i.schedule, active: i.active })),
      }),
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      toast('Lista guardada. Las pantallas se actualizan automáticamente.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/playlists/${playlist.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      onDeleted();
      toast('Lista eliminada');
    },
  });

  const usedBy = displays.data?.filter((d) => d.playlistId === playlist.id) ?? [];
  const totalSeconds = items.reduce((acc, i) => acc + (i.active ? (i.duration ?? i.media.duration ?? 0) : 0), 0);
  const previewItems = useMemo(() => items, [items]);
  const previewSettings = useMemo(() => defaultDisplayConfig().media, []);
  const scheduleItem = items.find((i) => i.key === scheduleFor) ?? null;

  return (
    <div className="space-y-6">
      <Card
        title={
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="h-9 max-w-md text-base font-semibold"
            aria-label="Nombre de la lista"
          />
        }
        actions={
          <>
            <Button variant="secondary" icon={<Play className="size-4" />} onClick={() => setPreview(true)} disabled={items.length === 0}>
              Vista previa
            </Button>
            <Button icon={<Save className="size-4" />} onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
              Guardar
            </Button>
            <IconButton
              label="Eliminar lista"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: `¿Eliminar la lista «${playlist.name}»?`, message: 'Las pantallas que la usan quedarán sin publicidad.', danger: true, confirmLabel: 'Eliminar' })) {
                  remove.mutate();
                }
              }}
            />
          </>
        }
      >
        <Field label="Descripción">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            placeholder="Opcional"
          />
        </Field>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <MonitorPlay className="size-4" />
          {usedBy.length ? (
            <>
              Se muestra en:{' '}
              {usedBy.map((d) => (
                <Badge key={d.id} color="#2563eb">
                  {d.name}
                </Badge>
              ))}
            </>
          ) : (
            <>
              No está asignada a ninguna pantalla.{' '}
              <Link to="/app/pantallas" className="font-medium text-primary hover:underline">
                Asignar en Pantallas
              </Link>
            </>
          )}
        </div>
      </Card>

      <Card
        title="Contenido"
        description={`${items.length} elemento(s)${totalSeconds ? ` · ~${formatDuration(totalSeconds)} por vuelta (sin contar videos de duración automática)` : ''}`}
        actions={
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>
            Agregar contenido
          </Button>
        }
        padded={false}
      >
        {items.length === 0 ? (
          <div className="p-5">
            <EmptyState title="La lista está vacía" description="Agregue contenido desde su biblioteca." action={<Button onClick={() => setPicker(true)}>Agregar contenido</Button>} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item, index) => {
              const summary = scheduleSummary(item.schedule);
              return (
                <li
                  key={item.key}
                  draggable
                  onDragStart={() => setDragKey(item.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = items.findIndex((i) => i.key === dragKey);
                    if (from >= 0 && from !== index) move(from, index);
                    setDragKey(null);
                  }}
                  className={cx('flex flex-wrap items-center gap-3 px-4 py-3 lg:flex-nowrap', !item.active && 'opacity-50', dragKey === item.key && 'bg-primary/5')}
                >
                  <GripVertical className="size-4 shrink-0 cursor-grab text-muted" />
                  <MediaThumb media={item.media} className="aspect-video w-24 shrink-0 overflow-hidden rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.media.name}</p>
                    <p className="text-xs text-muted">
                      {PROVIDER_LABELS[item.media.provider]}
                      {summary && (
                        <span className="ml-2 inline-flex items-center gap-1 text-primary">
                          <CalendarClock className="size-3" /> {summary}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-24 text-xs"
                      title="Duración en segundos"
                      placeholder={item.media.duration ? `${item.media.duration}s` : 'Auto'}
                      value={item.duration ?? ''}
                      onChange={(e) => patch(item.key, { duration: e.target.value ? Number(e.target.value) : null })}
                    />
                    <IconButton
                      label={item.muted ? 'Activar sonido' : 'Silenciar'}
                      icon={item.muted ? <VolumeX className="size-4 text-red-500" /> : <Volume2 className="size-4" />}
                      onClick={() => patch(item.key, { muted: !item.muted })}
                    />
                    <IconButton label="Programar horario" icon={<CalendarClock className={cx('size-4', summary && 'text-primary')} />} onClick={() => setScheduleFor(item.key)} />
                    <IconButton label="Subir" icon={<ArrowUp className="size-4" />} onClick={() => move(index, index - 1)} disabled={index === 0} />
                    <IconButton label="Bajar" icon={<ArrowDown className="size-4" />} onClick={() => move(index, index + 1)} disabled={index === items.length - 1} />
                    <Toggle checked={item.active} onChange={(active) => patch(item.key, { active })} ariaLabel="Activo en la lista" />
                    <IconButton label="Quitar" icon={<Trash2 className="size-4" />} onClick={() => change((list) => list.filter((i) => i.key !== item.key))} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(picked) => {
          change((list) => [
            ...list,
            ...picked.map((media) => ({
              id: newKey(),
              key: newKey(),
              mediaId: media.id,
              media,
              position: 0,
              duration: null,
              muted: false,
              volume: null,
              schedule: null,
              active: true,
            })),
          ]);
          setPicker(false);
        }}
      />

      {scheduleItem && (
        <ScheduleModal
          item={scheduleItem}
          onClose={() => setScheduleFor(null)}
          onSave={(schedule, volume) => {
            patch(scheduleItem.key, { schedule, volume });
            setScheduleFor(null);
          }}
        />
      )}

      <Modal open={preview} onClose={() => setPreview(false)} title={`Vista previa: ${name}`} description="Así se verá la publicidad en las pantallas (según el horario actual)." size="xl">
        <div className="aspect-video overflow-hidden rounded-ui bg-black">{preview && <MediaPlayer items={previewItems} settings={previewSettings} />}</div>
      </Modal>
    </div>
  );
}

function MediaPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (media: MediaDTO[]) => void }) {
  const media = useMedia();
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);
  const list = media.data ?? [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar contenido"
      size="xl"
      footer={
        <>
          <Link to="/app/contenido" className="mr-auto">
            <Button variant="ghost">Ir a la biblioteca</Button>
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={selected.length === 0} onClick={() => onPick(selected.map((id) => list.find((m) => m.id === id)!).filter(Boolean))}>
            Agregar {selected.length || ''}
          </Button>
        </>
      }
    >
      {media.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState title="La biblioteca está vacía" description="Suba videos o agregue URLs desde la Biblioteca de medios." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((m) => {
            const active = selected.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelected((s) => (active ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                className={cx('overflow-hidden rounded-ui border-2 text-left transition', active ? 'border-primary' : 'border-transparent hover:border-border')}
              >
                <div className="relative aspect-video bg-black">
                  <MediaThumb media={m} className="size-full" />
                  {active && (
                    <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-primary text-primary-fg">
                      <Check className="size-4" />
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted">{PROVIDER_LABELS[m.provider]}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function ScheduleModal({ item, onClose, onSave }: { item: DraftItem; onClose: () => void; onSave: (s: Schedule | null, volume: number | null) => void }) {
  const [s, setS] = useState<Schedule>(item.schedule ?? {});
  const [volume, setVolume] = useState<number | null>(item.volume);
  const clean = (): Schedule | null => {
    const result: Schedule = {
      startDate: s.startDate || null,
      endDate: s.endDate || null,
      days: s.days?.length ? s.days : null,
      startTime: s.startTime || null,
      endTime: s.endTime || null,
    };
    return Object.values(result).some((v) => v !== null) ? result : null;
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Programación: ${item.media.name}`}
      description="Sin programación, el contenido se muestra siempre."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => onSave(null, volume)}>
            Mostrar siempre
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(clean(), volume)}>Aplicar</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Días de la semana" hint="Ninguno seleccionado = todos los días">
          <ChipSelect options={DAYS} value={s.days ?? []} onChange={(days) => setS({ ...s, days })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde (hora)">
            <Input type="time" value={s.startTime ?? ''} onChange={(e) => setS({ ...s, startTime: e.target.value || null })} />
          </Field>
          <Field label="Hasta (hora)" hint="Puede cruzar la medianoche">
            <Input type="time" value={s.endTime ?? ''} onChange={(e) => setS({ ...s, endTime: e.target.value || null })} />
          </Field>
          <Field label="Desde (fecha)">
            <Input type="date" value={s.startDate ?? ''} onChange={(e) => setS({ ...s, startDate: e.target.value || null })} />
          </Field>
          <Field label="Hasta (fecha)">
            <Input type="date" value={s.endDate ?? ''} onChange={(e) => setS({ ...s, endDate: e.target.value || null })} />
          </Field>
        </div>
        <div>
          <Toggle checked={volume !== null} onChange={(on) => setVolume(on ? 1 : null)} label="Volumen propio" hint="Ajusta el volumen de este contenido respecto al general de la pantalla." />
          {volume !== null && (
            <div className="mt-3">
              <RangeInput value={volume} min={0} max={1} step={0.05} onChange={setVolume} format={(v) => `${Math.round(v * 100)}%`} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
