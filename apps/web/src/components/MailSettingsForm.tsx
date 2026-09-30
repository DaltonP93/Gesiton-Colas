import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, MailWarning, Send } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { MailSecurity, MailSettingsDTO, MailStatusDTO } from '@gc/shared';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field, Input, Loading, Select, Toggle, cx, useFeedback } from './ui';

/** Proveedores frecuentes: completan servidor, puerto y cifrado. */
const PRESETS: { name: string; host: string; port: number; security: MailSecurity; note: string }[] = [
  { name: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, security: 'starttls', note: 'Use una contraseña de aplicación (Cuenta de Google → Seguridad → Contraseñas de aplicaciones).' },
  { name: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, security: 'starttls', note: 'La cuenta debe tener habilitado «SMTP autenticado» en el centro de administración de Microsoft 365.' },
  { name: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, security: 'starttls', note: 'Use las credenciales SMTP de SES (no las claves de IAM) y un remitente verificado.' },
  { name: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, security: 'starttls', note: 'El usuario es el correo de la cuenta y la contraseña, la clave SMTP de Brevo.' },
  { name: 'Mailgun', host: 'smtp.mailgun.org', port: 587, security: 'starttls', note: 'Use las credenciales SMTP del dominio verificado en Mailgun.' },
  { name: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, security: 'ssl', note: 'Con verificación en dos pasos, use una contraseña específica de aplicación.' },
];

const SECURITY_LABELS: Record<MailSecurity, string> = {
  starttls: 'STARTTLS (puerto 587, recomendado)',
  ssl: 'SSL/TLS directo (puerto 465)',
  none: 'Sin cifrar (puerto 25, solo redes internas)',
};

type Form = Omit<MailSettingsDTO, 'hasPassword' | 'updatedAt'> & { password: string };

const toForm = (s: MailSettingsDTO): Form => ({
  enabled: s.enabled,
  host: s.host,
  port: s.port,
  security: s.security,
  username: s.username,
  password: '',
  fromName: s.fromName,
  fromEmail: s.fromEmail,
  replyTo: s.replyTo,
});

/**
 * Configuración del servidor de correo saliente. `scope` define qué se configura:
 * el de toda la plataforma (superadministrador) o el propio de una organización.
 */
export function MailSettingsForm({ scope }: { scope: 'platform' | 'tenant' }) {
  const { me } = useAuth();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const path = scope === 'platform' ? '/platform/mail' : '/mail-settings';
  const status = useQuery({ queryKey: ['mail-settings', scope, me?.tenant?.id ?? null], queryFn: () => api.get<MailStatusDTO>(path) });
  const [form, setForm] = useState<Form | null>(null);
  const [changePassword, setChangePassword] = useState(false);
  const [testTo, setTestTo] = useState(me?.user.email ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (status.data && !form) {
      setForm(toForm(status.data.settings));
      setChangePassword(!status.data.settings.hasPassword);
    }
  }, [status.data, form]);

  const body = () => {
    const f = form!;
    return { ...f, port: Number(f.port) || 587, password: changePassword ? f.password : undefined };
  };

  const save = useMutation({
    mutationFn: () => api.put<MailStatusDTO>(path, body()),
    onSuccess: (data) => {
      qc.setQueryData(['mail-settings', scope, me?.tenant?.id ?? null], data);
      void qc.invalidateQueries({ queryKey: ['public-config'] });
      setForm(toForm(data.settings));
      setChangePassword(!data.settings.hasPassword);
      toast('Configuración de correo guardada');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`${path}/test`, { ...body(), to: testTo }),
    onSuccess: (data) => setTestResult({ ok: true, message: data.message }),
    onError: (err) => setTestResult({ ok: false, message: errorMessage(err) }),
  });

  if (status.isLoading || !form) return <Loading />;
  if (status.isError || !status.data) return <p className="text-sm text-red-600">{errorMessage(status.error)}</p>;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setTestResult(null);
  };
  const saved = status.data.settings;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(saved)) || (changePassword && Boolean(form.password));

  return (
    <div className="space-y-6">
      <ActiveBanner status={status.data} scope={scope} />

      <div className="gc-card gc-pad space-y-6">
        <Toggle
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
          label={scope === 'platform' ? 'Enviar los correos con este servidor' : 'Usar un servidor de correo propio'}
          hint={
            scope === 'platform'
              ? 'Invitaciones, códigos de acceso, recuperación de contraseña y demos de todas las organizaciones (salvo las que tengan servidor propio).'
              : 'Los correos de su organización salen desde su dominio. Si lo desactiva, se usa el correo de la plataforma.'
          }
        />

        <div>
          <p className="mb-2 text-sm font-medium">Proveedor</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = form.host === p.host;
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setForm((f) => (f ? { ...f, host: p.host, port: p.port, security: p.security } : f));
                    setNote(p.note);
                    setTestResult(null);
                  }}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle',
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          {(note ?? PRESETS.find((p) => p.host === form.host)?.note) && (
            <p className="mt-2 flex gap-1.5 text-xs text-muted">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              {note ?? PRESETS.find((p) => p.host === form.host)?.note}
            </p>
          )}
        </div>

        <div className="@container">
          <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_8rem] @4xl:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
            <Field label="Servidor SMTP" required={form.enabled}>
              <Input value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="smtp.suempresa.com" autoComplete="off" />
            </Field>
            <Field label="Puerto">
              <Input type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
            </Field>
            <Field label="Cifrado" className="@xl:col-span-2 @4xl:col-span-1">
              <Select value={form.security} onChange={(e) => set('security', e.target.value as MailSecurity)}>
                {(Object.keys(SECURITY_LABELS) as MailSecurity[]).map((k) => (
                  <option key={k} value={k}>
                    {SECURITY_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 grid gap-4 @xl:grid-cols-2">
            <Field label="Usuario" hint="Normalmente, la dirección de correo completa.">
              <Input value={form.username} onChange={(e) => set('username', e.target.value.trim())} autoComplete="off" placeholder="avisos@suempresa.com" />
            </Field>
            <Field label="Contraseña" hint={saved.hasPassword && !changePassword ? 'Hay una contraseña guardada (cifrada).' : 'Se guarda cifrada y nunca se vuelve a mostrar.'}>
              {saved.hasPassword && !changePassword ? (
                <div className="flex gap-2">
                  <Input value="••••••••••" readOnly aria-label="Contraseña guardada" />
                  <Button variant="secondary" onClick={() => setChangePassword(true)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              )}
            </Field>
          </div>
          <div className="mt-4 grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
            <Field label="Nombre del remitente" hint="Vacío = el nombre de la organización que envía.">
              <Input value={form.fromName} maxLength={120} onChange={(e) => set('fromName', e.target.value)} placeholder={me?.tenant?.name ?? 'Gestión de Colas'} />
            </Field>
            <Field label="Correo del remitente" hint="Vacío = el usuario.">
              <Input type="email" value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value.trim())} placeholder="no-responder@suempresa.com" />
            </Field>
            <Field label="Responder a" hint="Opcional: a dónde llegan las respuestas.">
              <Input type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value.trim())} placeholder="atencion@suempresa.com" />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {dirty && <span className="mr-auto text-xs text-muted">Cambios sin guardar</span>}
          <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setForm(toForm(saved))}>
            Descartar
          </Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </div>
      </div>

      <div className="gc-card gc-pad">
        <h3 className="text-base font-semibold">Probar el envío</h3>
        <p className="mt-0.5 text-sm text-muted">Se envía un correo real con los datos del formulario, aunque todavía no los haya guardado.</p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Enviar a" className="min-w-60 flex-1">
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </Field>
          <Button icon={<Send className="size-4" />} loading={test.isPending} disabled={!form.host || !testTo} onClick={() => test.mutate()}>
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
            {testResult.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <MailWarning className="mt-0.5 size-4 shrink-0" />}
            {testResult.message}
          </p>
        )}
      </div>
    </div>
  );
}

function ActiveBanner({ status, scope }: { status: MailStatusDTO; scope: 'platform' | 'tenant' }) {
  const messages: Record<MailStatusDTO['active'], { tone: 'ok' | 'warn'; text: ReactNode }> = {
    tenant: { tone: 'ok', text: <>Los correos de su organización salen por su servidor propio{status.from ? <> como <strong>{status.from}</strong></> : null}.</> },
    platform: {
      tone: 'ok',
      text:
        scope === 'platform' ? (
          <>El correo está activo: los mensajes salen como <strong>{status.from}</strong>.</>
        ) : (
          <>Hoy se usa el correo de la plataforma{status.from ? <> (<strong>{status.from}</strong>)</> : null}. Configure uno propio si quiere enviar desde su dominio.</>
        ),
    },
    env: { tone: 'ok', text: <>Se usa el servidor definido en las variables del servidor (SMTP_HOST){status.from ? <> como <strong>{status.from}</strong></> : null}.</> },
    none: {
      tone: 'warn',
      text: (
        <>
          <strong>No hay correo configurado.</strong> Las invitaciones y los códigos de acceso no llegan: por ahora se comparte el enlace de invitación a mano
          (Usuarios → copiar enlace).
        </>
      ),
    },
  };
  const m = messages[status.active];
  return (
    <div
      role="status"
      className={cx(
        'flex items-start gap-3 rounded-ui border px-4 py-3 text-sm',
        m.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10',
      )}
    >
      {m.tone === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-600" />}
      <p className="min-w-0">{m.text}</p>
    </div>
  );
}
