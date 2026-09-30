import { ArrowLeft, CheckCircle2, KeyRound, Mail, MailCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { MeDTO } from '@gc/shared';
import { Button, Field, Input, Loading, cx } from '../../components/ui';
import { ApiError, api, assetUrl, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { usePublicConfig } from '../../lib/queries';

type Session = MeDTO & { token: string };

/* ------------------------------------------------------------------ */
/* Piezas comunes                                                      */
/* ------------------------------------------------------------------ */

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { platformBrand: brand } = useAuth();
  const { data: config } = usePublicConfig();
  // Solo se ofrece volver a la página principal cuando es la presentación del producto.
  const showHome = config?.homePage === 'landing';
  const logo = brand.logoUrl ? assetUrl(brand.logoUrl) : null;
  const mark = (onColor: boolean) =>
    logo ? (
      <span className={cx('inline-flex max-w-56 items-center rounded-ui', onColor && 'bg-white px-3 py-2 shadow-sm')}>
        <img src={logo} alt={brand.appName} className="h-8 max-w-full object-contain" />
      </span>
    ) : (
      <span className="inline-flex items-center gap-2 text-base font-bold">
        <span className={cx('grid size-9 place-items-center rounded-ui text-lg', onColor ? 'bg-white/20' : 'bg-primary text-primary-fg')}>
          {brand.appName.charAt(0)}
        </span>
        {brand.appName}
      </span>
    );
  const panelStyle: CSSProperties | undefined = brand.loginImageUrl
    ? {
        backgroundImage: `linear-gradient(160deg, color-mix(in srgb, var(--gc-primary) 92%, transparent), color-mix(in srgb, var(--gc-primary) 82%, #000 18%)), url("${assetUrl(brand.loginImageUrl)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-primary p-12 text-primary-fg lg:flex lg:flex-col lg:justify-between" style={panelStyle}>
        {!brand.loginImageUrl && (
          <>
            <div className="absolute -top-32 -right-32 size-96 rounded-full bg-white/10" />
            <div className="absolute -bottom-40 -left-20 size-[28rem] rounded-full bg-black/10" />
          </>
        )}
        <div className="relative flex items-center justify-between gap-4">
          {mark(true)}
          {showHome && (
            <Link to="/" className="flex items-center gap-1.5 text-sm opacity-85 hover:opacity-100">
              <ArrowLeft className="size-4" /> Inicio
            </Link>
          )}
        </div>
        <div className="relative max-w-md">
          <p className="text-4xl leading-tight font-bold text-balance">{brand.loginTitle}</p>
          {brand.loginText && <p className="mt-4 text-lg opacity-85">{brand.loginText}</p>}
        </div>
        <p className="relative text-sm opacity-75">
          © {new Date().getFullYear()} {brand.appName}
          {brand.supportEmail && (
            <>
              {' · '}
              <a href={`mailto:${brand.supportEmail}`} className="underline-offset-2 hover:underline">
                {brand.supportEmail}
              </a>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between gap-3 lg:hidden">
            {mark(false)}
            {showHome && (
              <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
                <ArrowLeft className="size-4" /> Inicio
              </Link>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 space-y-2 text-center text-sm text-muted">{footer}</div>}
          {brand.supportEmail && (
            <p className="mt-8 text-center text-xs text-muted lg:hidden">
              ¿Problemas para ingresar?{' '}
              <a href={`mailto:${brand.supportEmail}`} className="font-medium text-primary hover:underline">
                {brand.supportEmail}
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Alert({ tone = 'error', children }: { tone?: 'error' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'border-red-500/30 bg-red-500/10 text-red-700',
    info: 'border-primary/30 bg-primary/10 text-fg',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-ui border px-3 py-2.5 text-sm ${styles}`}>
      {children}
    </div>
  );
}

function Done({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 text-primary [&_svg]:size-7">{icon}</div>
      <p className="mt-4 text-lg font-semibold">{title}</p>
      <div className="mt-2 text-sm text-muted">{children}</div>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

const Or = () => (
  <div className="my-6 flex items-center gap-3 text-xs text-muted uppercase">
    <span className="h-px flex-1 bg-border" /> o <span className="h-px flex-1 bg-border" />
  </div>
);

const landingFor = (me: MeDTO) => (me.tenant ? '/app' : '/plataforma');

/** Consume un token de un solo uso al montar (protegido contra el doble montaje de StrictMode). */
function useTokenOnce<T>(run: (token: string) => Promise<T>) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const started = useRef(false);
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; data?: T; error?: string }>({ status: 'loading' });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState({ status: 'error', error: 'El enlace está incompleto. Ábralo nuevamente desde el correo.' });
      return;
    }
    run(token)
      .then((data) => setState({ status: 'ok', data }))
      .catch((error) => setState({ status: 'error', error: errorMessage(error) }));
  }, [token, run]);
  return { token, ...state };
}

/* ------------------------------------------------------------------ */
/* Iniciar sesión                                                      */
/* ------------------------------------------------------------------ */

/** Quien abre el ingreso con una sesión ya iniciada elige seguir o cambiar de cuenta (no se lo redirige sin avisar). */
function SignedInNotice({ me }: { me: MeDTO }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const initials = me.user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  const where = me.tenant ? me.tenant.name : 'Administración de la plataforma';
  const support = me.user.role === 'superadmin' && me.tenant;
  return (
    <AuthShell title="Ya inició sesión" subtitle="Puede seguir con esta cuenta o entrar con otra.">
      <div className="flex items-center gap-3 rounded-ui border border-border bg-surface p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary-text">{initials}</span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{me.user.name}</span>
          <span className="block truncate text-sm text-muted">{me.user.email}</span>
          <span className="block truncate text-xs text-muted">{support ? `Modo soporte en «${where}»` : where}</span>
        </span>
      </div>
      <div className="mt-6 space-y-3">
        <Button size="lg" className="w-full" onClick={() => navigate(landingFor(me), { replace: true })}>
          Continuar como {me.user.name.split(' ')[0]}
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={logout}>
          Cerrar sesión y usar otra cuenta
        </Button>
      </div>
    </AuthShell>
  );
}

export function LoginPage() {
  const { me, login } = useAuth();
  const { data: config } = usePublicConfig();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me && params.get('next')) return <Navigate to={params.get('next')!} replace />;
  if (me) return <SignedInNotice me={me} />;
  const q = email ? `?email=${encodeURIComponent(email)}` : '';
  const emailLogin = config?.allowEmailLogin !== false && config?.emailEnabled !== false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      navigate(params.get('next') ?? landingFor(res), { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err), code: err instanceof ApiError ? err.code : undefined });
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    await api.public('/auth/resend-verification', { email });
    setError(null);
    setNotice(`Le reenviamos el correo de verificación a ${email}.`);
  }

  return (
    <AuthShell
      title="Iniciar sesión"
      subtitle="Ingrese para administrar, atender o abrir sus pantallas y kioscos."
      footer={
        <>
          {config?.allowSignup !== false && (
            <p>
              ¿Aún no tiene cuenta?{' '}
              <Link to="/registro" className="font-medium text-primary hover:underline">
                Cree su organización
              </Link>
            </p>
          )}
          {config?.allowDemo !== false && (
            <p>
              ¿Quiere ver cómo funciona?{' '}
              <Link to="/demo" className="font-medium text-primary hover:underline">
                Pida una demo por correo
              </Link>
            </p>
          )}
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Contraseña">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="-mt-1 text-right">
          <Link to={`/olvide-contrasena${q}`} className="text-sm font-medium text-primary hover:underline">
            ¿Olvidó su contraseña?
          </Link>
        </div>
        {error && (
          <Alert>
            <p>{error.message}</p>
            {error.code === 'email_not_verified' && (
              <button type="button" onClick={() => void resendVerification()} className="mt-2 font-semibold underline">
                Reenviar correo de verificación
              </button>
            )}
            {error.code === 'no_password' && emailLogin && (
              <Link to={`/ingresar-con-correo${q}${q ? '&' : '?'}enviar=1`} className="mt-2 inline-block font-semibold underline">
                Enviarme un código de acceso
              </Link>
            )}
          </Alert>
        )}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Ingresar
        </Button>
      </form>
      {emailLogin && (
        <>
          <Or />
          <Link to={`/ingresar-con-correo${q}`}>
            <Button variant="secondary" size="lg" className="w-full" icon={<Mail className="size-4" />}>
              Ingresar con un código por correo
            </Button>
          </Link>
        </>
      )}
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Ingreso sin contraseña (código o enlace)                            */
/* ------------------------------------------------------------------ */

export function EmailLoginPage() {
  const { me, acceptSession } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [step, setStep] = useState<'email' | 'code'>(params.get('codigo') === '1' && params.get('email') ? 'code' : 'email');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const autoSent = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.public('/auth/email-login', { email });
      setStep('code');
      setCooldown(30);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.get('enviar') === '1' && email && !autoSent.current) {
      autoSent.current = true;
      void send();
    }
  });

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.public<Session>('/auth/email-login/verify', { email, code });
      navigate(landingFor(acceptSession(res)), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (me) return <Navigate to={landingFor(me)} replace />;

  return (
    <AuthShell
      title="Ingresar sin contraseña"
      subtitle={step === 'email' ? 'Le enviaremos un código de 6 dígitos y un enlace de acceso a su correo.' : `Ingrese el código que enviamos a ${email}.`}
      footer={
        <Link to={`/login${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="font-medium text-primary hover:underline">
          Volver a ingresar con contraseña
        </Link>
      }
    >
      {step === 'email' ? (
        <form onSubmit={send} className="space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={loading} icon={<Mail className="size-4" />}>
            Enviarme el código
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <Alert tone="info">Revise su bandeja de entrada (y la carpeta de spam). También puede hacer clic en el enlace del correo.</Alert>
          <Field label="Código de acceso">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
              autoFocus
              aria-label="Código de 6 dígitos"
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={code.length !== 6}>
            Ingresar
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-muted hover:text-fg" onClick={() => setStep('email')}>
              Cambiar email
            </button>
            <button type="button" className="font-medium text-primary disabled:text-muted" disabled={cooldown > 0 || loading} onClick={() => void send()}>
              {cooldown > 0 ? `Reenviar en ${cooldown} s` : 'Reenviar código'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

/** Enlace de acceso recibido por correo (/acceso?token=...). */
export function MagicLinkPage() {
  const { acceptSession } = useAuth();
  const navigate = useNavigate();
  const result = useTokenOnce(async (token) => acceptSession(await api.public<Session>('/auth/email-login/verify', { token })));
  useEffect(() => {
    if (result.status === 'ok' && result.data) navigate(landingFor(result.data), { replace: true });
  }, [result.status, result.data, navigate]);
  return (
    <AuthShell title="Ingresando…">
      {result.status === 'error' ? (
        <Done
          icon={<KeyRound />}
          title="No pudimos validar el enlace"
          action={
            <Link to="/ingresar-con-correo">
              <Button>Pedir un código nuevo</Button>
            </Link>
          }
        >
          {result.error}
        </Done>
      ) : (
        <Loading label="Validando su acceso…" />
      )}
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Contraseña                                                          */
/* ------------------------------------------------------------------ */

export function ForgotPasswordPage() {
  const { platformBrand } = useAuth();
  const { data: config } = usePublicConfig();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.public('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="¿Olvidó su contraseña?"
      subtitle="Le enviaremos un enlace para elegir una nueva."
      footer={
        <Link to={`/login${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="font-medium text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      {config?.emailEnabled === false ? (
        <Alert tone="info">
          <p className="font-medium">Esta instalación todavía no envía correos.</p>
          <p className="mt-1">
            Pida al administrador de su organización que le defina una nueva contraseña desde Configuración → Usuarios
            {platformBrand.supportEmail ? (
              <>
                {' '}o escriba a{' '}
                <a href={`mailto:${platformBrand.supportEmail}`} className="font-semibold underline">
                  {platformBrand.supportEmail}
                </a>
              </>
            ) : null}
            .
          </p>
        </Alert>
      ) : sent ? (
        <Done icon={<MailCheck />} title="Revise su correo">
          Si <strong>{email}</strong> está registrado, recibirá un enlace para restablecer la contraseña. El enlace vence en 1 hora.
        </Done>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

function NewPasswordForm({ submitLabel, onSubmit, extra }: { submitLabel: string; onSubmit: (password: string) => Promise<void>; extra?: ReactNode }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mismatch = repeat.length > 0 && password !== repeat;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError('Las contraseñas no coinciden.');
    setError(null);
    setLoading(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {extra}
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
        <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Field label="Repita la contraseña" error={mismatch ? 'No coincide.' : undefined}>
        <Input type="password" required minLength={8} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { acceptSession } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  return (
    <AuthShell
      title="Elija una nueva contraseña"
      subtitle="Por seguridad, se cerrarán las sesiones abiertas en otros dispositivos."
      footer={
        <Link to="/olvide-contrasena" className="font-medium text-primary hover:underline">
          Pedir un enlace nuevo
        </Link>
      }
    >
      {!token ? (
        <Alert>El enlace está incompleto. Ábralo nuevamente desde el correo.</Alert>
      ) : (
        <NewPasswordForm
          submitLabel="Guardar e ingresar"
          onSubmit={async (password) => {
            const res = await api.public<Session>('/auth/reset-password', { token, password });
            navigate(landingFor(acceptSession(res)), { replace: true });
          }}
        />
      )}
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ */
/* Verificación, invitación, registro y demo                           */
/* ------------------------------------------------------------------ */

export function VerifyEmailPage() {
  const { acceptSession } = useAuth();
  const navigate = useNavigate();
  const result = useTokenOnce(async (token) => acceptSession(await api.public<Session>('/auth/verify-email', { token })));
  useEffect(() => {
    if (result.status !== 'ok' || !result.data) return;
    const timer = setTimeout(() => navigate(landingFor(result.data!), { replace: true }), 2500);
    return () => clearTimeout(timer);
  }, [result.status, result.data, navigate]);
  return (
    <AuthShell title="Confirmación de correo">
      {result.status === 'loading' && <Loading label="Confirmando su correo…" />}
      {result.status === 'ok' && result.data && (
        <Done
          icon={<CheckCircle2 />}
          title="¡Correo confirmado!"
          action={
            <Button onClick={() => navigate(landingFor(result.data!), { replace: true })} className="w-full" size="lg">
              Continuar
            </Button>
          }
        >
          Gracias, {result.data.user.name.split(' ')[0]}. Su cuenta quedó verificada.
        </Done>
      )}
      {result.status === 'error' && (
        <Done
          icon={<MailCheck />}
          title="No pudimos confirmar el correo"
          action={
            <Link to="/login">
              <Button>Ir a iniciar sesión</Button>
            </Link>
          }
        >
          {result.error} Puede pedir un nuevo correo de verificación desde el panel.
        </Done>
      )}
    </AuthShell>
  );
}

export function AcceptInvitePage() {
  const { acceptSession } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [invite, setInvite] = useState<{ email: string; name: string; organization: string } | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'El enlace está incompleto.');
  const [name, setName] = useState('');

  useEffect(() => {
    if (!token) return;
    api
      .public<{ email: string; name: string; organization: string }>(`/auth/invite/${encodeURIComponent(token)}`)
      .then((data) => {
        setInvite(data);
        setName(data.name);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  return (
    <AuthShell
      title={invite ? `Bienvenido a ${invite.organization}` : 'Aceptar invitación'}
      subtitle={invite ? <>Elija su contraseña para ingresar como <strong>{invite.email}</strong>.</> : undefined}
    >
      {error ? (
        <Done
          icon={<Mail />}
          title="La invitación no es válida"
          action={
            <Link to="/login">
              <Button>Ir a iniciar sesión</Button>
            </Link>
          }
        >
          {error} Pida al administrador que le reenvíe la invitación.
        </Done>
      ) : !invite ? (
        <Loading />
      ) : (
        <NewPasswordForm
          submitLabel="Aceptar e ingresar"
          extra={
            <Field label="Su nombre">
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          }
          onSubmit={async (password) => {
            const res = await api.public<Session>('/auth/accept-invite', { token, password, name: name.trim() || undefined });
            navigate(landingFor(acceptSession(res)), { replace: true });
          }}
        />
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { me, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Una organización recién creada empieza por el asistente de configuración.
  const justCreated = useRef(false);

  if (me) return <Navigate to={justCreated.current ? '/app/bienvenida' : '/app'} replace />;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    justCreated.current = true;
    try {
      const res = await register(form);
      if (res) navigate('/app/bienvenida', { replace: true });
      else setPendingEmail(form.email);
    } catch (err) {
      justCreated.current = false;
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Cree su organización"
      subtitle="En un minuto tendrá una sucursal, servicios, una pantalla y un kiosco listos para usar."
      footer={
        <>
          <p>
            ¿Ya tiene cuenta?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Inicie sesión
            </Link>
          </p>
          <p>
            ¿Prefiere probar primero?{' '}
            <Link to="/demo" className="font-medium text-primary hover:underline">
              Pida una demo
            </Link>
          </p>
        </>
      }
    >
      {pendingEmail ? (
        <Done icon={<MailCheck />} title="Confirme su correo">
          Le enviamos un enlace a <strong>{pendingEmail}</strong>. Ábralo para activar su cuenta e ingresar.
        </Done>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nombre de la organización">
            <Input required minLength={2} value={form.organizationName} onChange={set('organizationName')} placeholder="Ej.: Clínica San José" autoFocus />
          </Field>
          <Field label="Su nombre">
            <Input required minLength={2} value={form.name} onChange={set('name')} autoComplete="name" />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <Field label="Contraseña" hint="Mínimo 8 caracteres">
            <Input type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Crear cuenta
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function DemoPage() {
  const { me } = useAuth();
  const { data: config } = usePublicConfig();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', organizationName: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to="/app" replace />;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.public('/auth/demo', {
        name: form.name,
        email: form.email,
        organizationName: form.organizationName || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Pruebe la demo"
      subtitle="Le enviamos por correo el acceso a una organización de ejemplo con turnos, pantalla de TV, kiosco, publicidad y reportes."
      footer={
        <p>
          ¿Ya tiene cuenta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Inicie sesión
          </Link>
        </p>
      }
    >
      {sent ? (
        <Done
          icon={<MailCheck />}
          title="¡Su demo está lista!"
          action={
            <Link to={`/ingresar-con-correo?email=${encodeURIComponent(form.email)}&codigo=1`}>
              <Button size="lg" className="w-full">
                Tengo el código del correo
              </Button>
            </Link>
          }
        >
          Revise <strong>{form.email}</strong>: allí encontrará el botón para entrar y un código de acceso.
        </Done>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Su nombre">
            <Input required minLength={2} value={form.name} onChange={set('name')} autoComplete="name" autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <Field label="Organización (opcional)">
            <Input value={form.organizationName} onChange={set('organizationName')} placeholder="Ej.: Farmacia Central" />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={loading} icon={<Sparkles className="size-4" />}>
            Enviarme la demo
          </Button>
          <p className="text-center text-xs text-muted">Sin tarjeta de crédito. La demo dura {config?.demoDays ?? 14} días.</p>
          {config?.allowDemo === false && <Alert>Las demos no están habilitadas en esta instalación.</Alert>}
        </form>
      )}
    </AuthShell>
  );
}
