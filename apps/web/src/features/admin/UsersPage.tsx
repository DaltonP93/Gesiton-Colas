import { Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Role, UserDTO } from '@gc/shared';
import {
  Badge,
  Button,
  Card,
  ChipSelect,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Table,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useBranches, useRemove, useSave, useServices, useUsers } from '../../lib/queries';

type TenantRole = Exclude<Role, 'superadmin'>;

const ASSIGNABLE_ROLES: TenantRole[] = ['admin', 'manager', 'agent'];

const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadministrador',
  admin: 'Administrador',
  manager: 'Supervisor',
  agent: 'Operador',
};

const ROLE_COLORS: Record<Role, string> = {
  superadmin: '#dc2626',
  admin: '#7c3aed',
  manager: '#2563eb',
  agent: '#0891b2',
};

function useRoleDescriptions(): Record<TenantRole, string> {
  const { terms } = useAuth();
  return {
    admin: 'Acceso total: configuración, usuarios, integraciones y API, pantallas, contenido y reportes.',
    manager: `Supervisa la operación: monitor en vivo, reportes, pantallas, kioscos y contenido. También puede atender ${terms.tickets.toLowerCase()}.`,
    agent: `Atiende ${terms.tickets.toLowerCase()} desde la consola de atención, en las ${terms.branches.toLowerCase()} y ${terms.services.toLowerCase()} que tenga asignados.`,
  };
}

function RoleBadge({ role }: { role: Role }) {
  return <Badge color={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Badge>;
}

interface UserForm {
  id: string | null;
  name: string;
  email: string;
  role: TenantRole;
  password: string;
  active: boolean;
  branchIds: string[];
  serviceIds: string[];
}

function userForm(u: UserDTO | null): UserForm {
  return {
    id: u?.id ?? null,
    name: u?.name ?? '',
    email: u?.email ?? '',
    role: u && u.role !== 'superadmin' ? u.role : 'agent',
    password: '',
    active: u?.active ?? true,
    branchIds: u?.branchIds ?? [],
    serviceIds: u?.serviceIds ?? [],
  };
}

export default function UsersPage() {
  const { me, terms } = useAuth();
  const { toast, confirm } = useFeedback();
  const users = useUsers();
  const branches = useBranches();
  const services = useServices();
  const remove = useRemove('users', ['users']);
  const [editing, setEditing] = useState<UserForm | null>(null);
  const roleDescriptions = useRoleDescriptions();

  const list = users.data ?? [];
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  const limit = me?.limits?.users ?? null;

  async function handleDelete(user: UserDTO) {
    const ok = await confirm({
      title: `¿Eliminar a «${user.name}»?`,
      message: `Perderá el acceso de inmediato. Los ${terms.tickets.toLowerCase()} que atendió conservarán su historial. Si solo quiere quitarle el acceso temporalmente, desactívelo.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(user.id);
      toast(`Se eliminó a «${user.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const addButton = (
    <Button icon={<Plus className="size-4" />} onClick={() => setEditing(userForm(null))}>
      Agregar usuario
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description={
          <>
            Personas que administran, supervisan o atienden en su organización.
            {limit !== null && me?.limits && (
              <span className="mt-1 block">
                Plan {me.limits.name}: {list.length} de {limit} usuarios en uso.
              </span>
            )}
          </>
        }
        actions={addButton}
      />

      {users.isLoading ? (
        <Loading />
      ) : users.isError ? (
        <EmptyState title="No se pudo cargar la información" description={errorMessage(users.error)} action={<Button onClick={() => users.refetch()}>Reintentar</Button>} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Users />} title="Aún no hay usuarios" description="Invite a su equipo para que pueda atender y supervisar." action={addButton} />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th>{terms.branches}</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((user) => {
                const isSelf = user.id === me?.user.id;
                return (
                  <tr key={user.id} className={cx(!user.active && 'opacity-60')}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold text-muted" aria-hidden>
                          {initials(user.name)}
                        </span>
                        <span className="font-medium">
                          {user.name}
                          {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(usted)</span>}
                        </span>
                      </div>
                    </td>
                    <td className="text-muted">{user.email}</td>
                    <td>
                      <RoleBadge role={user.role} />
                    </td>
                    <td>{user.active ? <Badge color="#16a34a">Activo</Badge> : <Badge color="#dc2626">Inactivo</Badge>}</td>
                    <td className="whitespace-nowrap text-muted">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca'}</td>
                    <td>
                      {user.branchIds.length === 0 ? (
                        <span className="text-muted">Todas</span>
                      ) : (
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {user.branchIds.map((id) => (
                            <Badge key={id}>{branchName.get(id) ?? '—'}</Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <IconButton label="Editar" icon={<Pencil className="size-4" />} onClick={() => setEditing(userForm(user))} />
                        <IconButton
                          label={isSelf ? 'No puede eliminar su propio usuario' : 'Eliminar'}
                          icon={<Trash2 className={cx('size-4', !isSelf && 'text-red-600')} />}
                          disabled={isSelf}
                          onClick={() => handleDelete(user)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mt-6" title="Roles" description="Cada rol incluye los permisos de los roles inferiores.">
        <dl className="grid gap-4 sm:grid-cols-3">
          {ASSIGNABLE_ROLES.map((role) => (
            <div key={role}>
              <dt>
                <RoleBadge role={role} />
              </dt>
              <dd className="mt-1.5 text-sm text-muted">{roleDescriptions[role]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {editing && (
        <UserFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          isSelf={editing.id === me?.user.id}
          branchOptions={(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
          serviceOptions={(services.data ?? []).map((s) => ({ value: s.id, label: s.name, color: s.color }))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

function Section({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      {children}
    </div>
  );
}

function UserFormModal({
  initial,
  isSelf,
  branchOptions,
  serviceOptions,
  onClose,
}: {
  initial: UserForm;
  isSelf: boolean;
  branchOptions: { value: string; label: string }[];
  serviceOptions: { value: string; label: string; color: string }[];
  onClose: () => void;
}) {
  const { terms } = useAuth();
  const { toast } = useFeedback();
  const save = useSave<UserDTO>('users', ['users']);
  const roleDescriptions = useRoleDescriptions();
  const [form, setForm] = useState(initial);
  const [limitError, setLimitError] = useState<string | null>(null);
  const formId = useId();
  const isNew = !form.id;
  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLimitError(null);
    try {
      await save.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        email: form.email.trim(),
        ...(isSelf ? {} : { role: form.role, active: form.active }),
        ...(form.password ? { password: form.password } : {}),
        branchIds: form.branchIds,
        serviceIds: form.serviceIds,
      });
      toast(isNew ? `Se creó el usuario «${form.name.trim()}».` : 'Cambios guardados.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setLimitError(err.message);
      else toast(errorMessage(err), 'error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'Agregar usuario' : `Editar «${initial.name}»`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {isNew ? 'Crear usuario' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        {limitError && (
          <p role="alert" className="rounded-ui border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <span className="font-medium">Límite del plan alcanzado.</span> {limitError}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required>
            <Input required minLength={2} maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" autoFocus />
          </Field>
          <Field label="Email" required>
            <Input type="email" required maxLength={200} value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Rol"
            required
            hint={isSelf ? 'No puede cambiar su propio rol.' : roleDescriptions[form.role]}
          >
            <Select value={form.role} onChange={(e) => set('role', e.target.value as TenantRole)} disabled={isSelf}>
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Contraseña"
            required={isNew}
            hint={isNew ? 'Mínimo 8 caracteres. Compártala con la persona de forma segura.' : 'Dejar vacío para no cambiar.'}
          >
            <Input
              type="password"
              required={isNew}
              minLength={8}
              maxLength={200}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        <Toggle
          checked={form.active}
          onChange={(v) => set('active', v)}
          disabled={isSelf}
          label="Activo"
          hint={isSelf ? 'No puede desactivar su propio usuario.' : 'Un usuario inactivo no puede iniciar sesión.'}
        />

        <Section title={`${terms.branches} asignadas`} hint={`Sin selección = puede trabajar en todas las ${terms.branches.toLowerCase()}.`}>
          <ChipSelect options={branchOptions} value={form.branchIds} onChange={(v) => set('branchIds', v)} emptyLabel={`No hay ${terms.branches.toLowerCase()}.`} />
        </Section>

        <Section title={`${terms.services} que atiende`} hint={`Sin selección = puede atender todos los ${terms.services.toLowerCase()}.`}>
          <ChipSelect options={serviceOptions} value={form.serviceIds} onChange={(v) => set('serviceIds', v)} emptyLabel={`No hay ${terms.services.toLowerCase()}.`} />
        </Section>

        {form.role === 'admin' && !isSelf && (
          <p className="flex items-start gap-2 rounded-ui bg-subtle px-3 py-2 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            Los administradores pueden cambiar toda la configuración, incluidas las integraciones y los demás usuarios.
          </p>
        )}
      </form>
    </Modal>
  );
}
