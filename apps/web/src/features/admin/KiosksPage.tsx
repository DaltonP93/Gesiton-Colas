import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Palette, Plus, Printer, RefreshCw, Settings2, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  BUILTIN_CUSTOMER_FIELDS,
  DEFAULT_TICKET_CSS,
  DEFAULT_TICKET_TEMPLATE,
  TEMPLATE_VARIABLES,
  deepMerge,
  type KioskConfig,
  type KioskDTO,
} from '@gc/shared';
import { CopyField } from '../../components/CopyField';
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
import { FONT_OPTIONS } from '../../lib/theme';
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
        description="Tótems táctiles o tablets para emitir turnos con impresión y código QR. El mismo enlace funciona como fila virtual desde el celular del cliente."
        actions={
          can('admin') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nuevo kiosco
            </Button>
          )
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
  const set = (patch: Partial<KioskConfig>) => setConfig((c) => deepMerge(c, patch));

  const save = useMutation({
    mutationFn: () => api.put<KioskDTO>(`/kiosks/${kiosk.id}`, { name, branchId, config }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kiosks'] });
      toast('Kiosco actualizado');
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
  };
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
            <Field label="Datos que se piden al cliente" hint="Los campos personalizados se crean en Personalización → Datos del cliente.">
              <ChipSelect options={fields.map((f) => ({ value: f.key, label: `${f.label}${f.required ? ' *' : ''}` }))} value={config.askFields} onChange={(askFields) => set({ askFields })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle checked={config.groupByDepartment} onChange={(groupByDepartment) => set({ groupByDepartment })} label="Agrupar por departamento" />
              <Toggle checked={config.showWaitingCount} onChange={(showWaitingCount) => set({ showWaitingCount })} label="Mostrar personas en espera" />
              <Toggle checked={config.showQr} onChange={(showQr) => set({ showQr })} label="Mostrar QR de seguimiento" hint="El cliente sigue su turno desde el celular." />
            </div>
          </>
        )}

        {tab === 'appearance' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ColorInput label="Fondo" value={config.theme.background} onChange={(background) => set({ theme: { ...config.theme, background } })} />
              <ColorInput label="Texto" value={config.theme.text} onChange={(text) => set({ theme: { ...config.theme, text } })} />
              <ColorInput label="Botones" value={config.theme.buttonBackground} onChange={(buttonBackground) => set({ theme: { ...config.theme, buttonBackground } })} />
              <ColorInput label="Texto de botones" value={config.theme.buttonText} onChange={(buttonText) => set({ theme: { ...config.theme, buttonText } })} />
              <ColorInput label="Botón preferencial" value={config.theme.priorityButtonBackground} onChange={(priorityButtonBackground) => set({ theme: { ...config.theme, priorityButtonBackground } })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tipografía">
                <Select value={config.theme.fontFamily} onChange={(e) => set({ theme: { ...config.theme, fontFamily: e.target.value } })}>
                  {FONT_OPTIONS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </Field>
              <RangeInput label="Tamaño de letra" value={config.theme.fontScale} min={0.7} max={1.8} step={0.05} onChange={(fontScale) => set({ theme: { ...config.theme, fontScale } })} format={(v) => `${Math.round(v * 100)}%`} />
              <RangeInput label="Columnas de botones" value={config.theme.columns} min={1} max={6} onChange={(columns) => set({ theme: { ...config.theme, columns } })} />
            </div>
            <Field label="CSS personalizado" hint="El kiosco usa la clase .gc-kiosk.">
              <Textarea rows={4} className="font-mono text-xs" value={config.customCss} onChange={(e) => set({ customCss: e.target.value })} />
            </Field>
          </>
        )}

        {tab === 'print' && (
          <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
            <div className="space-y-4">
              <Toggle
                checked={config.print.enabled}
                onChange={(enabled) => set({ print: { ...config.print, enabled } })}
                label="Imprimir el ticket automáticamente"
                hint="Use una impresora térmica configurada como predeterminada. En Chrome agregue --kiosk-printing para imprimir sin diálogo."
              />
              <Field label="Ancho del papel">
                <Select value={config.print.paperWidthMm} onChange={(e) => set({ print: { ...config.print, paperWidthMm: Number(e.target.value) } })}>
                  <option value={58}>58 mm</option>
                  <option value={80}>80 mm</option>
                  <option value={100}>100 mm</option>
                </Select>
              </Field>
              <Field label="Plantilla HTML" hint={<>Variables: {TEMPLATE_VARIABLES.ticket.map((v) => `{{${v}}}`).join(' ')}</>}>
                <Textarea rows={10} className="font-mono text-xs" value={config.print.template} onChange={(e) => set({ print: { ...config.print, template: e.target.value } })} />
              </Field>
              <Field label="Estilos (CSS)">
                <Textarea rows={6} className="font-mono text-xs" value={config.print.css} onChange={(e) => set({ print: { ...config.print, css: e.target.value } })} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => void printTicket(config.print, { vars: sampleVars, qrDataUrl: qr, logoUrl: logo })}>
                  Imprimir prueba
                </Button>
                <Button variant="ghost" onClick={() => set({ print: { ...config.print, template: DEFAULT_TICKET_TEMPLATE, css: DEFAULT_TICKET_CSS } })}>
                  Restaurar plantilla original
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
            <Card title="Kiosco / tótem" description="Abra este enlace en la tablet o tótem de la entrada.">
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
