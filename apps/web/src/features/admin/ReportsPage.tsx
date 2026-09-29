import { ArrowDownRight, ArrowUpRight, Ban, CalendarDays, CircleCheck, Clock, Download, Percent, Ticket, Timer, UserX } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { StatsSummaryDTO } from '@gc/shared';
import { Button, Card, EmptyState, Field, Input, Loading, PageHeader, Spinner, Stat, Table, cx, useFeedback } from '../../components/ui';
import { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDuration, shiftDays, todayISO } from '../../lib/format';
import { useBranches } from '../../lib/queries';
import { DailyChart, HourlyChart, SERIES, SeriesLegend, ServiceShareChart } from './reports/charts';
import { BranchSelect, ColorDot, formatNumber, formatPercent, summaryQueryString, useSummary } from './reports/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Preset {
  key: string;
  label: string;
  range: (today: string) => { from: string; to: string };
}

const PRESETS: Preset[] = [
  { key: 'today', label: 'Hoy', range: (t) => ({ from: t, to: t }) },
  { key: 'yesterday', label: 'Ayer', range: (t) => ({ from: shiftDays(t, -1), to: shiftDays(t, -1) }) },
  { key: '7d', label: 'Últimos 7 días', range: (t) => ({ from: shiftDays(t, -6), to: t }) },
  { key: 'month', label: 'Este mes', range: (t) => ({ from: `${t.slice(0, 8)}01`, to: t }) },
  { key: '30d', label: 'Últimos 30 días', range: (t) => ({ from: shiftDays(t, -29), to: t }) },
];

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1;
}

/** Completa con ceros los días sin turnos para que el gráfico diario no salte fechas. */
function fillDays(summary: StatsSummaryDTO): StatsSummaryDTO['byDay'] {
  const from = summary.from.slice(0, 10);
  const to = summary.to.slice(0, 10);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || daysBetween(from, to) > 400) return summary.byDay;
  const byDay = new Map(summary.byDay.map((d) => [d.day, d]));
  const out: StatsSummaryDTO['byDay'] = [];
  for (let d = from; d <= to; d = shiftDays(d, 1)) out.push(byDay.get(d) ?? { day: d, issued: 0, finished: 0 });
  return out;
}

const dateLabel = (iso: string, withYear = true) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });

function rangeLabel(from: string, to: string) {
  if (from === to) return dateLabel(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `Del ${dateLabel(from, !sameYear)} al ${dateLabel(to)}`;
}

export default function ReportsPage() {
  const { terms } = useAuth();
  const { toast } = useFeedback();
  const branchesQuery = useBranches();
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);

  const today = todayISO();
  const defaults = PRESETS[2]!.range(today);
  const from = ISO_DATE.test(params.get('from') ?? '') ? params.get('from')! : defaults.from;
  const to = ISO_DATE.test(params.get('to') ?? '') ? params.get('to')! : defaults.to;
  const branchId = params.get('branchId') || null;
  const invalidRange = from > to;
  const activePreset = PRESETS.find((p) => {
    const r = p.range(today);
    return r.from === from && r.to === to;
  })?.key;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const summary = useSummary({ from, to, branchId }, { enabled: !invalidRange });

  // Período anterior de igual duración, para comparar.
  const length = invalidRange ? 1 : daysBetween(from, to);
  const previous = useSummary({ from: shiftDays(from, -length), to: shiftDays(from, -1), branchId }, { enabled: !invalidRange });

  const branches = branchesQuery.data ?? [];
  const branchName = branches.find((b) => b.id === branchId)?.name;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await download(`/reports/tickets.csv?${summaryQueryString({ from, to, branchId })}`, `turnos_${from}_${to}.csv`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  };

  const data = summary.data;
  const days = useMemo(() => (data ? fillDays(data) : []), [data]);
  const multiDay = days.length > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description={`Indicadores de atención, tiempos de espera y productividad por ${terms.service.toLowerCase()} y ${terms.agent.toLowerCase()}.`}
        actions={
          <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting} disabled={invalidRange} onClick={() => void exportCsv()}>
            Exportar CSV
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="min-w-0 flex-1">
            <span className="mb-1.5 block text-sm font-medium">Período</span>
            <div role="group" aria-label="Períodos rápidos" className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={activePreset === p.key}
                  onClick={() => update(p.range(today))}
                  className={cx(
                    'h-10 rounded-ui border px-3 text-sm font-medium transition',
                    activePreset === p.key ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <Field label="Desde" className="sm:w-40">
              <Input type="date" value={from} max={to < today ? to : today} onChange={(e) => e.target.value && update({ from: e.target.value })} />
            </Field>
            <Field label="Hasta" className="sm:w-40">
              <Input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && update({ to: e.target.value })} />
            </Field>
            {branches.length > 1 && (
              <Field label={terms.branch} className="col-span-2 sm:col-span-1">
                <BranchSelect
                  branches={branches}
                  value={branchId}
                  onChange={(id) => update({ branchId: id })}
                  allLabel={`Todas las ${terms.branches.toLowerCase()}`}
                />
              </Field>
            )}
          </div>
        </div>
        {invalidRange && <p className="mt-3 text-sm text-red-600">La fecha «Desde» debe ser anterior o igual a «Hasta».</p>}
      </Card>

      {!invalidRange && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CalendarDays className="size-4" />
          <span>
            {rangeLabel(from, to)} · {branchName ?? (branches.length > 1 ? `Todas las ${terms.branches.toLowerCase()}` : branches[0]?.name ?? '')}
          </span>
          {summary.isFetching && <Spinner className="size-4" />}
        </p>
      )}

      {invalidRange ? null : summary.isLoading ? (
        <Loading label="Calculando indicadores…" />
      ) : summary.isError || !data ? (
        <EmptyState
          title="No se pudieron cargar los reportes"
          description={errorMessage(summary.error)}
          action={
            <Button variant="secondary" onClick={() => void summary.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <div className={cx('space-y-6 transition', summary.isPlaceholderData && 'opacity-60')}>
          <Kpis data={data} previous={previous.isPlaceholderData ? undefined : previous.data} />

          {data.totals.issued === 0 && data.byAgent.length === 0 ? (
            <EmptyState
              icon={<Ticket />}
              title={`No hay ${terms.tickets.toLowerCase()} en el período seleccionado`}
              description="Pruebe con otro rango de fechas o con otra sucursal."
            />
          ) : (
            <>
              <div className={cx('grid gap-6', multiDay && 'lg:grid-cols-2')}>
                {multiDay && (
                  <Card title={`${terms.tickets} por día`} actions={<SeriesLegend items={[SERIES.issued, SERIES.finished]} />}>
                    <DailyChart data={days} />
                  </Card>
                )}
                <Card
                  title={`${terms.tickets} por hora`}
                  description={multiDay ? 'Suma de todos los días del período' : undefined}
                  actions={<SeriesLegend items={[SERIES.issued, SERIES.finished]} />}
                >
                  <HourlyChart data={data.byHour} />
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-5">
                <Card title={`Distribución por ${terms.service.toLowerCase()}`} description="Participación en los emitidos" className="min-w-0 lg:col-span-2">
                  {data.byService.some((s) => s.issued > 0) ? (
                    <ServiceShareChart data={data.byService} />
                  ) : (
                    <p className="py-8 text-center text-sm text-muted">Sin datos.</p>
                  )}
                </Card>
                <Card title={`Por ${terms.service.toLowerCase()}`} padded={false} className="min-w-0 lg:col-span-3">
                  <ServiceTable data={data} />
                </Card>
              </div>

              <Card title={`Por ${terms.agent.toLowerCase()}`} description="Atenciones finalizadas en el período" padded={false}>
                <AgentTable data={data} />
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Indicadores                                                         */
/* ------------------------------------------------------------------ */

function Delta({
  current,
  previous,
  goodWhen,
  points,
}: {
  current: number | null;
  previous: number | null | undefined;
  goodWhen: 'up' | 'down';
  /** Compara en puntos porcentuales (para tasas) en lugar de variación relativa. */
  points?: boolean;
}) {
  if (current === null || previous === null || previous === undefined) return <span>&nbsp;</span>;
  if (!points && previous === 0) {
    return <span className="text-muted">{current === 0 ? 'Igual que el período anterior' : 'Sin registros en el período anterior'}</span>;
  }
  const change = points ? current - previous : (current - previous) / previous;
  if (Math.abs(change) < 0.005) return <span className="text-muted">Igual que el período anterior</span>;
  const up = change > 0;
  const good = up === (goodWhen === 'up');
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className={cx('inline-flex items-center gap-0.5 font-semibold', good ? 'text-emerald-600' : 'text-red-600')}>
        <Icon className="size-3.5" aria-hidden />
        {up ? '+' : '−'}
        {points ? `${Math.round(Math.abs(change) * 100)} pts` : formatPercent(Math.abs(change))}
      </span>
      <span className="text-muted">vs. período anterior</span>
    </span>
  );
}

function Kpis({ data, previous }: { data: StatsSummaryDTO; previous?: StatsSummaryDTO }) {
  const t = data.totals;
  const p = previous?.totals;
  const rate = t.issued > 0 ? t.finished / t.issued : null;
  const prevRate = p ? (p.issued > 0 ? p.finished / p.issued : null) : undefined;
  const tiles: { label: string; value: ReactNode; icon: ReactNode; tone?: string; hint?: ReactNode }[][] = [
    [
      { label: 'Emitidos', value: formatNumber(t.issued), icon: <Ticket />, hint: <Delta current={t.issued} previous={p?.issued} goodWhen="up" /> },
      { label: 'Atendidos', value: formatNumber(t.finished), icon: <CircleCheck />, tone: '#16a34a', hint: <Delta current={t.finished} previous={p?.finished} goodWhen="up" /> },
      { label: 'No se presentaron', value: formatNumber(t.noShow), icon: <UserX />, tone: '#dc2626', hint: <Delta current={t.noShow} previous={p?.noShow} goodWhen="down" /> },
      { label: 'Cancelados', value: formatNumber(t.cancelled), icon: <Ban />, tone: '#64748b', hint: <Delta current={t.cancelled} previous={p?.cancelled} goodWhen="down" /> },
    ],
    [
      {
        label: 'Espera promedio',
        value: formatDuration(t.avgWaitSeconds),
        icon: <Clock />,
        tone: '#d97706',
        hint: <Delta current={t.avgWaitSeconds} previous={p?.avgWaitSeconds} goodWhen="down" />,
      },
      {
        label: 'Atención promedio',
        value: formatDuration(t.avgServiceSeconds),
        icon: <Timer />,
        tone: '#7c3aed',
        hint: <Delta current={t.avgServiceSeconds} previous={p?.avgServiceSeconds} goodWhen="down" />,
      },
      {
        label: 'Tasa de atención',
        value: rate === null ? '—' : formatPercent(rate),
        icon: <Percent />,
        hint: rate === null ? 'Atendidos sobre emitidos' : <Delta current={rate} previous={prevRate} goodWhen="up" points />,
      },
    ],
  ];
  return (
    <div className="space-y-3 sm:space-y-4">
      {tiles.map((row, i) => (
        <div key={i} className={cx('grid grid-cols-2 gap-3 sm:gap-4', i === 0 ? 'lg:grid-cols-4' : 'sm:grid-cols-3')}>
          {row.map((tile) => (
            <Stat key={tile.label} {...tile} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tablas                                                              */
/* ------------------------------------------------------------------ */

function ShareBar({ value, color = 'var(--gc-primary)' }: { value: number; color?: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-subtle sm:block" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
      </div>
      <span className="w-10 text-right tabular-nums">{formatPercent(value)}</span>
    </div>
  );
}

function ServiceTable({ data }: { data: StatsSummaryDTO }) {
  const { terms } = useAuth();
  const total = data.byService.reduce((sum, s) => sum + s.issued, 0);
  if (data.byService.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">Sin datos.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th>{terms.service}</th>
          <th className="text-right">Emitidos</th>
          <th className="text-right">Atendidos</th>
          <th className="text-right">Participación</th>
          <th className="text-right">Espera prom.</th>
          <th className="text-right">Atención prom.</th>
        </tr>
      </thead>
      <tbody>
        {data.byService.map((s) => (
          <tr key={s.serviceId}>
            <td>
              <span className="flex items-center gap-2 font-medium">
                <ColorDot color={s.color} />
                {s.name}
              </span>
            </td>
            <td className="text-right tabular-nums">{formatNumber(s.issued)}</td>
            <td className="text-right tabular-nums">{formatNumber(s.finished)}</td>
            <td className="text-right">
              <ShareBar value={total ? s.issued / total : 0} color={s.color} />
            </td>
            <td className="text-right whitespace-nowrap tabular-nums text-muted">{formatDuration(s.avgWaitSeconds)}</td>
            <td className="text-right whitespace-nowrap tabular-nums text-muted">{formatDuration(s.avgServiceSeconds)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AgentTable({ data }: { data: StatsSummaryDTO }) {
  const { terms } = useAuth();
  const total = data.byAgent.reduce((sum, a) => sum + a.finished, 0);
  if (data.byAgent.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted">Ningún {terms.agent.toLowerCase()} finalizó atenciones en este período.</p>;
  }
  return (
    <Table>
      <thead>
        <tr>
          <th>{terms.agent}</th>
          <th className="text-right">Atendidos</th>
          <th className="text-right">Participación</th>
          <th className="text-right">Atención prom.</th>
        </tr>
      </thead>
      <tbody>
        {data.byAgent.map((a, i) => (
          <tr key={a.agentId}>
            <td>
              <span className="flex items-center gap-3 font-medium">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                {a.name}
              </span>
            </td>
            <td className="text-right tabular-nums">{formatNumber(a.finished)}</td>
            <td className="text-right">
              <ShareBar value={total ? a.finished / total : 0} />
            </td>
            <td className="text-right whitespace-nowrap tabular-nums text-muted">{formatDuration(a.avgServiceSeconds)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
