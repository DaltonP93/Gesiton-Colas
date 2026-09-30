import { useQuery } from '@tanstack/react-query';
import { BellRing, CheckCircle2, ChevronRight, Clock, Heart, Loader2, MapPin, MessageCircle, Star, Users, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { RT, type PublicTicketDTO } from '@gc/shared';
import { ApiError, api, assetUrl } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { connectSocket } from '../../lib/socket';
import { applyBranding } from '../../lib/theme';
import { playSound } from '../display/useAnnouncer';

export default function TrackingPage() {
  const { token = '' } = useParams();
  const query = useQuery({
    queryKey: ['track', token],
    queryFn: () => api.public<PublicTicketDTO>(`/public/tickets/${token}`),
    refetchInterval: (q) => (q.state.data && ['waiting', 'called', 'in_service'].includes(q.state.data.status) ? 15_000 : false),
  });
  const ticket = query.data;
  const t = translator(ticket?.tenant.locale ?? 'es', ticket?.tenant.terminology);
  const [notify, setNotify] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [cancelling, setCancelling] = useState(false);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (ticket) applyBranding(ticket.tenant.branding, { title: `${ticket.code} · ${ticket.tenant.name}`, applyCustomCss: false });
  }, [ticket]);

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket('ticket', token);
    socket.on(RT.ticketUpdated, () => void query.refetch());
    return () => {
      socket.close();
    };
  }, [token]);

  // Aviso al cliente cuando lo llaman: vibración, sonido y notificación.
  useEffect(() => {
    if (!ticket) return;
    if (previous.current && previous.current !== 'called' && ticket.status === 'called') {
      navigator.vibrate?.([400, 200, 400, 200, 600]);
      void playSound('/sounds/airport-bingbong.wav', 1);
      if (notify && typeof Notification !== 'undefined') {
        try {
          new Notification(t('track.called'), { body: `${ticket.code} · ${t('track.goTo')} ${ticket.counter ?? ''}`, tag: token });
        } catch {
          /* algunos navegadores móviles requieren service worker */
        }
      }
    }
    previous.current = ticket.status;
  }, [ticket, notify, t, token]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="size-8 animate-spin text-muted" />
      </div>
    );
  }
  if (!ticket) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-center">
        <XCircle className="size-12 text-muted" />
        <p className="mt-4 text-xl font-semibold">{notFound ? t('track.notFound') : 'Sin conexión'}</p>
      </div>
    );
  }

  const active = ['waiting', 'called', 'in_service'].includes(ticket.status);
  const branding = ticket.tenant.branding;

  async function enableNotifications() {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotify(permission === 'granted');
  }

  async function cancel() {
    if (!window.confirm(t('track.cancelConfirm'))) return;
    setCancelling(true);
    try {
      await api.public(`/public/tickets/${token}/cancel`, {});
      await query.refetch();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg pb-10">
      <header className="bg-primary px-6 pt-8 pb-24 text-center text-primary-fg">
        {branding.logoUrl ? (
          <img src={assetUrl(branding.logoUrl)} alt={ticket.tenant.name} className="mx-auto h-12 max-w-[60%] object-contain" />
        ) : (
          <p className="text-xl font-bold">{branding.appName}</p>
        )}
        <p className="mt-1 text-sm opacity-80">{ticket.branch}</p>
      </header>

      <main className="mx-auto -mt-16 max-w-md px-4">
        <div className="rounded-3xl bg-surface p-6 text-center shadow-xl">
          <p className="text-sm font-semibold tracking-widest text-muted uppercase">{t('track.title')}</p>
          <p className="mt-2 text-7xl font-black tracking-tight text-primary">{ticket.code}</p>
          <p className="mt-1 text-lg font-semibold">{ticket.service}</p>

          {ticket.status === 'waiting' && (
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-subtle p-4">
                <Users className="mx-auto size-5 text-primary" />
                <p className="mt-1 text-3xl font-bold tabular-nums">{ticket.waitingAhead}</p>
                <p className="text-xs text-muted">{t('track.ahead')}</p>
              </div>
              <div className="rounded-2xl bg-subtle p-4">
                <Clock className="mx-auto size-5 text-primary" />
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {ticket.estimatedMinutes ?? '—'}
                  <span className="ml-1 text-base font-medium">{t('track.minutes')}</span>
                </p>
                <p className="text-xs text-muted">{t('track.estimated')}</p>
              </div>
            </div>
          )}

          {ticket.status === 'called' && (
            <div className="gc-pop mt-6 rounded-2xl bg-accent p-5 text-accent-fg">
              <BellRing className="mx-auto size-8 animate-bounce" />
              <p className="mt-2 text-2xl font-extrabold">{t('track.called')}</p>
              <p className="mt-1 text-lg">
                {t('track.goTo')} <strong>{ticket.counter}</strong>
              </p>
            </div>
          )}

          {ticket.status === 'in_service' && (
            <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-subtle p-4 font-semibold">
              <MapPin className="size-5 text-primary" /> {t('track.inService')} {ticket.counter && `· ${ticket.counter}`}
            </div>
          )}

          {!active && (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl bg-subtle p-5">
              {ticket.status === 'finished' ? <CheckCircle2 className="size-8 text-emerald-600" /> : <XCircle className="size-8 text-muted" />}
              <p className="font-semibold">
                {ticket.status === 'finished'
                  ? t('track.finished')
                  : ticket.status === 'no_show'
                    ? t('track.noShow')
                    : ticket.status === 'transferred'
                      ? t('track.transferred')
                      : t('track.cancelled')}
              </p>
            </div>
          )}

          <p className="mt-5 text-xs text-muted">
            {t('track.issuedAt')} {new Date(ticket.createdAt).toLocaleTimeString(ticket.tenant.locale, { hour: '2-digit', minute: '2-digit' })}
            {active && (
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="size-2 animate-pulse rounded-full bg-emerald-500" /> {t('track.live')}
              </span>
            )}
          </p>
        </div>

        {ticket.survey && (
          <div className="mt-4">
            {ticket.survey.answered ? (
              <p className="flex items-center justify-center gap-2 rounded-2xl bg-surface px-4 py-4 text-sm font-semibold shadow">
                <Heart className="size-5 fill-rose-500 text-rose-500" /> {t('track.surveyDone')}
              </p>
            ) : (
              <Link to={ticket.survey.url} className="gc-pop flex items-center gap-4 rounded-2xl bg-surface p-5 text-left shadow-lg ring-2 ring-primary/30">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-400/20">
                  <Star className="size-7 fill-amber-400 text-amber-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{t('track.surveyTitle')}</span>
                  <span className="block text-sm text-muted">{t('track.surveyHint')}</span>
                </span>
                <ChevronRight className="size-6 shrink-0 text-primary" aria-label={t('track.surveyOpen')} />
              </Link>
            )}
          </div>
        )}

        {active && (
          <div className="mt-4 space-y-3">
            {ticket.status === 'waiting' && ticket.notify.available && <PhoneOptIn token={token} phone={ticket.notify.phone} t={t} onSaved={() => void query.refetch()} />}
            {typeof Notification !== 'undefined' && (
              <button
                type="button"
                onClick={() => void enableNotifications()}
                disabled={notify}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface px-4 py-4 font-semibold shadow disabled:opacity-70"
              >
                <BellRing className="size-5 text-primary" /> {notify ? t('track.notifyOn') : t('track.notify')}
              </button>
            )}
            {ticket.status === 'waiting' && (
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={cancelling}
                className="w-full rounded-2xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {t('track.cancel')}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** El cliente deja su teléfono para recibir los avisos por WhatsApp o SMS. */
function PhoneOptIn({ token, phone, t, onSaved }: { token: string; phone: string | null; t: ReturnType<typeof translator>; onSaved: () => void }) {
  const [editing, setEditing] = useState(!phone);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.public(`/public/tickets/${token}/notify`, { phone: value });
      setEditing(false);
      setValue('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  if (!editing && phone) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-4 shadow">
        <MessageCircle className="size-5 shrink-0 text-emerald-600" />
        <p className="min-w-0 flex-1 text-sm font-semibold">{t('track.phoneOn', { phone })}</p>
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline">
          {t('track.phoneChange')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-2xl bg-surface p-4 text-left shadow">
      <p className="flex items-center gap-2 font-semibold">
        <MessageCircle className="size-5 text-primary" /> {t('track.phoneTitle')}
      </p>
      <p className="mt-1 text-sm text-muted">{t('track.phoneHint')}</p>
      <div className="mt-3 flex gap-2">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          minLength={6}
          maxLength={30}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('track.phonePlaceholder')}
          aria-label={t('track.phonePlaceholder')}
          className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <button type="submit" disabled={saving || value.trim().length < 6} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-fg disabled:opacity-50">
          {saving ? <Loader2 className="size-5 animate-spin" /> : t('track.phoneSave')}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
