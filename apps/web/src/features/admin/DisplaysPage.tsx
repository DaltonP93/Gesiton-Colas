import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Columns2,
  ExternalLink,
  Link2,
  Maximize2,
  MonitorPlay,
  Mic,
  Palette,
  Plus,
  RefreshCw,
  Rows3,
  Settings2,
  Trash2,
  Tv,
  Video,
  Volume2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ALERT_SOUNDS,
  ALERT_SOUND_LABELS,
  TEMPLATE_VARIABLES,
  isAlertSound,
  defaultDisplayConfig,
  deepMerge,
  type CallDTO,
  type DisplayConfig,
  type DisplayDTO,
} from '@gc/shared';
import { Link } from 'react-router';
import { CopyField } from '../../components/CopyField';
import { QrCode } from '../../components/QrCode';
import {
  Badge,
  Button,
  Card,
  ChipSelect,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  RangeInput,
  Select,
  Tabs,
  Textarea,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useBranches, useDisplays, useMedia, usePlaylists, useServices } from '../../lib/queries';
import { FONT_OPTIONS } from '../../lib/theme';
import { callSpeechText, pickVoice, playSound, soundUrl, speak } from '../display/useAnnouncer';

const LAYOUTS: { value: DisplayConfig['layout']; label: string; description: string; icon: ReactNode }[] = [
  { value: 'split', label: 'Publicidad + turnos', description: 'Contenido a un lado y panel de llamados al otro.', icon: <Columns2 /> },
  { value: 'fullscreen', label: 'Publicidad a pantalla completa', description: 'El llamado aparece destacado encima del contenido.', icon: <Maximize2 /> },
  { value: 'tickets', label: 'Solo turnos', description: 'Llamado grande e historial. Sin publicidad.', icon: <Rows3 /> },
];

const THEME_PRESETS: { name: string; theme: Partial<DisplayConfig['theme']> }[] = [
  { name: 'Noche', theme: { background: '#0f172a', text: '#f8fafc', panelBackground: '#1e293b', accent: '#38bdf8', callBackground: '#2563eb', callText: '#ffffff' } },
  { name: 'Claro', theme: { background: '#f1f5f9', text: '#0f172a', panelBackground: '#ffffff', accent: '#2563eb', callBackground: '#2563eb', callText: '#ffffff' } },
  { name: 'Salud', theme: { background: '#042f2e', text: '#f0fdfa', panelBackground: '#134e4a', accent: '#2dd4bf', callBackground: '#0d9488', callText: '#ffffff' } },
  { name: 'Retail', theme: { background: '#1c1917', text: '#fafaf9', panelBackground: '#292524', accent: '#fb923c', callBackground: '#ea580c', callText: '#ffffff' } },
  { name: 'Elegante', theme: { background: '#000000', text: '#f5f5f5', panelBackground: '#171717', accent: '#eab308', callBackground: '#facc15', callText: '#0a0a0a' } },
  { name: 'Banco', theme: { background: '#0b1f3a', text: '#e2e8f0', panelBackground: '#12305a', accent: '#60a5fa', callBackground: '#dc2626', callText: '#ffffff' } },
];

export const displayUrl = (token: string) => `${window.location.origin}/pantalla/${token}`;

function online(lastSeenAt: string | null) {
  return Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 3 * 60_000);
}

export default function DisplaysPage() {
  const displays = useDisplays();
  const branches = useBranches();
  const playlists = usePlaylists();
  const { can } = useAuth();
  const [editing, setEditing] = useState<DisplayDTO | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Pantallas"
        description="Cada pantalla tiene su propio enlace: ábralo en el navegador de una Smart TV, Android TV, mini PC, Chromecast con Google TV o Raspberry Pi."
        actions={
          can('admin') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva pantalla
            </Button>
          )
        }
      />
      {displays.isLoading ? (
        <Loading />
      ) : !displays.data?.length ? (
        <EmptyState icon={<Tv />} title="No hay pantallas" description="Cree una pantalla para mostrar los llamados y su publicidad." action={<Button onClick={() => setCreating(true)}>Nueva pantalla</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displays.data.map((d) => {
            const layout = LAYOUTS.find((l) => l.value === d.config.layout);
            const isOnline = online(d.lastSeenAt);
            return (
              <Card key={d.id} padded={false} className="overflow-hidden">
                <div className="relative">
                  <LayoutThumb config={d.config} />
                  <span className={cx('absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-white', isOnline ? 'bg-emerald-600' : 'bg-slate-600')}>
                    <span className={cx('size-1.5 rounded-full', isOnline ? 'bg-white' : 'bg-white/60')} />
                    {isOnline ? 'En línea' : 'Sin conexión'}
                  </span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{d.name}</p>
                      <p className="text-xs text-muted">
                        {branches.data?.find((b) => b.id === d.branchId)?.name} · {layout?.label}
                      </p>
                    </div>
                    <a href={`/pantalla/${d.token}`} target="_blank" rel="noreferrer">
                      <IconButton label="Abrir pantalla" icon={<ExternalLink className="size-4" />} />
                    </a>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Video className="size-3.5" />
                    {playlists.data?.find((p) => p.id === d.playlistId)?.name ?? 'Sin publicidad'}
                    {d.lastSeenAt && <span>· Visto {formatDateTime(d.lastSeenAt)}</span>}
                  </div>
                  <Button variant="secondary" className="mt-4 w-full" icon={<Settings2 className="size-4" />} onClick={() => setEditing(d)}>
                    Configurar
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <CreateDisplayModal open={creating} onClose={() => setCreating(false)} onCreated={(d) => setEditing(d)} />
      {editing && <DisplayEditor display={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreateDisplayModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (d: DisplayDTO) => void }) {
  const branches = useBranches();
  const playlists = usePlaylists();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [layout, setLayout] = useState<DisplayConfig['layout']>('split');
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branches.data, branchId]);
  const create = useMutation({
    mutationFn: () => api.post<DisplayDTO>('/displays', { name, branchId, playlistId: playlists.data?.[0]?.id ?? null, config: { layout } }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['displays'] });
      toast('Pantalla creada');
      setName('');
      onClose();
      onCreated(d);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva pantalla"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim() || !branchId}>
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Sala de espera planta baja" autoFocus />
        </Field>
        <Field label="Sucursal" required>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <LayoutPicker value={layout} onChange={setLayout} />
      </div>
    </Modal>
  );
}

function LayoutPicker({ value, onChange }: { value: DisplayConfig['layout']; onChange: (v: DisplayConfig['layout']) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {LAYOUTS.map((l) => (
        <button
          key={l.value}
          type="button"
          onClick={() => onChange(l.value)}
          className={cx('rounded-ui border-2 p-3 text-left transition [&_svg]:size-6', value === l.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-subtle')}
        >
          <span className={cx(value === l.value ? 'text-primary' : 'text-muted')}>{l.icon}</span>
          <p className="mt-2 text-sm font-semibold">{l.label}</p>
          <p className="mt-0.5 text-xs text-muted">{l.description}</p>
        </button>
      ))}
    </div>
  );
}

type EditorTab = 'general' | 'appearance' | 'voice' | 'media' | 'link';

function DisplayEditor({ display, onClose }: { display: DisplayDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { can, terms } = useAuth();
  const branches = useBranches();
  const services = useServices();
  const playlists = usePlaylists();
  const [tab, setTab] = useState<EditorTab>('general');
  const [name, setName] = useState(display.name);
  const [branchId, setBranchId] = useState(display.branchId);
  const [playlistId, setPlaylistId] = useState<string | null>(display.playlistId);
  const [config, setConfig] = useState<DisplayConfig>(display.config);
  const [token, setToken] = useState(display.token);
  const [previewKey, setPreviewKey] = useState(0);

  const set = (patch: Partial<DisplayConfig> | ((c: DisplayConfig) => Partial<DisplayConfig>)) =>
    setConfig((c) => deepMerge(c, typeof patch === 'function' ? patch(c) : patch));

  const save = useMutation({
    mutationFn: () => api.put<DisplayDTO>(`/displays/${display.id}`, { name, branchId, playlistId, config }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['displays'] });
      toast('Pantalla actualizada. Se aplica al instante en la TV.');
      setTimeout(() => setPreviewKey((k) => k + 1), 600);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const rotate = useMutation({
    mutationFn: () => api.post<DisplayDTO>(`/displays/${display.id}/rotate-token`),
    onSuccess: (d) => {
      setToken(d.token);
      void qc.invalidateQueries({ queryKey: ['displays'] });
      toast('Se generó un nuevo enlace. Actualice la TV con el nuevo enlace.');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/displays/${display.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['displays'] });
      toast('Pantalla eliminada');
      onClose();
    },
  });

  const branch = branches.data?.find((b) => b.id === branchId);
  const branchServices = (services.data ?? []).filter((s) => branch?.services.some((bs) => bs.serviceId === s.id && bs.enabled));

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title={`Configurar pantalla: ${display.name}`}
      description="Los cambios se aplican en la TV al guardar, sin recargar."
      footer={
        <>
          {can('admin') && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: '¿Eliminar esta pantalla?', message: 'La TV dejará de mostrar los llamados.', danger: true, confirmLabel: 'Eliminar' })) remove.mutate();
              }}
            >
              Eliminar
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1fr_minmax(0,520px)]">
        <div className="min-w-0">
          <Tabs<EditorTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'general', label: 'General', icon: <MonitorPlay className="size-4" /> },
              { value: 'appearance', label: 'Apariencia', icon: <Palette className="size-4" /> },
              { value: 'voice', label: 'Voz y sonido', icon: <Mic className="size-4" /> },
              { value: 'media', label: 'Publicidad', icon: <Video className="size-4" /> },
              { value: 'link', label: 'Enlace', icon: <Link2 className="size-4" /> },
            ]}
          />
          <div className="mt-5 space-y-5">
            {tab === 'general' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre">
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label={terms.branch}>
                    <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                      {branches.data?.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Diseño">
                  <LayoutPicker value={config.layout} onChange={(layout) => set({ layout })} />
                </Field>
                <Field label="Título (opcional)" hint="Se muestra en la cabecera, p. ej. «Planta baja – Cajas»">
                  <Input value={config.title} onChange={(e) => set({ title: e.target.value })} />
                </Field>
                <Field label={`${terms.services} que muestra`} hint="Sin selección = todos los de la sucursal. Útil para una pantalla por sector.">
                  <ChipSelect options={branchServices.map((s) => ({ value: s.id, label: s.name, color: s.color }))} value={config.services} onChange={(services) => set({ services })} />
                </Field>
                {config.layout === 'split' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Panel de turnos">
                      <Select value={config.sidebarPosition} onChange={(e) => set({ sidebarPosition: e.target.value as 'left' | 'right' })}>
                        <option value="right">A la derecha</option>
                        <option value="left">A la izquierda</option>
                      </Select>
                    </Field>
                    <RangeInput label="Ancho del panel" value={config.sidebarWidth} min={20} max={60} onChange={(sidebarWidth) => set({ sidebarWidth })} format={(v) => `${v}%`} />
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Toggle checked={config.showLogo} onChange={(showLogo) => set({ showLogo })} label="Mostrar logo" />
                  <Toggle checked={config.showClock} onChange={(showClock) => set({ showClock })} label="Mostrar reloj" />
                  <Toggle checked={config.showDate} onChange={(showDate) => set({ showDate })} label="Mostrar fecha" />
                  <Toggle checked={config.showHistory} onChange={(showHistory) => set({ showHistory })} label="Mostrar últimos llamados" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <RangeInput label="Cantidad en el historial" value={config.historySize} min={1} max={20} onChange={(historySize) => set({ historySize })} />
                  <RangeInput label="Tiempo destacado del llamado" value={config.callHighlightSeconds} min={2} max={60} onChange={(callHighlightSeconds) => set({ callHighlightSeconds })} format={(v) => `${v} s`} />
                </div>
              </>
            )}

            {tab === 'appearance' && (
              <>
                <Field label="Temas rápidos">
                  <div className="flex flex-wrap gap-2">
                    {THEME_PRESETS.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => set({ theme: p.theme as DisplayConfig['theme'] })}
                        className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm hover:bg-subtle"
                      >
                        <span className="flex overflow-hidden rounded-full">
                          <span className="size-5" style={{ background: p.theme.background }} />
                          <span className="size-5" style={{ background: p.theme.callBackground }} />
                        </span>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <ColorInput label="Fondo" value={config.theme.background} onChange={(background) => set({ theme: { ...config.theme, background } })} />
                  <ColorInput label="Texto" value={config.theme.text} onChange={(text) => set({ theme: { ...config.theme, text } })} />
                  <ColorInput label="Paneles" value={config.theme.panelBackground} onChange={(panelBackground) => set({ theme: { ...config.theme, panelBackground } })} />
                  <ColorInput label="Fondo del llamado" value={config.theme.callBackground} onChange={(callBackground) => set({ theme: { ...config.theme, callBackground } })} />
                  <ColorInput label="Texto del llamado" value={config.theme.callText} onChange={(callText) => set({ theme: { ...config.theme, callText } })} />
                  <ColorInput label="Prioridad" value={config.theme.priorityColor} onChange={(priorityColor) => set({ theme: { ...config.theme, priorityColor } })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tipografía">
                    <Select value={config.theme.fontFamily} onChange={(e) => set({ theme: { ...config.theme, fontFamily: e.target.value } })}>
                      {FONT_OPTIONS.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </Select>
                  </Field>
                  <RangeInput label="Tamaño de letra" value={config.theme.fontScale} min={0.6} max={2} step={0.05} onChange={(fontScale) => set({ theme: { ...config.theme, fontScale } })} format={(v) => `${Math.round(v * 100)}%`} />
                </div>
                <Field label="CSS personalizado" hint="Para ajustes avanzados. La pantalla usa la clase .gc-display.">
                  <Textarea rows={5} className="font-mono text-xs" value={config.customCss} onChange={(e) => set({ customCss: e.target.value })} placeholder=".gc-display { letter-spacing: .02em }" />
                </Field>
              </>
            )}

            {tab === 'voice' && <VoiceSettings config={config} set={set} />}

            {tab === 'media' && (
              <>
                <Field label="Lista de reproducción" hint="Videos, imágenes y contenido de otras plataformas que se muestran en esta pantalla.">
                  <Select value={playlistId ?? ''} onChange={(e) => setPlaylistId(e.target.value || null)}>
                    <option value="">Sin publicidad</option>
                    {playlists.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.items.length})
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Toggle checked={config.media.muted} onChange={(muted) => set({ media: { ...config.media, muted } })} label="Silenciar publicidad" />
                  <Toggle checked={config.media.shuffle} onChange={(shuffle) => set({ media: { ...config.media, shuffle } })} label="Orden aleatorio" />
                  <RangeInput label="Volumen de la publicidad" value={config.media.volume} min={0} max={1} step={0.05} onChange={(volume) => set({ media: { ...config.media, volume } })} format={(v) => `${Math.round(v * 100)}%`} />
                  <RangeInput
                    label="Volumen durante un llamado"
                    value={config.media.duckVolume}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(duckVolume) => set({ media: { ...config.media, duckVolume } })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <Field label="Duración por defecto (imágenes/web)">
                    <Input type="number" min={3} value={config.media.defaultDuration} onChange={(e) => set({ media: { ...config.media, defaultDuration: Number(e.target.value) || 15 } })} />
                  </Field>
                  <Field label="Transición">
                    <Select value={config.media.transition} onChange={(e) => set({ media: { ...config.media, transition: e.target.value as DisplayConfig['media']['transition'] } })}>
                      <option value="fade">Fundido</option>
                      <option value="slide">Deslizar</option>
                      <option value="none">Ninguna</option>
                    </Select>
                  </Field>
                  <Field label="Ajuste de imágenes y videos">
                    <Select value={config.media.fitMode} onChange={(e) => set({ media: { ...config.media, fitMode: e.target.value as 'cover' | 'contain' } })}>
                      <option value="cover">Llenar (recortar bordes)</option>
                      <option value="contain">Completo (con fondo difuminado)</option>
                    </Select>
                  </Field>
                </div>
                <MusicSettings config={config} set={set} />
                <Card title="Cintillo de mensajes" description="Texto que se desplaza en la parte inferior.">
                  <div className="space-y-4">
                    <Toggle checked={config.ticker.enabled} onChange={(enabled) => set({ ticker: { ...config.ticker, enabled } })} label="Mostrar cintillo" />
                    <Field label="Mensajes" hint="Uno por línea">
                      <Textarea
                        rows={4}
                        value={config.ticker.messages.join('\n')}
                        onChange={(e) => set({ ticker: { ...config.ticker, messages: e.target.value.split('\n') } })}
                        placeholder={'Bienvenidos\nHorario: lunes a viernes de 8 a 18 h'}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <RangeInput label="Velocidad" value={config.ticker.speed} min={20} max={300} onChange={(speed) => set({ ticker: { ...config.ticker, speed } })} format={(v) => `${v}px/s`} />
                      <ColorInput label="Fondo" value={config.ticker.background} onChange={(background) => set({ ticker: { ...config.ticker, background } })} />
                      <ColorInput label="Texto" value={config.ticker.color} onChange={(color) => set({ ticker: { ...config.ticker, color } })} />
                    </div>
                  </div>
                </Card>
              </>
            )}

            {tab === 'link' && (
              <>
                <Field label="Enlace de la pantalla">
                  <CopyField value={displayUrl(token)} open />
                </Field>
                <div className="flex flex-wrap items-start gap-6">
                  <QrCode text={displayUrl(token)} size={150} className="rounded-ui border border-border bg-white p-2" />
                  <div className="min-w-0 flex-1 space-y-2 text-sm text-muted">
                    <p className="font-medium text-fg">Cómo instalarla</p>
                    <ol className="list-decimal space-y-1 pl-5">
                      <li>
                        Lo más fácil: en la TV abra <strong className="text-fg">{window.location.host}/vincular</strong> y escriba el código en{' '}
                        <Link to="/app/vincular" className="font-medium text-primary hover:underline">
                          Vincular dispositivo
                        </Link>
                        . También puede abrir el enlace directamente o escanear el QR.
                      </li>
                      <li>Toque la pantalla una vez para habilitar el sonido y use el botón de pantalla completa.</li>
                      <li>
                        Para modo kiosco sin interacción en Chrome/Edge:{' '}
                        <code className="rounded bg-subtle px-1 text-xs break-all">--kiosk --autoplay-policy=no-user-gesture-required {displayUrl(token)}</code>
                      </li>
                    </ol>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  icon={<RefreshCw className="size-4" />}
                  loading={rotate.isPending}
                  onClick={async () => {
                    if (await confirm({ title: '¿Generar un nuevo enlace?', message: 'El enlace actual dejará de funcionar.', confirmLabel: 'Generar', danger: true })) rotate.mutate();
                  }}
                >
                  Generar nuevo enlace
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-2 xl:sticky xl:top-0 xl:self-start">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Vista en vivo</p>
            <Badge>Muestra la configuración guardada</Badge>
          </div>
          <ScaledPreview key={`${token}-${previewKey}`} src={`/pantalla/${token}`} />
        </div>
      </div>
    </Modal>
  );
}

/** Miniatura del diseño de la pantalla con sus colores (sin cargar la pantalla real). */
function LayoutThumb({ config }: { config: DisplayConfig }) {
  const { theme } = config;
  const call = (
    <div className="flex flex-col items-center justify-center rounded-md px-2 py-1.5" style={{ background: theme.callBackground, color: theme.callText }}>
      <span className="text-[8px] font-semibold tracking-widest uppercase opacity-80">Llamando</span>
      <span className="text-xl leading-none font-black">A015</span>
      <span className="text-[9px] font-semibold">Ventanilla 2</span>
    </div>
  );
  const rows = (
    <div className="space-y-1">
      {['A014', 'C008', 'A013'].map((c) => (
        <div key={c} className="flex justify-between rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: theme.panelBackground }}>
          <span>{c}</span>
          <span className="opacity-70">V1</span>
        </div>
      ))}
    </div>
  );
  const ads = <div className="size-full bg-gradient-to-br from-indigo-500 via-sky-400 to-emerald-300" />;
  return (
    <div className="flex aspect-video flex-col overflow-hidden" style={{ background: theme.background, color: theme.text }}>
      <div className="flex min-h-0 flex-1">
        {config.layout === 'tickets' ? (
          <div className="grid flex-1 grid-cols-2 gap-2 p-2">
            {call}
            {rows}
          </div>
        ) : config.layout === 'fullscreen' ? (
          <div className="relative flex-1">
            {ads}
            <div className="absolute inset-x-[25%] top-[20%]">{call}</div>
          </div>
        ) : (
          <div className={cx('flex flex-1', config.sidebarPosition === 'left' && 'flex-row-reverse')}>
            <div className="min-w-0 flex-1">{ads}</div>
            <div className="space-y-1.5 p-1.5" style={{ width: `${config.sidebarWidth}%` }}>
              {call}
              {rows}
            </div>
          </div>
        )}
      </div>
      {config.ticker.enabled && <div className="h-2.5 shrink-0" style={{ background: config.ticker.background }} />}
    </div>
  );
}

function ScaledPreview({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="relative aspect-video overflow-hidden rounded-ui border border-border bg-black">
      <iframe
        src={`${src}?preview=1`}
        title="Vista previa de la pantalla"
        className="absolute top-0 left-0 h-[1080px] w-[1920px] origin-top-left border-0"
        style={{ transform: `scale(${width / 1920})` }}
      />
    </div>
  );
}

function MusicSettings({ config, set }: { config: DisplayConfig; set: (p: Partial<DisplayConfig>) => void }) {
  const media = useMedia();
  const audios = (media.data ?? []).filter((m) => m.kind === 'audio');
  const music = config.music;
  const setMusic = (patch: Partial<DisplayConfig['music']>) => set({ music: { ...music, ...patch } });
  return (
    <Card title="Música ambiental" description="Audios o radios que suenan de fondo en la sala de espera. Se atenúan en cada llamado y, mientras suenan, la publicidad se reproduce sin sonido.">
      <div className="space-y-4">
        <Toggle checked={music.enabled} onChange={(enabled) => setMusic({ enabled })} label="Reproducir música ambiental" />
        <Field label="Audios">
          <ChipSelect
            options={audios.map((m) => ({ value: m.id, label: m.name }))}
            value={music.mediaIds}
            onChange={(mediaIds) => setMusic({ mediaIds })}
            emptyLabel="No hay audios en la biblioteca"
          />
        </Field>
        <p className="text-sm text-muted">
          Suba música en{' '}
          <Link to="/app/sonidos" className="font-medium text-primary hover:underline">
            Sonidos de llamado
          </Link>{' '}
          o agregue una radio por URL en la{' '}
          <Link to="/app/contenido" className="font-medium text-primary hover:underline">
            biblioteca de medios
          </Link>
          .
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <RangeInput label="Volumen de la música" value={music.volume} min={0} max={1} step={0.05} onChange={(volume) => setMusic({ volume })} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle checked={music.shuffle} onChange={(shuffle) => setMusic({ shuffle })} label="Orden aleatorio" />
        </div>
      </div>
    </Card>
  );
}

function VoiceSettings({ config, set }: { config: DisplayConfig; set: (p: Partial<DisplayConfig>) => void }) {
  const { terms } = useAuth();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const langVoices = useMemo(() => voices.filter((v) => v.lang.toLowerCase().startsWith(config.voice.lang.slice(0, 2).toLowerCase())), [voices, config.voice.lang]);
  const langs = useMemo(() => [...new Set(['es-ES', 'es-US', 'es-MX', 'es-AR', 'pt-BR', 'en-US', ...voices.map((v) => v.lang)])].sort(), [voices]);
  const sample: CallDTO = {
    ticketId: 'x',
    code: 'A015',
    serviceId: 'x',
    service: 'Atención al cliente',
    serviceColor: '#2563eb',
    counter: `${terms.counter} 2`,
    priority: 'Preferencial',
    priorityWeight: 0,
    priorityColor: '#f59e0b',
    customerName: 'Juan Pérez',
    calledAt: new Date().toISOString(),
    callCount: 1,
  };
  const voice = config.voice;
  const setVoice = (patch: Partial<DisplayConfig['voice']>) => set({ voice: { ...voice, ...patch } });
  const media = useMedia();
  const audios = (media.data ?? []).filter((m) => m.kind === 'audio');
  const isOwnAudio = audios.some((m) => m.url === config.sound.file);
  const isCustomSound = !isAlertSound(config.sound.file) && !isOwnAudio;

  async function test() {
    if (config.sound.enabled) await playSound(soundUrl(config.sound.file), config.sound.volume);
    if (voice.enabled) await speak(callSpeechText(sample, voice, 'Casa central'), voice);
  }

  return (
    <>
      <Card title="Voz" description="Anuncia cada llamado con síntesis de voz del navegador (sin costo, funciona sin internet en la mayoría de los equipos).">
        <div className="space-y-4">
          <Toggle checked={voice.enabled} onChange={(enabled) => setVoice({ enabled })} label="Anunciar llamados por voz" />
          <Field label="Texto a leer" hint={<>Variables: {TEMPLATE_VARIABLES.voice.map((v) => `{{${v}}}`).join(' ')}</>}>
            <Input value={voice.template} onChange={(e) => setVoice({ template: e.target.value })} />
          </Field>
          <p className="rounded-ui bg-subtle px-3 py-2 text-sm">
            <span className="text-muted">Ejemplo: </span>«{callSpeechText(sample, voice, 'Casa central')}»
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Idioma">
              <Select value={voice.lang} onChange={(e) => setVoice({ lang: e.target.value, voiceName: '' })}>
                {langs.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Voz" hint={langVoices.length ? undefined : 'Las voces disponibles dependen del equipo de la pantalla.'}>
              <Select value={voice.voiceName} onChange={(e) => setVoice({ voiceName: e.target.value })}>
                <option value="">Automática ({pickVoice(voices, voice.lang, '')?.name ?? 'predeterminada'})</option>
                {langVoices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lectura del código">
              <Select value={voice.codeMode} onChange={(e) => setVoice({ codeMode: e.target.value as 'spell' | 'number' })}>
                <option value="spell">Dígito por dígito (A 0 1 5)</option>
                <option value="number">Número completo (A 15)</option>
              </Select>
            </Field>
            <Field label="Repeticiones">
              <Select value={voice.repeat} onChange={(e) => setVoice({ repeat: Number(e.target.value) })}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <RangeInput label="Velocidad" value={voice.rate} min={0.5} max={2} step={0.05} onChange={(rate) => setVoice({ rate })} format={(v) => `${v.toFixed(2)}x`} />
            <RangeInput label="Tono" value={voice.pitch} min={0} max={2} step={0.05} onChange={(pitch) => setVoice({ pitch })} format={(v) => v.toFixed(2)} />
            <RangeInput label="Volumen de la voz" value={voice.volume} min={0} max={1} step={0.05} onChange={(volume) => setVoice({ volume })} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        </div>
      </Card>
      <Card title="Sonido de alerta" description="Se reproduce antes de la voz.">
        <div className="space-y-4">
          <Toggle checked={config.sound.enabled} onChange={(enabled) => set({ sound: { ...config.sound, enabled } })} label="Reproducir sonido" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sonido">
              <Select
                value={isCustomSound ? 'custom' : config.sound.file}
                onChange={(e) => set({ sound: { ...config.sound, file: e.target.value === 'custom' ? 'https://' : e.target.value } })}
              >
                {(['Suaves', 'Llamativos', 'Musicales', 'Clásicos'] as const).map((category) => (
                  <optgroup key={category} label={category}>
                    {ALERT_SOUNDS.filter((s) => ALERT_SOUND_LABELS[s].category === category).map((s) => (
                      <option key={s} value={s}>
                        {ALERT_SOUND_LABELS[s].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {audios.length > 0 && (
                  <optgroup label="Sus audios">
                    {audios.map((m) => (
                      <option key={m.id} value={m.url}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="custom">URL propia…</option>
              </Select>
            </Field>
            <RangeInput label="Volumen" value={config.sound.volume} min={0} max={1} step={0.05} onChange={(volume) => set({ sound: { ...config.sound, volume } })} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
          {isCustomSound && (
            <Field label="URL del sonido (MP3/WAV/OGG)">
              <Input value={config.sound.file} onChange={(e) => set({ sound: { ...config.sound, file: e.target.value } })} />
            </Field>
          )}
          <p className="text-sm text-muted">
            Escuche todos los tonos, descárguelos o suba los suyos en{' '}
            <Link to="/app/sonidos" className="font-medium text-primary hover:underline">
              Sonidos de llamado
            </Link>
            .
          </p>
        </div>
      </Card>
      <Button variant="secondary" icon={<Volume2 className="size-4" />} onClick={() => void test()}>
        Probar en este equipo
      </Button>
    </>
  );
}
