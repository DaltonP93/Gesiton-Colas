import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, History, LifeBuoy, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { AUDIT_ENTITIES, type AuditEntity, type AuditLogDTO, type AuditPageDTO, type TenantDTO } from '@gc/shared';
import { api, download, errorMessage } from '../lib/api';
import { formatDateTime, shiftDays, todayISO } from '../lib/format';
import { Badge, Button, EmptyState, Field, Input, Loading, Select, Table, cx, useFeedback } from './ui';

const ROLE_LABELS: Record<string, string> = { superadmin: 'Superadministrador', admin: 'Administrador', manager: 'Supervisor', agent: 'Operador', api: 'Integración' };
const PAGE = 50;

/** Registro de actividad: quién cambió qué. `scope` = la organización actual o toda la plataforma. */
export function AuditLog({ scope }: { scope: 'tenant' | 'platform' }) {
  const { toast } = useFeedback();
  const today = todayISO();
  const [from, setFrom] = useState(shiftDays(today, -29));
  const [to, setTo] = useState(today);
  const [entity, setEntity] = useState<AuditEntity | ''>('');
  const [tenantId, setTenantId] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const base = scope === 'platform' ? '/platform/audit' : '/audit';
  const params = new URLSearchParams(Object.entries({ from, to, entity, q: search, ...(scope === 'platform' ? { tenantId } : {}) }).filter(([, v]) => v) as [string, string][]);
  const list = useQuery({
    queryKey: ['audit', scope, params.toString(), offset],
    queryFn: () => api.get<AuditPageDTO>(`${base}?${params}&limit=${PAGE}&offset=${offset}`),
    placeholderData: keepPreviousData,
  });
  const tenants = useQuery({ queryKey: ['platform', 'tenants', ''], queryFn: () => api.get<TenantDTO[]>('/platform/tenants'), enabled: scope === 'platform' });
  const reset = () => setOffset(0);

  const exportCsv = async () => {
    try {
      await download(`${base}.csv?${params}`, `actividad_${from}_${to}.csv`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const data = list.data;
  return (
    <div className="space-y-4">
      <div className="gc-card gc-pad flex flex-wrap items-end gap-3">
        <Field label="Desde" className="w-40">
          <Input type="date" value={from} max={to} onChange={(e) => (setFrom(e.target.value), reset())} />
        </Field>
        <Field label="Hasta" className="w-40">
          <Input type="date" value={to} min={from} max={today} onChange={(e) => (setTo(e.target.value), reset())} />
        </Field>
        <Field label="Tipo" className="w-52">
          <Select value={entity} onChange={(e) => (setEntity(e.target.value as AuditEntity | ''), reset())}>
            <option value="">Todos</option>
            {(Object.keys(AUDIT_ENTITIES) as AuditEntity[]).map((k) => (
              <option key={k} value={k}>
                {AUDIT_ENTITIES[k]}
              </option>
            ))}
          </Select>
        </Field>
        {scope === 'platform' && (
          <Field label="Organización" className="w-56">
            <Select value={tenantId} onChange={(e) => (setTenantId(e.target.value), reset())}>
              <option value="">Todas</option>
              <option value="platform">Solo la plataforma</option>
              {tenants.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <form
          className="flex min-w-60 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            reset();
          }}
        >
          <Field label="Buscar" className="flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Persona, email o acción" />
          </Field>
          <Button type="submit" variant="secondary" icon={<Search className="size-4" />} aria-label="Buscar" />
        </form>
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportCsv()}>
          CSV
        </Button>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.isError || !data ? (
        <p className="text-sm text-red-600">{errorMessage(list.error)}</p>
      ) : !data.items.length ? (
        <EmptyState icon={<History />} title="Sin actividad en este período" description="Aquí aparece cada cambio: quién lo hizo, cuándo, desde qué dirección y qué datos envió." />
      ) : (
        <>
          <div className="gc-card overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Fecha</th>
                  <th>Quién</th>
                  <th className="w-full">Qué hizo</th>
                  {scope === 'platform' && <th>Organización</th>}
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((log) => (
                  <Fragment key={log.id}>
                    <tr className={cx(log.changes && 'cursor-pointer')} onClick={() => log.changes && setOpen(open === log.id ? null : log.id)}>
                      <td className="text-muted">{log.changes ? open === log.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" /> : null}</td>
                      <td className="whitespace-nowrap text-muted tabular-nums">{formatDateTime(log.createdAt)}</td>
                      <td className="whitespace-nowrap">
                        <span className="font-medium">{log.actor.name}</span>
                        <span className="block text-xs text-muted">
                          {log.actor.role ? (ROLE_LABELS[log.actor.role] ?? log.actor.role) : log.actor.kind === 'system' ? 'Automático' : ''}
                          {log.actor.email ? ` · ${log.actor.email}` : ''}
                        </span>
                      </td>
                      <td className="min-w-72">
                        <span className="flex flex-wrap items-center gap-2">
                          {log.summary}
                          <Badge>{AUDIT_ENTITIES[log.entity] ?? log.entity}</Badge>
                          {log.support && (
                            <Badge color="#7c3aed">
                              <LifeBuoy className="size-3" /> Soporte
                            </Badge>
                          )}
                        </span>
                      </td>
                      {scope === 'platform' && <td className="whitespace-nowrap">{log.tenantName ?? <span className="text-muted">Plataforma</span>}</td>}
                      <td className="font-mono text-xs whitespace-nowrap text-muted">{log.ip ?? ''}</td>
                    </tr>
                    {open === log.id && log.changes && (
                      <tr>
                        <td />
                        <td colSpan={scope === 'platform' ? 5 : 4}>
                          <Changes value={log.changes} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              {offset + 1}–{offset + data.items.length} de {data.total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Datos enviados en el cambio, legibles (las claves y contraseñas ya vienen ocultas). */
function Changes({ value }: { value: AuditLogDTO['changes'] }) {
  return (
    <pre className="gc-scroll max-h-72 overflow-auto rounded-ui bg-subtle p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
  );
}
