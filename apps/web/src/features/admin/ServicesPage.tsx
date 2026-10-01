import { ClipboardList, FolderTree, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { CURRENCY_DECIMALS, fromMinor, toMinor, type Currency, type DepartmentDTO, type PriorityDTO, type ServiceDTO } from '@gc/shared';
import { IconPicker } from '../../components/IconPicker';
import { ServiceIcon } from '../../components/ServiceIcon';
import {
  Badge,
  Button,
  Card,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  RangeInput,
  Select,
  Tabs,
  Table,
  Textarea,
  Toggle,
  cx,
  useFeedback,
} from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDepartments, usePriorities, useRemove, useSave, useServices } from '../../lib/queries';
import { readableOn } from '../../lib/theme';

type TabId = 'services' | 'departments' | 'priorities';


const toInt = (value: string, fallback: number) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

function StatusBadge({ active, female }: { active: boolean; female?: boolean }) {
  return active ? <Badge color="#16a34a">{female ? 'Activa' : 'Activo'}</Badge> : <Badge color="#dc2626">{female ? 'Inactiva' : 'Inactivo'}</Badge>;
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <IconButton label="Editar" icon={<Pencil className="size-4" />} onClick={onEdit} />
      <IconButton label="Eliminar" icon={<Trash2 className="size-4 text-red-600" />} onClick={onDelete} />
    </div>
  );
}

function FormModal({
  title,
  formId,
  onClose,
  saving,
  isNew,
  children,
}: {
  title: ReactNode;
  formId: string;
  onClose: () => void;
  saving: boolean;
  isNew: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {isNew ? 'Crear' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/**
 * Elimina un registro y, si el servidor responde que tiene historial (409),
 * ofrece desactivarlo en su lugar.
 */
function useDeleteWithFallback(resource: string, invalidate: string[]) {
  const { toast, confirm } = useFeedback();
  const remove = useRemove(resource, invalidate);
  const save = useSave(resource, invalidate);
  return async (item: { id: string; name: string; active: boolean }, message: string) => {
    const ok = await confirm({ title: `¿Eliminar «${item.name}»?`, message, confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync(item.id);
      toast(`Se eliminó «${item.name}».`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && item.active) {
        const deactivate = await confirm({
          title: 'No se puede eliminar',
          message: `${errorMessage(err)} ¿Desea desactivar «${item.name}» ahora?`,
          confirmLabel: 'Desactivar',
        });
        if (!deactivate) return;
        try {
          await save.mutateAsync({ id: item.id, active: false });
          toast(`Se desactivó «${item.name}».`);
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
        return;
      }
      toast(errorMessage(err), 'error');
    }
  };
}

export default function ServicesPage() {
  const { terms } = useAuth();
  const [tab, setTab] = useState<TabId>('services');

  return (
    <div>
      <PageHeader
        title={`${terms.services} y prioridades`}
        description={`Defina qué ${terms.services.toLowerCase()} ofrece, cómo se agrupan en departamentos y qué prioridades se atienden antes.`}
      />
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'services', label: terms.services, icon: <ClipboardList className="size-4" /> },
          { value: 'departments', label: 'Departamentos', icon: <FolderTree className="size-4" /> },
          { value: 'priorities', label: 'Prioridades', icon: <Star className="size-4" /> },
        ]}
      />
      <div className="mt-6">
        {tab === 'services' && <ServicesTab />}
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'priorities' && <PrioritiesTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Servicios                                                           */
/* ------------------------------------------------------------------ */

interface ServiceForm {
  id: string | null;
  name: string;
  description: string;
  prefix: string;
  color: string;
  icon: string;
  departmentId: string;
  estimatedMinutes: string;
  sortOrder: string;
  active: boolean;
  /** Precio en la unidad principal (vacío = sin cobro). */
  price: string;
}

function serviceForm(s: ServiceDTO | null, nextOrder: number): ServiceForm {
  return {
    id: s?.id ?? null,
    name: s?.name ?? '',
    description: s?.description ?? '',
    prefix: s?.prefix ?? '',
    color: s?.color ?? '#2563eb',
    icon: s?.icon ?? 'ticket',
    departmentId: s?.departmentId ?? '',
    estimatedMinutes: String(s?.estimatedMinutes ?? 5),
    sortOrder: String(s?.sortOrder ?? nextOrder),
    active: s?.active ?? true,
    price: '',
  };
}

function ServicesTab() {
  const { terms } = useAuth();
  const services = useServices();
  const departments = useDepartments();
  const [editing, setEditing] = useState<ServiceForm | null>(null);
  const deleteService = useDeleteWithFallback('services', ['services', 'branches']);

  const list = services.data ?? [];
  const deptName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const nextOrder = list.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
  const openCreate = () => setEditing(serviceForm(null, nextOrder));
  const addButton = (
    <Button icon={<Plus className="size-4" />} onClick={openCreate}>
      Agregar {terms.service.toLowerCase()}
    </Button>
  );

  return (
    <>
      {services.isLoading ? (
        <Loading />
      ) : services.isError ? (
        <EmptyState title="No se pudo cargar la información" description={errorMessage(services.error)} action={<Button onClick={() => services.refetch()}>Reintentar</Button>} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={`Aún no hay ${terms.services.toLowerCase()}`}
          description={`Cada ${terms.service.toLowerCase()} tiene su propia fila de ${terms.tickets.toLowerCase()}, con un prefijo (A, B, C…) y un color para identificarlo.`}
          action={addButton}
        />
      ) : (
        <Card
          padded={false}
          title={terms.services}
          description={`Se habilitan automáticamente en todas las ${terms.branches.toLowerCase()}; puede ajustarlo en cada una.`}
          actions={addButton}
        >
          <Table>
            <thead>
              <tr>
                <th>{terms.service}</th>
                <th>Prefijo</th>
                <th>Departamento</th>
                <th className="text-right">Min. estimados</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={cx(!s.active && 'opacity-60')}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-ui"
                        style={{ background: `color-mix(in srgb, ${s.color} 15%, transparent)`, color: s.color }}
                      >
                        <ServiceIcon name={s.icon} className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{s.name}</p>
                        {s.description && <p className="max-w-xs truncate text-xs text-muted">{s.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="font-mono font-semibold">{s.prefix || '—'}</span>
                  </td>
                  <td className={cx(!s.departmentId && 'text-muted')}>{s.departmentId ? (deptName.get(s.departmentId) ?? '—') : 'Sin departamento'}</td>
                  <td className="text-right tabular-nums">{s.estimatedMinutes}</td>
                  <td>
                    <StatusBadge active={s.active} />
                  </td>
                  <td>
                    <RowActions
                      onEdit={() => setEditing(serviceForm(s, nextOrder))}
                      onDelete={() =>
                        deleteService(s, `Se quitará de todas las ${terms.branches.toLowerCase()}, pantallas y kioscos. Esta acción no se puede deshacer.`)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {editing && <ServiceFormModal key={editing.id ?? 'new'} initial={editing} departments={departments.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceFormModal({ initial, departments, onClose }: { initial: ServiceForm; departments: DepartmentDTO[]; onClose: () => void }) {
  const { terms, settings, hasModule } = useAuth();
  const currency = settings.payments.currency;
  const { toast } = useFeedback();
  const save = useSave<ServiceDTO>('services', ['services', 'branches']);
  const services = useServices();
  const current = services.data?.find((x) => x.id === initial.id);
  const [form, setForm] = useState(() => ({ ...initial, price: current?.price ? String(fromMinor(current.price, currency)) : '' }));
  const formId = useId();
  const isNew = !form.id;
  const set = <K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const preview = `${form.prefix}${'1'.padStart(settings.tickets.digits, '0')}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        description: form.description.trim(),
        prefix: form.prefix.trim().toUpperCase(),
        color: form.color,
        icon: form.icon,
        departmentId: form.departmentId || null,
        estimatedMinutes: Math.min(600, Math.max(1, toInt(form.estimatedMinutes, 5))),
        sortOrder: toInt(form.sortOrder, 0),
        active: form.active,
        ...(hasModule('payments') ? { price: parsePrice(form.price, currency) } : {}),
      });
      toast(isNew ? `Se creó «${form.name.trim()}».` : 'Cambios guardados.');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <FormModal title={isNew ? `Agregar ${terms.service.toLowerCase()}` : `Editar «${initial.name}»`} formId={formId} onClose={onClose} saving={save.isPending} isNew={isNew}>
      <form id={formId} onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre" required className="sm:col-span-2">
            <Input required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej.: Caja" autoFocus />
          </Field>
          <Field label="Prefijo" hint="Letras antes del número. Máx. 5.">
            <Input
              value={form.prefix}
              maxLength={5}
              onChange={(e) => set('prefix', e.target.value.toUpperCase().replace(/\s/g, ''))}
              placeholder="Ej.: A"
              className="font-mono uppercase"
            />
          </Field>
          <Field label="Descripción" className="sm:col-span-3" hint="Se muestra en el kiosco debajo del nombre.">
            <Textarea maxLength={500} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput label="Color" value={form.color} onChange={(v) => set('color', v)} />
          <Field label="Departamento">
            <Select value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">Sin departamento</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.active ? '' : ' (inactivo)'}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Vista previa</span>
            <div className="flex h-10 items-center gap-2">
              <span
                className="inline-flex h-10 items-center gap-2 rounded-ui px-3 font-mono text-lg font-bold"
                style={{ background: form.color, color: readableOn(form.color) }}
              >
                <ServiceIcon name={form.icon} className="size-5" />
                {preview}
              </span>
            </div>
          </div>
        </div>

        <div>
          <span id={`${formId}-icon`} className="mb-1.5 block text-sm font-medium">
            Ícono
          </span>
          <IconPicker value={form.icon} onChange={(icon) => set('icon', icon)} labelledBy={`${formId}-icon`} />
        </div>

        {hasModule('payments') && (
          <Field label={`Precio (${currency})`} hint="Vacío o 0 = sin cobro. Con precio, el cliente puede pagar en línea o en el puesto.">
            <Input
              inputMode="decimal"
              className="max-w-52"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="50.000"
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minutos estimados" hint="Promedio por atención; se usa para estimar la espera.">
            <Input type="number" min={1} max={600} required value={form.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} />
          </Field>
          <Field label="Orden" hint="Menor número = aparece primero.">
            <Input type="number" step={1} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
          </Field>
          <div className="flex items-start pt-7">
            <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activo" hint="Visible en kioscos y consola" />
          </div>
        </div>
      </form>
    </FormModal>
  );
}

/* ------------------------------------------------------------------ */
/* Departamentos                                                       */
/* ------------------------------------------------------------------ */

interface DepartmentForm {
  id: string | null;
  name: string;
  description: string;
  sortOrder: string;
  active: boolean;
}

function DepartmentsTab() {
  const { terms } = useAuth();
  const departments = useDepartments();
  const services = useServices();
  const [editing, setEditing] = useState<DepartmentForm | null>(null);
  const deleteDepartment = useDeleteWithFallback('departments', ['departments', 'services']);

  const list = departments.data ?? [];
  const nextOrder = list.reduce((max, d) => Math.max(max, d.sortOrder), 0) + 1;
  const toForm = (d: DepartmentDTO | null): DepartmentForm => ({
    id: d?.id ?? null,
    name: d?.name ?? '',
    description: d?.description ?? '',
    sortOrder: String(d?.sortOrder ?? nextOrder),
    active: d?.active ?? true,
  });
  const countFor = (id: string) => (services.data ?? []).filter((s) => s.departmentId === id).length;
  const addButton = (
    <Button icon={<Plus className="size-4" />} onClick={() => setEditing(toForm(null))}>
      Agregar departamento
    </Button>
  );

  return (
    <>
      {departments.isLoading ? (
        <Loading />
      ) : departments.isError ? (
        <EmptyState title="No se pudo cargar la información" description={errorMessage(departments.error)} action={<Button onClick={() => departments.refetch()}>Reintentar</Button>} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FolderTree />}
          title="Aún no hay departamentos"
          description={`Los departamentos son opcionales: agrupan ${terms.services.toLowerCase()} en el kiosco (por ejemplo, «Laboratorio» o «Atención al cliente»).`}
          action={addButton}
        />
      ) : (
        <Card padded={false} title="Departamentos" description={`Agrupan ${terms.services.toLowerCase()} en el kiosco.`} actions={addButton}>
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th className="text-right">{terms.services}</th>
                <th className="text-right">Orden</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={cx(!d.active && 'opacity-60')}>
                  <td>
                    <p className="font-medium">{d.name}</p>
                    {d.description && <p className="max-w-md truncate text-xs text-muted">{d.description}</p>}
                  </td>
                  <td className="text-right tabular-nums">{countFor(d.id)}</td>
                  <td className="text-right tabular-nums">{d.sortOrder}</td>
                  <td>
                    <StatusBadge active={d.active} />
                  </td>
                  <td>
                    <RowActions
                      onEdit={() => setEditing(toForm(d))}
                      onDelete={() => deleteDepartment(d, `Los ${terms.services.toLowerCase()} de este departamento quedarán sin departamento.`)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {editing && <DepartmentFormModal key={editing.id ?? 'new'} initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DepartmentFormModal({ initial, onClose }: { initial: DepartmentForm; onClose: () => void }) {
  const { toast } = useFeedback();
  const save = useSave<DepartmentDTO>('departments', ['departments']);
  const [form, setForm] = useState(initial);
  const formId = useId();
  const isNew = !form.id;
  const set = <K extends keyof DepartmentForm>(key: K, value: DepartmentForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        description: form.description.trim(),
        sortOrder: toInt(form.sortOrder, 0),
        active: form.active,
      });
      toast(isNew ? `Se creó «${form.name.trim()}».` : 'Cambios guardados.');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <FormModal title={isNew ? 'Agregar departamento' : `Editar «${initial.name}»`} formId={formId} onClose={onClose} saving={save.isPending} isNew={isNew}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field label="Nombre" required>
          <Input required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej.: Atención al cliente" autoFocus />
        </Field>
        <Field label="Descripción">
          <Textarea maxLength={500} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Orden" hint="Menor número = aparece primero.">
            <Input type="number" step={1} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
          </Field>
          <div className="flex items-start pt-7">
            <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activo" />
          </div>
        </div>
      </form>
    </FormModal>
  );
}

/* ------------------------------------------------------------------ */
/* Prioridades                                                         */
/* ------------------------------------------------------------------ */

interface PriorityForm {
  id: string | null;
  name: string;
  description: string;
  weight: number;
  color: string;
  sortOrder: string;
  active: boolean;
}

function PrioritiesTab() {
  const { terms, settings } = useAuth();
  const priorities = usePriorities();
  const [editing, setEditing] = useState<PriorityForm | null>(null);
  const deletePriority = useDeleteWithFallback('priorities', ['priorities']);

  const list = priorities.data ?? [];
  const nextOrder = list.reduce((max, p) => Math.max(max, p.sortOrder), 0) + 1;
  const toForm = (p: PriorityDTO | null): PriorityForm => ({
    id: p?.id ?? null,
    name: p?.name ?? '',
    description: p?.description ?? '',
    weight: p?.weight ?? 50,
    color: p?.color ?? '#f59e0b',
    sortOrder: String(p?.sortOrder ?? nextOrder),
    active: p?.active ?? true,
  });
  const addButton = (
    <Button icon={<Plus className="size-4" />} onClick={() => setEditing(toForm(null))}>
      Agregar prioridad
    </Button>
  );
  const ratio = settings.tickets.priorityRatio;

  return (
    <>
      {priorities.isLoading ? (
        <Loading />
      ) : priorities.isError ? (
        <EmptyState title="No se pudo cargar la información" description={errorMessage(priorities.error)} action={<Button onClick={() => priorities.refetch()}>Reintentar</Button>} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Star />}
          title="Aún no hay prioridades"
          description={`Las prioridades permiten atender antes a ciertos ${terms.tickets.toLowerCase()} (adultos mayores, embarazadas, personas con discapacidad…).`}
          action={addButton}
        />
      ) : (
        <Card
          padded={false}
          title="Prioridades"
          description={
            ratio > 0
              ? `Mayor peso = se atiende antes. Cada ${ratio} ${terms.tickets.toLowerCase()} preferenciales se intercala uno normal.`
              : 'Mayor peso = se atiende antes. 0 = atención normal.'
          }
          actions={addButton}
        >
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Peso</th>
                <th className="text-right">Orden</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                      <div className="min-w-0">
                        <p className="font-medium">{p.name}</p>
                        {p.description && <p className="max-w-md truncate text-xs text-muted">{p.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <div className="h-full rounded-full" style={{ width: `${p.weight}%`, background: p.color }} />
                      </div>
                      <span className="text-sm tabular-nums">{p.weight === 0 ? 'Normal' : p.weight}</span>
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{p.sortOrder}</td>
                  <td>
                    <StatusBadge active={p.active} female />
                  </td>
                  <td>
                    <RowActions onEdit={() => setEditing(toForm(p))} onDelete={() => deletePriority(p, 'Esta acción no se puede deshacer.')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {editing && <PriorityFormModal key={editing.id ?? 'new'} initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PriorityFormModal({ initial, onClose }: { initial: PriorityForm; onClose: () => void }) {
  const { toast } = useFeedback();
  const save = useSave<PriorityDTO>('priorities', ['priorities']);
  const [form, setForm] = useState(initial);
  const formId = useId();
  const isNew = !form.id;
  const set = <K extends keyof PriorityForm>(key: K, value: PriorityForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        description: form.description.trim(),
        weight: form.weight,
        color: form.color,
        sortOrder: toInt(form.sortOrder, 0),
        active: form.active,
      });
      toast(isNew ? `Se creó «${form.name.trim()}».` : 'Cambios guardados.');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <FormModal title={isNew ? 'Agregar prioridad' : `Editar «${initial.name}»`} formId={formId} onClose={onClose} saving={save.isPending} isNew={isNew}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Field label="Nombre" required>
          <Input required maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej.: Preferencial" autoFocus />
        </Field>
        <Field label="Descripción" hint="Se muestra en el kiosco para orientar al público.">
          <Textarea maxLength={300} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ej.: Adultos mayores, embarazadas, personas con discapacidad" />
        </Field>
        <div>
          <RangeInput label="Peso" min={0} max={100} value={form.weight} onChange={(v) => set('weight', v)} format={(v) => (v === 0 ? 'Normal' : String(v))} />
          <p className="mt-1.5 text-xs text-muted">0 = normal; mayor peso = se atiende antes. Ej.: preferencial = 50, urgencia = 100.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorInput label="Color" value={form.color} onChange={(v) => set('color', v)} />
          <Field label="Orden" hint="Menor número = aparece primero.">
            <Input type="number" step={1} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
          </Field>
          <div className="flex items-start pt-7">
            <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activa" />
          </div>
        </div>
      </form>
    </FormModal>
  );
}

/** «50.000» (guaraníes) o «12,50» / «12.50» → unidad mínima de la moneda; vacío o 0 = sin precio. */
function parsePrice(text: string, currency: Currency): number | null {
  const clean = CURRENCY_DECIMALS[currency] === 0 ? text.replace(/\D/g, '') : text.replace(/[^\d.,]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
  const value = Number(clean);
  return clean && Number.isFinite(value) && value > 0 ? toMinor(value, currency) : null;
}
