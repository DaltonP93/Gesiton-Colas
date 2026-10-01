import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CalendarPlus, CheckCircle2, FilePlus2, FileText, Mail, Receipt, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  CURRENCIES,
  INVOICE_STATUS_LABELS,
  MANUAL_METHODS,
  MANUAL_METHOD_LABELS,
  formatMoney,
  fromMinor,
  type BillingSettings,
  type BillingStatsDTO,
  type Currency,
  type InvoiceDTO,
  type ManualMethod,
  type PlatformSettings,
  type SifenDocumentDTO,
  type SifenIssuerDTO,
  type TenantDTO,
} from '@gc/shared';
import { GatewayForm } from '../../components/GatewayForm';
import { InvoiceForm, type InvoicePrefill } from '../../components/sifen/InvoiceForm';
import { Badge, Button, EmptyState, Field, Input, Loading, Modal, Select, Stat, Table, Textarea, Toggle, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, todayISO, shiftDays } from '../../lib/format';

type Filter = 'all' | 'pending' | 'overdue' | 'paid' | 'void';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'void', label: 'Anuladas' },
];

export function statusBadge(inv: Pick<InvoiceDTO, 'status' | 'overdue'>) {
  if (inv.status === 'pending' && inv.overdue) return <Badge color="#dc2626">{INVOICE_STATUS_LABELS.overdue}</Badge>;
  const colors = { pending: '#d97706', paid: '#059669', void: '#6b7280' } as const;
  return <Badge color={colors[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>;
}

export const dateOnly = (iso: string) => iso.split('-').reverse().join('/');

/** Detalle de la factura (plan y módulos adicionales). */
export function InvoiceLines({ invoice }: { invoice: Pick<InvoiceDTO, 'lines' | 'currency'> }) {
  if (invoice.lines.length < 2) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      {invoice.lines.map((l, i) => (
        <li key={i} className="flex justify-between gap-4">
          <span>{l.description}</span>
          <span className="tabular-nums">{formatMoney(l.amount, invoice.currency)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BillingTab() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<InvoiceDTO | null>(null);
  const [eInvoice, setEInvoice] = useState<InvoicePrefill | null>(null);
  // Factura electrónica SIFEN de la plataforma (si está configurada).
  const sifen = useQuery({ queryKey: ['sifen', '/platform/invoicing', 'issuer'], queryFn: () => api.get<SifenIssuerDTO>('/platform/invoicing/issuer'), retry: false });
  const sifenReady = Boolean(sifen.data?.enabled && !sifen.data.missing.length);
  const eDocs = useQuery({
    queryKey: ['sifen', '/platform/invoicing', 'by-invoice'],
    queryFn: () => api.get<SifenDocumentDTO[]>('/platform/invoicing/documents?sourceType=invoice'),
    enabled: sifenReady,
  });
  const eDocOf = (invoiceId: string) => eDocs.data?.find((d) => d.source.id === invoiceId && d.status !== 'rejected' && d.status !== 'error');
  const tenants = useQuery({ queryKey: ['platform', 'tenants', ''], queryFn: () => api.get<TenantDTO[]>('/platform/tenants'), enabled: sifenReady });
  const prefillFor = (inv: InvoiceDTO): InvoicePrefill => {
    const fiscal = tenants.data?.find((t) => t.id === inv.tenantId)?.settings.fiscal;
    const lines = inv.lines.length ? inv.lines : [{ description: inv.description, amount: inv.amount }];
    return {
      receiver: { kind: fiscal?.ruc && /^\d{1,8}-\d$/.test(fiscal.ruc) ? 'ruc' : 'ci', document: fiscal?.ruc ?? '', name: fiscal?.name || inv.tenantName, email: fiscal?.email ?? '', address: fiscal?.address ?? '' },
      items: lines.map((l) => ({ code: '', description: l.description.slice(0, 120), quantity: 1, unitPrice: fromMinor(l.amount, inv.currency), iva: sifen.data?.defaultIva ?? 10 })),
      paymentType: inv.method === 'cash' ? 1 : inv.method === 'card' ? 3 : inv.method === 'transfer' ? 5 : inv.method === 'qr' ? 21 : 99,
      source: { type: 'invoice', id: inv.id },
    };
  };
  const settings = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => api.get<PlatformSettings>('/platform/settings') });
  const stats = useQuery({ queryKey: ['platform', 'billing-stats'], queryFn: () => api.get<BillingStatsDTO>('/platform/billing/stats') });
  const list = useQuery({
    queryKey: ['platform', 'invoices', filter],
    queryFn: () => api.get<InvoiceDTO[]>(`/platform/billing/invoices${filter === 'all' ? '' : `?status=${filter}`}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'invoices'] });
    void qc.invalidateQueries({ queryKey: ['platform', 'billing-stats'] });
    void qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
  };

  const generate = useMutation({
    mutationFn: () => api.post<{ period: string; created: number }>('/platform/billing/generate', {}),
    onSuccess: (r) => {
      refresh();
      toast(r.created ? `Se emitieron ${r.created} facturas de ${r.period}` : `Todas las organizaciones con plan pago ya tienen su factura de ${r.period}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const voidInvoice = useMutation({
    mutationFn: (id: string) => api.post(`/platform/billing/invoices/${id}/void`),
    onSuccess: () => {
      refresh();
      toast('Factura anulada');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const resend = useMutation({
    mutationFn: (id: string) => api.post(`/platform/billing/invoices/${id}/resend`),
    onSuccess: () => toast('Factura reenviada a los administradores'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const s = stats.data;
  const currency = settings.data?.plans.pro.currency ?? 'PYG';

  return (
    <div className="space-y-8">
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Facturado este mes" value={formatMoney(s.issuedThisMonth, s.currency)} icon={<Receipt />} />
          <Stat label="Cobrado este mes" value={formatMoney(s.paidThisMonth, s.currency)} icon={<CheckCircle2 />} tone="#059669" />
          <Stat label="Pendiente de cobro" value={formatMoney(s.pending, s.currency)} icon={<Wallet />} tone="#d97706" />
          <Stat
            label="Vencido"
            value={formatMoney(s.overdue, s.currency)}
            hint={s.overdueTenants ? `${s.overdueTenants} ${s.overdueTenants === 1 ? 'organización' : 'organizaciones'} con deuda` : 'Sin deudas vencidas'}
            icon={<AlertTriangle />}
            tone="#dc2626"
          />
        </div>
      )}

      {settings.data && <BillingSettingsCard value={settings.data.billing} />}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Facturas</h2>
          <Button variant="secondary" icon={<CalendarPlus className="size-4" />} loading={generate.isPending} onClick={() => generate.mutate()}>
            Generar las del mes
          </Button>
          <Button icon={<FilePlus2 className="size-4" />} onClick={() => setCreating(true)}>
            Nueva factura
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar facturas">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cx('rounded-full border px-3 py-1 text-sm transition', filter === f.value ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
            >
              {f.label}
            </button>
          ))}
        </div>
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Receipt />}
            title="No hay facturas"
            description="Defina el precio de cada plan en Ajustes → Planes y módulos y use «Generar las del mes», o emita una factura a mano."
          />
        ) : (
          <div className="gc-card overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Organización</th>
                  <th className="w-full">Concepto</th>
                  <th className="text-right">Monto</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono text-xs whitespace-nowrap">{inv.number}</td>
                    <td className="font-medium whitespace-nowrap">{inv.tenantName}</td>
                    <td className="min-w-56">
                      {inv.description}
                      <InvoiceLines invoice={inv} />
                      {inv.status === 'paid' && (
                        <span className="block text-xs text-muted">
                          Pagada {inv.paidAt ? formatDateTime(inv.paidAt) : ''} · {inv.method && (MANUAL_METHOD_LABELS[inv.method as ManualMethod] ?? inv.method)}
                          {inv.reference ? ` · ${inv.reference}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatMoney(inv.amount, inv.currency)}</td>
                    <td className="whitespace-nowrap tabular-nums">{dateOnly(inv.dueDate)}</td>
                    <td>{statusBadge(inv)}</td>
                    <td>
                      {inv.status === 'paid' && sifenReady && (inv.currency === 'PYG' || inv.currency === 'USD') && (
                        <div className="flex justify-end">
                          {eDocOf(inv.id) ? (
                            <a href={eDocOf(inv.id)!.kudeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-primary hover:underline">
                              <FileText className="size-3.5" /> {eDocOf(inv.id)!.number}
                            </a>
                          ) : (
                            <Button size="sm" variant="secondary" icon={<FileText className="size-3.5" />} onClick={() => setEInvoice(prefillFor(inv))}>
                              Factura electrónica
                            </Button>
                          )}
                        </div>
                      )}
                      {inv.status === 'pending' && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setPaying(inv)}>
                            Registrar pago
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="Reenviar por correo" title="Reenviar por correo" icon={<Mail className="size-3.5" />} onClick={() => resend.mutate(inv.id)} />
                          <Button size="sm" variant="ghost" aria-label="Anular" title="Anular" className="text-red-600" icon={<Ban className="size-3.5" />} onClick={() => voidInvoice.mutate(inv.id)} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Cobro en línea de las facturas</h2>
          <p className="text-sm text-muted">Con una pasarela activa, cada organización paga sus facturas desde «Plan y facturación» y se acreditan solas.</p>
        </div>
        <GatewayForm scope="platform" currency={currency} />
      </section>

      {creating && <NewInvoiceModal onClose={() => setCreating(false)} onCreated={refresh} defaultCurrency={currency} />}
      {paying && <PayInvoiceModal invoice={paying} onClose={() => setPaying(null)} onPaid={refresh} />}
      {eInvoice && (
        <InvoiceForm
          base="/platform/invoicing"
          defaultIva={sifen.data?.defaultIva ?? 10}
          prefill={eInvoice}
          onClose={() => setEInvoice(null)}
          onIssued={() => void qc.invalidateQueries({ queryKey: ['sifen', '/platform/invoicing'] })}
        />
      )}
    </div>
  );
}

function BillingSettingsCard({ value }: { value: BillingSettings }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState(value);
  useEffect(() => setForm(value), [value]);
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  const save = useMutation({
    mutationFn: () => api.put<PlatformSettings>('/platform/settings', { billing: form }),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'settings'], data);
      toast('Facturación guardada');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <section className="gc-card gc-pad space-y-5">
      <Toggle
        checked={form.enabled}
        onChange={(v) => set('enabled', v)}
        label="Facturar los planes a las organizaciones"
        hint="Los administradores ven «Plan y facturación» con sus facturas y pueden pagarlas. Apagado, no se muestra nada."
      />
      <div className={cx('grid gap-5 lg:grid-cols-2', !form.enabled && 'pointer-events-none opacity-50')}>
        <div className="space-y-4">
          <Toggle checked={form.autoGenerate} onChange={(v) => set('autoGenerate', v)} label="Emitir sola la factura de cada mes" hint="El día 1, a cada organización con plan pago (según el precio del plan)." />
          <Field label="Días para pagar" hint="Desde la emisión.">
            <Input type="number" min={0} max={90} value={form.dueDays} onChange={(e) => set('dueDays', Number(e.target.value))} className="max-w-32" />
          </Field>
          <Toggle
            checked={form.autoSuspend}
            onChange={(v) => set('autoSuspend', v)}
            label="Suspender por falta de pago"
            hint="El administrador puede entrar igual a pagar; al acreditarse el pago se reactiva sola."
          />
          <Field label="Días de gracia antes de suspender">
            <Input type="number" min={0} max={120} value={form.graceDays} onChange={(e) => set('graceDays', Number(e.target.value))} className="max-w-32" disabled={!form.autoSuspend} />
          </Field>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razón social del emisor">
              <Input value={form.issuerName} maxLength={160} onChange={(e) => set('issuerName', e.target.value)} placeholder="Su empresa S.A." />
            </Field>
            <Field label="RUC">
              <Input value={form.issuerTaxId} maxLength={40} onChange={(e) => set('issuerTaxId', e.target.value)} placeholder="80000000-0" />
            </Field>
          </div>
          <Field label="Instrucciones de pago" hint="Aparecen en el correo y en «Plan y facturación» (cuenta bancaria, alias, contacto).">
            <Textarea rows={4} maxLength={1000} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Transferencia a Banco … cuenta … a nombre de …" />
          </Field>
          <p className="text-xs text-muted">Estas facturas son comprobantes internos de cobro. La factura legal (timbrada / electrónica SIFEN) se emite con su sistema contable.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" disabled={!dirty} onClick={() => setForm(value)}>
          Descartar
        </Button>
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          Guardar
        </Button>
      </div>
    </section>
  );
}

function NewInvoiceModal({ onClose, onCreated, defaultCurrency }: { onClose: () => void; onCreated: () => void; defaultCurrency: Currency }) {
  const { toast } = useFeedback();
  const tenants = useQuery({ queryKey: ['platform', 'tenants', ''], queryFn: () => api.get<TenantDTO[]>('/platform/tenants') });
  const [form, setForm] = useState({ tenantId: '', description: '', amount: '', currency: defaultCurrency, dueDate: shiftDays(todayISO(), 10), notes: '', notify: true });
  const create = useMutation({
    mutationFn: () => api.post('/platform/billing/invoices', { ...form, amount: Number(form.amount.replace(/\./g, '').replace(',', '.')) }),
    onSuccess: () => {
      onCreated();
      toast('Factura emitida');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.tenantId && form.description.trim() && Number(form.amount.replace(/\./g, '').replace(',', '.')) > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva factura"
      description="Para cobros fuera del plan mensual: instalación, capacitación, equipos, ajustes de precio."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Emitir factura
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Organización" required>
          <Select value={form.tenantId} onChange={(e) => set('tenantId', e.target.value)}>
            <option value="">Elija una organización…</option>
            {tenants.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Concepto" required>
          <Input value={form.description} maxLength={300} onChange={(e) => set('description', e.target.value)} placeholder="Instalación y capacitación" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_10rem]">
          <Field label="Monto" required>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="500.000" />
          </Field>
          <Field label="Moneda">
            <Select value={form.currency} onChange={(e) => set('currency', e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Vence">
            <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
        <Field label="Notas" hint="Opcional, visible para la organización.">
          <Textarea rows={2} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <Toggle checked={form.notify} onChange={(v) => set('notify', v)} label="Enviarla por correo a los administradores" />
      </div>
    </Modal>
  );
}

function PayInvoiceModal({ invoice, onClose, onPaid }: { invoice: InvoiceDTO; onClose: () => void; onPaid: () => void }) {
  const { toast } = useFeedback();
  const [method, setMethod] = useState<ManualMethod>('transfer');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () => api.post(`/platform/billing/invoices/${invoice.id}/pay`, { method, reference }),
    onSuccess: () => {
      onPaid();
      toast(`Factura ${invoice.number} pagada`);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Registrar el pago de ${invoice.number}`}
      description={`${invoice.tenantName} · ${formatMoney(invoice.amount, invoice.currency)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={pay.isPending} onClick={() => pay.mutate()}>
            Marcar como pagada
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Forma de pago">
          <Select value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
            {MANUAL_METHODS.map((m) => (
              <option key={m} value={m}>
                {MANUAL_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Referencia" hint="N.º de transferencia, recibo…">
          <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
