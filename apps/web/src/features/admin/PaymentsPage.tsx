import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, FileText, Globe, Receipt } from 'lucide-react';
import { useState } from 'react';
import { MANUAL_METHOD_LABELS, PAYMENT_GATEWAY_INFO, PAYMENT_STATUS_LABELS, formatMoney, fromMinor, type ManualMethod, type PaymentDTO, type PaymentStatus, type SifenDocumentDTO, type SifenIssuerDTO } from '@gc/shared';
import { InvoiceForm, type InvoicePrefill } from '../../components/sifen/InvoiceForm';
import { Badge, Button, EmptyState, Field, Input, Loading, PageHeader, Select, Stat, Table, cx } from '../../components/ui';
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
  const { settings, terms, hasModule } = useAuth();
  const today = todayISO();
  const [range, setRange] = useState(PRESETS[0]!.range(today));
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const qs = new URLSearchParams({ ...range, ...(status ? { status } : {}) }).toString();
  const list = useQuery({ queryKey: ['payments', qs], queryFn: () => api.get<PaymentsList>(`/payments?${qs}`), refetchInterval: 30_000 });
  const currency = settings.payments.currency;
  const active = PRESETS.find((p) => JSON.stringify(p.range(today)) === JSON.stringify(range))?.key;
  // Factura electrónica de cada cobro (módulo SIFEN).
  const invoicing = hasModule('invoicing');
  const [eInvoice, setEInvoice] = useState<InvoicePrefill | null>(null);
  const issuer = useQuery({ queryKey: ['sifen', '/invoicing', 'issuer'], queryFn: () => api.get<SifenIssuerDTO>('/invoicing/issuer'), enabled: invoicing, retry: false });
  const sifenReady = Boolean(issuer.data?.enabled && !issuer.data.missing.length);
  const eDocs = useQuery({
    queryKey: ['sifen', '/invoicing', 'by-payment', range.from, range.to],
    queryFn: () => api.get<SifenDocumentDTO[]>(`/invoicing/documents?sourceType=payment&from=${range.from}&to=${range.to}`),
    enabled: sifenReady,
  });
  const eDocOf = (paymentId: string) => eDocs.data?.find((d) => d.source.id === paymentId && d.status !== 'rejected' && d.status !== 'error');
  const prefillFor = (p: PaymentDTO): InvoicePrefill => ({
    receiver: { kind: 'ci' },
    items: [{ code: '', description: (p.service ?? p.description).slice(0, 120), quantity: 1, unitPrice: fromMinor(p.amount, p.currency), iva: issuer.data?.defaultIva ?? 10 }],
    paymentType: p.provider !== 'manual' ? 21 : p.method === 'cash' ? 1 : p.method === 'card' ? 3 : p.method === 'transfer' ? 5 : p.method === 'qr' ? 21 : 99,
    source: { type: 'payment', id: p.id },
  });

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
                    {sifenReady && <th>Factura</th>}
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
                      {sifenReady && (
                        <td className="whitespace-nowrap">
                          {p.status === 'paid' && (p.currency === 'PYG' || p.currency === 'USD') ? (
                            eDocOf(p.id) ? (
                              <a href={eDocOf(p.id)!.kudeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                                <FileText className="size-3.5" /> {eDocOf(p.id)!.number}
                              </a>
                            ) : (
                              <Button size="sm" variant="secondary" icon={<FileText className="size-3.5" />} onClick={() => setEInvoice(prefillFor(p))}>
                                Facturar
                              </Button>
                            )
                          ) : null}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
      {eInvoice && (
        <InvoiceForm base="/invoicing" defaultIva={issuer.data?.defaultIva ?? 10} prefill={eInvoice} onClose={() => setEInvoice(null)} onIssued={() => void eDocs.refetch()} />
      )}
    </div>
  );
}
