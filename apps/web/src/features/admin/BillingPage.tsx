import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, CreditCard, Info, Receipt } from 'lucide-react';
import { MODULES, PAYMENT_GATEWAY_INFO, formatMoney, type BillingOverviewDTO, type FiscalProfile } from '@gc/shared';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, PageHeader, Table, useFeedback } from '../../components/ui';
import { useSaveTenant } from './customization/common';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { InvoiceLines, dateOnly, statusBadge } from '../platform/BillingTab';

export default function BillingPage() {
  const { me } = useAuth();
  const { toast } = useFeedback();
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => api.get<BillingOverviewDTO>('/billing') });
  const pay = useMutation({
    mutationFn: (id: string) => api.post<{ url: string }>(`/billing/invoices/${id}/pay`),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (billing.isLoading) return <Loading />;
  if (!billing.data) return <p className="text-sm text-red-600">{errorMessage(billing.error)}</p>;
  const b = billing.data;
  const pending = b.invoices.filter((i) => i.status === 'pending');
  const overdue = pending.filter((i) => i.overdue);
  const modules = me?.modules ?? [];

  return (
    <div className="space-y-6">
      <PageHeader icon={<Receipt />} title="Plan y facturación" description={`Plan de ${me?.tenant?.name}, facturas y pagos.`} />

      {b.suspended && (
        <div role="alert" className="flex gap-3 rounded-ui border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">La organización está suspendida por falta de pago.</p>
            <p className="text-fg/80">Las pantallas, kioscos y la atención están detenidos. Al acreditarse el pago de las facturas vencidas se reactiva sola.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="gc-card gc-pad">
          <p className="text-sm text-muted">Su plan</p>
          <p className="mt-1 text-2xl font-bold">{b.plan.name}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {b.monthly.total > 0 ? (
              <>
                {formatMoney(b.monthly.total, b.monthly.currency)} <span className="text-sm font-normal text-muted">por mes</span>
              </>
            ) : (
              <span className="text-muted">Sin costo mensual</span>
            )}
          </p>
          {b.monthly.lines.length > 1 && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
              {b.monthly.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="text-muted">{l.description}</span>
                  <span className="tabular-nums">{formatMoney(l.amount, b.monthly.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {modules.map((m) => (
              <Badge key={m}>{MODULES[m].name}</Badge>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">Para cambiar de plan o sumar módulos, contacte a {b.issuer.name.replace(/\.$/, '')}.</p>
        </div>

        <div className="gc-card gc-pad space-y-3">
          <p className="text-sm text-muted">Estado de cuenta</p>
          {pending.length ? (
            <p className="text-2xl font-bold tabular-nums">
              {formatMoney(
                pending.reduce((a, i) => a + i.amount, 0),
                pending[0]!.currency,
              )}{' '}
              <span className="text-sm font-normal text-muted">
                pendiente{overdue.length ? ` · ${overdue.length} ${overdue.length === 1 ? 'vencida' : 'vencidas'}` : ''}
              </span>
            </p>
          ) : (
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">Al día</p>
          )}
          {b.onlinePayment && pending.length > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <CreditCard className="size-4" /> Puede pagar en línea con {PAYMENT_GATEWAY_INFO[b.onlinePayment].name}.
            </p>
          )}
          {b.instructions && (
            <div className="flex gap-2 rounded-ui bg-subtle p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="whitespace-pre-line">{b.instructions}</p>
            </div>
          )}
          <p className="text-xs text-muted">
            Emisor: {b.issuer.name}
            {b.issuer.taxId ? ` · RUC ${b.issuer.taxId}` : ''}
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Facturas</h2>
        {!b.invoices.length ? (
          <EmptyState icon={<Receipt />} title="Todavía no hay facturas" />
        ) : (
          <div className="gc-card overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th className="w-full">Concepto</th>
                  <th className="text-right">Monto</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {b.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono text-xs whitespace-nowrap">{inv.number}</td>
                    <td className="min-w-56">
                      {inv.description}
                      <InvoiceLines invoice={inv} />
                      {inv.notes && <span className="block text-xs text-muted">{inv.notes}</span>}
                    </td>
                    <td className="text-right font-semibold whitespace-nowrap tabular-nums">{formatMoney(inv.amount, inv.currency)}</td>
                    <td className="whitespace-nowrap tabular-nums">{dateOnly(inv.dueDate)}</td>
                    <td>{statusBadge(inv)}</td>
                    <td>
                      {inv.status === 'pending' && b.onlinePayment && (
                        <Button size="sm" icon={<CreditCard className="size-3.5" />} loading={pay.isPending && pay.variables === inv.id} onClick={() => pay.mutate(inv.id)}>
                          Pagar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>
      <FiscalCard />
    </div>
  );
}

/** Datos con los que la plataforma le emite la factura (RUC y razón social). */
function FiscalCard() {
  const { settings } = useAuth();
  const { save, saving } = useSaveTenant();
  const [form, setForm] = useState<FiscalProfile>(settings.fiscal);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.fiscal);
  const set = <K extends keyof FiscalProfile>(k: K, v: FiscalProfile[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card title="Datos para su factura" description="RUC y razón social con los que se emiten las facturas de su plan.">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="RUC" hint="Con dígito verificador: 80012345-6">
          <Input value={form.ruc} onChange={(e) => set('ruc', e.target.value.trim())} maxLength={20} />
        </Field>
        <Field label="Razón social">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={255} />
        </Field>
        <Field label="Correo para las facturas">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value.trim())} maxLength={80} />
        </Field>
        <Field label="Dirección">
          <Input value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={255} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button disabled={!dirty} loading={saving} onClick={() => void save({ settings: { fiscal: form } }, 'Datos de facturación guardados')}>
          Guardar
        </Button>
      </div>
    </Card>
  );
}

