import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { StatsSummaryDTO } from '@gc/shared';
import { formatNumber, formatPercent } from './shared';

/*
 * Gráficos de atención. Los colores salen del branding de la organización
 * (--gc-primary / --gc-accent) o del color de cada servicio, así respetan el tema claro/oscuro.
 */

export const SERIES = {
  issued: { label: 'Emitidos', color: 'var(--gc-primary)' },
  finished: { label: 'Atendidos', color: 'var(--gc-accent)' },
} as const;

const TICK = { fill: 'var(--gc-muted)', fontSize: 12 };
const GRID = 'var(--gc-border)';

export function SeriesLegend({ items }: { items: { label: ReactNode; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item, i) => (
        <li key={i} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipExtras = {
  formatLabel?: (label: string | number | undefined) => ReactNode;
  formatValue?: (value: number) => ReactNode;
};

export function ChartTooltip({ active, payload, label, formatLabel, formatValue = formatNumber }: TooltipContentProps & TooltipExtras) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-36 rounded-ui border border-border bg-surface px-3 py-2 text-xs text-fg shadow-lg">
      <p className="mb-1.5 font-semibold">{formatLabel ? formatLabel(label) : label}</p>
      <ul className="space-y-1">
        {payload.map((entry, i) => {
          const fill = (entry.payload as { color?: string } | undefined)?.color ?? entry.color ?? entry.fill;
          return (
            <li key={`${String(entry.dataKey)}-${i}`} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: fill }} />
              <span className="text-muted">{entry.name}</span>
              <span className="ml-auto pl-4 font-semibold tabular-nums">{formatValue(Number(entry.value ?? 0))}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** Turnos por hora del día (emitidos vs. atendidos). Muestra 6–22 h y cualquier hora con datos. */
export function HourlyChart({ data, height = 260 }: { data: StatsSummaryDTO['byHour']; height?: number }) {
  const rows = data
    .filter((h) => (h.hour >= 6 && h.hour <= 22) || h.issued > 0 || h.finished > 0)
    .map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}h` }));
  return (
    <div style={{ height }} role="img" aria-label="Gráfico de barras: turnos emitidos y atendidos por hora">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barGap={2} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={TICK} minTickGap={6} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} width={44} />
          <Tooltip
            cursor={{ fill: 'var(--gc-subtle)' }}
            content={(props) => (
              <ChartTooltip
                {...props}
                formatLabel={() => {
                  const row = props.payload?.[0]?.payload as { hour?: number } | undefined;
                  return row?.hour !== undefined ? `${hourLabel(row.hour)} – ${hourLabel((row.hour + 1) % 24)}` : '';
                }}
              />
            )}
          />
          <Bar dataKey="issued" name={SERIES.issued.label} fill={SERIES.issued.color} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="finished" name={SERIES.finished.label} fill={SERIES.finished.color} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const dayShort = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const dayLong = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

/** Evolución diaria (emitidos vs. atendidos). */
export function DailyChart({ data, height = 260 }: { data: StatsSummaryDTO['byDay']; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Gráfico de área: turnos emitidos y atendidos por día">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="day" tickFormatter={dayShort} tickLine={false} axisLine={{ stroke: GRID }} tick={TICK} minTickGap={16} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} width={44} />
          <Tooltip
            cursor={{ stroke: 'var(--gc-muted)', strokeWidth: 1 }}
            content={(props) => <ChartTooltip {...props} formatLabel={(l) => (typeof l === 'string' ? dayLong(l) : l)} />}
          />
          {(['issued', 'finished'] as const).map((key) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={SERIES[key].label}
              stroke={SERIES[key].color}
              strokeWidth={2}
              fill={SERIES[key].color}
              fillOpacity={0.1}
              dot={data.length <= 14 ? { r: 3, strokeWidth: 0, fill: SERIES[key].color } : false}
              activeDot={{ r: 5, stroke: 'var(--gc-surface)', strokeWidth: 2, fill: SERIES[key].color }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Participación de cada servicio en los turnos emitidos (barras horizontales con el color del servicio). */
export function ServiceShareChart({ data }: { data: StatsSummaryDTO['byService'] }) {
  const total = data.reduce((sum, s) => sum + s.issued, 0) || 1;
  const rows = data.filter((s) => s.issued > 0).map((s) => ({ name: s.name, issued: s.issued, color: s.color, share: s.issued / total }));
  const height = Math.max(120, rows.length * 40 + 16);
  return (
    <div style={{ height }} role="img" aria-label="Gráfico de barras: turnos emitidos por servicio">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ ...TICK, fill: 'var(--gc-fg)' }}
            width={130}
            tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: 'var(--gc-subtle)' }}
            content={(props) => {
              const row = props.payload?.[0]?.payload as { share?: number } | undefined;
              return (
                <ChartTooltip
                  {...props}
                  formatValue={(v) => `${formatNumber(v)} (${formatPercent(row?.share ?? 0)})`}
                />
              );
            }}
          />
          <Bar dataKey="issued" name="Emitidos" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.color} />
            ))}
            <LabelList
              dataKey="share"
              position="right"
              formatter={(v: unknown) => formatPercent(Number(v))}
              style={{ fill: 'var(--gc-muted)', fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
