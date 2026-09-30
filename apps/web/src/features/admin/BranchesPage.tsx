import { AlertTriangle, Building2, Check, Clock, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { BranchDTO, CounterDTO, ServiceDTO } from '@gc/shared';
import { ServiceIcon } from '../../components/ServiceIcon';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useBranches, useCounters, useRemove, useSave, useServices } from '../../lib/queries';

/* ------------------------------------------------------------------ */
/* Zonas horarias                                                      */
/* ------------------------------------------------------------------ */

const COMMON_TIMEZONES = [
  'America/Asuncion',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Santiago',
  'America/La_Paz',
  'America/Lima',
  'America/Bogota',
  'America/Guayaquil',
  'America/Caracas',
  'America/Panama',
  'America/Costa_Rica',
  'America/Guatemala',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
];

function allTimezones(): string[] {
  try {
    const rest = Intl.supportedValuesOf('timeZone').filter((tz) => !COMMON_TIMEZONES.includes(tz));
    return [...COMMON_TIMEZONES, ...rest];
  } catch {
    return COMMON_TIMEZONES;
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Formulario                                                          */
/* ------------------------------------------------------------------ */

interface BranchServiceState {
  enabled: boolean;
  prefix: string;
}

interface BranchForm {
  id: string | null;
  name: string;
  code: string;
  address: string;
  timezone: string;
  active: boolean;
  services: Record<string, BranchServiceState>;
}

function formFromBranch(branch: BranchDTO | null, services: ServiceDTO[]): BranchForm {
  const map: Record<string, BranchServiceState> = {};
  for (const s of services) {
    const link = branch?.services.find((x) => x.serviceId === s.id);
    // En una sucursal nueva se habilitan todos los servicios activos por defecto.
    map[s.id] = { enabled: branch ? Boolean(link?.enabled) : s.active, prefix: link?.prefix ?? '' };
  }
  return {
    id: branch?.id ?? null,
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    address: branch?.address ?? '',
    timezone: branch?.timezone ?? '',
    active: branch?.active ?? true,
    services: map,
  };
}

export default function BranchesPage() {
  const { terms, settings, me } = useAuth();
  const { toast, confirm } = useFeedback();
  const branches = useBranches();
  const services = useServices();
  const save = useSave<BranchDTO>('branches', ['branches']);
  const remove = useRemove('branches', ['branches', 'counters', 'displays', 'kiosks']);
  const [editing, setEditing] = useState<BranchForm | null>(null);

  const serviceList = services.data ?? [];
  const limit = me?.limits?.branches ?? null;
  const count = branches.data?.length ?? 0;
  const atLimit = limit !== null && count >= limit;

  const openCreate = () => setEditing(formFromBranch(null, serviceList));
  const openEdit = (branch: BranchDTO) => setEditing(formFromBranch(branch, serviceList));

  async function handleDelete(branch: BranchDTO) {
    const ok = await confirm({
      title: `¿Eliminar «${branch.name}»?`,
      message: `También se eliminarán sus ${terms.counters.toLowerCase()}, pantallas y kioscos. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(branch.id);
      toast(`Se eliminó «${branch.name}».`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && branch.active) {
        const deactivate = await confirm({
          title: 'No se puede eliminar',
          message: `${errorMessage(err)} ¿Desea desactivar «${branch.name}» ahora?`,
          confirmLabel: 'Desactivar',
        });
        if (!deactivate) return;
        try {
          await save.mutateAsync({ id: branch.id, active: false });
          toast(`Se desactivó «${branch.name}».`);
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
        return;
      }
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title={terms.branches}
        description={
          <>
            Administre los lugares donde atiende, sus {terms.counters.toLowerCase()} y qué {terms.services.toLowerCase()} ofrece cada uno.
            {limit !== null && me?.limits && (
              <span className="mt-1 block">
                Plan {me.limits.name}: {count} de {limit} en uso.
              </span>
            )}
          </>
        }
        actions={
          <Button icon={<Plus className="size-4" />} onClick={openCreate} disabled={services.isLoading}>
            Agregar {terms.branch.toLowerCase()}
          </Button>
        }
      />

      {atLimit && (
        <div className="mb-6 flex items-start gap-3 rounded-ui border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            Alcanzó el límite de {limit} {terms.branches.toLowerCase()} de su plan {me?.limits?.name}. Para agregar más, actualice su plan o
            desactive y elimine las que ya no use.
          </p>
        </div>
      )}

      {branches.isLoading ? (
        <Loading />
      ) : branches.isError ? (
        <EmptyState title="No se pudo cargar la información" description={errorMessage(branches.error)} action={<Button onClick={() => branches.refetch()}>Reintentar</Button>} />
      ) : count === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={`Aún no hay ${terms.branches.toLowerCase()}`}
          description={`Registre el lugar donde atiende al público para empezar a emitir ${terms.tickets.toLowerCase()}.`}
          action={
            <Button icon={<Plus className="size-4" />} onClick={openCreate}>
              Agregar {terms.branch.toLowerCase()}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {branches.data!.map((branch) => {
            const enabled = branch.services.filter((s) => s.enabled && serviceList.some((x) => x.id === s.serviceId)).length;
            return (
              <Card
                key={branch.id}
                className={cx(!branch.active && 'opacity-75')}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {branch.name}
                    <Badge className="font-mono">{branch.code}</Badge>
                    {branch.active ? <Badge color="#16a34a">Activa</Badge> : <Badge color="#dc2626">Inactiva</Badge>}
                  </span>
                }
                actions={
                  <>
                    <IconButton label="Editar" icon={<Pencil className="size-4" />} onClick={() => openEdit(branch)} disabled={services.isLoading} />
                    <IconButton label="Eliminar" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => handleDelete(branch)} />
                  </>
                }
              >
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <p className="flex min-w-0 items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span className="sr-only">Dirección:</span>
                    <span className={cx('min-w-0 break-words', !branch.address && 'text-muted')}>{branch.address || 'Sin dirección'}</span>
                  </p>
                  <p className="flex min-w-0 items-start gap-2">
                    <Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span className="sr-only">Zona horaria:</span>
                    <span className="min-w-0 break-words">
                      {branch.timezone ?? (
                        <>
                          {settings.timezone} <span className="text-muted">(de la organización)</span>
                        </>
                      )}
                    </span>
                  </p>
                </div>
                <p className="mt-3 text-sm text-muted">
                  {enabled} de {serviceList.length} {terms.services.toLowerCase()} habilitados
                </p>
                <div className="mt-5 border-t border-border pt-4">
                  <CountersPanel branch={branch} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <BranchFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          services={serviceList}
          servicesLoading={services.isLoading}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal de sucursal                                                   */
/* ------------------------------------------------------------------ */

function BranchFormModal({
  initial,
  services,
  servicesLoading,
  onClose,
}: {
  initial: BranchForm;
  services: ServiceDTO[];
  servicesLoading: boolean;
  onClose: () => void;
}) {
  const { terms, settings } = useAuth();
  const { toast } = useFeedback();
  const save = useSave<BranchDTO>('branches', ['branches']);
  const [form, setForm] = useState<BranchForm>(initial);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [tzError, setTzError] = useState<string | null>(null);
  const formId = useId();
  const tzListId = useId();
  const timezones = useMemo(allTimezones, []);

  const isNew = !form.id;
  const set = <K extends keyof BranchForm>(key: K, value: BranchForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setService = (id: string, patch: Partial<BranchServiceState>) =>
    setForm((f) => ({
      ...f,
      services: { ...f.services, [id]: { ...(f.services[id] ?? { enabled: false, prefix: '' }), ...patch } },
    }));
  const setAll = (enabled: boolean) =>
    setForm((f) => ({
      ...f,
      services: Object.fromEntries(services.map((s) => [s.id, { ...(f.services[s.id] ?? { prefix: '' }), enabled }])),
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLimitError(null);
    const timezone = form.timezone.trim();
    if (timezone && !isValidTimezone(timezone)) {
      setTzError('Zona horaria inválida. Elija una de la lista (por ejemplo, America/Asuncion).');
      return;
    }
    setTzError(null);
    try {
      await save.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        code: form.code.trim(),
        address: form.address.trim(),
        timezone: timezone || null,
        active: form.active,
        ...(servicesLoading
          ? {}
          : {
              services: services.map((s) => ({
                serviceId: s.id,
                enabled: form.services[s.id]?.enabled ?? false,
                prefix: form.services[s.id]?.prefix.trim().toUpperCase() || null,
              })),
            }),
      });
      toast(isNew ? `Se creó «${form.name.trim()}».` : 'Cambios guardados.');
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
      title={isNew ? `Agregar ${terms.branch.toLowerCase()}` : `Editar «${initial.name}»`}
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
      <form id={formId} onSubmit={submit} className="space-y-6">
        {limitError && (
          <div role="alert" className="flex items-start gap-3 rounded-ui border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Límite del plan alcanzado</p>
              <p className="mt-0.5">{limitError}</p>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre" required className="sm:col-span-2">
            <Input required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej.: Casa central" autoFocus />
          </Field>
          <Field label="Código" required hint="Identificador corto y único">
            <Input required maxLength={20} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="Ej.: CENTRO" className="font-mono" />
          </Field>
          <Field label="Dirección" className="sm:col-span-3">
            <Input maxLength={300} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Calle, número, ciudad" />
          </Field>
          <Field
            label="Zona horaria"
            className="sm:col-span-2"
            error={tzError}
            hint={`Déjela vacía para usar la de la organización (${settings.timezone}).`}
          >
            <Input
              list={tzListId}
              value={form.timezone}
              onChange={(e) => {
                set('timezone', e.target.value);
                setTzError(null);
              }}
              placeholder={settings.timezone}
              autoComplete="off"
            />
            <datalist id={tzListId}>
              {timezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </Field>
          <div className="flex items-end pb-2">
            <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activa" hint={`Si se desactiva, no se emiten ${terms.tickets.toLowerCase()}`} />
          </div>
        </div>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{terms.services} disponibles</h3>
              <p className="text-xs text-muted">
                Elija qué {terms.services.toLowerCase()} se ofrecen aquí. Opcionalmente, defina un prefijo distinto para esta {terms.branch.toLowerCase()}.
              </p>
            </div>
            {services.length > 0 && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                  Habilitar todos
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
                  Ninguno
                </Button>
              </div>
            )}
          </div>
          {servicesLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : services.length === 0 ? (
            <p className="rounded-ui border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              Aún no hay {terms.services.toLowerCase()}.{' '}
              <Link to="/app/configuracion/servicios" className="font-medium text-primary hover:underline">
                Créelos aquí
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-ui border border-border">
              {services.map((service) => {
                const state = form.services[service.id] ?? { enabled: false, prefix: '' };
                return (
                  <li key={service.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-ui"
                      style={{ background: `color-mix(in srgb, ${service.color} 15%, transparent)`, color: service.color }}
                    >
                      <ServiceIcon name={service.icon} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {service.name}
                        {!service.active && <Badge className="ml-2">Inactivo</Badge>}
                      </p>
                      <p className="text-xs text-muted">Prefijo general: {service.prefix || '—'}</p>
                    </div>
                    <Input
                      aria-label={`Prefijo en esta ${terms.branch.toLowerCase()} para ${service.name}`}
                      title="Prefijo propio (opcional)"
                      value={state.prefix}
                      onChange={(e) => setService(service.id, { prefix: e.target.value.toUpperCase().replace(/\s/g, '') })}
                      placeholder={service.prefix || 'Prefijo'}
                      maxLength={5}
                      disabled={!state.enabled}
                      className="h-9 w-24 font-mono uppercase"
                    />
                    <Toggle
                      checked={state.enabled}
                      onChange={(v) => setService(service.id, { enabled: v })}
                      label={<span className="text-xs font-normal text-muted">Habilitado</span>}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Puestos de atención                                                 */
/* ------------------------------------------------------------------ */

function CountersPanel({ branch }: { branch: BranchDTO }) {
  const { terms } = useAuth();
  const { toast, confirm } = useFeedback();
  const counters = useCounters(branch.id);
  const save = useSave<CounterDTO>('counters', ['counters']);
  const remove = useRemove('counters', ['counters']);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = counters.data ?? [];

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    try {
      const sortOrder = list.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
      await save.mutateAsync({ branchId: branch.id, name: value, sortOrder });
      setName('');
      toast(`Se agregó «${value}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function update(counter: CounterDTO, patch: { name?: string; active?: boolean }) {
    setBusyId(counter.id);
    try {
      await save.mutateAsync({ id: counter.id, ...patch });
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const counter = list.find((c) => c.id === renaming.id);
    const value = renaming.name.trim();
    if (!counter || !value || value === counter.name) {
      setRenaming(null);
      return;
    }
    if (await update(counter, { name: value })) {
      setRenaming(null);
      toast('Nombre actualizado.');
    }
  }

  async function handleDelete(counter: CounterDTO) {
    const ok = await confirm({
      title: `¿Eliminar «${counter.name}»?`,
      message: `Los ${terms.tickets.toLowerCase()} ya atendidos conservarán su historial, pero sin referencia a este puesto.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    setBusyId(counter.id);
    try {
      await remove.mutateAsync(counter.id);
      toast(`Se eliminó «${counter.name}».`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {terms.counters} <span className="font-normal text-muted">({list.length})</span>
        </h3>
      </div>

      {counters.isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-ui border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
          Aún no hay {terms.counters.toLowerCase()}. Escriba un nombre abajo para agregar.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-ui border border-border">
          {list.map((counter) => (
            <li key={counter.id} className={cx('flex items-center gap-2 px-3 py-2', !counter.active && 'bg-subtle')}>
              {renaming?.id === counter.id ? (
                <form onSubmit={rename} className="flex min-w-0 flex-1 items-center gap-1">
                  <Input
                    aria-label="Nuevo nombre"
                    value={renaming.name}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setRenaming({ id: counter.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    className="h-8"
                  />
                  <IconButton type="submit" label="Guardar nombre" icon={<Check className="size-4 text-emerald-600" />} loading={busyId === counter.id} />
                  <IconButton label="Cancelar" icon={<X className="size-4" />} onClick={() => setRenaming(null)} />
                </form>
              ) : (
                <>
                  <span className={cx('min-w-0 flex-1 truncate text-sm font-medium', !counter.active && 'text-muted')}>{counter.name}</span>
                  {!counter.active && <Badge>Inactivo</Badge>}
                  <Toggle
                    checked={counter.active}
                    disabled={busyId === counter.id}
                    onChange={async (v) => {
                      if (await update(counter, { active: v })) toast(v ? `Se activó «${counter.name}».` : `Se desactivó «${counter.name}».`);
                    }}
                    label={<span className="sr-only">{counter.active ? `Desactivar ${counter.name}` : `Activar ${counter.name}`}</span>}
                  />
                  <IconButton label="Renombrar" icon={<Pencil className="size-4" />} onClick={() => setRenaming({ id: counter.id, name: counter.name })} />
                  <IconButton
                    label="Eliminar"
                    icon={<Trash2 className="size-4 text-red-600" />}
                    disabled={busyId === counter.id}
                    onClick={() => handleDelete(counter)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input
          aria-label={`Nombre del nuevo puesto (${terms.counter.toLowerCase()})`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Ej.: ${terms.counter} ${list.length + 1}`}
          className="h-9"
        />
        <Button type="submit" size="sm" variant="secondary" className="h-9" icon={<Plus className="size-4" />} disabled={!name.trim()} loading={save.isPending && !busyId}>
          Agregar
        </Button>
      </form>
    </div>
  );
}
