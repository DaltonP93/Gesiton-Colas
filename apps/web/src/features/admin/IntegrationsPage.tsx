import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  History,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  API_KEY_SCOPES,
  WEBHOOK_EVENTS,
  type ApiKeyDTO,
  type ApiKeyScope,
  type WebhookDTO,
  type WebhookDeliveryDTO,
  type WebhookEvent,
} from '@gc/shared';
import { CopyField } from '../../components/CopyField';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  Table,
  Tabs,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { API_BASE, ApiError, api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { copyToClipboard, formatDateTime } from '../../lib/format';
import { useApiKeys, useBranches, useRemove, useSave, useServices, useWebhooks } from '../../lib/queries';

const SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  'tickets:read': 'Consultar turnos, su estado y las colas de espera.',
  'tickets:write': 'Emitir turnos y actualizar su estado (llamar, finalizar, cancelar…).',
  'catalog:read': 'Consultar sucursales, servicios, departamentos, prioridades y puestos de atención.',
  'catalog:write': 'Crear y modificar sucursales, servicios, prioridades y puestos de atención.',
  'reports:read': 'Consultar estadísticas y exportar reportes.',
  'displays:write': 'Administrar pantallas, kioscos y contenido multimedia.',
  'appointments:read': 'Consultar las citas y la disponibilidad de horarios.',
  'appointments:write': 'Crear, modificar, cancelar y dar llegada a citas desde otro sistema.',
};

const EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'ticket.created': 'Se emitió un turno (kiosco, web, API u operador).',
  'ticket.called': 'Un turno fue llamado a un puesto de atención.',
  'ticket.recalled': 'Un turno fue llamado nuevamente.',
  'ticket.started': 'Comenzó la atención de un turno.',
  'ticket.finished': 'Finalizó la atención de un turno.',
  'ticket.no_show': 'El cliente no se presentó al ser llamado.',
  'ticket.cancelled': 'Un turno fue cancelado.',
  'ticket.transferred': 'Un turno fue derivado a otro servicio.',
  'ticket.requeued': 'Un turno volvió a la cola de espera.',
  'queue.reset': 'Se reinició la cola de una sucursal.',
  'survey.answered': 'Un cliente respondió la encuesta de satisfacción.',
  'payment.paid': 'Se acreditó el pago de un turno (en línea o registrado en el puesto).',
  'appointment.created': 'Se agendó una cita (panel, reserva en línea, API o CSV).',
  'appointment.updated': 'Se modificó una cita (fecha, hora o datos).',
  'appointment.cancelled': 'Se canceló una cita.',
  'appointment.checked_in': 'El cliente llegó a su cita y se le emitió el turno.',
  'appointment.no_show': 'El cliente no se presentó a su cita.',
};

const DELIVERY_STATUS: Record<WebhookDeliveryDTO['status'], { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: '#d97706' },
  success: { label: 'Entregada', color: '#16a34a' },
  failed: { label: 'Fallida', color: '#dc2626' },
};

type WebhookWithSecret = WebhookDTO & { secret: string };
type ApiKeyWithSecret = ApiKeyDTO & { key: string };

/** URL base de la API para los ejemplos. */
function baseUrl() {
  return API_BASE || window.location.origin;
}

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones y API"
        description="Conecte la gestión de turnos con su web, app, CRM, ERP, WhatsApp o herramientas como Zapier, n8n y Make."
      />
      <IntroCard />
      <ApiKeysSection />
      <WebhooksSection />
      <ExamplesCard />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Utilidades de presentación                                          */
/* ------------------------------------------------------------------ */

function Notice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'error' }) {
  return (
    <div
      role="alert"
      className={cx(
        'flex items-start gap-3 rounded-ui border px-4 py-3 text-sm',
        tone === 'warning' ? 'border-amber-500/40 bg-amber-500/10' : 'border-red-500/30 bg-red-500/10',
      )}
    >
      <AlertTriangle className={cx('mt-0.5 size-4 shrink-0', tone === 'warning' ? 'text-amber-600' : 'text-red-600')} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SecretModal({ title, description, value, onClose }: { title: string; description: ReactNode; value: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title} footer={<Button onClick={onClose}>Ya la guardé</Button>}>
      <div className="space-y-4">
        <Notice>
          <p className="font-medium">Cópiela ahora: por seguridad no se volverá a mostrar.</p>
          <p className="mt-0.5 text-muted">{description}</p>
        </Notice>
        <CopyField value={value} />
      </div>
    </Modal>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre
        aria-label={label}
        className="gc-scroll overflow-x-auto rounded-ui border border-border bg-subtle p-4 pt-12 font-mono text-xs leading-relaxed text-fg sm:pt-4 sm:pr-28"
      >
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="secondary"
        className="absolute top-2 right-2"
        icon={copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        onClick={async () => {
          if (await copyToClipboard(code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Introducción                                                        */
/* ------------------------------------------------------------------ */

function IntroCard() {
  const docsUrl = `${API_BASE}/api/docs`;
  const options = [
    {
      icon: <KeyRound />,
      title: 'API REST',
      text: 'Emita y consulte turnos, lea el catálogo y los reportes desde sus sistemas. Autentíquese con una API key en la cabecera X-API-Key.',
    },
    {
      icon: <Webhook />,
      title: 'Webhooks',
      text: 'Reciba avisos al instante cuando se emite, llama o finaliza un turno. Cada envío va firmado con HMAC-SHA256 y se reintenta si falla.',
    },
    {
      icon: <BookOpen />,
      title: 'Documentación OpenAPI',
      text: 'Referencia completa de todos los endpoints, con esquemas y la posibilidad de probarlos desde el navegador.',
    },
  ];
  return (
    <Card
      title="¿Cómo integrarse?"
      description="Todos los endpoints están bajo /api/v1 y usan JSON."
      actions={
        <a href={docsUrl} target="_blank" rel="noreferrer">
          <Button variant="secondary" icon={<ExternalLink className="size-4" />}>
            Abrir documentación de la API
          </Button>
        </a>
      }
    >
      <div className="grid gap-5 md:grid-cols-3">
        {options.map((o) => (
          <div key={o.title} className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary [&_svg]:size-5">{o.icon}</span>
            <div>
              <p className="font-medium">{o.title}</p>
              <p className="mt-0.5 text-sm text-muted">{o.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

function ApiKeysSection() {
  const { me } = useAuth();
  const { toast, confirm } = useFeedback();
  const keys = useApiKeys();
  const remove = useRemove('api-keys', ['api-keys']);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyWithSecret | null>(null);

  const list = keys.data ?? [];
  const activeCount = list.filter((k) => !k.revokedAt).length;
  const limit = me?.limits?.apiKeys ?? null;

  async function revoke(key: ApiKeyDTO) {
    const ok = await confirm({
      title: `¿Revocar la API key «${key.name}»?`,
      message: 'Las integraciones que la usen dejarán de funcionar de inmediato. Esta acción no se puede deshacer.',
      confirmLabel: 'Revocar',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(key.id);
      toast(`Se revocó «${key.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const createButton = (
    <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
      Crear API key
    </Button>
  );

  return (
    <Card
      padded={false}
      title="API keys"
      description={
        <>
          Claves para que sus sistemas llamen a la API. Envíela en la cabecera <code className="font-mono text-xs">X-API-Key</code>.
          {limit !== null && ` Su plan permite ${limit} (activas: ${activeCount}).`}
        </>
      }
      actions={list.length > 0 ? createButton : undefined}
    >
      {keys.isLoading ? (
        <Loading />
      ) : keys.isError ? (
        <div className="p-5">
          <EmptyState title="No se pudieron cargar las API keys" description={errorMessage(keys.error)} action={<Button onClick={() => keys.refetch()}>Reintentar</Button>} />
        </div>
      ) : list.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={<KeyRound />}
            title="Aún no hay API keys"
            description="Cree una clave con los permisos mínimos que necesite cada integración."
            action={createButton}
          />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Prefijo</th>
              <th>Permisos</th>
              <th>Último uso</th>
              <th>Creada</th>
              <th>Estado</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((key) => (
              <tr key={key.id} className={cx(key.revokedAt && 'opacity-60')}>
                <td className="font-medium">{key.name}</td>
                <td>
                  <span className="font-mono text-xs whitespace-nowrap">{key.prefix}_…</span>
                </td>
                <td>
                  <div className="flex max-w-xs flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <Badge key={s} className="font-mono" color="#2563eb">
                        <span title={SCOPE_DESCRIPTIONS[s]}>{s}</span>
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap text-muted">{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Nunca'}</td>
                <td className="whitespace-nowrap text-muted">{formatDateTime(key.createdAt)}</td>
                <td>
                  {key.revokedAt ? (
                    <span title={`Revocada el ${formatDateTime(key.revokedAt)}`}>
                      <Badge color="#dc2626">Revocada</Badge>
                    </span>
                  ) : (
                    <Badge color="#16a34a">Activa</Badge>
                  )}
                </td>
                <td>
                  {!key.revokedAt && (
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => revoke(key)}>
                        Revocar
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {creating && (
        <ApiKeyFormModal
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
          }}
        />
      )}
      {created && (
        <SecretModal
          title={`API key «${created.name}» creada`}
          description="Guárdela en un lugar seguro (por ejemplo, variables de entorno de su servidor). Si la pierde, revóquela y cree otra."
          value={created.key}
          onClose={() => setCreated(null)}
        />
      )}
    </Card>
  );
}

function ApiKeyFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (key: ApiKeyWithSecret) => void }) {
  const { toast } = useFeedback();
  const save = useSave<ApiKeyWithSecret>('api-keys', ['api-keys']);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['tickets:read', 'tickets:write']);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const toggle = (scope: ApiKeyScope, on: boolean) => setScopes((s) => (on ? [...s, scope] : s.filter((x) => x !== scope)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (scopes.length === 0) {
      setError('Elija al menos un permiso.');
      return;
    }
    try {
      const key = await save.mutateAsync({ name: name.trim(), scopes });
      toast('API key creada.');
      onCreated(key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setError(err.message);
      else toast(errorMessage(err), 'error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Crear API key"
      description="La clave completa se mostrará una sola vez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            Crear
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        {error && <Notice>{error}</Notice>}
        <Field label="Nombre" required hint="Para reconocerla, por ejemplo «Sitio web» o «CRM».">
          <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">Permisos</legend>
          <p className="mb-3 text-xs text-muted">Otorgue solo los permisos que la integración necesita.</p>
          <div className="space-y-3">
            {API_KEY_SCOPES.map((scope) => (
              <Checkbox
                key={scope}
                checked={scopes.includes(scope)}
                onChange={(on) => toggle(scope, on)}
                label={
                  <span>
                    <span className="font-mono text-xs font-semibold">{scope}</span>
                    <span className="block text-xs text-muted">{SCOPE_DESCRIPTIONS[scope]}</span>
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

interface WebhookForm {
  id: string | null;
  name: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
}

function WebhooksSection() {
  const { toast, confirm } = useFeedback();
  const webhooks = useWebhooks();
  const save = useSave<WebhookDTO>('webhooks', ['webhooks']);
  const remove = useRemove('webhooks', ['webhooks']);
  const [editing, setEditing] = useState<WebhookForm | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [deliveriesOf, setDeliveriesOf] = useState<WebhookDTO | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: 'test' | 'toggle' | 'rotate' } | null>(null);

  const list = webhooks.data ?? [];
  const isBusy = (id: string, action: 'test' | 'toggle' | 'rotate') => busy?.id === id && busy.action === action;

  async function test(webhook: WebhookDTO) {
    setBusy({ id: webhook.id, action: 'test' });
    try {
      const res = await api.post<{ ok: boolean; status: number | null; error: string | null }>(`/webhooks/${webhook.id}/test`);
      if (res.ok) toast(`Prueba enviada correctamente (HTTP ${res.status}).`);
      else toast(`La prueba falló: ${res.error ?? (res.status ? `HTTP ${res.status}` : 'sin respuesta')}.`, 'error');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(webhook: WebhookDTO, active: boolean) {
    setBusy({ id: webhook.id, action: 'toggle' });
    try {
      await save.mutateAsync({ id: webhook.id, active });
      toast(active ? `Se activó «${webhook.name}».` : `Se pausó «${webhook.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function rotate(webhook: WebhookDTO) {
    const ok = await confirm({
      title: '¿Generar un nuevo secreto?',
      message: `El secreto actual de «${webhook.name}» dejará de ser válido de inmediato. Deberá actualizarlo en el sistema que recibe los eventos.`,
      confirmLabel: 'Generar nuevo secreto',
      danger: true,
    });
    if (!ok) return;
    setBusy({ id: webhook.id, action: 'rotate' });
    try {
      const res = await api.post<WebhookWithSecret>(`/webhooks/${webhook.id}/rotate-secret`);
      setSecret({ title: `Nuevo secreto de «${webhook.name}»`, value: res.secret });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(webhook: WebhookDTO) {
    const ok = await confirm({
      title: `¿Eliminar el webhook «${webhook.name}»?`,
      message: 'Dejará de recibir eventos y se borrará su historial de entregas.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(webhook.id);
      toast(`Se eliminó «${webhook.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const createButton = (
    <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ id: null, name: '', url: '', events: [], active: true })}>
      Agregar webhook
    </Button>
  );

  return (
    <Card
      padded={false}
      title="Webhooks"
      description="Enviamos un POST con JSON a su URL en cada evento. Si su servidor no responde 2xx, se reintenta a los 30 s, 2 min, 10 min, 1 h y 6 h."
      actions={list.length > 0 ? createButton : undefined}
    >
      {webhooks.isLoading ? (
        <Loading />
      ) : webhooks.isError ? (
        <div className="p-5">
          <EmptyState title="No se pudieron cargar los webhooks" description={errorMessage(webhooks.error)} action={<Button onClick={() => webhooks.refetch()}>Reintentar</Button>} />
        </div>
      ) : list.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={<Webhook />}
            title="Aún no hay webhooks"
            description="Agregue una URL para que su sistema se entere al instante de lo que pasa con los turnos."
            action={createButton}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((webhook) => (
            <li key={webhook.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
              <div className={cx('min-w-0 flex-1', !webhook.active && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{webhook.name}</p>
                  {!webhook.active && <Badge>Pausado</Badge>}
                </div>
                <p className="truncate font-mono text-xs text-muted" title={webhook.url}>
                  {webhook.url}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {webhook.events.length === 0 ? (
                    <Badge color="#7c3aed">Todos los eventos</Badge>
                  ) : (
                    webhook.events.map((ev) => (
                      <Badge key={ev} className="font-mono">
                        <span title={EVENT_DESCRIPTIONS[ev]}>{ev}</span>
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle
                  checked={webhook.active}
                  disabled={isBusy(webhook.id, 'toggle')}
                  onChange={(v) => toggleActive(webhook, v)}
                  label={<span className="text-xs font-normal text-muted">{webhook.active ? 'Activo' : 'Pausado'}</span>}
                />
                <Button size="sm" variant="secondary" icon={<Send className="size-4" />} loading={isBusy(webhook.id, 'test')} onClick={() => test(webhook)}>
                  Probar
                </Button>
                <Button size="sm" variant="secondary" icon={<History className="size-4" />} onClick={() => setDeliveriesOf(webhook)}>
                  Entregas
                </Button>
                <IconButton
                  label="Generar nuevo secreto"
                  icon={<RefreshCw className="size-4" />}
                  loading={isBusy(webhook.id, 'rotate')}
                  onClick={() => rotate(webhook)}
                />
                <IconButton
                  label="Editar"
                  icon={<Pencil className="size-4" />}
                  onClick={() => setEditing({ id: webhook.id, name: webhook.name, url: webhook.url, events: webhook.events, active: webhook.active })}
                />
                <IconButton label="Eliminar" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => handleDelete(webhook)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <WebhookFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          onClose={() => setEditing(null)}
          onCreated={(created) => {
            setEditing(null);
            setSecret({ title: `Secreto de firma de «${created.name}»`, value: created.secret });
          }}
        />
      )}
      {secret && (
        <SecretModal
          title={secret.title}
          description="Úselo para verificar la cabecera X-GC-Signature de cada envío (vea el ejemplo más abajo)."
          value={secret.value}
          onClose={() => setSecret(null)}
        />
      )}
      {deliveriesOf && <DeliveriesModal webhook={deliveriesOf} onClose={() => setDeliveriesOf(null)} />}
    </Card>
  );
}

function WebhookFormModal({
  initial,
  onClose,
  onCreated,
}: {
  initial: WebhookForm;
  onClose: () => void;
  onCreated: (webhook: WebhookWithSecret) => void;
}) {
  const { toast } = useFeedback();
  const save = useSave<WebhookWithSecret>('webhooks', ['webhooks']);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const isNew = !form.id;
  const set = <K extends keyof WebhookForm>(key: K, value: WebhookForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleEvent = (ev: WebhookEvent, on: boolean) =>
    set('events', on ? WEBHOOK_EVENTS.filter((x) => x === ev || form.events.includes(x)) : form.events.filter((x) => x !== ev));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await save.mutateAsync({ id: form.id, name: form.name.trim(), url: form.url.trim(), events: form.events, active: form.active });
      if (isNew) {
        toast('Webhook creado.');
        onCreated(res);
      } else {
        toast('Cambios guardados.');
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.status === 400)) setError(errorMessage(err));
      else toast(errorMessage(err), 'error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'Agregar webhook' : `Editar «${initial.name}»`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {isNew ? 'Crear' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required>
            <Input required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej.: CRM" autoFocus />
          </Field>
          <Field label="URL de destino" required hint="Debe ser una URL pública (https recomendado).">
            <Input
              type="url"
              required
              maxLength={2048}
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://su-sistema.com/webhooks/turnos"
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <fieldset>
          <legend className="sr-only">Eventos</legend>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-medium" aria-hidden>
                Eventos
              </p>
              <p className="text-xs text-muted">Si no marca ninguno, recibirá todos los eventos (incluidos los que se agreguen en el futuro).</p>
            </div>
            {form.events.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => set('events', [])}>
                Recibir todos
              </Button>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((ev) => (
              <Checkbox
                key={ev}
                checked={form.events.includes(ev)}
                onChange={(on) => toggleEvent(ev, on)}
                label={
                  <span>
                    <span className="font-mono text-xs font-semibold">{ev}</span>
                    <span className="block text-xs text-muted">{EVENT_DESCRIPTIONS[ev]}</span>
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
        <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activo" hint="Mientras esté pausado no se envían eventos." />
      </form>
    </Modal>
  );
}

function DeliveriesModal({ webhook, onClose }: { webhook: WebhookDTO; onClose: () => void }) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const queryKey = ['webhook-deliveries', webhook.id];
  const deliveries = useQuery({
    queryKey,
    queryFn: () => api.get<WebhookDeliveryDTO[]>(`/webhooks/${webhook.id}/deliveries`),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post<WebhookDeliveryDTO>(`/webhooks/deliveries/${id}/retry`),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey });
      if (d.status === 'success') toast('Entrega reenviada correctamente.');
      else toast(`El reintento no tuvo éxito${d.error ? `: ${d.error}` : ''}. Se volverá a intentar automáticamente.`, 'error');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const list = deliveries.data ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Entregas de «${webhook.name}»`}
      description="Últimas 100 entregas, de la más reciente a la más antigua."
      footer={
        <>
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={deliveries.isFetching} onClick={() => deliveries.refetch()}>
            Actualizar
          </Button>
          <Button onClick={onClose}>Cerrar</Button>
        </>
      }
    >
      {deliveries.isLoading ? (
        <Loading />
      ) : deliveries.isError ? (
        <EmptyState title="No se pudieron cargar las entregas" description={errorMessage(deliveries.error)} />
      ) : list.length === 0 ? (
        <EmptyState icon={<History />} title="Todavía no hay entregas" description="Aparecerán aquí cuando ocurra un evento suscrito. Use «Probar» para enviar un ping (no queda registrado)." />
      ) : (
        <div className="-mx-5">
          <Table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Estado</th>
                <th className="text-right">Intentos</th>
                <th>Respuesta</th>
                <th>Error</th>
                <th>Creada</th>
                <th>Entregada</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const status = DELIVERY_STATUS[d.status];
                const retrying = retry.isPending && retry.variables === d.id;
                return (
                  <tr key={d.id}>
                    <td className="font-mono text-xs whitespace-nowrap">{d.event}</td>
                    <td>
                      <Badge color={status.color}>{status.label}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{d.attempts}</td>
                    <td className="font-mono text-xs">{d.responseStatus ?? '—'}</td>
                    <td className="max-w-[16rem]">
                      {d.error ? (
                        <span className="block truncate text-xs text-red-600" title={d.error}>
                          {d.error}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(d.createdAt)}</td>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(d.deliveredAt)}</td>
                    <td>
                      {d.status !== 'success' && (
                        <Button size="sm" variant="secondary" loading={retrying} disabled={retry.isPending && !retrying} onClick={() => retry.mutate(d.id)}>
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
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Ejemplos                                                            */
/* ------------------------------------------------------------------ */

type ExampleTab = 'curl' | 'node' | 'payload';

function ExamplesCard() {
  const { terms } = useAuth();
  const branches = useBranches();
  const services = useServices();
  const [tab, setTab] = useState<ExampleTab>('curl');

  const base = baseUrl();
  const branch = branches.data?.find((b) => b.active) ?? branches.data?.[0];
  const service =
    services.data?.find((s) => s.active && (!branch || branch.services.some((x) => x.serviceId === s.id && x.enabled))) ?? services.data?.[0];
  const branchId = branch?.id ?? 'ID_DE_LA_SUCURSAL';
  const serviceId = service?.id ?? 'ID_DEL_SERVICIO';

  const curl = [
    `curl -X POST "${base}/api/v1/tickets" \\`,
    '  -H "X-API-Key: gc_SU_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{`,
    `    "branchId": "${branchId}",`,
    `    "serviceId": "${serviceId}",`,
    '    "customer": { "name": "Ana Pérez", "phone": "+595981123456" }',
    `  }'`,
    '',
    '# Respuesta (201):',
    '# { "ticket": { "code": "A001", "status": "waiting", ... },',
    `#   "waitingAhead": 3, "trackingUrl": "${window.location.origin}/t/..." }`,
  ].join('\n');

  const node = [
    '// npm install express',
    "import crypto from 'node:crypto';",
    "import express from 'express';",
    '',
    'const SECRET = process.env.GC_WEBHOOK_SECRET; // whsec_...',
    'const app = express();',
    '',
    '// Importante: use el cuerpo sin procesar (raw) para calcular la firma.',
    "app.post('/webhooks/turnos', express.raw({ type: 'application/json' }), (req, res) => {",
    "  const timestamp = req.get('x-gc-timestamp') ?? '';",
    "  const signature = req.get('x-gc-signature') ?? '';",
    "  const rawBody = req.body.toString('utf8');",
    '',
    "  const expected = 'sha256=' + crypto",
    "    .createHmac('sha256', SECRET)",
    '    .update(`${timestamp}.${rawBody}`)',
    "    .digest('hex');",
    '',
    '  const valid =',
    '    signature.length === expected.length &&',
    '    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));',
    '  // Rechace eventos con más de 5 minutos para evitar reenvíos maliciosos.',
    '  const recent = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;',
    "  if (!valid || !recent) return res.status(401).send('Firma inválida');",
    '',
    '  const event = JSON.parse(rawBody);',
    "  console.log(event.event, event.data); // p. ej. 'ticket.called'",
    '  res.sendStatus(200); // Responda 2xx rápido; si no, se reintentará.',
    '});',
    '',
    'app.listen(3001);',
  ].join('\n');

  const payload = [
    '// Cabeceras:',
    '// X-GC-Event: ticket.called',
    '// X-GC-Delivery: <id único de la entrega>',
    '// X-GC-Timestamp: 1790000000',
    '// X-GC-Signature: sha256=<HMAC-SHA256(secreto, `${timestamp}.${cuerpo}`)>',
    '{',
    '  "id": "8f1c2b7e-...",',
    '  "event": "ticket.called",',
    `  "createdAt": "${new Date().toISOString()}",`,
    '  "tenantId": "...",',
    '  "data": {',
    '    "ticket": {',
    '      "id": "...",',
    '      "code": "A001",',
    '      "status": "called",',
    `      "branchId": "${branchId}",`,
    `      "serviceId": "${serviceId}",`,
    '      "customer": { "name": "Ana Pérez" },',
    `      "counter": { "id": "...", "name": "${terms.counter} 1" },`,
    '      "callCount": 1,',
    '      "createdAt": "...",',
    '      "calledAt": "..."',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const snippets: Record<ExampleTab, { label: string; code: string; hint: ReactNode }> = {
    curl: {
      label: 'Crear un turno con cURL',
      code: curl,
      hint: (
        <>
          Requiere una API key con el permiso <code className="font-mono">tickets:write</code>. Los IDs de ejemplo corresponden a su organización.
        </>
      ),
    },
    node: {
      label: 'Verificar la firma de un webhook en Node.js',
      code: node,
      hint: (
        <>
          La firma es <code className="font-mono">sha256=</code> + HMAC-SHA256 del texto <code className="font-mono">{'`${X-GC-Timestamp}.${cuerpo}`'}</code> con el secreto del webhook.
        </>
      ),
    },
    payload: {
      label: 'Formato de un evento de webhook',
      code: payload,
      hint: 'Todos los eventos comparten esta estructura; «data» contiene el turno completo.',
    },
  };
  const current = snippets[tab];

  return (
    <Card title="Ejemplos" description="Copie y adapte estos fragmentos para empezar rápido.">
      <Tabs<ExampleTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'curl', label: 'Crear turno (cURL)' },
          { value: 'node', label: 'Verificar firma (Node.js)' },
          { value: 'payload', label: 'Formato del evento' },
        ]}
      />
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted">{current.hint}</p>
        {branches.isLoading || services.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <CodeBlock code={current.code} label={current.label} />
        )}
      </div>

      {(branches.data?.length ?? 0) + (services.data?.length ?? 0) > 0 && (
        <details className="mt-5 rounded-ui border border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">
            IDs de {terms.branches.toLowerCase()} y {terms.services.toLowerCase()}
          </summary>
          <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
            <IdList title={terms.branches} items={(branches.data ?? []).map((b) => ({ id: b.id, name: b.name }))} />
            <IdList title={terms.services} items={(services.data ?? []).map((s) => ({ id: s.id, name: s.name }))} />
          </div>
        </details>
      )}
    </Card>
  );
}

function IdList({ title, items }: { title: string; items: { id: string; name: string }[] }) {
  const { toast } = useFeedback();
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <code className="hidden truncate font-mono text-xs text-muted sm:block">{item.id}</code>
            <IconButton
              label={`Copiar ID de ${item.name}`}
              icon={<Copy className="size-3.5" />}
              onClick={async () => {
                if (await copyToClipboard(item.id)) toast('ID copiado.', 'info');
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
