import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { BranchDTO, StatsSummaryDTO, TicketChannel } from '@gc/shared';
import { Select, cx } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useBranches } from '../../../lib/queries';

/* ------------------------------------------------------------------ */
/* Sucursal seleccionada (recordada en este navegador)                  */
/* ------------------------------------------------------------------ */

const BRANCH_KEY = 'gc.admin.branch';

function readStoredBranch(): string | null {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
}

function storeBranch(id: string) {
  try {
    window.localStorage.setItem(BRANCH_KEY, id);
  } catch {
    /* sin almacenamiento local */
  }
}

/** Sucursal activa en los paneles de operación. Por defecto, la primera. */
export function useBranchSelection() {
  const query = useBranches();
  const branches = useMemo(() => {
    const all = query.data ?? [];
    const active = all.filter((b) => b.active);
    return active.length > 0 ? active : all;
  }, [query.data]);
  const [selected, setSelected] = useState<string | null>(() => readStoredBranch());
  const branch = branches.find((b) => b.id === selected) ?? branches[0] ?? null;

  return {
    branches,
    branch,
    branchId: branch?.id ?? null,
    isLoading: query.isLoading,
    error: query.error,
    select(id: string) {
      setSelected(id);
      storeBranch(id);
    },
  };
}

export function BranchSelect({
  branches,
  value,
  onChange,
  allLabel,
  className,
}: {
  branches: BranchDTO[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Si se indica, agrega la opción "todas". */
  allLabel?: string;
  className?: string;
}) {
  const { terms } = useAuth();
  return (
    <div className={cx('w-full sm:w-60', className)}>
      <Select aria-label={terms.branch} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {allLabel && <option value="">{allLabel}</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.active ? '' : ' (inactiva)'}
          </option>
        ))}
      </Select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Indicadores                                                         */
/* ------------------------------------------------------------------ */

export interface SummaryParams {
  from?: string;
  to?: string;
  branchId?: string | null;
}

export function summaryQueryString({ from, to, branchId }: SummaryParams): string {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (branchId) qs.set('branchId', branchId);
  return qs.toString();
}

export const SUMMARY_KEY = 'reports-summary';

/** Indicadores de atención (`GET /reports/summary`). Sin fechas = hoy en la zona horaria de la sucursal. */
export function useSummary(params: SummaryParams, options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  const qs = summaryQueryString(params);
  return useQuery({
    queryKey: [SUMMARY_KEY, qs],
    queryFn: ({ signal }) => api.get<StatsSummaryDTO>(`/reports/summary${qs ? `?${qs}` : ''}`, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? false,
  });
}

/* ------------------------------------------------------------------ */
/* Utilidades de presentación                                          */
/* ------------------------------------------------------------------ */

/** Marca de tiempo que se actualiza cada `intervalMs` (cronómetros en vivo). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export const CHANNEL_LABELS: Record<TicketChannel, string> = {
  kiosk: 'Kiosco',
  web: 'Web',
  api: 'API',
  agent: 'Personal',
  mobile: 'Móvil',
};

const integer = new Intl.NumberFormat('es');
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

export const formatNumber = (value: number) => integer.format(value);
export const formatPercent = (fraction: number) => percent.format(Number.isFinite(fraction) ? fraction : 0);

/** Cronómetro compacto: 04:12, o "1 h 05 min" si pasa la hora. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h} h ${String(m).padStart(2, '0')} min`;
  }
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function LiveBadge({ updatedAt, label = 'En vivo' }: { updatedAt?: number; label?: string }) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <span className="text-fg">{label}</span>
      {updatedAt ? (
        <span className="tabular-nums">
          · {new Date(updatedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      ) : null}
    </span>
  );
}

/** Punto de color que identifica a un servicio. */
export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}
