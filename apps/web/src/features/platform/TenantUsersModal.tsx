import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, Link2, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AccessLinkDTO, Role, TenantDTO, UserDTO } from '@gc/shared';
import { CopyField } from '../../components/CopyField';
import { Badge, Button, EmptyState, Input, Loading, Modal, Table, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

const ROLE_LABELS: Record<Role, string> = { superadmin: 'Superadministrador', admin: 'Administrador', manager: 'Supervisor', agent: 'Operador' };

/**
 * Usuarios de una organización vistos por el superadministrador: puede definirles una contraseña
 * o generar un enlace de acceso para entregárselo cuando no hay correo configurado.
 */
export function TenantUsersModal({ tenant, onClose, onEnter }: { tenant: TenantDTO; onClose: () => void; onEnter: () => void }) {
  const users = useQuery({ queryKey: ['platform', 'tenant-users', tenant.id], queryFn: () => api.get<UserDTO[]>(`/platform/tenants/${tenant.id}/users`) });
  const [action, setAction] = useState<{ user: UserDTO; kind: 'password' | 'link' } | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Usuarios de «${tenant.name}»`}
      description="Defina una contraseña o genere un enlace de acceso de un solo uso para quien no puede ingresar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button icon={<LogIn className="size-4" />} onClick={onEnter}>
            Entrar a la organización
          </Button>
        </>
      }
    >
      {users.isLoading ? (
        <Loading />
      ) : !users.data?.length ? (
        <EmptyState title="La organización no tiene usuarios" />
      ) : (
        <div className="-mx-5">
          <Table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>
                    {!u.active ? (
                      <Badge color="#64748b">Deshabilitado</Badge>
                    ) : u.invitePending ? (
                      <Badge color="#d97706">Invitación pendiente</Badge>
                    ) : !u.hasPassword ? (
                      <Badge color="#0891b2">Sin contraseña</Badge>
                    ) : (
                      <Badge color="#16a34a">Activo</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Nunca'}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" />} onClick={() => setAction({ user: u, kind: 'password' })}>
                        Contraseña
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Link2 className="size-4" />} disabled={!u.active} onClick={() => setAction({ user: u, kind: 'link' })}>
                        Enlace de acceso
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {action?.kind === 'password' && <SetPasswordModal user={action.user} onClose={() => setAction(null)} onDone={() => void users.refetch()} />}
      {action?.kind === 'link' && <AccessLinkModal user={action.user} onClose={() => setAction(null)} />}
    </Modal>
  );
}

function SetPasswordModal({ user, onClose, onDone }: { user: UserDTO; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => api.put(`/platform/users/${user.id}/password`, { password }) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync();
      toast(`Contraseña definida para ${user.email}. Ya puede ingresar con ella.`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Definir contraseña"
      description={`${user.name} · ${user.email}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="platform-set-password" loading={save.isPending}>
            Guardar contraseña
          </Button>
        </>
      }
    >
      <form id="platform-set-password" onSubmit={submit} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Nueva contraseña</span>
          <Input type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoFocus />
          <span className="block text-xs text-muted">Mínimo 8 caracteres. Se cierran las sesiones abiertas del usuario. Compártala de forma segura.</span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

function AccessLinkModal({ user, onClose }: { user: UserDTO; onClose: () => void }) {
  const link = useQuery({
    queryKey: ['platform', 'access-link', user.id],
    queryFn: () => api.post<AccessLinkDTO>(`/platform/users/${user.id}/access-link`),
    gcTime: 0,
    staleTime: Infinity,
  });
  return (
    <Modal open onClose={onClose} title="Enlace de acceso" description={`${user.name} · ${user.email}`} footer={<Button onClick={onClose}>Listo</Button>}>
      {link.isLoading ? (
        <Loading />
      ) : link.isError || !link.data ? (
        <p className="text-sm text-red-600">{errorMessage(link.error)}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Quien abra este enlace entra como <strong className="text-fg">{user.name}</strong> sin contraseña. Sirve una sola vez y vence el{' '}
            {formatDateTime(link.data.expiresAt)}. Envíelo solo a esa persona.
          </p>
          <CopyField value={link.data.url} />
        </div>
      )}
    </Modal>
  );
}
