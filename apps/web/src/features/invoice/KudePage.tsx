import { useQuery } from '@tanstack/react-query';
import { FileX2, Loader2, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { SIFEN_RECEIVER_LABELS, formatCdc, type SifenKudeDTO } from '@gc/shared';
import { ApiError, api, assetUrl } from '../../lib/api';

const num = (n: number, currency: string) =>
  currency === 'PYG' ? Math.round(n).toLocaleString('es-PY') : n.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** KuDE: representación gráfica de la factura electrónica, para ver, imprimir o guardar en PDF. */
export default function KudePage() {
  const { token = '' } = useParams();
  const query = useQuery({ queryKey: ['kude', token], queryFn: () => api.public<SifenKudeDTO>(`/public/invoices/${token}`), retry: false });
  const [qr, setQr] = useState<string | null>(null);
  const d = query.data;
  useEffect(() => {
    if (d?.qrUrl) void QRCode.toDataURL(d.qrUrl, { width: 300, margin: 1 }).then(setQr);
    if (d) document.title = `Factura ${d.number} · ${d.issuer.razonSocial}`;
  }, [d]);

  if (query.isLoading)
    return (
      <div className="grid min-h-screen place-items-center bg-white">
        <Loader2 className="size-10 animate-spin text-slate-400" />
      </div>
    );
  if (!d)
    return (
      <div className="grid min-h-screen place-items-center bg-white p-6 text-center text-slate-700">
        <div>
          <FileX2 className="mx-auto size-12 text-slate-400" />
          <p className="mt-3 text-lg font-semibold">{query.error instanceof ApiError && query.error.status === 404 ? 'Factura no encontrada' : 'Sin conexión'}</p>
        </div>
      </div>
    );

  const c = d.currency;
  const r = d.receiver;
  return (
    <div className="min-h-screen bg-slate-100 py-6 text-[13px] text-slate-900 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end px-4 print:hidden">
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
          <Printer className="size-4" /> Imprimir o guardar PDF
        </button>
      </div>
      <article className="relative mx-auto max-w-4xl overflow-hidden bg-white p-6 shadow print:max-w-none print:p-0 print:shadow-none sm:p-8">
        {d.status === 'cancelled' && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="-rotate-30 text-[110px] font-black tracking-widest text-red-600/15">ANULADA</span>
          </div>
        )}
        {d.environment === 'test' && <p className="mb-4 rounded border border-amber-400 bg-amber-50 p-2 text-center font-semibold text-amber-900">Documento de PRUEBA, sin valor comercial ni fiscal (ambiente de pruebas de la SET)</p>}

        <header className="grid gap-4 border border-slate-300 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex gap-4 p-4">
            {d.issuer.logoUrl && <img src={assetUrl(d.issuer.logoUrl)} alt="" className="h-16 w-auto max-w-32 object-contain" />}
            <div className="min-w-0 space-y-0.5">
              <p className="text-base font-bold">{d.issuer.razonSocial}</p>
              {d.issuer.nombreFantasia && d.issuer.nombreFantasia !== d.issuer.razonSocial && <p className="font-medium">{d.issuer.nombreFantasia}</p>}
              <p>{d.issuer.actividadDescripcion}</p>
              <p>
                {d.issuer.direccion} {d.issuer.numeroCasa !== '0' ? d.issuer.numeroCasa : ''} · {d.issuer.ciudad}
              </p>
              <p>
                {d.issuer.telefono}
                {d.issuer.email ? ` · ${d.issuer.email}` : ''}
              </p>
            </div>
          </div>
          <div className="space-y-0.5 border-t border-slate-300 p-4 sm:border-t-0 sm:border-l">
            <p>
              <strong>RUC:</strong> {d.issuer.ruc}
            </p>
            <p>
              <strong>Timbrado N°:</strong> {d.issuer.timbrado}
            </p>
            <p>
              <strong>Inicio de vigencia:</strong> {d.issuer.timbradoFecha.split('-').reverse().join('/')}
            </p>
            <p className="pt-2 text-base font-bold uppercase">{d.type}</p>
            <p className="text-base font-bold tabular-nums">N° {d.number}</p>
          </div>
        </header>

        <section className="mt-3 grid gap-x-6 gap-y-1 border border-slate-300 p-4 sm:grid-cols-2">
          <p>
            <strong>Fecha de emisión:</strong> {new Date(d.issuedAt).toLocaleString('es-PY', { timeZone: 'America/Asuncion', dateStyle: 'short', timeStyle: 'short' })}
          </p>
          <p>
            <strong>Condición de venta:</strong> {d.condition}
          </p>
          <p>
            <strong>{r.kind === 'ruc' ? 'RUC' : r.kind === 'none' ? 'Documento' : SIFEN_RECEIVER_LABELS[r.kind]}:</strong> {r.kind === 'none' ? '—' : r.document}
          </p>
          <p>
            <strong>Moneda:</strong> {c === 'PYG' ? 'Guaraní' : `Dólar estadounidense${d.exchangeRate ? ` · cambio ${num(d.exchangeRate, 'PYG')}` : ''}`}
          </p>
          <p className="sm:col-span-2">
            <strong>Nombre o razón social:</strong> {r.kind === 'none' ? 'Sin Nombre' : r.name}
          </p>
          {r.address && (
            <p className="sm:col-span-2">
              <strong>Dirección:</strong> {r.address}
            </p>
          )}
          {r.email && (
            <p className="sm:col-span-2">
              <strong>Correo:</strong> {r.email}
            </p>
          )}
        </section>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse border border-slate-300 text-left [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1.5">
            <thead>
              <tr>
                <th className="w-16 text-right">Cant.</th>
                <th>Descripción</th>
                <th className="w-28 text-right">Precio unit.</th>
                <th className="w-24 text-right">Exentas</th>
                <th className="w-24 text-right">5 %</th>
                <th className="w-24 text-right">10 %</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i, n) => (
                <tr key={n}>
                  <td className="text-right tabular-nums">{i.quantity.toLocaleString('es-PY')}</td>
                  <td>{i.description}</td>
                  <td className="text-right tabular-nums">{num(i.unitPrice, c)}</td>
                  <td className="text-right tabular-nums">{i.iva === 0 ? num(i.total, c) : ''}</td>
                  <td className="text-right tabular-nums">{i.iva === 5 ? num(i.total, c) : ''}</td>
                  <td className="text-right tabular-nums">{i.iva === 10 ? num(i.total, c) : ''}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={3} className="text-right">
                  Subtotales
                </td>
                <td className="text-right tabular-nums">{num(d.totals.subtotalExento, c)}</td>
                <td className="text-right tabular-nums">{num(d.totals.subtotal5, c)}</td>
                <td className="text-right tabular-nums">{num(d.totals.subtotal10, c)}</td>
              </tr>
              <tr className="text-base font-bold">
                <td colSpan={5} className="text-right">
                  Total a pagar
                </td>
                <td className="text-right tabular-nums">{num(d.totals.total, c)}</td>
              </tr>
              <tr>
                <td colSpan={6}>
                  <strong>Liquidación del IVA:</strong> 5 %: {num(d.totals.iva5, c)} · 10 %: {num(d.totals.iva10, c)} · Total IVA: {num(d.totals.totalIva, c)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {d.notes && <p className="mt-3 border border-slate-300 p-3">{d.notes}</p>}

        <footer className="mt-3 grid items-center gap-4 border border-slate-300 p-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
          {qr ? <img src={qr} alt="Código QR de la factura" className="size-36" /> : <div className="size-36" />}
          <div className="space-y-2">
            <p>
              Consulte la validez de esta factura electrónica con el número de CDC impreso abajo en:{' '}
              <a href={d.environment === 'test' ? 'https://ekuatia.set.gov.py/consultas-test' : 'https://ekuatia.set.gov.py/consultas'} className="font-medium text-blue-700 underline">
                {d.environment === 'test' ? 'https://ekuatia.set.gov.py/consultas-test' : 'https://ekuatia.set.gov.py/consultas'}
              </a>
            </p>
            <p className="font-mono text-base font-bold tracking-wide">CDC: {formatCdc(d.cdc)}</p>
            <p className="text-xs text-slate-600">ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML).</p>
            <p className="text-xs text-slate-600">
              Si su documento electrónico presenta algún error, podrá solicitar la modificación dentro de las 72 horas siguientes de la emisión de este comprobante.
            </p>
          </div>
        </footer>
      </article>
    </div>
  );
}
