import { ArrowLeft } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button, Field, Input } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  const { settings } = useAuth();
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-primary p-12 text-primary-fg lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-40 -left-20 size-[28rem] rounded-full bg-black/10" />
        <Link to="/" className="relative flex items-center gap-2 text-sm opacity-90 hover:opacity-100">
          <ArrowLeft className="size-4" /> {settings.branding.appName}
        </Link>
        <div className="relative max-w-md">
          <p className="text-4xl leading-tight font-bold">Turnos, pantallas y publicidad en un solo lugar.</p>
          <p className="mt-4 text-lg opacity-85">
            Organice la atención de todas sus sucursales, muestre contenido en las salas de espera e intégrelo con sus sistemas.
          </p>
        </div>
        <p className="relative text-sm opacity-70">© {new Date().getFullYear()} {settings.branding.appName}</p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-muted">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { me, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to={params.get('next') ?? (me.tenant ? '/app' : '/plataforma')} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      navigate(params.get('next') ?? (res.tenant ? '/app' : '/plataforma'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Iniciar sesión"
      subtitle="Ingrese con su cuenta para administrar o atender."
      footer={
        <>
          ¿Aún no tiene cuenta?{' '}
          <Link to="/registro" className="font-medium text-primary hover:underline">
            Cree su organización gratis
          </Link>
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
        {error && <p className="rounded-ui bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Ingresar
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { me, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to="/app" replace />;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(form);
      navigate('/app', { replace: true });
    } catch (err) {
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
          ¿Ya tiene cuenta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Inicie sesión
          </Link>
        </>
      }
    >
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
        {error && <p className="rounded-ui bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Crear cuenta
        </Button>
      </form>
    </AuthShell>
  );
}
