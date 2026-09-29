import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2, Maximize, Printer, Smartphone, Star, Users } from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  RT,
  type CustomerField,
  type IssuedTicketDTO,
  type KioskBootstrapDTO,
  type PriorityDTO,
} from '@gc/shared';
import { ServiceIcon } from '../../components/ServiceIcon';
import { cx } from '../../components/ui';
import { ApiError, api, assetUrl, errorMessage } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { connectSocket } from '../../lib/socket';
import { fontStack, loadFont, readableOn, setCustomCss } from '../../lib/theme';
import { printTicket } from './printTicket';

type Service = KioskBootstrapDTO['services'][number];
type Step =
  | { name: 'services' }
  | { name: 'priority'; service: Service }
  | { name: 'form'; service: Service; priority: PriorityDTO | null }
  | { name: 'issuing' }
  | { name: 'done'; result: IssuedTicketDTO; qr: string | null; service: Service; priority: PriorityDTO | null }
  | { name: 'error'; message: string };

export default function KioskPage() {
  const { token = '' } = useParams();
  const query = useQuery({
    queryKey: ['kiosk', token],
    queryFn: () => api.public<KioskBootstrapDTO>(`/public/kiosks/${token}`),
    refetchInterval: 60_000,
  });

  if (query.error && !query.data) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-100 p-8 text-center">
        <p className="text-3xl font-bold">{status === 404 ? 'Kiosco no encontrado' : 'Sin conexión'}</p>
        <p className="mt-2 text-slate-500">{status === 404 ? 'Verifique el enlace en el panel.' : 'Reintentando…'}</p>
        {status === 404 && (
          <a href="/vincular?nuevo=1" className="mt-6 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white">
            Vincular este equipo con un código
          </a>
        )}
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <Loader2 className="size-10 animate-spin text-slate-400" />
      </div>
    );
  }
  return <Kiosk boot={query.data} token={token} refetch={() => void query.refetch()} />;
}

function Kiosk({ boot, token, refetch }: { boot: KioskBootstrapDTO; token: string; refetch: () => void }) {
  const { kiosk, tenant, services, priorities, departments, customerFields } = boot;
  const config = kiosk.config;
  const theme = config.theme;
  const t = translator(tenant.locale, tenant.terminology);
  const [params] = useSearchParams();
  const mobile = useMemo(() => params.get('modo') === 'movil' || window.matchMedia('(max-width: 640px)').matches, [params]);
  const [step, setStep] = useState<Step>({ name: 'services' });
  const reset = useCallback(() => setStep({ name: 'services' }), []);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    loadFont(theme.fontFamily);
    setCustomCss('gc-kiosk-css', config.customCss);
    document.title = `${kiosk.name} · ${tenant.name}`;
    return () => setCustomCss('gc-kiosk-css', '');
  }, [theme.fontFamily, config.customCss, kiosk.name, tenant.name]);

  // Configuración y cantidad de personas en espera en tiempo real.
  useEffect(() => {
    const socket = connectSocket('kiosk', token);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refetchRef.current(), 1500);
    };
    socket.on(RT.kioskConfig, () => refetchRef.current());
    socket.on(RT.tenantSettings, () => refetchRef.current());
    socket.on(RT.ticketUpdated, soon);
    return () => {
      clearTimeout(timer);
      socket.close();
    };
  }, [token]);

  // Vuelve al inicio si nadie interactúa en los pasos intermedios.
  useEffect(() => {
    if (step.name !== 'priority' && step.name !== 'form' && step.name !== 'error') return;
    let timer = setTimeout(reset, 45_000);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(reset, 45_000);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [step.name, reset]);

  const normal = useMemo(() => [...priorities].sort((a, b) => a.weight - b.weight)[0] ?? null, [priorities]);
  const preferential = useMemo(() => priorities.find((p) => p.weight > 0) ?? null, [priorities]);
  const askFields = useMemo(
    () => config.askFields.map((key) => customerFields.find((f) => f.key === key)).filter((f): f is CustomerField => Boolean(f)),
    [config.askFields, customerFields],
  );

  async function issue(service: Service, priority: PriorityDTO | null, customer: Record<string, string> = {}) {
    setStep({ name: 'issuing' });
    try {
      const result = await api.public<IssuedTicketDTO>(`/public/kiosks/${token}/tickets`, {
        serviceId: service.id,
        priorityId: priority?.id ?? null,
        customer,
        channel: mobile ? 'mobile' : 'kiosk',
      });
      const trackingUrl = `${window.location.origin}/t/${result.ticket.publicToken}`;
      const qr = config.showQr ? await QRCode.toDataURL(trackingUrl, { width: 360, margin: 1 }).catch(() => null) : null;
      setStep({ name: 'done', result: { ...result, trackingUrl }, qr, service, priority });
      if (config.print.enabled && !mobile) {
        const now = new Date(result.ticket.createdAt);
        const locale = tenant.locale === 'pt' ? 'pt-BR' : tenant.locale;
        void printTicket(config.print, {
          qrDataUrl: qr,
          logoUrl: tenant.branding.logoUrl ? assetUrl(tenant.branding.logoUrl) : null,
          vars: {
            code: result.ticket.code,
            service: service.name,
            priority: priority && priority.weight > 0 ? priority.name : '',
            branch: boot.branch.name,
            organization: tenant.name,
            date: now.toLocaleDateString(locale),
            time: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
            waiting: result.waitingAhead,
            customer: customer.name ?? '',
            trackingUrl,
          },
        }).catch(() => undefined);
      }
      refetch();
    } catch (error) {
      setStep({ name: 'error', message: errorMessage(error) || t('kiosk.error') });
    }
  }

  function chooseService(service: Service) {
    if (config.priorityMode === 'none' || priorities.length <= 1) return next(service, normal);
    setStep({ name: 'priority', service });
  }

  function next(service: Service, priority: PriorityDTO | null) {
    if (askFields.length > 0) setStep({ name: 'form', service, priority });
    else void issue(service, priority);
  }

  // Vuelta automática al inicio tras emitir (en el celular el cliente decide).
  useEffect(() => {
    if (step.name !== 'done' || mobile) return;
    const timer = setTimeout(reset, config.returnSeconds * 1000);
    return () => clearTimeout(timer);
  }, [step, mobile, config.returnSeconds, reset]);

  const style = {
    background: theme.background,
    color: theme.text,
    fontFamily: fontStack(theme.fontFamily),
    fontSize: `${16 * theme.fontScale}px`,
    '--k-btn': theme.buttonBackground,
    '--k-btn-fg': theme.buttonText,
    '--k-pri': theme.priorityButtonBackground,
  } as CSSProperties;

  return (
    <div className="gc-kiosk flex min-h-screen flex-col select-none" style={style}>
      <header className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-10">
        {tenant.branding.logoUrl ? (
          <img src={assetUrl(tenant.branding.logoUrl)} alt={tenant.name} className="h-12 max-w-[50%] object-contain sm:h-16" />
        ) : (
          <p className="text-2xl font-extrabold">{tenant.branding.appName}</p>
        )}
        <div className="flex items-center gap-3 text-right">
          <div className="hidden sm:block">
            <p className="font-semibold">{boot.branch.name}</p>
          </div>
          {!mobile && (
            <button
              type="button"
              aria-label="Pantalla completa"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
              className="rounded-full p-2 opacity-40 hover:opacity-100"
            >
              <Maximize className="size-5" />
            </button>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col px-6 py-8 sm:px-10">
        {step.name === 'services' && (
          <ServicesStep
            services={services}
            departments={departments}
            config={config}
            t={t}
            onChoose={chooseService}
          />
        )}
        {step.name === 'priority' && (
          <StepFrame title={t('kiosk.choosePriority')} subtitle={step.service.name} onBack={reset} t={t}>
            {config.priorityMode === 'list' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {priorities.map((p) => (
                  <BigButton key={p.id} onClick={() => next(step.service, p)} background={p.weight > 0 ? theme.priorityButtonBackground : theme.buttonBackground}>
                    {p.weight > 0 && <Star className="size-8" />}
                    <span>
                      <span className="block text-[1.6em] font-bold">{p.name}</span>
                      {p.description && <span className="block text-[0.95em] opacity-85">{p.description}</span>}
                    </span>
                  </BigButton>
                ))}
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <BigButton onClick={() => next(step.service, normal)} background={theme.buttonBackground}>
                  <Users className="size-10" />
                  <span className="text-[1.7em] font-bold">{t('kiosk.normal')}</span>
                </BigButton>
                {preferential && (
                  <BigButton onClick={() => next(step.service, preferential)} background={theme.priorityButtonBackground}>
                    <Star className="size-10" />
                    <span>
                      <span className="block text-[1.7em] font-bold">{t('kiosk.preferential')}</span>
                      <span className="block text-[0.95em] opacity-85">{preferential.description || t('kiosk.preferentialHint')}</span>
                    </span>
                  </BigButton>
                )}
              </div>
            )}
          </StepFrame>
        )}
        {step.name === 'form' && (
          <StepFrame title={t('kiosk.yourData')} subtitle={step.service.name} onBack={reset} t={t}>
            <CustomerForm fields={askFields} t={t} onSubmit={(data) => void issue(step.service, step.priority, data)} />
          </StepFrame>
        )}
        {step.name === 'issuing' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <Loader2 className="size-16 animate-spin opacity-60" />
            <p className="text-[1.8em] font-semibold">{t('kiosk.issuing')}</p>
          </div>
        )}
        {step.name === 'done' && <DoneStep step={step} config={config} mobile={mobile} t={t} onDone={reset} />}
        {step.name === 'error' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <p className="max-w-xl text-[1.6em] font-semibold">{step.message}</p>
            <BigButton onClick={reset} background={theme.buttonBackground} className="w-auto px-12">
              {t('kiosk.back')}
            </BigButton>
          </div>
        )}
      </main>
    </div>
  );
}

function BigButton({
  children,
  onClick,
  background,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  background: string;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cx(
        'flex min-h-28 w-full items-center justify-center gap-5 rounded-3xl px-8 py-6 text-center shadow-lg transition active:scale-[0.98] hover:brightness-110',
        className,
      )}
      style={{ background, color: readableOn(background) }}
    >
      {children}
    </button>
  );
}

function StepFrame({ title, subtitle, onBack, t, children }: { title: string; subtitle?: string; onBack: () => void; t: ReturnType<typeof translator>; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
      <button type="button" onClick={onBack} className="mb-6 inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-[1.05em] font-medium opacity-70 hover:opacity-100">
        <ArrowLeft className="size-5" /> {t('kiosk.back')}
      </button>
      <h1 className="text-[2.2em] leading-tight font-extrabold">{title}</h1>
      {subtitle && <p className="mt-1 text-[1.2em] opacity-70">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

function ServicesStep({
  services,
  departments,
  config,
  t,
  onChoose,
}: {
  services: Service[];
  departments: KioskBootstrapDTO['departments'];
  config: KioskBootstrapDTO['kiosk']['config'];
  t: ReturnType<typeof translator>;
  onChoose: (s: Service) => void;
}) {
  const groups = useMemo(() => {
    if (!config.groupByDepartment) return [{ id: 'all', name: '', services }];
    const byDept = departments
      .map((d) => ({ id: d.id, name: d.name, services: services.filter((s) => s.departmentId === d.id) }))
      .filter((g) => g.services.length > 0);
    const orphan = services.filter((s) => !s.departmentId || !departments.some((d) => d.id === s.departmentId));
    return orphan.length ? [...byDept, { id: 'other', name: '', services: orphan }] : byDept;
  }, [config.groupByDepartment, departments, services]);

  const columns = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6' }[config.theme.columns] ?? 'sm:grid-cols-2';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      <div className="text-center">
        <h1 className="text-[2.6em] leading-tight font-extrabold">{config.title}</h1>
        {config.subtitle && <p className="mt-2 text-[1.3em] opacity-70">{config.subtitle}</p>}
      </div>
      {services.length === 0 ? (
        <p className="mt-16 text-center text-[1.4em] opacity-70">{t('kiosk.noServices')}</p>
      ) : (
        <div className="mt-10 space-y-10">
          {groups.map((group) => (
            <section key={group.id}>
              {group.name && <h2 className="mb-4 text-[1.4em] font-bold opacity-80">{group.name}</h2>}
              <div className={cx('grid gap-5', columns)}>
                {group.services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => onChoose(service)}
                    className="group flex min-h-32 items-center gap-5 rounded-3xl px-7 py-6 text-left shadow-lg transition active:scale-[0.98] hover:brightness-110"
                    style={{ background: config.theme.buttonBackground, color: config.theme.buttonText }}
                  >
                    <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white shadow-sm" style={{ color: service.color }}>
                      <ServiceIcon name={service.icon} className="size-8" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.5em] leading-tight font-bold">{service.name}</span>
                      {service.description && <span className="mt-1 block text-[0.95em] opacity-80">{service.description}</span>}
                    </span>
                    {config.showWaitingCount && (
                      <span className="shrink-0 rounded-full bg-black/15 px-3 py-1 text-[0.9em] font-semibold tabular-nums">
                        {service.waiting} {t('kiosk.waiting')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerForm({ fields, t, onSubmit }: { fields: CustomerField[]; t: ReturnType<typeof translator>; onSubmit: (data: Record<string, string>) => void }) {
  const [data, setData] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(Object.fromEntries(Object.entries(data).filter(([, v]) => v.trim() !== '')));
  };
  const inputType = (f: CustomerField) => (f.type === 'document' ? 'text' : f.type === 'select' ? 'text' : f.type);
  return (
    <form onSubmit={submit} className="space-y-5">
      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-2 block text-[1.15em] font-semibold">
            {field.label} {field.required && <span className="text-[0.8em] font-normal opacity-60">({t('kiosk.required')})</span>}
          </span>
          {field.type === 'select' ? (
            <select
              required={field.required}
              value={data[field.key] ?? ''}
              onChange={(e) => setData((d) => ({ ...d, [field.key]: e.target.value }))}
              className="h-16 w-full rounded-2xl border-2 border-black/10 bg-white px-5 text-[1.3em] text-slate-900 outline-none focus:border-[var(--k-btn)]"
            >
              <option value="" />
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={inputType(field)}
              inputMode={field.type === 'document' || field.type === 'number' ? 'numeric' : field.type === 'tel' ? 'tel' : undefined}
              required={field.required}
              placeholder={field.placeholder}
              value={data[field.key] ?? ''}
              onChange={(e) => setData((d) => ({ ...d, [field.key]: e.target.value }))}
              className="h-16 w-full rounded-2xl border-2 border-black/10 bg-white px-5 text-[1.3em] text-slate-900 outline-none focus:border-[var(--k-btn)]"
            />
          )}
        </label>
      ))}
      <button
        type="submit"
        className="mt-4 flex h-20 w-full items-center justify-center gap-3 rounded-3xl text-[1.5em] font-bold shadow-lg active:scale-[0.99]"
        style={{ background: 'var(--k-btn)', color: 'var(--k-btn-fg)' }}
      >
        <Check className="size-7" /> {t('kiosk.continue')}
      </button>
    </form>
  );
}

function DoneStep({
  step,
  config,
  mobile,
  t,
  onDone,
}: {
  step: Extract<Step, { name: 'done' }>;
  config: KioskBootstrapDTO['kiosk']['config'];
  mobile: boolean;
  t: ReturnType<typeof translator>;
  onDone: () => void;
}) {
  const { result, qr, service, priority } = step;
  return (
    <div className="gc-pop mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center text-center">
      <p className="text-[1.4em] font-semibold tracking-widest uppercase opacity-70">{t('kiosk.yourTicket')}</p>
      <p className="my-2 text-[6em] leading-none font-black tracking-tight sm:text-[8em]" style={{ color: config.theme.buttonBackground }}>
        {result.ticket.code}
      </p>
      <p className="text-[1.6em] font-bold">{service.name}</p>
      {priority && priority.weight > 0 && (
        <span className="mt-2 rounded-full px-4 py-1 font-bold" style={{ background: config.theme.priorityButtonBackground, color: readableOn(config.theme.priorityButtonBackground) }}>
          {priority.name}
        </span>
      )}
      {config.showWaitingCount && (
        <p className="mt-4 text-[1.3em]">
          {t('kiosk.waitingAhead')}: <strong className="tabular-nums">{result.waitingAhead}</strong>
        </p>
      )}
      {qr && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <img src={qr} alt="QR" className="size-44 rounded-2xl bg-white p-2 shadow" />
          <p className="max-w-sm text-[0.95em] opacity-75">{mobile ? t('kiosk.saveLink') : t('kiosk.scanToTrack')}</p>
        </div>
      )}
      {mobile ? (
        <Link
          to={`/t/${result.ticket.publicToken}`}
          className="mt-8 inline-flex items-center gap-3 rounded-3xl px-8 py-5 text-[1.3em] font-bold shadow-lg"
          style={{ background: 'var(--k-btn)', color: 'var(--k-btn-fg)' }}
        >
          <Smartphone className="size-6" /> {t('kiosk.openTracking')}
        </Link>
      ) : (
        <>
          {config.print.enabled && (
            <p className="mt-6 inline-flex items-center gap-2 text-[1.2em] font-medium opacity-80">
              <Printer className="size-6" /> {t('kiosk.takeTicket')}
            </p>
          )}
          <button
            type="button"
            onClick={onDone}
            className="mt-8 rounded-3xl px-12 py-5 text-[1.3em] font-bold shadow-lg"
            style={{ background: 'var(--k-btn)', color: 'var(--k-btn-fg)' }}
          >
            {t('kiosk.done')}
          </button>
        </>
      )}
    </div>
  );
}
