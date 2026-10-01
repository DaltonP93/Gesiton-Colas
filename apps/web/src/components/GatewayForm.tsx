import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, ExternalLink, FlaskConical, Info, Landmark, ShieldAlert, Wallet } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { PAYMENT_GATEWAYS, PAYMENT_GATEWAY_INFO, type GatewayDTO, type PaymentGateway } from '@gc/shared';
import { api, errorMessage } from '../lib/api';
import { CopyField } from './CopyField';
import { Button, Field, Input, Loading, Toggle, cx, useFeedback } from './ui';

type Form = Pick<GatewayDTO, 'enabled' | 'provider' | 'sandbox' | 'publicKey' | 'apiUrl'> & { secret: string; webhookSecret: string };

const toForm = (g: GatewayDTO): Form => ({ enabled: g.enabled, provider: g.provider, sandbox: g.sandbox, publicKey: g.publicKey, apiUrl: g.apiUrl, secret: '', webhookSecret: '' });

const ICONS: Record<PaymentGateway, ReactNode> = { bancard: <CreditCard />, pagopar: <Wallet />, stripe: <Landmark /> };

const HELP: Record<PaymentGateway, { keys: string; webhook: string; secretLabel: string }> = {
  bancard: {
    keys: 'Las claves pública y privada del comercio las entrega Bancard al habilitar el vPOS (primero las del ambiente de pruebas).',
    webhook: 'Pásela a Bancard como «URL de confirmación» del comercio.',
    secretLabel: 'Clave privada',
  },
  pagopar: {
    keys: 'En PagoPar: Integrar con mi sitio → Claves (pública y privada).',
    webhook: 'Péguela en PagoPar como «URL de respuesta» del comercio.',
    secretLabel: 'Clave privada',
  },
  stripe: {
    keys: 'En Stripe: Desarrolladores → Claves de API → Clave secreta (sk_test_… en pruebas, sk_live_… en producción).',
    webhook: 'En Stripe: Desarrolladores → Webhooks → Agregar destino con esta URL y los eventos checkout.session.completed y checkout.session.expired. Copie el «secreto de firma» (whsec_…) abajo.',
    secretLabel: 'Clave secreta',
  },
};

/** Pasarela de pagos en línea de la plataforma (cobro de facturas) o de una organización (cobro de turnos). */
export function GatewayForm({ scope, currency }: { scope: 'platform' | 'tenant'; currency?: string }) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const path = scope === 'platform' ? '/platform/payments/gateway' : '/payments/gateway';
  const status = useQuery({ queryKey: ['payment-gateway', scope], queryFn: () => api.get<GatewayDTO>(path) });
  const [form, setForm] = useState<Form | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [changeSecret, setChangeSecret] = useState(false);
  const [changeWebhook, setChangeWebhook] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; url?: string | null } | null>(null);

  useEffect(() => {
    if (status.data && !form) {
      setForm(toForm(status.data));
      setAdvanced(Boolean(status.data.apiUrl));
    }
  }, [status.data, form]);

  const saved = status.data;
  const sameProvider = saved && form ? saved.provider === form.provider : false;
  const secretSaved = Boolean(saved?.hasSecret && sameProvider);
  const webhookSaved = Boolean(saved?.hasWebhookSecret && sameProvider);
  const editingSecret = changeSecret || !secretSaved;
  const editingWebhook = changeWebhook || !webhookSaved;

  const save = useMutation({
    mutationFn: () =>
      api.put<GatewayDTO>(path, {
        enabled: form!.enabled,
        provider: form!.provider,
        sandbox: form!.sandbox,
        publicKey: form!.publicKey,
        apiUrl: form!.apiUrl,
        secret: editingSecret ? form!.secret : undefined,
        webhookSecret: form!.provider === 'stripe' && editingWebhook ? form!.webhookSecret : undefined,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['payment-gateway', scope], data);
      setForm(toForm(data));
      setChangeSecret(false);
      setChangeWebhook(false);
      toast('Pasarela guardada');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string; checkoutUrl: string | null }>(`${path}/test`),
    onSuccess: (data) => setTestResult({ ok: true, message: data.message, url: data.checkoutUrl }),
    onError: (err) => setTestResult({ ok: false, message: errorMessage(err) }),
  });

  if (status.isLoading || !form || !saved) return <Loading />;
  if (status.isError) return <p className="text-sm text-red-600">{errorMessage(status.error)}</p>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setTestResult(null);
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved)) || (editingSecret && Boolean(form.secret)) || (editingWebhook && Boolean(form.webhookSecret));
  const info = PAYMENT_GATEWAY_INFO[form.provider];
  const help = HELP[form.provider];
  const unsupported = currency && !info.currencies.includes(currency as never);

  return (
    <div className="space-y-6">
      <div role="status" className={cx('flex items-start gap-3 rounded-ui border px-4 py-3 text-sm', saved.enabled ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-border bg-subtle')}>
        {saved.enabled ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Info className="mt-0.5 size-4 shrink-0 text-muted" />}
        <p>
          {saved.enabled ? (
            <>
              Pagos en línea activos con <strong>{PAYMENT_GATEWAY_INFO[saved.provider].name}</strong>
              {saved.sandbox ? ' en modo de pruebas' : ''}.
            </>
          ) : (
            <>Sin pasarela en línea: los pagos se registran a mano (efectivo, POS, transferencia).</>
          )}
        </p>
      </div>

      <div className="gc-card gc-pad space-y-6">
        <Toggle
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
          label="Aceptar pagos en línea"
          hint={scope === 'platform' ? 'Las organizaciones pagan sus facturas con esta pasarela.' : 'Sus clientes pagan el turno desde el celular (página de seguimiento).'}
        />

        <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Pasarela">
          {PAYMENT_GATEWAYS.map((p) => {
            const active = form.provider === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set('provider', p)}
                className={cx('flex items-start gap-3 rounded-ui border p-3 text-left transition [&_svg]:size-5', active ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'border-border hover:bg-subtle')}
              >
                <span className={cx('mt-0.5 shrink-0', active ? 'text-primary' : 'text-muted')}>{ICONS[p]}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{PAYMENT_GATEWAY_INFO[p].name}</span>
                  <span className="block text-xs text-muted">{PAYMENT_GATEWAY_INFO[p].currencies.join(', ')}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="-mt-3 flex gap-1.5 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden /> {info.description}
        </p>
        {unsupported && (
          <p className="flex gap-2 rounded-ui bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {info.name} no cobra en {currency}. Cambie la moneda o elija otra pasarela.
          </p>
        )}

        <div className="@container space-y-4">
          <Toggle checked={form.sandbox} onChange={(v) => set('sandbox', v)} label="Modo de pruebas (sandbox)" hint="Use las claves de prueba de la pasarela. Desactívelo al pasar a producción con las claves reales." />
          <p className="text-xs text-muted">{help.keys}</p>
          <div className="grid gap-4 @2xl:grid-cols-2">
            {form.provider !== 'stripe' && (
              <Field label="Clave pública" required={form.enabled}>
                <Input value={form.publicKey} onChange={(e) => set('publicKey', e.target.value.trim())} autoComplete="off" />
              </Field>
            )}
            <SecretField
              label={help.secretLabel}
              saved={!editingSecret}
              value={form.secret}
              onChange={(v) => set('secret', v)}
              onChange2={() => setChangeSecret(true)}
              placeholder={form.provider === 'stripe' ? 'sk_test_…' : ''}
            />
            {form.provider === 'stripe' && (
              <SecretField label="Secreto de firma del webhook" saved={!editingWebhook} value={form.webhookSecret} onChange={(v) => set('webhookSecret', v)} onChange2={() => setChangeWebhook(true)} placeholder="whsec_…" />
            )}
          </div>

          <div className="rounded-ui border border-border p-4">
            <p className="text-sm font-medium">URL de confirmación de pagos</p>
            <p className="mt-0.5 mb-2 text-xs text-muted">{help.webhook} Si el servidor no es accesible desde Internet, el estado igual se consulta cuando el cliente vuelve del pago.</p>
            {saved.webhookUrl && sameProvider ? <CopyField value={saved.webhookUrl} /> : <p className="text-xs text-muted">Aparece al guardar la pasarela.</p>}
          </div>

          <button type="button" className="text-xs font-medium text-muted underline-offset-2 hover:underline" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
            {advanced ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas'}
          </button>
          {advanced && (
            <Field label="Dirección de la API" hint="Solo para pruebas o un proxy propio. Vacío = la dirección oficial de la pasarela.">
              <Input value={form.apiUrl} onChange={(e) => set('apiUrl', e.target.value.trim())} placeholder="https://…" />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {dirty && <span className="mr-auto text-xs text-muted">Cambios sin guardar</span>}
          <Button
            variant="secondary"
            icon={<FlaskConical className="size-4" />}
            loading={test.isPending}
            disabled={!saved.enabled || dirty}
            onClick={() => test.mutate()}
            title={dirty ? 'Guarde los cambios antes de probar' : undefined}
          >
            Pago de prueba
          </Button>
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setForm(toForm(saved));
              setChangeSecret(false);
              setChangeWebhook(false);
            }}
          >
            Descartar
          </Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </div>
        {testResult && (
          <div
            role="status"
            className={cx(
              'flex flex-wrap items-center gap-2 rounded-ui border px-3 py-2.5 text-sm',
              testResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
            )}
          >
            <span className="min-w-0 flex-1">{testResult.message}</span>
            {testResult.url && (
              <a href={testResult.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
                Abrir el pago de prueba <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SecretField({ label, saved, value, onChange, onChange2, placeholder }: { label: string; saved: boolean; value: string; onChange: (v: string) => void; onChange2: () => void; placeholder?: string }) {
  return (
    <Field label={label} hint={saved ? 'Hay un valor guardado (cifrado).' : 'Se guarda cifrado y nunca se vuelve a mostrar.'}>
      {saved ? (
        <div className="flex gap-2">
          <Input value="••••••••••" readOnly aria-label={`${label} guardada`} />
          <Button variant="secondary" onClick={onChange2}>
            Cambiar
          </Button>
        </div>
      ) : (
        <Input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" placeholder={placeholder} />
      )}
    </Field>
  );
}
