import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck2, CalendarX2, ChevronRight, Clock, Loader2, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { AvailabilityDayDTO, BookingPageDTO, BookingResultDTO } from '@gc/shared';
import { Button, Field, Input, cx } from '../../components/ui';
import { ApiError, api, assetUrl, errorMessage } from '../../lib/api';
import { longDate } from '../../lib/format';
import { AppointmentCard } from './AppointmentPage';
import { PrivacyNotice } from '../../components/legal/PrivacyNotice';

type Step = 'service' | 'branch' | 'slot' | 'data' | 'done';

/** Reserva en línea: servicio → sucursal → día y hora → datos → confirmación. */
export default function BookingPage() {
  const { slug = '' } = useParams();
  const page = useQuery({ queryKey: ['booking', slug], queryFn: () => api.public<BookingPageDTO>(`/public/booking/${slug}`), retry: false });
  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [slot, setSlot] = useState<{ at: string; time: string; date: string } | null>(null);
  const [result, setResult] = useState<BookingResultDTO | null>(null);
  const data = page.data;

  useEffect(() => {
    if (data?.tenant.name) document.title = `Reservar · ${data.tenant.name}`;
  }, [data?.tenant.name]);

  if (page.isLoading) return <Shell><Centered icon={<Loader2 className="size-10 animate-spin text-muted" />} title="Cargando…" /></Shell>;
  if (!data) {
    const notFound = page.error instanceof ApiError && page.error.status === 404;
    return (
      <Shell>
        <Centered icon={<CalendarX2 className="size-12 text-muted" />} title={notFound ? 'La reserva en línea no está disponible' : 'Sin conexión'} text={notFound ? 'Comuníquese con la organización para agendar su cita.' : 'Intente de nuevo en unos minutos.'} />
      </Shell>
    );
  }

  const brand = data.tenant.branding;
  const service = data.services.find((s) => s.id === serviceId);
  const branchesFor = service ? data.branches.filter((b) => service.branchIds.includes(b.id)) : [];
  const branch = data.branches.find((b) => b.id === branchId);

  const chooseService = (id: string) => {
    setServiceId(id);
    const options = data.branches.filter((b) => data.services.find((s) => s.id === id)?.branchIds.includes(b.id));
    if (options.length === 1) {
      setBranchId(options[0]!.id);
      setStep('slot');
    } else setStep('branch');
  };
  const back = () => setStep(step === 'data' ? 'slot' : step === 'slot' ? (branchesFor.length > 1 ? 'branch' : 'service') : 'service');

  return (
    <Shell brand={{ name: data.tenant.name, logoUrl: brand.logoUrl, color: brand.primaryColor }}>
      {step !== 'service' && step !== 'done' && (
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 font-medium text-primary shadow-sm hover:bg-subtle">
            <ArrowLeft className="size-3.5" /> Volver
          </button>
          {service && <Chip>{service.name}</Chip>}
          {branch && step !== 'branch' && <Chip>{branch.name}</Chip>}
          {slot && step === 'data' && <Chip>{`${longDate(slot.date)} · ${slot.time}`}</Chip>}
        </div>
      )}

      {step === 'service' && (
        <Panel title="¿Qué necesita?" text={data.booking.message || undefined}>
          {!data.services.length ? (
            <p className="text-sm text-muted">Todavía no hay servicios con reserva en línea.</p>
          ) : (
            <div className="grid gap-2">
              {data.services.map((s) => (
                <Option key={s.id} onClick={() => chooseService(s.id)} accent={s.color} title={s.name} text={s.description} />
              ))}
            </div>
          )}
        </Panel>
      )}

      {step === 'branch' && (
        <Panel title="¿Dónde?">
          <div className="grid gap-2">
            {branchesFor.map((b) => (
              <Option
                key={b.id}
                onClick={() => {
                  setBranchId(b.id);
                  setStep('slot');
                }}
                icon={<MapPin className="size-5" />}
                title={b.name}
                text={b.address}
              />
            ))}
          </div>
        </Panel>
      )}

      {step === 'slot' && service && branch && (
        <SlotPicker
          slug={slug}
          branchId={branch.id}
          serviceId={service.id}
          days={Math.min(data.booking.daysAhead, 31)}
          onPick={(s) => {
            setSlot(s);
            setStep('data');
          }}
        />
      )}

      {step === 'data' && service && branch && slot && (
        <CustomerStep
          slug={slug}
          booking={data.booking}
          tenant={data.tenant}
          body={{ branchId: branch.id, serviceId: service.id, scheduledAt: slot.at }}
          onTaken={() => setStep('slot')}
          onDone={(r) => {
            setResult(r);
            setStep('done');
          }}
        />
      )}

      {step === 'done' && result && (
        <>
          <div className="rounded-3xl bg-surface p-6 text-center shadow-xl">
            <CalendarCheck2 className="mx-auto size-12 text-emerald-600" />
            <h1 className="mt-3 text-2xl font-bold">¡Cita agendada!</h1>
            <p className="mt-1 text-sm text-muted">Guarde este enlace para ver o cancelar su cita. También se lo enviamos por mensaje si dejó su contacto.</p>
          </div>
          <AppointmentCard data={result} />
          <a href={result.manageUrl} className="block text-center text-sm font-medium text-primary hover:underline">
            Abrir mi cita
          </a>
        </>
      )}
    </Shell>
  );
}

function SlotPicker({ slug, branchId, serviceId, days, onPick }: { slug: string; branchId: string; serviceId: string; days: number; onPick: (s: { at: string; time: string; date: string }) => void }) {
  const availability = useQuery({
    queryKey: ['booking', slug, 'availability', branchId, serviceId],
    queryFn: () => api.public<AvailabilityDayDTO[]>(`/public/booking/${slug}/availability?branchId=${branchId}&serviceId=${serviceId}&days=${days}`),
    refetchInterval: 60_000,
  });
  const open = useMemo(() => (availability.data ?? []).filter((d) => d.slots.some((s) => s.available > 0)), [availability.data]);
  const [date, setDate] = useState('');
  const selected = open.find((d) => d.date === date) ?? open[0];

  if (availability.isLoading) return <Centered icon={<Loader2 className="size-8 animate-spin text-muted" />} title="Buscando horarios…" />;
  if (!open.length) return <Panel title="No hay horarios libres" text="Pruebe más adelante u otro servicio." />;

  return (
    <Panel title="Elija el día y la hora">
      <div className="gc-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Días">
        {open.map((d) => {
          const on = d.date === selected?.date;
          const noon = new Date(`${d.date}T12:00:00Z`);
          const weekday = noon.toLocaleDateString('es', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
          const month = noon.toLocaleDateString('es', { month: 'short', timeZone: 'UTC' }).replace('.', '');
          return (
            <button
              key={d.date}
              type="button"
              aria-pressed={on}
              onClick={() => setDate(d.date)}
              className={cx('flex min-w-20 shrink-0 flex-col items-center rounded-2xl border px-3 py-2 transition', on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
            >
              <span className="text-xs capitalize opacity-80">{weekday}</span>
              <span className="text-lg font-bold">{Number(d.date.slice(8))}</span>
              <span className="text-xs opacity-80">{month}</span>
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {selected.slots.map((s) => (
            <button
              key={s.at}
              type="button"
              disabled={s.available <= 0}
              onClick={() => onPick({ at: s.at, time: s.time, date: selected.date })}
              className="h-12 rounded-xl border border-border bg-surface text-base font-semibold tabular-nums transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted disabled:line-through"
            >
              {s.time}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CustomerStep({
  slug,
  booking,
  tenant,
  body,
  onDone,
  onTaken,
}: {
  slug: string;
  booking: BookingPageDTO['booking'];
  tenant: BookingPageDTO['tenant'];
  body: { branchId: string; serviceId: string; scheduledAt: string };
  onDone: (r: BookingResultDTO) => void;
  onTaken: () => void;
}) {
  const [form, setForm] = useState({ name: '', document: '', phone: '', email: '' });
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () => api.public<BookingResultDTO>(`/public/booking/${slug}`, { ...body, customer: Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())) }),
    onSuccess: onDone,
    onError: (e) => {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409 && /ocup|disponible/.test(e.message)) setTimeout(onTaken, 1800);
    },
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    send.mutate();
  };
  return (
    <Panel title="Sus datos">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre y apellido">
          <Input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        {booking.requireDocument && (
          <Field label="Documento" hint="Con él se presenta al llegar.">
            <Input required inputMode="numeric" maxLength={30} value={form.document} onChange={(e) => set('document', e.target.value)} />
          </Field>
        )}
        <Field label={booking.requirePhone ? 'Celular' : 'Celular (opcional)'} hint="Para la confirmación y el recordatorio.">
          <Input type="tel" required={booking.requirePhone} autoComplete="tel" maxLength={30} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={booking.requireEmail ? 'Correo' : 'Correo (opcional)'}>
          <Input type="email" required={booking.requireEmail} autoComplete="email" maxLength={200} value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <Button type="submit" className="h-12 w-full text-base" loading={send.isPending}>
          Confirmar la cita
        </Button>
        {booking.cancelUntilHours > 0 && <p className="text-center text-xs text-muted">Puede cancelarla desde su enlace hasta {booking.cancelUntilHours} h antes.</p>}
        <PrivacyNotice notice={tenant.privacyNotice} organization={tenant.name} intro="Al confirmar, sus datos se usan según el" label="aviso de privacidad" />
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function Shell({ brand, children }: { brand?: { name: string; logoUrl: string | null; color: string }; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg pb-12 text-fg" style={brand ? { ['--gc-primary' as string]: brand.color } : undefined}>
      <header className="px-6 pt-8 pb-16 text-center text-white" style={{ background: brand?.color ?? 'var(--gc-primary)' }}>
        {brand?.logoUrl ? <img src={assetUrl(brand.logoUrl)} alt={brand.name} className="mx-auto h-11 max-w-[60%] object-contain" /> : <p className="text-xl font-bold">{brand?.name ?? ''}</p>}
        <p className="mt-1 text-sm opacity-85">Reserva de citas</p>
      </header>
      <main className="mx-auto -mt-10 max-w-lg space-y-4 px-4">{children}</main>
    </div>
  );
}

function Panel({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <section className="rounded-3xl bg-surface p-5 shadow-xl sm:p-6">
      <h1 className="text-xl font-bold">{title}</h1>
      {text && <p className="mt-1 text-sm whitespace-pre-line text-muted">{text}</p>}
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

function Option({ title, text, onClick, accent, icon }: { title: string; text?: string; onClick: () => void; accent?: string; icon?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-primary hover:bg-primary/5">
      {icon ? <span className="text-primary">{icon}</span> : <span className="size-3 shrink-0 rounded-full" style={{ background: accent }} />}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {text && <span className="block text-sm text-muted">{text}</span>}
      </span>
      <ChevronRight className="size-5 text-muted" />
    </button>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 font-medium shadow-sm">
      <Clock className="size-3.5 text-primary" />
      <span className="first-letter:uppercase">{children}</span>
    </span>
  );
}

export function Centered({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="rounded-3xl bg-surface p-8 text-center shadow-xl">
      <div className="flex justify-center">{icon}</div>
      <h1 className="mt-3 text-xl font-bold">{title}</h1>
      {text && <p className="mt-1 text-sm text-muted">{text}</p>}
    </div>
  );
}
