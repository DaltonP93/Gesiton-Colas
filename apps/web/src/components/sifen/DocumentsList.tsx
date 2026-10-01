import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileCode2, FileText, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import { SIFEN_STATUSES, SIFEN_STATUS_LABELS, formatCdc, type SifenDocumentDTO, type SifenIssuerDTO, type SifenStatus } from '@gc/shared';
import { Badge, Button, EmptyState, Field, IconButton, Input, Loading, Modal, Select, Table, Textarea, useFeedback } from '../ui';
import { api, download, errorMessage } from '../../lib/api';
import { formatDateTime, shiftDays, todayISO } from '../../lib/format';
import { InvoiceForm, type InvoicePrefill } from './InvoiceForm';

export const SIFEN_STATUS_COLORS: Record<SifenStatus, string> = {
  pending: '#2563eb',
  approved: '#059669',
  rejected: '#dc2626',
  cancelled: '#6b7280',
  error: '#d97706',
};

const money = (n: number, currency: string) => (currency === 'PYG' ? `Gs. ${Math.round(n).toLocaleString('es-PY')}` : `US$ ${n.toLocaleString('es-PY', { minimumFractionDigits: 2 })}`);

/** Facturas electrónicas emitidas, con su estado en la SET. */
export function DocumentsList({ base, catalog, canCancel = true }: { base: '/invoicing' | '/platform/invoicing'; catalog?: { name: string; price: number }[]; canCancel?: boolean }) {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const today = todayISO();
  const [from, setFrom] = useState(shiftDays(today, -29));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<SifenStatus | ''>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState<InvoicePrefill | null>(null);
  const [cancelling, setCancelling] = useState<SifenDocumentDTO | null>(null);
  const params = new URLSearchParams(Object.entries({ from, to, status, q: search }).filter(([, v]) => v) as [string, string][]);
  const list = useQuery({ queryKey: ['sifen', base, params.toString()], queryFn: () => api.get<SifenDocumentDTO[]>(`${base}/documents?${params}`), placeholderData: keepPreviousData });
  const issuer = useQuery({ queryKey: ['sifen', base, 'issuer'], queryFn: () => api.get<SifenIssuerDTO>(`${base}/issuer`), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sifen', base] });

  const action = useMutation({
    mutationFn: ({ doc, kind }: { doc: SifenDocumentDTO; kind: 'retry' | 'refresh' }) => api.post<SifenDocumentDTO | { document: SifenDocumentDTO; set: { message: string | null } }>(`${base}/documents/${doc.id}/${kind}`),
    onSuccess: (r) => {
      const doc = 'document' in r ? r.document : r;
      toast(doc.status === 'approved' ? `Factura ${doc.number} aprobada` : `${doc.number}: ${('set' in r ? r.set.message : doc.setMessage) ?? SIFEN_STATUS_LABELS[doc.status]}`, doc.status === 'approved' ? 'success' : 'error');
      void refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const ready = issuer.data && issuer.data.enabled && !issuer.data.missing.length;

  return (
    <div className="space-y-4">
      {issuer.data && !ready && (
        <div className="rounded-ui border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {!issuer.data.enabled ? 'La factura electrónica está desactivada.' : `Para emitir falta: ${issuer.data.missing.join(', ')}.`} Complételo en la configuración de factura electrónica.
        </div>
      )}
      <div className="gc-card gc-pad flex flex-wrap items-end gap-3">
        <Field label="Desde" className="w-40">
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta" className="w-40">
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
        <Field label="Estado" className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as SifenStatus | '')}>
            <option value="">Todos</option>
            {SIFEN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SIFEN_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <form
          className="flex min-w-56 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <Field label="Buscar" className="flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, documento, número o CDC" />
          </Field>
          <Button type="submit" variant="secondary" icon={<Search className="size-4" />} aria-label="Buscar" />
        </form>
        <Button icon={<Plus className="size-4" />} disabled={!ready} onClick={() => setCreating({})}>
          Nueva factura
        </Button>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.isError || !list.data ? (
        <p className="text-sm text-red-600">{errorMessage(list.error)}</p>
      ) : !list.data.length ? (
        <EmptyState icon={<FileText />} title="Sin facturas en este período" description="Las facturas que emita aquí (o al registrar un cobro) quedan con su CDC, su estado en la SET y su KuDE para imprimir." />
      ) : (
        <div className="gc-card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th className="w-full">Cliente</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">
                    <span className="font-semibold tabular-nums">{d.number}</span>
                    {d.environment === 'test' && <Badge className="ml-2">Pruebas</Badge>}
                    <span className="block font-mono text-[11px] text-muted" title="CDC">
                      {formatCdc(d.cdc)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(d.issuedAt)}</td>
                  <td className="min-w-48">
                    <span className="font-medium">{d.receiver.kind === 'none' ? 'Sin nombre' : d.receiver.name}</span>
                    <span className="block text-xs text-muted">{d.receiver.kind === 'none' ? 'Consumidor final' : `${d.receiver.kind === 'ruc' ? 'RUC' : 'Doc.'} ${d.receiver.document}`}</span>
                  </td>
                  <td className="text-right font-semibold whitespace-nowrap tabular-nums">{money(d.totals.total, d.currency)}</td>
                  <td className="max-w-64">
                    <Badge color={SIFEN_STATUS_COLORS[d.status]}>{SIFEN_STATUS_LABELS[d.status]}</Badge>
                    {(d.status === 'rejected' || d.status === 'error') && d.setMessage && (
                      <span className="mt-0.5 block text-xs text-red-600">
                        {d.setCode ? `${d.setCode}: ` : ''}
                        {d.setMessage}
                      </span>
                    )}
                    {d.status === 'cancelled' && d.cancelReason && <span className="mt-0.5 block text-xs text-muted">{d.cancelReason}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      {(d.status === 'approved' || d.status === 'cancelled') && (
                        <a href={d.kudeUrl} target="_blank" rel="noreferrer" title="Ver e imprimir el KuDE" className="inline-flex size-9 items-center justify-center rounded-ui hover:bg-subtle">
                          <FileText className="size-4" />
                        </a>
                      )}
                      <IconButton label="Descargar el XML" onClick={() => void download(`${base}/documents/${d.id}/xml`, `${d.cdc}.xml`).catch((e) => toast(errorMessage(e), 'error'))}>
                        <FileCode2 className="size-4" />
                      </IconButton>
                      {(d.status === 'error' || d.status === 'pending') && (
                        <IconButton label="Consultar en la SET" loading={action.isPending && action.variables?.doc.id === d.id && action.variables.kind === 'refresh'} onClick={() => action.mutate({ doc: d, kind: 'refresh' })}>
                          <RefreshCw className="size-4" />
                        </IconButton>
                      )}
                      {(d.status === 'error' || d.status === 'rejected') && (
                        <IconButton label={d.status === 'rejected' ? 'Corregir y reenviar' : 'Reenviar'} loading={action.isPending && action.variables?.doc.id === d.id && action.variables.kind === 'retry'} onClick={() => action.mutate({ doc: d, kind: 'retry' })}>
                          <RotateCcw className="size-4" />
                        </IconButton>
                      )}
                      {canCancel && d.canCancel && (
                        <IconButton
                          label="Anular ante la SET"
                          onClick={async () => {
                            const ok = await confirm({ title: `¿Anular la factura ${d.number}?`, message: 'Se envía el evento de cancelación a la SET. Solo dentro de las 48 h desde la aprobación.', confirmLabel: 'Continuar', danger: true });
                            if (ok) setCancelling(d);
                          }}
                        >
                          <Ban className="size-4" />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {creating && <InvoiceForm base={base} defaultIva={issuer.data?.defaultIva ?? 10} prefill={creating} catalog={catalog} onClose={() => setCreating(null)} onIssued={() => void refresh()} />}
      {cancelling && <CancelModal base={base} doc={cancelling} onClose={() => setCancelling(null)} onDone={() => void refresh()} />}
    </div>
  );
}

function CancelModal({ base, doc, onClose, onDone }: { base: string; doc: SifenDocumentDTO; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.post<SifenDocumentDTO>(`${base}/documents/${doc.id}/cancel`, { reason }),
    onSuccess: () => {
      toast(`Factura ${doc.number} anulada ante la SET`);
      onDone();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Anular la factura ${doc.number}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 5} onClick={() => cancel.mutate()}>
            Anular
          </Button>
        </>
      }
    >
      <Field label="Motivo" hint="Queda registrado en la SET (ej.: error en los datos del cliente).">
        <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Abre el formulario de factura desde otra pantalla (cobros, facturas de la plataforma). */
export function useInvoiceFromElsewhere() {
  const [prefill, setPrefill] = useState<InvoicePrefill | null>(null);
  return { prefill, open: setPrefill, close: () => setPrefill(null) };
}
