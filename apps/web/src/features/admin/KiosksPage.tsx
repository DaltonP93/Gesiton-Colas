import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Link2, Palette, Plus, Printer, RefreshCw, Settings2, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  BUILTIN_CUSTOMER_FIELDS,
  DEFAULT_TICKET_CSS,
  DEFAULT_TICKET_TEMPLATE,
  TEMPLATE_VARIABLES,
  TICKET_PRESETS,
  deepMerge,
  matchTicketPreset,
  type KioskConfig,
  type KioskDTO,
} from '@gc/shared';
import { CopyField } from '../../components/CopyField';
import { ImageField } from '../../components/ImageField';
import { QrCode, useQrDataUrl } from '../../components/QrCode';
import {
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
import { api, assetUrl, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useBranches, useKiosks, useServices } from '../../lib/queries';
import { FONT_OPTIONS, readableOn } from '../../lib/theme';
import { buildTicketHtml, printTicket } from '../kiosk/printTicket';

const kioskUrl = (token: string, mobile = false) => `${window.location.origin}/kiosco/${token}${mobile ? '?modo=movil' : ''}`;

export default function KiosksPage() {
  const kiosks = useKiosks();
  const branches = useBranches();
  const { can } = useAuth();
  const [editing, setEditing] = useState<KioskDTO | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Kioscos y fila virtual"
        icon={<Tablet />}
        description="Tótems táctiles o tablets para emitir turnos con impresión y código QR. El mismo enlace funciona como fila virtual desde el celular del cliente."
        actions={
          <>
            <Link to="/app/vincular">
              <Button variant="secondary" icon={<Link2 className="size-4" />}>
                Vincular una tablet
              </Button>
            </Link>
            {can('admin') && (
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Nuevo kiosco
              </Button>
            )}
          </>
        }
      />
      {kiosks.isLoading ? (
        <Loading />
      ) : !kiosks.data?.length ? (
        <EmptyState icon={<Tablet />} title="No hay kioscos" action={<Button onClick={() => setCreating(true)}>Nuevo kiosco</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kiosks.data.map((k) => (
            <Card key={k.id} padded={false}>
              <div className="flex items-center gap-4 p-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-ui" style={{ background: k.config.theme.buttonBackground, color: k.config.theme.buttonText }}>
                  <Tablet className="size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{k.name}</p>
                  <p className="truncate text-xs text-muted">
                    {branches.data?.find((b) => b.id === k.branchId)?.name} · {k.lastSeenAt ? `visto ${formatDateTime(k.lastSeenAt)}` : 'nunca conectado'}
                  </p>
                </div>
                <a href={kioskUrl(k.token)} target="_blank" rel="noreferrer">
                  <IconButton label="Abrir kiosco" icon={<ExternalLink className="size-4" />} />
                </a>
              </div>
              <div className="flex gap-2 border-t border-border p-3">
                <Button variant="secondary" className="flex-1" icon={<Settings2 className="size-4" />} onClick={() => setEditing(k)}>
                  Configurar
                </Button>
                <a href={kioskUrl(k.token, true)} target="_blank" rel="noreferrer">
                  <Button variant="ghost" icon={<Smartphone className="size-4" />}>
                    Versión móvil
                  </Button>
                </a>
              </div>
            </Card>
          ))}
          {can('admin') && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-ui border-2 border-dashed border-border p-6 text-center text-muted transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary-text"
            >
              <Plus className="size-7" />
              <span className="font-semibold">Agregar otro kiosco</span>
              <span className="max-w-60 text-xs">Para otra entrada, un piso o un área de triage.</span>
            </button>
          )}
        </div>
      )}
      <CreateKioskModal open={creating} onClose={() => setCreating(false)} onCreated={setEditing} />
      {editing && <KioskEditor kiosk={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreateKioskModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (k: KioskDTO) => void }) {
  const branches = useBranches();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branches.data, branchId]);
  const create = useMutation({
    mutationFn: () => api.post<KioskDTO>('/kiosks', { name, branchId }),
    onSuccess: (k) => {
      void qc.invalidateQueries({ queryKey: ['kiosks'] });
      setName('');
      onClose();
      onCreated(k);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo kiosco"
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Tótem de la entrada" autoFocus />
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
      </div>
    </Modal>
  );
}

type EditorTab = 'general' | 'appearance' | 'print' | 'link';

function KioskEditor({ kiosk, onClose }: { kiosk: KioskDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { settings, terms, me, can } = useAuth();
  const branches = useBranches();
  const services = useServices();
  const [tab, setTab] = useState<EditorTab>('general');
  const [name, setName] = useState(kiosk.name);
  const [branchId, setBranchId] = useState(kiosk.branchId);
  const [config, setConfig] = useState<KioskConfig>(kiosk.config);
  const [token, setToken] = useState(kiosk.token);
  const [previewKey, setPreviewKey] = useState(0);
  const set = (patch: Partial<KioskConfig>) => setConfig((c) => deepMerge(c, patch));

  const save = useMutation({
    mutationFn: () => api.put<KioskDTO>(`/kiosks/${kiosk.id}`, { name, branchId, config }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kiosks'] });
      toast('Kiosco actualizado. Se aplica al instante en el equipo.');
      setTimeout(() => setPreviewKey((k) => k + 1), 600);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const rotate = useMutation({
    mutationFn: () => api.post<KioskDTO>(`/kiosks/${kiosk.id}/rotate-token`),
    onSuccess: (k) => {
      setToken(k.token);
      void qc.invalidateQueries({ queryKey: ['kiosks'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/kiosks/${kiosk.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kiosks'] });
      onClose();
    },
  });

  const branch = branches.data?.find((b) => b.id === branchId);
  const branchServices = (services.data ?? []).filter((s) => branch?.services.some((bs) => bs.serviceId === s.id && bs.enabled));
  const fields = [...BUILTIN_CUSTOMER_FIELDS, ...settings.customerFields];

  const sampleVars = {
    code: 'A015',
    service: branchServices[0]?.name ?? 'Atención al cliente',
    priority: '',
    branch: branch?.name ?? '',
    organization: me?.tenant?.name ?? '',
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    waiting: 4,
    customer: '',
    trackingUrl: `${window.location.origin}/t/ejemplo`,
    header: config.print.headerText,
    footer: config.print.footerText,
  };
  const [advanced, setAdvanced] = useState(false);
  const activePreset = matchTicketPreset(config.print.template, config.print.css);
  const qr = useQrDataUrl(sampleVars.trackingUrl, 240);
  const logo = settings.branding.logoUrl ? assetUrl(settings.branding.logoUrl) : null;
  const ticketHtml = buildTicketHtml(config.print, { vars: sampleVars, qrDataUrl: qr, logoUrl: logo });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Configurar kiosco: ${kiosk.name}`}
      footer={
        <>
          {can('admin') && (
            <Button
              variant="ghost"
              className="mr-auto text-red-600"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: '¿Eliminar este kiosco?', danger: true, confirmLabel: 'Eliminar' })) remove.mutate();
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
      <Tabs<EditorTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General', icon: <Settings2 className="size-4" /> },
          { value: 'appearance', label: 'Apariencia', icon: <Palette className="size-4" /> },
          { value: 'print', label: 'Impresión', icon: <Printer className="size-4" /> },
          { value: 'link', label: 'Enlaces y QR', icon: <Link2 className="size-4" /> },
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
              <Field label="Título">
                <Input value={config.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="Subtítulo">
                <Input value={config.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
              </Field>
            </div>
            <Field label={`${terms.services} disponibles`} hint="Sin selección = todos los habilitados en la sucursal.">
              <ChipSelect options={branchServices.map((s) => ({ value: s.id, label: s.name, color: s.color }))} value={config.services} onChange={(services) => set({ services })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Atención preferencial">
                <Select value={config.priorityMode} onChange={(e) => set({ priorityMode: e.target.value as KioskConfig['priorityMode'] })}>
                  <option value="buttons">Preguntar: normal o preferencial</option>
                  <option value="list">Mostrar todas las prioridades</option>
                  <option value="none">No preguntar (siempre normal)</option>
                </Select>
              </Field>
              <RangeInput label="Volver al inicio tras emitir" value={config.returnSeconds} min={3} max={60} onChange={(returnSeconds) => set({ returnSeconds })} format={(v) => `${v} s`} />
            </div>
            <Field label="Datos que se piden al cliente" hint="Los campos personalizados se crean en Configuración → Datos del cliente.">
              <ChipSelect options={fields.map((f) => ({ value: f.key, label: `${f.label}${f.required ? ' *' : ''}` }))} value={config.askFields} onChange={(askFields) => set({ askFields })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle checked={config.groupByDepartment} onChange={(groupByDepartment) => set({ groupByDepartment })} label="Agrupar por departamento" />
              <Toggle checked={config.showWaitingCount} onChange={(showWaitingCount) => set({ showWaitingCount })} label="Mostrar personas en espera" />
              <Toggle checked={config.showQr} onChange={(showQr) => set({ showQr })} label="Mostrar QR de seguimiento" hint="El cliente sigue su turno desde el celular." />
              <Toggle checked={config.showBranch} onChange={(showBranch) => set({ showBranch })} label={`Mostrar el nombre de la ${terms.branch.toLowerCase()}`} />
            </div>
            <Field label="Texto al pie" hint="Horarios, avisos o un mensaje de bienvenida. Opcional.">
              <Input value={config.footerText} maxLength={300} onChange={(e) => set({ footerText: e.target.value })} placeholder="Ej.: Horario de atención de lunes a viernes de 7 a 19 h" />
            </Field>
            <Card title="Pantalla de espera" description="Tras un tiempo sin uso, el tótem muestra su logo, la hora y una invitación a tocar la pantalla.">
              <div className="space-y-4">
                <Toggle checked={config.idle.enabled} onChange={(enabled) => set({ idle: { ...config.idle, enabled } })} label="Activar pantalla de espera" />
                {config.idle.enabled && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Mensaje">
                      <Input value={config.idle.title} maxLength={120} onChange={(e) => set({ idle: { ...config.idle, title: e.target.value } })} />
                    </Field>
                    <RangeInput label="Aparece después de" value={config.idle.seconds} min={10} max={600} step={10} onChange={(seconds) => set({ idle: { ...config.idle, seconds } })} format={(v) => (v >= 60 ? `${Math.round(v / 6) / 10} min` : `${v} s`)} />
                    <Toggle checked={config.idle.showClock} onChange={(showClock) => set({ idle: { ...config.idle, showClock } })} label="Mostrar la hora" />
                  </div>
                )}
              </div>
            </Card>
          </>
        )}

        {tab === 'appearance' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0 space-y-5">
              <Field label="Temas rápidos">
                <div className="flex flex-wrap gap-2">
                  {kioskThemePresets(settings.branding.primaryColor, settings.branding.accentColor).map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => set({ theme: { ...config.theme, ...p.theme } })}
                      className="flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm hover:bg-subtle"
                    >
                      <span className="flex overflow-hidden rounded-full ring-1 ring-black/10">
                        <span className="size-5" style={{ background: p.theme.background }} />
                        <span className="size-5" style={{ background: p.theme.buttonBackground }} />
                      </span>
                      {p.name}
                    </button>
                  ))}
                </div>
              </Field>
              <Card title="Botones de servicio">
                <div className="space-y-5">
                  <div>
                    <span className="mb-2 block text-sm font-medium">Forma</span>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {BUTTON_STYLES.map((b) => (
                        <button
                          key={b.value}
                          type="button"
                          aria-pressed={config.theme.buttonStyle === b.value}
                          onClick={() => set({ theme: { ...config.theme, buttonStyle: b.value } })}
                          className={cx(
                            'flex flex-col items-center gap-2 rounded-ui border p-2.5 text-xs font-medium transition',
                            config.theme.buttonStyle === b.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:bg-subtle',
                          )}
                        >
                          <span className="grid h-10 w-full place-items-center">{b.preview(config.theme.buttonBackground)}</span>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Tamaño">
                      <Select value={config.theme.buttonSize} onChange={(e) => set({ theme: { ...config.theme, buttonSize: e.target.value as KioskConfig['theme']['buttonSize'] } })}>
                        <option value="md">Mediano</option>
                        <option value="lg">Grande</option>
                        <option value="xl">Muy grande</option>
                      </Select>
                    </Field>
                    <RangeInput label="Columnas" value={config.theme.columns} min={1} max={6} onChange={(columns) => set({ theme: { ...config.theme, columns } })} />
                    <Toggle checked={config.theme.serviceColors} onChange={(serviceColors) => set({ theme: { ...config.theme, serviceColors } })} label={`Un color por ${terms.service.toLowerCase()}`} hint={`Cada botón usa el color de su ${terms.service.toLowerCase()}.`} />
                    <Toggle checked={config.theme.showIcons} onChange={(showIcons) => set({ theme: { ...config.theme, showIcons } })} label="Mostrar íconos" />
                  </div>
                </div>
              </Card>
              <Card title="Colores">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <ColorInput label="Fondo" value={config.theme.background} onChange={(background) => set({ theme: { ...config.theme, background } })} />
                  <ColorInput label="Texto" value={config.theme.text} onChange={(text) => set({ theme: { ...config.theme, text } })} />
                  <ColorInput label="Botones" value={config.theme.buttonBackground} onChange={(buttonBackground) => set({ theme: { ...config.theme, buttonBackground } })} />
                  <ColorInput label="Texto de botones" value={config.theme.buttonText} onChange={(buttonText) => set({ theme: { ...config.theme, buttonText } })} />
                  <ColorInput label="Botón preferencial" value={config.theme.priorityButtonBackground} onChange={(priorityButtonBackground) => set({ theme: { ...config.theme, priorityButtonBackground } })} />
                </div>
              </Card>
              <Card title="Fondo">
                <div className="space-y-4">
                  <Field label="Tipo de fondo">
                    <Select value={config.theme.backgroundStyle} onChange={(e) => set({ theme: { ...config.theme, backgroundStyle: e.target.value as KioskConfig['theme']['backgroundStyle'] } })}>
                      <option value="solid">Color liso</option>
                      <option value="gradient">Degradado</option>
                      <option value="image">Imagen</option>
                    </Select>
                  </Field>
                  {config.theme.backgroundStyle === 'gradient' && (
                    <ColorInput label="Segundo color del degradado" value={config.theme.backgroundTo} onChange={(backgroundTo) => set({ theme: { ...config.theme, backgroundTo } })} />
                  )}
                  {config.theme.backgroundStyle === 'image' && (
                    <>
                      <ImageField
                        label="Imagen de fondo"
                        hint="Una foto del local o una textura. Se aclara u oscurece según el color del texto."
                        value={config.theme.backgroundImageUrl}
                        onChange={(backgroundImageUrl) => set({ theme: { ...config.theme, backgroundImageUrl } })}
                        uploadName="Fondo del kiosco"
                      />
                      <RangeInput
                        label="Velo sobre la imagen"
                        value={config.theme.backgroundOverlay}
                        min={0}
                        max={0.9}
                        step={0.05}
                        onChange={(backgroundOverlay) => set({ theme: { ...config.theme, backgroundOverlay } })}
                        format={(v) => `${Math.round(v * 100)}%`}
                      />
                    </>
                  )}
                </div>
              </Card>
              <Card title="Logo y textos">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Tamaño del logo">
                    <Select value={config.theme.logoSize} onChange={(e) => set({ theme: { ...config.theme, logoSize: e.target.value as KioskConfig['theme']['logoSize'] } })}>
                      <option value="sm">Chico</option>
                      <option value="md">Mediano</option>
                      <option value="lg">Grande</option>
                      <option value="xl">Muy grande</option>
                    </Select>
                  </Field>
                  <Field label="Encabezado">
                    <Select value={config.theme.headerAlign} onChange={(e) => set({ theme: { ...config.theme, headerAlign: e.target.value as KioskConfig['theme']['headerAlign'] } })}>
                      <option value="split">Logo a la izquierda</option>
                      <option value="center">Todo centrado</option>
                    </Select>
                  </Field>
                  <Field label="Tipografía">
                    <Select value={config.theme.fontFamily} onChange={(e) => set({ theme: { ...config.theme, fontFamily: e.target.value } })}>
                      {FONT_OPTIONS.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </Select>
                  </Field>
                  <RangeInput label="Tamaño de letra" value={config.theme.fontScale} min={0.7} max={1.8} step={0.05} onChange={(fontScale) => set({ theme: { ...config.theme, fontScale } })} format={(v) => `${Math.round(v * 100)}%`} />
                </div>
              </Card>
              <Field label="CSS personalizado" hint="El kiosco usa la clase .gc-kiosk.">
                <Textarea rows={4} className="font-mono text-xs" value={config.customCss} onChange={(e) => set({ customCss: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-2 lg:sticky lg:top-0 lg:self-start">
              <p className="text-sm font-medium">Vista en vivo</p>
              <KioskPreview key={`${token}-${previewKey}`} token={token} />
              <p className="text-xs text-muted">Muestra la configuración guardada. Guarde para ver los cambios.</p>
            </div>
          </div>
        )}

        {tab === 'print' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-5">
              <Toggle
                checked={config.print.enabled}
                onChange={(enabled) => set({ print: { ...config.print, enabled } })}
                label="Imprimir el ticket automáticamente"
                hint="Use una impresora térmica configurada como predeterminada. En Chrome agregue --kiosk-printing para imprimir sin diálogo."
              />
              <div>
                <span className="mb-2 block text-sm font-medium">Diseño del ticket</span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {TICKET_PRESETS.map((preset) => {
                    const active = activePreset?.id === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => set({ print: { ...config.print, template: preset.template, css: preset.css } })}
                        className={cx(
                          'flex flex-col overflow-hidden rounded-ui border text-left transition',
                          active ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-primary/40',
                        )}
                      >
                        <TicketThumb html={buildTicketHtml({ ...config.print, template: preset.template, css: preset.css, paperWidthMm: 80 }, { vars: sampleVars, qrDataUrl: qr, logoUrl: logo })} />
                        <span className="border-t border-border p-2.5">
                          <span className="flex items-center gap-1 text-sm font-semibold">
                            {preset.name}
                            {active && <Check className="size-3.5 text-primary-text" />}
                          </span>
                          <span className="block text-xs leading-snug text-muted">{preset.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!activePreset && <p className="mt-2 text-xs text-muted">Está usando un diseño propio editado a mano.</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Texto de encabezado" hint="Aparece arriba del número. Ej.: «Bienvenido»">
                  <Input value={config.print.headerText} maxLength={200} onChange={(e) => set({ print: { ...config.print, headerText: e.target.value } })} />
                </Field>
                <Field label="Texto al pie" hint="Ej.: horario, teléfono o una promoción.">
                  <Input value={config.print.footerText} maxLength={300} onChange={(e) => set({ print: { ...config.print, footerText: e.target.value } })} />
                </Field>
                <Field label="Ancho del papel">
                  <Select value={config.print.paperWidthMm} onChange={(e) => set({ print: { ...config.print, paperWidthMm: Number(e.target.value) } })}>
                    <option value={58}>58 mm</option>
                    <option value={80}>80 mm</option>
                    <option value={100}>100 mm</option>
                  </Select>
                </Field>
              </div>
              <div className="rounded-ui border border-border">
                <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <span>
                    <span className="block text-sm font-medium">Editar HTML y CSS (avanzado)</span>
                    <span className="block text-xs text-muted">Para un diseño totalmente propio con las variables del ticket.</span>
                  </span>
                  <span className="text-sm font-medium text-primary-text">{advanced ? 'Ocultar' : 'Mostrar'}</span>
                </button>
                {advanced && (
                  <div className="space-y-4 border-t border-border p-4">
                    <Field label="Plantilla HTML" hint={<>Variables: {TEMPLATE_VARIABLES.ticket.map((v) => `{{${v}}}`).join(' ')}</>}>
                      <Textarea rows={10} className="font-mono text-xs" value={config.print.template} onChange={(e) => set({ print: { ...config.print, template: e.target.value } })} />
                    </Field>
                    <Field label="Estilos (CSS)">
                      <Textarea rows={6} className="font-mono text-xs" value={config.print.css} onChange={(e) => set({ print: { ...config.print, css: e.target.value } })} />
                    </Field>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => void printTicket(config.print, { vars: sampleVars, qrDataUrl: qr, logoUrl: logo })}>
                  Imprimir prueba
                </Button>
                <Button variant="ghost" onClick={() => set({ print: { ...config.print, template: DEFAULT_TICKET_TEMPLATE, css: DEFAULT_TICKET_CSS } })}>
                  Restaurar diseño original
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Vista previa</p>
              <iframe
                title="Vista previa del ticket"
                srcDoc={ticketHtml}
                sandbox=""
                className="rounded-ui border border-border bg-white shadow-sm"
                style={{ width: `${config.print.paperWidthMm * 3.78 + 2}px`, height: 560 }}
              />
            </div>
          </div>
        )}

        {tab === 'link' && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Kiosco / tótem" description={`Abra este enlace en la tablet o tótem, o abra ${window.location.host}/vincular en el equipo y vincúlelo con el código desde el portal.`}>
              <div className="space-y-4">
                <CopyField value={kioskUrl(token)} open />
                <p className="text-xs text-muted">
                  Recomendado en Chrome/Edge: <code className="rounded bg-subtle px-1 break-all">--kiosk --kiosk-printing {kioskUrl(token)}</code>
                </p>
              </div>
            </Card>
            <Card title="Fila virtual (celular)" description="Imprima este QR y colóquelo en la entrada: los clientes sacan su turno sin tocar el kiosco.">
              <div className="space-y-4">
                <CopyField value={kioskUrl(token, true)} open />
                <div className="flex items-center gap-4">
                  <QrCode text={kioskUrl(token, true)} size={140} className="rounded-ui border border-border bg-white p-2" />
                  <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printPoster(kioskUrl(token, true), settings.branding.appName, logo)}>
                    Imprimir cartel
                  </Button>
                </div>
              </div>
            </Card>
            <div className="md:col-span-2">
              <Button
                variant="secondary"
                icon={<RefreshCw className={cx('size-4', rotate.isPending && 'animate-spin')} />}
                onClick={async () => {
                  if (await confirm({ title: '¿Generar nuevos enlaces?', message: 'Los enlaces y QR actuales dejarán de funcionar.', danger: true, confirmLabel: 'Generar' })) rotate.mutate();
                }}
              >
                Generar nuevos enlaces
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

async function printPoster(url: string, appName: string, logo: string | null) {
  const QR = (await import('qrcode')).default;
  const qr = await QR.toDataURL(url, { width: 900, margin: 1 });
  const win = window.open('', '_blank', 'width=800,height=1000');
  if (!win) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fila virtual</title><style>
    body{font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#0f172a}
    h1{font-size:44px;margin:24px 0 8px} p{font-size:22px;color:#475569} img.qr{width:420px;height:420px;margin:24px auto}
    img.logo{max-height:90px;max-width:320px}
  </style></head><body>
    ${logo ? `<img class="logo" src="${esc(logo)}">` : `<h2>${esc(appName)}</h2>`}
    <h1>Saque su turno desde el celular</h1>
    <p>Escanee el código con la cámara y siga su turno en vivo</p>
    <img class="qr" src="${qr}">
    <p style="font-size:14px">${esc(url)}</p>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`);
  win.document.close();
}

/** Temas rápidos del kiosco (el primero usa los colores de la marca). */
function kioskThemePresets(primary: string, accent: string): { name: string; theme: Partial<KioskConfig['theme']> }[] {
  return [
    { name: 'Mi marca', theme: { background: '#f8fafc', text: '#0f172a', buttonBackground: primary, buttonText: readableOn(primary), priorityButtonBackground: accent, backgroundStyle: 'solid' } },
    { name: 'Degradado', theme: { background: '#eff6ff', backgroundTo: '#dbeafe', text: '#0f172a', buttonBackground: primary, buttonText: readableOn(primary), priorityButtonBackground: accent, backgroundStyle: 'gradient' } },
    { name: 'Oscuro', theme: { background: '#0f172a', backgroundTo: '#1e293b', text: '#f8fafc', buttonBackground: '#1e293b', buttonText: '#f8fafc', priorityButtonBackground: '#f59e0b', backgroundStyle: 'gradient' } },
    { name: 'Alto contraste', theme: { background: '#ffffff', text: '#000000', buttonBackground: '#000000', buttonText: '#ffffff', priorityButtonBackground: '#facc15', backgroundStyle: 'solid' } },
    { name: 'Cálido', theme: { background: '#fff7ed', backgroundTo: '#ffedd5', text: '#431407', buttonBackground: '#ea580c', buttonText: '#ffffff', priorityButtonBackground: '#16a34a', backgroundStyle: 'gradient' } },
  ];
}

const BUTTON_STYLES: { value: KioskConfig['theme']['buttonStyle']; label: string; preview: (color: string) => ReactNode }[] = [
  { value: 'rounded', label: 'Redondeado', preview: (c) => <span className="block h-7 w-full rounded-lg" style={{ background: c }} /> },
  { value: 'pill', label: 'Píldora', preview: (c) => <span className="block h-7 w-full rounded-full" style={{ background: c }} /> },
  { value: 'square', label: 'Recto', preview: (c) => <span className="block h-7 w-full rounded-[3px]" style={{ background: c }} /> },
  { value: 'outline', label: 'Contorno', preview: (c) => <span className="block h-7 w-full rounded-lg" style={{ boxShadow: `inset 0 0 0 2.5px ${c}`, background: `color-mix(in srgb, ${c} 10%, transparent)` }} /> },
  {
    value: 'tile',
    label: 'Mosaico',
    preview: (c) => (
      <span className="flex h-10 w-10 flex-col items-center justify-center gap-1 rounded-lg" style={{ background: c }}>
        <span className="size-3 rounded bg-white/90" />
        <span className="h-1 w-6 rounded bg-white/70" />
      </span>
    ),
  },
];

/** Kiosco real (configuración guardada) escalado en un iframe sin interacción. */
function KioskPreview({ token }: { token: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(272);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="relative aspect-[3/4] overflow-hidden rounded-ui border border-border bg-slate-100 shadow-sm">
      <iframe
        src={`/kiosco/${token}?vista=1`}
        title="Vista previa del kiosco"
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 h-[1440px] w-[1080px] origin-top-left border-0"
        style={{ transform: `scale(${width / 1080})` }}
      />
    </div>
  );
}

/** Miniatura de un diseño de ticket (80 mm) escalada. */
function TicketThumb({ html }: { html: string }) {
  return (
    <span className="relative block h-40 overflow-hidden bg-slate-100">
      <iframe
        title="Diseño de ticket"
        srcDoc={html}
        sandbox=""
        tabIndex={-1}
        className="pointer-events-none absolute top-2 left-1/2 h-[520px] w-[304px] origin-top border-0 bg-white shadow-sm"
        style={{ transform: 'translateX(-50%) scale(0.42)' }}
      />
    </span>
  );
}
