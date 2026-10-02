import { BellRing, KeyRound } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LOCALES, type Locale, type MeDTO, type Role } from '@gc/shared';
import { Avatar } from '../../components/Avatar';
import { AvatarEditor } from '../../components/AvatarEditor';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Select, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { LOCALE_LABELS } from '../../lib/i18n';

const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadministrador',
  admin: 'Administrador',
  manager: 'Supervisor',
  agent: 'Operador',
};

/** Mi perfil dentro de una organización (/app/perfil). */
export default function ProfilePage() {
  return (
    <div>
      <PageHeader title="Mi perfil" description="Su foto, sus datos personales, idioma y contraseña." />
      <ProfileContent />
    </div>
  );
}

/**
 * Contenido de «Mi perfil». En la plataforma (`platform`) el superadministrador también cambia su correo
 * y carga el celular donde recibe los avisos por WhatsApp/SMS.
 */
export function ProfileContent({ platform = false }: { platform?: boolean }) {
  const { me } = useAuth();
  if (!me) return <Loading />;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Foto de perfil" description={platform ? 'Se ve en el encabezado de la plataforma y en la lista de superadministradores.' : 'La ven sus compañeros en la lista de usuarios y en el encabezado del panel.'}>
          <AvatarEditor />
        </Card>
        <PersonalCard me={me} platform={platform} />
        <PasswordCard />
      </div>
      <AccountCard me={me} platform={platform} />
    </div>
  );
}

function PersonalCard({ me, platform }: { me: MeDTO; platform: boolean }) {
  const { refresh, settings } = useAuth();
  const { toast } = useFeedback();
  const [name, setName] = useState(me.user.name);
  const [email, setEmail] = useState(me.user.email);
  const [phone, setPhone] = useState(me.user.phone ?? '');
  const [locale, setLocale] = useState<Locale | ''>(me.user.locale ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cleanEmail = email.trim().toLowerCase();
  const changesEmail = platform && cleanEmail !== me.user.email;
  const needsCurrent = changesEmail && me.user.hasPassword;
  const dirty =
    name.trim() !== me.user.name || (locale || null) !== me.user.locale || (platform && (changesEmail || phone.trim() !== (me.user.phone ?? '')));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.put<MeDTO>('/auth/me', {
        name: name.trim(),
        locale: locale || null,
        ...(platform ? { phone: phone.trim() || null } : {}),
        ...(changesEmail ? { email: cleanEmail, ...(needsCurrent ? { currentPassword } : {}) } : {}),
      });
      await refresh();
      setCurrentPassword('');
      toast('Perfil actualizado.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Datos personales" description={platform ? 'Su nombre y correo de ingreso a la plataforma.' : 'Así lo verán sus compañeros en la consola y en los reportes.'}>
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <p role="alert" className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required>
            <Input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          {platform && (
            <Field label="Email" required hint="Con este correo ingresa a la plataforma.">
              <Input type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
          )}
          {platform && (
            <Field label="Celular" hint="Recibe aquí los avisos de la plataforma por WhatsApp/SMS. Opcional.">
              <Input type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="0981 123 456" />
            </Field>
          )}
          <Field label="Idioma" hint="Idioma preferido para su cuenta.">
            <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale | '')}>
              <option value="">{platform ? 'Predeterminado' : `Predeterminado de la organización (${LOCALE_LABELS[settings.locale]})`}</option>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {needsCurrent && (
          <Field label="Contraseña actual" required hint="Para cambiar su correo confirme su contraseña.">
            <Input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className="sm:w-80" />
          </Field>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!dirty || (needsCurrent && !currentPassword)}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const { me, refresh, acceptSession } = useAuth();
  const hasPassword = me?.user.hasPassword ?? true;
  const { toast } = useFeedback();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mismatch = repeat.length > 0 && next !== repeat;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (next !== repeat) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (hasPassword && next === current) {
      setError('La nueva contraseña debe ser distinta de la actual.');
      return;
    }
    setSaving(true);
    try {
      // Al cambiar la contraseña se cierran las demás sesiones y se recibe un token nuevo.
      const res = await api.put<MeDTO & { token?: string }>('/auth/me', { currentPassword: hasPassword ? current : undefined, newPassword: next });
      if (res.token) acceptSession({ ...res, token: res.token });
      else await refresh();
      setCurrent('');
      setNext('');
      setRepeat('');
      toast('Contraseña actualizada.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={hasPassword ? 'Cambiar contraseña' : 'Definir una contraseña'}
      description={
        hasPassword
          ? 'Use al menos 8 caracteres. Al cambiarla se cerrarán sus sesiones en otros dispositivos.'
          : 'Ingresó con un enlace o código por correo. Defina una contraseña para poder ingresar también con ella.'
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {hasPassword && (
          <Field label="Contraseña actual" required>
            <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nueva contraseña" required>
            <Input type="password" required minLength={8} maxLength={200} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Repita la nueva contraseña" required error={mismatch ? 'No coincide con la nueva contraseña.' : undefined}>
            <Input type="password" required minLength={8} maxLength={200} value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" icon={<KeyRound className="size-4" />} loading={saving} disabled={(hasPassword && !current) || !next || !repeat}>
            {hasPassword ? 'Cambiar contraseña' : 'Guardar contraseña'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AccountCard({ me, platform }: { me: MeDTO; platform: boolean }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Email', value: <span className="break-all">{me.user.email}</span> },
    { label: 'Rol', value: <Badge>{ROLE_LABELS[me.user.role]}</Badge> },
    ...(platform ? [] : [{ label: 'Organización', value: me.tenant?.name ?? '—' }]),
    ...(me.limits && !platform ? [{ label: 'Plan', value: me.limits.name }] : []),
    { label: 'Último acceso', value: formatDateTime(me.user.lastLoginAt) },
    { label: 'Cuenta creada', value: formatDateTime(me.user.createdAt) },
  ];
  return (
    <Card title="Cuenta" className="h-fit">
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={me.user.name} url={me.user.avatarUrl} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{me.user.name}</p>
          <p className="truncate text-sm text-muted">{me.user.email}</p>
        </div>
      </div>
      <dl className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4">
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 text-right font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
      {platform ? (
        <Link to="/plataforma#comunicaciones" className="mt-5 flex items-center gap-2 text-sm font-medium text-primary-text hover:underline">
          <BellRing className="size-4" /> Elegir qué avisos recibe y por qué canal
        </Link>
      ) : (
        <p className="mt-5 text-xs text-muted">Para cambiar su email o su rol, pídaselo a un administrador de la organización.</p>
      )}
    </Card>
  );
}
