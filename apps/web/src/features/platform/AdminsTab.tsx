import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Send, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { InviteResultDTO, UserDTO } from '@gc/shared';
import { InviteResultModal } from '../../components/InviteResult';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Loading, Modal, Table, Toggle, useFeedback } from '../../components/ui';
import { api, errorMessage, session } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';

type Editing = { user: UserDTO | null };

/** Superadministradores: quienes administran toda la plataforma. */
export function AdminsTab() {
  const { me } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const admins = useQuery({ queryKey: ['platform', 'admins'], queryFn: () => api.get<UserDTO[]>('/platform/admins') });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [invited, setInvited] = useState<{ result: InviteResultDTO; user: UserDTO } | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/platform/admins/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'admins'] }),
  });

  async function handleDelete(user: UserDTO) {
    const ok = await confirm({
      title: `¿Quitar a «${user.name}» como superadministrador?`,
      message: 'Pierde el acceso a la plataforma de inmediato.',
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(user.id);
      toast(`Se quitó a «${user.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function resend(user: UserDTO) {
    try {
      const result = await api.post<InviteResultDTO>(`/platform/admins/${user.id}/invite`);
      setInvited({ result, user });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const list = admins.data ?? [];

  return (
    <Card
      padded={false}
      title="Superadministradores"
      description="Tienen acceso a todas las organizaciones, los planes y los ajustes de la plataforma. Deje al menos dos para no perder el acceso."
      actions={
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ user: null })}>
          Agregar superadministrador
        </Button>
      }
    >
      {admins.isLoading ? (
        <Loading />
      ) : admins.isError ? (
        <div className="p-5">
          <EmptyState title="No se pudieron cargar los superadministradores" description={errorMessage(admins.error)} />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Último acceso</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const self = u.id === me?.user.id;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary-text">
                        <ShieldCheck className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">
                          {u.name} {self && <span className="text-xs font-normal text-muted">(usted)</span>}
                        </p>
                        <p className="text-xs text-muted">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    {!u.active ? <Badge color="#64748b">Deshabilitado</Badge> : u.invitePending ? <Badge color="#d97706">Invitación pendiente</Badge> : <Badge color="#16a34a">Activo</Badge>}
                  </td>
                  <td className="whitespace-nowrap text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca'}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {u.invitePending && <IconButton label="Reenviar invitación" icon={<Send className="size-4" />} onClick={() => void resend(u)} />}
                      <IconButton label="Editar" icon={<Pencil className="size-4" />} onClick={() => setEditing({ user: u })} />
                      {!self && <IconButton label="Quitar" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => void handleDelete(u)} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {editing && (
        <AdminModal
          user={editing.user}
          self={editing.user?.id === me?.user.id}
          onClose={() => setEditing(null)}
          onInvited={(result, user) => setInvited({ result, user })}
        />
      )}
      {invited && <InviteResultModal result={invited.result} name={invited.user.name} email={invited.user.email} onClose={() => setInvited(null)} />}
    </Card>
  );
}

function AdminModal({
  user,
  self,
  onClose,
  onInvited,
}: {
  user: UserDTO | null;
  self: boolean;
  onClose: () => void;
  onInvited: (result: InviteResultDTO, user: UserDTO) => void;
}) {
  const { toast } = useFeedback();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const isNew = !user;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [active, setActive] = useState(user?.active ?? true);
  const [invite, setInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changesCredentials = Boolean(password) || (!isNew && email.trim().toLowerCase() !== user.email);
  const needsCurrent = self && changesCredentials && user?.hasPassword;

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return api.post<{ user: UserDTO; invitation: InviteResultDTO | null }>('/platform/admins', {
          name: name.trim(),
          email: email.trim(),
          ...(invite ? {} : { password }),
        });
      }
      return api.put<{ user: UserDTO; token?: string }>(`/platform/admins/${user.id}`, {
        name: name.trim(),
        email: email.trim(),
        ...(password ? { password } : {}),
        ...(self ? {} : { active }),
        ...(needsCurrent ? { currentPassword } : {}),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'admins'] }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await save.mutateAsync();
      if ('invitation' in res && res.invitation) {
        onInvited(res.invitation, res.user);
      } else {
        toast(isNew ? `Se agregó a «${res.user.name}» como superadministrador.` : 'Cambios guardados.');
      }
      if ('token' in res && res.token) session.token = res.token;
      if (self) await refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Agregar superadministrador' : self ? 'Mi cuenta de superadministrador' : `Editar «${user.name}»`}
      description={isNew ? 'Tendrá acceso total a la plataforma.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="platform-admin-form" loading={save.isPending} icon={isNew ? <UserCog className="size-4" /> : undefined}>
            {isNew ? 'Agregar' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="platform-admin-form" onSubmit={submit} className="space-y-4">
        {error && (
          <p role="alert" className="rounded-ui border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required>
            <Input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Email" required hint={self ? 'Con este correo ingresa a la plataforma.' : undefined}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        {isNew && (
          <Toggle
            checked={invite}
            onChange={setInvite}
            label="Enviar una invitación para que elija su contraseña"
            hint={invite ? 'Si no hay correo configurado, le mostramos el enlace para compartirlo.' : 'Usted define la contraseña y se la comparte.'}
          />
        )}
        {!(isNew && invite) && (
          <Field label={isNew ? 'Contraseña' : 'Nueva contraseña'} required={isNew} hint={isNew ? 'Mínimo 8 caracteres.' : 'Déjela vacía para no cambiarla.'}>
            <Input type="password" required={isNew} minLength={8} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        {needsCurrent && (
          <Field label="Contraseña actual" required hint="Para cambiar su correo o su contraseña confirme la actual.">
            <Input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        {!isNew && !self && <Toggle checked={active} onChange={setActive} label="Habilitado" hint="Deshabilitado no puede ingresar, pero se conserva." />}
      </form>
    </Modal>
  );
}
