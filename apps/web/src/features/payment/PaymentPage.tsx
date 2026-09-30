import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CreditCard, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PAYMENT_GATEWAY_INFO, formatMoney, type PublicPaymentDTO } from '@gc/shared';
import { ApiError, api, assetUrl } from '../../lib/api';

declare global {
  interface Window {
    Bancard?: { Checkout?: { createForm: (containerId: string, processId: string, options?: Record<string, unknown>) => void } };
  }
}

/** Página de pago: redirige al checkout de la pasarela (o muestra el de Bancard) y confirma el resultado al volver. */
export default function PaymentPage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const returned = params.get('r');
  const [since] = useState(() => Date.now());
  const query = useQuery({
    queryKey: ['payment', token],
    queryFn: () => api.public<PublicPaymentDTO>(`/public/payments/${token}`),
    retry: false,
    // Al volver del checkout se consulta hasta que la pasarela confirme (máx. 3 minutos).
    refetchInterval: (q) => (q.state.data?.status === 'pending' && (returned === 'ok' || q.state.data.bancard) && Date.now() - since < 180_000 ? 3000 : false),
  });
  const data = query.data;
  const redirected = useRef(false);

  useEffect(() => {
    if (data?.status === 'pending' && data.checkoutUrl && !returned && !redirected.current) {
      redirected.current = true;
      window.location.assign(data.checkoutUrl);
    }
  }, [data, returned]);

  useEffect(() => {
    const bancard = data?.bancard;
    if (!bancard) return;
    const render = () => window.Bancard?.Checkout?.createForm('bancard-checkout', bancard.processId, { styles: { 'form-background-color': '#ffffff' } });
    if (window.Bancard?.Checkout) return render();
    const script = document.createElement('script');
    script.src = bancard.scriptUrl;
    script.async = true;
    script.onload = render;
    document.body.appendChild(script);
    return () => script.remove();
  }, [data?.bancard?.processId]);

  if (query.isLoading) return <Centered icon={<Loader2 className="size-10 animate-spin text-muted" />} title="Preparando el pago…" />;
  if (!data) {
    return <Centered icon={<XCircle className="size-12 text-muted" />} title={query.error instanceof ApiError && query.error.status === 404 ? 'Pago no encontrado' : 'Sin conexión'} />;
  }

  const back = data.returnUrl ? (
    <Link to={data.returnUrl} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline">
      <ArrowLeft className="size-4" /> Volver
    </Link>
  ) : null;

  return (
    <div className="min-h-screen bg-bg pb-10" style={{ ['--gc-primary' as string]: data.brand.primaryColor }}>
      <header className="px-6 pt-8 pb-16 text-center text-white" style={{ background: data.brand.primaryColor }}>
        {data.brand.logoUrl ? <img src={assetUrl(data.brand.logoUrl)} alt={data.brand.name} className="mx-auto h-11 max-w-[60%] object-contain" /> : <p className="text-xl font-bold">{data.brand.name}</p>}
      </header>
      <main className="mx-auto -mt-10 max-w-lg space-y-4 px-4">
        <div className="rounded-3xl bg-surface p-6 text-center shadow-xl">
          <p className="text-sm text-muted">{data.description}</p>
          <p className="mt-1 text-4xl font-black tracking-tight tabular-nums">{formatMoney(data.amount, data.currency)}</p>
          {data.provider !== 'manual' && <p className="mt-1 text-xs text-muted">Pago con {PAYMENT_GATEWAY_INFO[data.provider].name}</p>}
        </div>

        {data.status === 'paid' && (
          <Result icon={<CheckCircle2 className="size-12 text-emerald-600" />} title="¡Pago acreditado!" text="Gracias. El comprobante queda registrado.">
            {back}
          </Result>
        )}
        {(data.status === 'failed' || data.status === 'cancelled' || (data.status === 'pending' && returned === 'cancel')) && (
          <Result icon={<XCircle className="size-12 text-red-500" />} title={data.status === 'failed' ? 'El pago fue rechazado' : 'El pago no se completó'} text="No se hizo ningún cobro. Puede intentarlo de nuevo.">
            <div className="flex flex-wrap items-center justify-center gap-4">
              {data.checkoutUrl && (
                <a href={data.checkoutUrl} className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-fg">
                  Intentar de nuevo
                </a>
              )}
              {back}
            </div>
          </Result>
        )}
        {data.status === 'pending' && returned !== 'cancel' && (
          <>
            {data.bancard ? (
              <div className="overflow-hidden rounded-3xl bg-surface p-2 shadow-xl">
                <div id="bancard-checkout" className="min-h-[26rem]" />
              </div>
            ) : returned === 'ok' ? (
              <Result icon={<Loader2 className="size-10 animate-spin text-primary" />} title="Confirmando el pago…" text="Esperamos la confirmación de la pasarela. No cierre esta página." />
            ) : (
              <Result icon={<CreditCard className="size-10 text-primary" />} title="Lo llevamos a la página de pago…" text="Si no se abre sola, use el botón.">
                {data.checkoutUrl && (
                  <a href={data.checkoutUrl} className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-fg">
                    Continuar al pago
                  </a>
                )}
              </Result>
            )}
            <div className="text-center">{back}</div>
          </>
        )}
      </main>
    </div>
  );
}

function Result({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-8 text-center shadow-xl">
      {icon}
      <p className="text-xl font-bold">{title}</p>
      {text && <p className="text-sm text-muted">{text}</p>}
      {children}
    </div>
  );
}

function Centered({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      {icon}
      <p className="text-xl font-semibold">{title}</p>
    </div>
  );
}
