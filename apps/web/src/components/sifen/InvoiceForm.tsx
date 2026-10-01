import { useMutation } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  SIFEN_PAYMENT_TYPES,
  SIFEN_PAYMENT_TYPE_IDS,
  SIFEN_RECEIVER_KINDS,
  SIFEN_RECEIVER_LABELS,
  sifenTotals,
  type IvaRate,
  type SifenDocumentDTO,
  type SifenIssueInput,
  type SifenItem,
  type SifenReceiver,
} from '@gc/shared';
import { Button, Field, IconButton, Input, Modal, Select, Textarea, useFeedback } from '../ui';
import { api, errorMessage } from '../../lib/api';

export interface InvoicePrefill {
  receiver?: Partial<SifenReceiver>;
  items?: SifenItem[];
  paymentType?: SifenIssueInput['paymentType'];
  source?: SifenIssueInput['source'];
  notes?: string;
}

const money = (n: number, currency: string) => (currency === 'PYG' ? `Gs. ${Math.round(n).toLocaleString('es-PY')}` : `US$ ${n.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const emptyItem = (iva: IvaRate): SifenItem => ({ code: '', description: '', quantity: 1, unitPrice: 0, iva });

/** Emitir una factura electrónica (organización o plataforma, según `base`). */
export function InvoiceForm({
  base,
  defaultIva = 10,
  prefill,
  catalog,
  onClose,
  onIssued,
}: {
  base: '/invoicing' | '/platform/invoicing';
  defaultIva?: IvaRate;
  prefill?: InvoicePrefill;
  /** Servicios con precio para agregar rápido (en unidades de la moneda). */
  catalog?: { name: string; price: number }[];
  onClose: () => void;
  onIssued: (doc: SifenDocumentDTO) => void;
}) {
  const { toast } = useFeedback();
  const [receiver, setReceiver] = useState<SifenReceiver>({ kind: 'ci', document: '', name: '', email: '', phone: '', address: '', ...prefill?.receiver });
  const [items, setItems] = useState<SifenItem[]>(prefill?.items?.length ? prefill.items : [emptyItem(defaultIva)]);
  const [currency, setCurrency] = useState<'PYG' | 'USD'>('PYG');
  const [exchangeRate, setExchangeRate] = useState(0);
  const [condition, setCondition] = useState<'cash' | 'credit'>('cash');
  const [paymentType, setPaymentType] = useState<SifenIssueInput['paymentType']>(prefill?.paymentType ?? 1);
  const [creditDays, setCreditDays] = useState(30);
  const [notes, setNotes] = useState(prefill?.notes ?? '');
  const totals = useMemo(() => sifenTotals(items, currency), [items, currency]);
  const setR = <K extends keyof SifenReceiver>(k: K, v: SifenReceiver[K]) => setReceiver((r) => ({ ...r, [k]: v }));
  const setItem = (i: number, patch: Partial<SifenItem>) => setItems((list) => list.map((it, n) => (n === i ? { ...it, ...patch } : it)));

  const lookup = useMutation({
    mutationFn: () => api.post<{ found: boolean; name: string | null; status: string | null; message: string | null }>(`${base}/ruc`, { ruc: receiver.document }),
    onSuccess: (r) => {
      if (r.found && r.name) {
        setR('name', r.name);
        toast(`${r.name}${r.status ? ` · ${r.status}` : ''}`);
      } else toast(r.message ?? 'RUC no encontrado', 'error');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const issue = useMutation({
    mutationFn: () =>
      api.post<SifenDocumentDTO>(`${base}/documents`, {
        receiver,
        items: items.filter((i) => i.description.trim()),
        currency,
        ...(currency === 'USD' ? { exchangeRate } : {}),
        condition,
        paymentType,
        ...(condition === 'credit' ? { creditDays } : {}),
        notes,
        source: prefill?.source ?? { type: 'manual' },
      }),
    onSuccess: (doc) => {
      if (doc.status === 'approved') toast(`Factura ${doc.number} aprobada por la SET`);
      else toast(`Factura ${doc.number}: ${doc.setMessage ?? 'no se aprobó'}`, 'error');
      onIssued(doc);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    issue.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Nueva factura electrónica"
      description="Se firma con su certificado, se envía a la SET y queda con su CDC y su KuDE para imprimir o enviar."
      footer={
        <>
          <span className="mr-auto text-lg font-bold tabular-nums">Total {money(totals.total, currency)}</span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="sifen-invoice" loading={issue.isPending} disabled={totals.total <= 0}>
            Emitir y enviar a la SET
          </Button>
        </>
      }
    >
      <form id="sifen-invoice" onSubmit={submit} className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">Cliente</h3>
          <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <Field label="Tipo">
              <Select value={receiver.kind} onChange={(e) => setR('kind', e.target.value as SifenReceiver['kind'])}>
                {SIFEN_RECEIVER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SIFEN_RECEIVER_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            {receiver.kind !== 'none' && (
              <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <Field label={receiver.kind === 'ruc' ? 'RUC' : 'Número de documento'} hint={receiver.kind === 'ruc' ? 'Con dígito verificador: 80012345-6' : undefined}>
                  <div className="flex gap-1.5">
                    <Input required aria-label={receiver.kind === 'ruc' ? 'RUC' : 'Número de documento'} value={receiver.document} onChange={(e) => setR('document', e.target.value.trim())} maxLength={20} />
                    {receiver.kind === 'ruc' && (
                      <IconButton label="Buscar el RUC en la SET" loading={lookup.isPending} disabled={!/^\d{1,8}-\d$/.test(receiver.document)} onClick={() => lookup.mutate()}>
                        <Search className="size-4" />
                      </IconButton>
                    )}
                  </div>
                </Field>
                <Field label={receiver.kind === 'ruc' ? 'Razón social' : 'Nombre y apellido'}>
                  <Input required minLength={4} value={receiver.name} onChange={(e) => setR('name', e.target.value)} maxLength={255} />
                </Field>
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correo (opcional)" hint="Se le envía la factura al aprobarse.">
              <Input type="email" value={receiver.email} onChange={(e) => setR('email', e.target.value)} maxLength={80} />
            </Field>
            <Field label="Dirección (opcional)">
              <Input value={receiver.address} onChange={(e) => setR('address', e.target.value)} maxLength={255} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">Detalle</h3>
            {catalog && catalog.length > 0 && (
              <Select
                className="w-64"
                value=""
                onChange={(e) => {
                  const c = catalog[Number(e.target.value)];
                  if (!c) return;
                  const item = { ...emptyItem(defaultIva), description: c.name, unitPrice: c.price };
                  setItems((list) => (list.length === 1 && !list[0]!.description ? [item] : [...list, item]));
                }}
                aria-label="Agregar un servicio"
              >
                <option value="">+ Agregar un servicio…</option>
                {catalog.map((c, i) => (
                  <option key={c.name} value={i}>
                    {c.name} · {money(c.price, 'PYG')}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_2.5rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_6rem_2.5rem]">
                <Field label={i === 0 ? 'Descripción' : undefined} className="col-span-4 sm:col-span-1">
                  <Input value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} maxLength={120} placeholder="Consulta, estudio, servicio…" required={i === 0} />
                </Field>
                <Field label={i === 0 ? 'Cant.' : undefined}>
                  <Input type="number" min={0.001} step="any" value={item.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 0 })} />
                </Field>
                <Field label={i === 0 ? 'Precio (IVA incl.)' : undefined}>
                  <Input type="number" min={0} step="any" value={item.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) || 0 })} />
                </Field>
                <Field label={i === 0 ? 'IVA' : undefined}>
                  <Select value={item.iva} onChange={(e) => setItem(i, { iva: Number(e.target.value) as IvaRate })}>
                    <option value={10}>10 %</option>
                    <option value={5}>5 %</option>
                    <option value={0}>Exento</option>
                  </Select>
                </Field>
                <IconButton label="Quitar" disabled={items.length === 1} onClick={() => setItems((list) => list.filter((_, n) => n !== i))}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} disabled={items.length >= 100} onClick={() => setItems((list) => [...list, emptyItem(defaultIva)])}>
            Agregar ítem
          </Button>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {totals.subtotalExento > 0 && (
              <>
                <dt className="text-muted">Exentas</dt>
                <dd className="text-right tabular-nums">{money(totals.subtotalExento, currency)}</dd>
              </>
            )}
            {totals.iva5 > 0 && (
              <>
                <dt className="text-muted">IVA 5 %</dt>
                <dd className="text-right tabular-nums">{money(totals.iva5, currency)}</dd>
              </>
            )}
            <dt className="text-muted">IVA 10 %</dt>
            <dd className="text-right tabular-nums">{money(totals.iva10, currency)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums">{money(totals.total, currency)}</dd>
          </dl>
        </section>

        <section className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Condición">
            <Select value={condition} onChange={(e) => setCondition(e.target.value as 'cash' | 'credit')}>
              <option value="cash">Contado</option>
              <option value="credit">Crédito</option>
            </Select>
          </Field>
          {condition === 'cash' ? (
            <Field label="Forma de pago">
              <Select value={paymentType} onChange={(e) => setPaymentType(Number(e.target.value) as SifenIssueInput['paymentType'])}>
                {SIFEN_PAYMENT_TYPE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {SIFEN_PAYMENT_TYPES[id]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Plazo (días)">
              <Input type="number" min={1} max={365} value={creditDays} onChange={(e) => setCreditDays(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          )}
          <Field label="Moneda">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as 'PYG' | 'USD')}>
              <option value="PYG">Guaraníes</option>
              <option value="USD">Dólares</option>
            </Select>
          </Field>
          {currency === 'USD' && (
            <Field label="Tipo de cambio">
              <Input type="number" min={1} step="any" required value={exchangeRate || ''} onChange={(e) => setExchangeRate(Number(e.target.value) || 0)} />
            </Field>
          )}
        </section>
        <Field label="Observación (opcional)">
          <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
