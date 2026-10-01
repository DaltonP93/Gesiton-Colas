import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, MessageCircle, RotateCcw, Settings2, TextQuote } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  NOTIFY_EVENT_LABELS,
  NOTIFY_EVENTS,
  NOTIFY_PROVIDER_LABELS,
  renderTemplate,
  type NotificationSettings,
  type NotifyEvent,
  type NotifyMessageDTO,
  type NotifyStatusDTO,
} from '@gc/shared';
import { NotifyProviderForm } from '../../components/NotifyProviderForm';
import { Badge, Button, EmptyState, Field, Input, Loading, PageHeader, Select, Table, Tabs, Textarea, Toggle, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { Callout, SaveBar, Section, sameJson, useSaveTenant } from './customization/common';

type TabKey = 'canal' | 'mensajes' | 'historial';

export default function NotificationsPage() {
  const [tab, setTab] = useState<TabKey>('canal');
  const { terms } = useAuth();
  return (
    <div>
      <PageHeader
        icon={<MessageCircle />}
        title="Avisos por WhatsApp y SMS"
        description={`Avise al ${terms.customer.toLowerCase()} cuando saca su ${terms.ticket.toLowerCase()}, cuando se acerca, cuando lo llaman y al terminar (con la encuesta).`}
      />
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'canal', label: 'Canal de envío', icon: <Settings2 className="size-4" /> },
          { value: 'mensajes', label: 'Mensajes', icon: <TextQuote className="size-4" /> },
          { value: 'historial', label: 'Historial', icon: <History className="size-4" /> },
        ]}
      />
      <div className="mt-[var(--gc-gap)]">
        {tab === 'canal' && <NotifyProviderForm scope="tenant" />}
        {tab === 'mensajes' && <MessagesTab />}
        {tab === 'historial' && <HistoryTab />}
      </div>
    </div>
  );
}

/* ------------------------------ Mensajes ------------------------------ */

const SAMPLE: Record<string, string | number> = {
  code: 'A015',
  service: 'Consultas',
  branch: 'Casa central',
  counter: 'Box 3',
  customer: 'María',
  waiting: 4,
  remaining: 3,
  link: 'https://turnos.ejemplo.com/t/abc123',
  survey: 'https://turnos.ejemplo.com/encuesta/xyz',
  organization: 'Su organización',
};

const VARIABLES: { key: string; label: string; events?: NotifyEvent[] }[] = [
  { key: 'customer', label: 'Nombre' },
  { key: 'code', label: 'Número' },
  { key: 'service', label: 'Servicio' },
  { key: 'branch', label: 'Sucursal' },
  { key: 'counter', label: 'Puesto', events: ['called'] },
  { key: 'waiting', label: 'Personas antes', events: ['created'] },
  { key: 'remaining', label: 'Turnos que faltan', events: ['near'] },
  { key: 'link', label: 'Enlace de seguimiento', events: ['created', 'near'] },
  { key: 'survey', label: 'Enlace de la encuesta', events: ['finished'] },
  { key: 'organization', label: 'Organización' },
];

const META_PARAM_LABELS: Record<NotifyEvent, string> = {
  created: '{{1}} número · {{2}} servicio · {{3}} personas antes · {{4}} enlace',
  near: '{{1}} número · {{2}} turnos que faltan · {{3}} sucursal',
  called: '{{1}} número · {{2}} puesto',
  finished: '{{1}} organización · {{2}} enlace de la encuesta',
};

function MessagesTab() {
  const { settings, me, hasModule, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const provider = useQuery({ queryKey: ['notify-provider', 'tenant', me?.tenant?.id ?? null], queryFn: () => api.get<NotifyStatusDTO>('/notifications/provider') });
  const [form, setForm] = useState<NotificationSettings>(settings.notifications);
  const dirty = !sameJson(form, settings.notifications);
  const usesMeta = provider.data?.active === 'tenant' ? provider.data.settings.provider === 'meta' : provider.data?.settings.provider === 'meta';
  const setEvent = (event: NotifyEvent, patch: Partial<NotificationSettings['events'][NotifyEvent]>) =>
    setForm((f) => ({ ...f, events: { ...f.events, [event]: { ...f.events[event], ...patch } } }));

  return (
    <div className="space-y-[var(--gc-gap)]">
      <Callout icon={<MessageCircle />}>
        <p>
          Los avisos llegan a quien dejó su teléfono: pídalo en el kiosco (Kioscos → Datos que se piden → Teléfono), al emitir el {terms.ticket.toLowerCase()} desde el panel o
          la API, o el propio {terms.customer.toLowerCase()} lo escribe en la página de seguimiento de su {terms.ticket.toLowerCase()}.
        </p>
      </Callout>

      <Section title="General">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Código de país" hint="Se agrega a los números sin él. Paraguay = 595.">
            <Input value={form.countryCode} inputMode="numeric" maxLength={4} onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.replace(/\D/g, '') }))} />
          </Field>
          <Field label="Avisar cuando falten" hint="Turnos antes de que lo llamen.">
            <Select value={form.nearAhead} onChange={(e) => setForm((f) => ({ ...f, nearAhead: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'turno' : 'turnos'}
                </option>
              ))}
            </Select>
          </Field>
          {usesMeta && (
            <Field label="Idioma de las plantillas (Meta)" hint="El código del idioma con que se aprobaron: es, es_AR, es_MX…">
              <Input value={form.metaLanguage} maxLength={10} onChange={(e) => setForm((f) => ({ ...f, metaLanguage: e.target.value.trim() }))} />
            </Field>
          )}
        </div>
      </Section>

      <div className="grid gap-[var(--gc-gap)] xl:grid-cols-2">
        {NOTIFY_EVENTS.map((event) => (
          <EventCard
            key={event}
            event={event}
            value={form.events[event]}
            usesMeta={usesMeta}
            surveysOff={event === 'finished' && !hasModule('surveys')}
            onChange={(patch) => setEvent(event, patch)}
          />
        ))}
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        invalid={!form.countryCode}
        onDiscard={() => setForm(settings.notifications)}
        onSave={() => void save({ settings: { notifications: form } }, 'Mensajes guardados')}
      />
    </div>
  );
}

function EventCard({
  event,
  value,
  usesMeta,
  surveysOff,
  onChange,
}: {
  event: NotifyEvent;
  value: NotificationSettings['events'][NotifyEvent];
  usesMeta: boolean;
  surveysOff: boolean;
  onChange: (patch: Partial<NotificationSettings['events'][NotifyEvent]>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const label = NOTIFY_EVENT_LABELS[event];
  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return onChange({ template: value.template + token });
    const start = el.selectionStart ?? value.template.length;
    const end = el.selectionEnd ?? start;
    onChange({ template: value.template.slice(0, start) + token + value.template.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const preview = renderTemplate(value.template, SAMPLE).replace(/\s+/g, ' ').trim();

  return (
    <section className="gc-card gc-pad space-y-4">
      <Toggle checked={value.enabled} onChange={(enabled) => onChange({ enabled })} label={label.name} hint={label.description} />
      {surveysOff && value.enabled && <p className="rounded-ui bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">Necesita el módulo de encuestas activo: sin encuesta, este aviso no se envía.</p>}
      <div className={value.enabled ? '' : 'pointer-events-none opacity-50'}>
        <Field label="Mensaje" hint={`${value.template.length}/700 · Un SMS tiene 160 caracteres; los más largos se cobran como varios.`}>
          <Textarea ref={ref} rows={3} maxLength={700} value={value.template} onChange={(e) => onChange({ template: e.target.value })} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1">
          {VARIABLES.filter((v) => !v.events || v.events.includes(event)).map((v) => (
            <button key={v.key} type="button" onClick={() => insert(v.key)} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-fg/80 hover:bg-subtle" title={`Insertar {{${v.key}}}`}>
              + {v.label}
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-2xl rounded-tl-sm bg-emerald-500/10 px-3 py-2 text-sm text-fg/90" aria-label="Vista previa">
          {preview || <span className="text-muted">(vacío)</span>}
        </div>
        {usesMeta && (
          <Field className="mt-4" label="Plantilla aprobada en Meta" hint={<>Nombre exacto de la plantilla. Variables en este orden: {META_PARAM_LABELS[event]}. Vacío = se envía como texto (solo llega si el cliente le escribió en las últimas 24 h).</>}>
            <Input value={value.metaTemplate} maxLength={120} onChange={(e) => onChange({ metaTemplate: e.target.value.trim() })} placeholder={`turno_${event}`} />
          </Field>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ Historial ----------------------------- */

const STATUS_BADGES: Record<NotifyMessageDTO['status'], { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: '#d97706' },
  sent: { label: 'Enviado', color: '#059669' },
  failed: { label: 'Falló', color: '#dc2626' },
  skipped: { label: 'Sin canal', color: '#6b7280' },
};

function HistoryTab() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const { can } = useAuth();
  const messages = useQuery({ queryKey: ['notify-messages'], queryFn: () => api.get<NotifyMessageDTO[]>('/notifications/messages?limit=200'), refetchInterval: 15_000 });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/messages/${id}/retry`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notify-messages'] });
      toast('Aviso reenviado');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (messages.isLoading) return <Loading />;
  if (messages.isError) return <p className="text-sm text-red-600">{errorMessage(messages.error)}</p>;
  const rows = messages.data ?? [];
  if (!rows.length) return <EmptyState icon={<History />} title="Todavía no se envió ningún aviso" description="Aquí verá cada mensaje, a quién se envió y si llegó al proveedor." />;
  const sent = rows.filter((m) => m.status === 'sent').length;
  const failed = rows.filter((m) => m.status === 'failed').length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Últimos {rows.length} avisos · <strong className="text-emerald-700 dark:text-emerald-400">{sent} enviados</strong>
        {failed > 0 && (
          <>
            {' '}
            · <strong className="text-red-600">{failed} con error</strong>
          </>
        )}
      </p>
      <div className="gc-card overflow-hidden">
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Turno</th>
              <th>Aviso</th>
              <th>Destino</th>
              <th>Estado</th>
              <th className="w-full">Mensaje</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const badge = STATUS_BADGES[m.status];
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt)}</td>
                  <td className="font-semibold whitespace-nowrap">{m.ticketCode ?? '—'}</td>
                  <td className="whitespace-nowrap">{m.event === 'test' ? 'Prueba' : m.event === 'alert' ? 'Alerta de equipos' : NOTIFY_EVENT_LABELS[m.event].name}</td>
                  <td className="whitespace-nowrap tabular-nums">+{m.to}</td>
                  <td>
                    <Badge color={badge.color}>{badge.label}</Badge>
                    {m.provider && <span className="mt-0.5 block text-[11px] whitespace-nowrap text-muted">{NOTIFY_PROVIDER_LABELS[m.provider].split(' (')[0]}</span>}
                  </td>
                  <td className="min-w-72">
                    <p className="line-clamp-2 text-xs">{m.body}</p>
                    {m.error && <p className="mt-1 text-xs text-red-600">{m.error}</p>}
                  </td>
                  <td>
                    {can('admin') && m.status !== 'sent' && (
                      <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} loading={retry.isPending && retry.variables === m.id} onClick={() => retry.mutate(m.id)}>
                        Reintentar
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
