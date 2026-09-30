import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, MessageCircle, MessageSquareWarning, Send, Server, Smartphone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NOTIFY_PROVIDER_LABELS, NOTIFY_PROVIDERS, type NotifyProvider, type NotifyProviderDTO, type NotifyStatusDTO } from '@gc/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field, Input, Loading, Select, Textarea, Toggle, cx, useFeedback } from './ui';

type Form = Omit<NotifyProviderDTO, 'hasSecret' | 'updatedAt'> & { secret: string };

const toForm = (s: NotifyProviderDTO): Form => ({
  enabled: s.enabled,
  provider: s.provider,
  metaPhoneNumberId: s.metaPhoneNumberId,
  metaApiVersion: s.metaApiVersion,
  wahaUrl: s.wahaUrl,
  wahaSession: s.wahaSession,
  httpMethod: s.httpMethod,
  httpUrl: s.httpUrl,
  httpBody: s.httpBody,
  httpContentType: s.httpContentType,
  httpAuthHeader: s.httpAuthHeader,
  secret: '',
});

const PROVIDER_INFO: Record<NotifyProvider, { icon: ReactNode; title: string; subtitle: string; description: string; secretLabel: string; secretHint: string }> = {
  meta: {
    icon: <MessageCircle />,
    title: 'WhatsApp oficial',
    subtitle: 'Meta Cloud API',
    description: 'La API oficial de WhatsApp Business. Los avisos usan plantillas aprobadas por Meta; cada mensaje tiene costo según Meta.',
    secretLabel: 'Token de acceso',
    secretHint: 'Token permanente de un usuario del sistema (Meta Business → Usuarios del sistema).',
  },
  waha: {
    icon: <Server />,
    title: 'WhatsApp local',
    subtitle: 'WAHA u otra API en su servidor',
    description: 'WAHA u otra API de WhatsApp instalada en su servidor, con un número propio vinculado por QR. Sin costo por mensaje.',
    secretLabel: 'API key',
    secretHint: 'La WAHA_API_KEY de su instalación (se envía en el encabezado X-Api-Key). Vacío si no usa clave.',
  },
  http: {
    icon: <Smartphone />,
    title: 'SMS por HTTP',
    subtitle: 'Cualquier proveedor de SMS',
    description: 'Cualquier proveedor de SMS (Tigo, Claro, Personal, gateways locales o internacionales) que reciba los envíos por una URL.',
    secretLabel: 'Valor del encabezado',
    secretHint: 'Por ejemplo «Bearer abc123» para Authorization, o la clave si el proveedor usa X-Api-Key.',
  },
};

/** Ejemplos para el proveedor por HTTP. */
const HTTP_PRESETS: { name: string; method: 'GET' | 'POST'; url: string; body: string; contentType: string; header: string }[] = [
  { name: 'JSON (POST)', method: 'POST', url: 'https://api.proveedor.com/sms/send', body: '{"to":"{{phone}}","message":"{{message}}"}', contentType: 'application/json', header: 'Authorization' },
  { name: 'Formulario (POST)', method: 'POST', url: 'https://api.proveedor.com/sms', body: 'numero={{phone}}&mensaje={{message}}', contentType: 'application/x-www-form-urlencoded', header: '' },
  { name: 'Parámetros en la URL (GET)', method: 'GET', url: 'https://gateway.local/send?to={{phone}}&text={{message}}&key=SU_CLAVE', body: '', contentType: 'application/json', header: '' },
];

/**
 * Proveedor de avisos por WhatsApp o SMS. `scope` define qué se configura:
 * el de toda la plataforma (superadministrador) o el propio de una organización.
 */
export function NotifyProviderForm({ scope }: { scope: 'platform' | 'tenant' }) {
  const { me, settings } = useAuth();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const path = scope === 'platform' ? '/platform/notifications' : '/notifications/provider';
  const key = ['notify-provider', scope, me?.tenant?.id ?? null];
  const status = useQuery({ queryKey: key, queryFn: () => api.get<NotifyStatusDTO>(path) });
  const [form, setForm] = useState<Form | null>(null);
  const [changeSecret, setChangeSecret] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (status.data && !form) {
      setForm(toForm(status.data.settings));
      setChangeSecret(!status.data.settings.hasSecret);
    }
  }, [status.data, form]);

  // La clave guardada es del canal guardado: al elegir otro canal hay que escribir la suya.
  const secretSaved = Boolean(status.data?.settings.hasSecret && form && form.provider === status.data.settings.provider);
  const editingSecret = changeSecret || !secretSaved;
  const body = () => ({ ...form!, secret: editingSecret ? form!.secret : undefined });

  const save = useMutation({
    mutationFn: () => api.put<NotifyStatusDTO>(path, body()),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: ['notify-provider'] });
      setForm(toForm(data.settings));
      setChangeSecret(!data.settings.hasSecret);
      toast('Proveedor de avisos guardado');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`${path}/test`, { ...body(), enabled: true, to: testTo }),
    onSuccess: (data) => setTestResult({ ok: true, message: data.message }),
    onError: (err) => setTestResult({ ok: false, message: errorMessage(err) }),
  });

  if (status.isLoading || !form) return <Loading />;
  if (status.isError || !status.data) return <p className="text-sm text-red-600">{errorMessage(status.error)}</p>;

  const set = <K extends keyof Form>(k: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: value } : f));
    setTestResult(null);
  };
  const saved = status.data.settings;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved)) || (editingSecret && Boolean(form.secret));
  const info = PROVIDER_INFO[form.provider];
  const countryCode = scope === 'tenant' ? settings.notifications.countryCode : '595';

  return (
    <div className="space-y-6">
      <ActiveBanner status={status.data} scope={scope} />

      <div className="gc-card gc-pad space-y-6">
        <Toggle
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
          label={scope === 'platform' ? 'Enviar avisos con este proveedor' : 'Usar un proveedor propio'}
          hint={
            scope === 'platform'
              ? 'Lo usan todas las organizaciones con el módulo de avisos que no tengan un proveedor propio.'
              : 'Los avisos salen por su número de WhatsApp o su cuenta de SMS. Si lo desactiva, se usa el de la plataforma (si hay uno).'
          }
        />

        <div>
          <p className="mb-2 text-sm font-medium">Canal</p>
          <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Canal de los avisos">
            {NOTIFY_PROVIDERS.map((p) => {
              const active = form.provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set('provider', p)}
                  className={cx(
                    'flex items-start gap-3 rounded-ui border p-3 text-left transition [&_svg]:size-5',
                    active ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'border-border hover:bg-subtle',
                  )}
                >
                  <span className={cx('mt-0.5 shrink-0', active ? 'text-primary' : 'text-muted')}>{PROVIDER_INFO[p].icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{PROVIDER_INFO[p].title}</span>
                    <span className="block text-xs text-muted">{PROVIDER_INFO[p].subtitle}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex gap-1.5 text-xs text-muted">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {info.description}
          </p>
        </div>

        <div className="@container space-y-4">
          {form.provider === 'meta' && (
            <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_10rem]">
              <Field label="Identificador del número (Phone number ID)" required={form.enabled} hint="En Meta for Developers → WhatsApp → Configuración de la API.">
                <Input value={form.metaPhoneNumberId} onChange={(e) => set('metaPhoneNumberId', e.target.value.trim())} placeholder="123456789012345" autoComplete="off" />
              </Field>
              <Field label="Versión de la API" hint="Vacío = v22.0">
                <Input value={form.metaApiVersion} onChange={(e) => set('metaApiVersion', e.target.value.trim())} placeholder="v22.0" />
              </Field>
            </div>
          )}

          {form.provider === 'waha' && (
            <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="Dirección de WAHA" required={form.enabled} hint="La dirección donde corre WAHA, vista desde este servidor.">
                <Input value={form.wahaUrl} onChange={(e) => set('wahaUrl', e.target.value.trim())} placeholder="http://10.0.0.5:3000" autoComplete="off" />
              </Field>
              <Field label="Sesión" hint="Vacío = default">
                <Input value={form.wahaSession} onChange={(e) => set('wahaSession', e.target.value.trim())} placeholder="default" />
              </Field>
            </div>
          )}

          {form.provider === 'http' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <span className="mr-1 self-center text-xs text-muted">Ejemplos:</span>
                {HTTP_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      setForm((f) => (f ? { ...f, httpMethod: p.method, httpUrl: p.url, httpBody: p.body, httpContentType: p.contentType, httpAuthHeader: p.header } : f));
                      setTestResult(null);
                    }}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition hover:bg-subtle"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 @xl:grid-cols-[8rem_minmax(0,1fr)]">
                <Field label="Método">
                  <Select value={form.httpMethod} onChange={(e) => set('httpMethod', e.target.value as 'GET' | 'POST')}>
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </Select>
                </Field>
                <Field label="URL" required={form.enabled} hint={<>Use <code>{'{{phone}}'}</code> y <code>{'{{message}}'}</code> donde el proveedor espera el número y el texto.</>}>
                  <Input value={form.httpUrl} onChange={(e) => set('httpUrl', e.target.value.trim())} placeholder="https://api.proveedor.com/sms/send" autoComplete="off" />
                </Field>
              </div>
              {form.httpMethod === 'POST' && (
                <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_16rem]">
                  <Field label="Cuerpo" hint="Los valores se escapan según el tipo de contenido (JSON o formulario).">
                    <Textarea rows={3} className="font-mono text-xs" value={form.httpBody} onChange={(e) => set('httpBody', e.target.value)} placeholder='{"to":"{{phone}}","message":"{{message}}"}' />
                  </Field>
                  <Field label="Tipo de contenido">
                    <Select value={form.httpContentType} onChange={(e) => set('httpContentType', e.target.value)}>
                      <option value="application/json">application/json</option>
                      <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                      <option value="text/plain">text/plain</option>
                    </Select>
                  </Field>
                </div>
              )}
              <Field label="Encabezado de autenticación" hint="Opcional: nombre del encabezado (Authorization, X-Api-Key…). Su valor va en el campo secreto.">
                <Input value={form.httpAuthHeader} onChange={(e) => set('httpAuthHeader', e.target.value.trim())} placeholder="Authorization" className="max-w-xs" />
              </Field>
            </>
          )}

          {(form.provider !== 'http' || form.httpAuthHeader) && (
            <Field label={info.secretLabel} hint={!editingSecret ? 'Hay un valor guardado (cifrado).' : `${info.secretHint} Se guarda cifrado y nunca se vuelve a mostrar.`}>
              {!editingSecret ? (
                <div className="flex max-w-xl gap-2">
                  <Input value="••••••••••" readOnly aria-label={`${info.secretLabel} guardado`} />
                  <Button variant="secondary" onClick={() => setChangeSecret(true)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <Input type="password" className="max-w-xl" value={form.secret} onChange={(e) => set('secret', e.target.value)} autoComplete="new-password" />
              )}
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {dirty && <span className="mr-auto text-xs text-muted">Cambios sin guardar</span>}
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setForm(toForm(saved));
              setChangeSecret(!saved.hasSecret);
            }}
          >
            Descartar
          </Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </div>
      </div>

      <div className="gc-card gc-pad">
        <h3 className="text-base font-semibold">Probar el envío</h3>
        <p className="mt-0.5 text-sm text-muted">
          Se envía un mensaje real con los datos del formulario, aunque todavía no los haya guardado. Los números sin código de país se completan con +{countryCode}.
          {form.provider === 'meta' && ' Con WhatsApp oficial, la prueba es un mensaje de texto: solo llega si ese número le escribió en las últimas 24 horas.'}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Enviar a" className="min-w-60 flex-1">
            <Input type="tel" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="0981 123 456" />
          </Field>
          <Button icon={<Send className="size-4" />} loading={test.isPending} disabled={testTo.trim().length < 6} onClick={() => test.mutate()}>
            Enviar prueba
          </Button>
        </div>
        {testResult && (
          <p
            role="status"
            className={cx(
              'mt-3 flex gap-2 rounded-ui border px-3 py-2.5 text-sm',
              testResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
            )}
          >
            {testResult.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />}
            {testResult.message}
          </p>
        )}
      </div>
    </div>
  );
}

function ActiveBanner({ status, scope }: { status: NotifyStatusDTO; scope: 'platform' | 'tenant' }) {
  const messages: Record<NotifyStatusDTO['active'], { tone: 'ok' | 'warn'; text: ReactNode }> = {
    tenant: { tone: 'ok', text: <>Los avisos salen por su proveedor propio: <strong>{NOTIFY_PROVIDER_LABELS[status.settings.provider]}</strong>.</> },
    platform: {
      tone: 'ok',
      text: scope === 'platform' ? <>Los avisos están activos para las organizaciones sin proveedor propio.</> : <>Hoy se usa el proveedor de la plataforma. Configure uno propio si quiere enviar desde su número.</>,
    },
    none: {
      tone: 'warn',
      text:
        scope === 'platform' ? (
          <>
            <strong>No hay proveedor de la plataforma.</strong> Solo envían avisos las organizaciones que configuren el suyo.
          </>
        ) : (
          <>
            <strong>Todavía no se envían avisos.</strong> Configure un canal abajo y pruébelo.
          </>
        ),
    },
  };
  const m = messages[status.active];
  return (
    <div role="status" className={cx('flex items-start gap-3 rounded-ui border px-4 py-3 text-sm', m.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
      {m.tone === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-amber-600" />}
      <p className="min-w-0">{m.text}</p>
    </div>
  );
}
