import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, Globe, Receipt } from 'lucide-react';
import { useState } from 'react';
import { MANUAL_METHOD_LABELS, PAYMENT_GATEWAY_INFO, PAYMENT_STATUS_LABELS, formatMoney, type ManualMethod, type PaymentDTO, type PaymentStatus } from '@gc/shared';
import { Badge, EmptyState, Field, Input, Loading, PageHeader, Select, Stat, Table, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, shiftDays, todayISO } from '../../lib/format';

interface PaymentsList {
  from: string;
  to: string;
  items: PaymentDTO[];
  totals: { count: number; amount: number; online: number; manual: number };
}

const STATUS_COLORS: Record<PaymentStatus, string> = { pending: '#d97706', paid: '#059669', failed: '#dc2626', cancelled: '#6b7280' };

const PRESETS = [
  { key: 'today', label: 'Hoy', range: (t: string) => ({ from: t, to: t }) },
  { key: '7d', label: '7 días', range: (t: string) => ({ from: shiftDays(t, -6), to: t }) },
  { key: 'month', label: 'Este mes', range: (t: string) => ({ from: `${t.slice(0, 8)}01`, to: t }) },
];

/** Cobros de turnos del período (módulo «Pagos»). */
export default function PaymentsPage() {
  const { settings, terms } = useAuth();
  const today = todayISO();
  const [range, setRange] = useState(PRESETS[0]!.range(today));
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const qs = new URLSearchParams({ ...range, ...(status ? { status } : {}) }).toString();
  const list = useQuery({ queryKey: ['payments', qs], queryFn: () => api.get<PaymentsList>(`/payments?${qs}`), refetchInterval: 30_000 });
  const currency = settings.payments.currency;
  const active = PRESETS.find((p) => JSON.stringify(p.range(today)) === JSON.stringify(range))?.key;

  return (
    <div className="space-y-6">
      <PageHeader icon={<Receipt />} title="Cobros" description={`Pagos de ${terms.tickets.toLowerCase()}: en línea y registrados en el puesto.`} />

      <div className="gc-card gc-pad flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Períodos rápidos" className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={active === p.key}
              onClick={() => setRange(p.range(today))}
              className={cx('h-10 rounded-ui border px-3 text-sm font-medium transition', active === p.key ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Field label="Desde" className="w-40">
          <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
        </Field>
        <Field label="Hasta" className="w-40">
          <Input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
        </Field>
        <Field label="Estado" className="w-44">
          <Select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus | '')}>
            <option value="">Todos</option>
            {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : !list.data ? (
        <p className="text-sm text-red-600">{errorMessage(list.error)}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Cobrado" value={formatMoney(list.data.totals.amount, currency)} hint={`${list.data.totals.count} pagos`} icon={<CreditCard />} tone="#059669" />
            <Stat label="En línea" value={formatMoney(list.data.totals.online, currency)} icon={<Globe />} />
            <Stat label="En el puesto" value={formatMoney(list.data.totals.manual, currency)} icon={<Banknote />} />
          </div>
          {!list.data.items.length ? (
            <EmptyState icon={<Receipt />} title="No hay cobros en este período" />
          ) : (
            <div className="gc-card overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>{terms.ticket}</th>
                    <th className="w-full">{terms.service}</th>
                    <th className="text-right">Monto</th>
                    <th>Forma de pago</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap text-muted">{formatDateTime(p.paidAt ?? p.createdAt)}</td>
                      <td className="font-semibold whitespace-nowrap">{p.ticketCode ?? '—'}</td>
                      <td>{p.service ?? p.description}</td>
                      <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                      <td className="whitespace-nowrap">
                        {p.provider === 'manual' ? (MANUAL_METHOD_LABELS[p.method as ManualMethod] ?? p.method) : (p.method ?? PAYMENT_GATEWAY_INFO[p.provider].name)}
                        <span className="block text-xs text-muted">
                          {p.provider === 'manual' ? (p.recordedBy ? `Registró ${p.recordedBy}` : 'En el puesto') : PAYMENT_GATEWAY_INFO[p.provider].name}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </span>
                      </td>
                      <td>
                        <Badge color={STATUS_COLORS[p.status]}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
