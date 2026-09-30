import { useQuery } from '@tanstack/react-query';
import { Maximize, Volume2, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { RT, type CallDTO, type DisplayBootstrapDTO, type DisplayConfig, type PublicTenantDTO } from '@gc/shared';
import { cx } from '../../components/ui';
import { ApiError, api, assetUrl } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { connectSocket } from '../../lib/socket';
import { fontStack, loadFont, setCustomCss } from '../../lib/theme';
import { BackgroundMusic } from './BackgroundMusic';
import { MediaPlayer } from './MediaPlayer';
import { useAnnouncer } from './useAnnouncer';

/** Tamaño tipográfico relativo a la altura de la pantalla, afectado por la escala configurada. */
const fs = (vh: number): CSSProperties => ({ fontSize: `calc(${vh}vh * var(--d-scale, 1))` });
/** Igual que `fs`, con la escala propia del llamado actual o del historial. */
const fsCall = (vh: number): CSSProperties => ({ fontSize: `calc(${vh}vh * var(--d-scale, 1) * var(--d-call, 1))` });
const fsHist = (vh: number): CSSProperties => ({ fontSize: `calc(${vh}vh * var(--d-scale, 1) * var(--d-hist, 1))` });

/** Fondo de un panel según el estilo elegido (sólido, vidrio o solo borde). */
function panel(theme: DisplayConfig['theme'], extra: CSSProperties = {}): CSSProperties {
  const base: CSSProperties =
    theme.panelStyle === 'glass'
      ? { background: `color-mix(in srgb, ${theme.panelBackground} 55%, transparent)`, backdropFilter: 'blur(1.6vh) saturate(1.3)', WebkitBackdropFilter: 'blur(1.6vh) saturate(1.3)' }
      : theme.panelStyle === 'outline'
        ? { background: 'transparent', boxShadow: `inset 0 0 0 0.25vh color-mix(in srgb, ${theme.text} 28%, transparent)` }
        : { background: theme.panelBackground };
  return { ...base, ...extra };
}

/** Clase de animación de un llamado nuevo. */
function callAnimationClass(config: DisplayConfig, flash: boolean) {
  const entry = { pop: 'gc-pop', slide: 'gc-slide-in', zoom: 'gc-zoom', flash: '', none: '' }[config.callAnimation];
  return cx(entry, flash && config.callAnimation !== 'none' && 'gc-flash');
}

export default function DisplayPage() {
  const { token = '' } = useParams();
  const query = useQuery({
    queryKey: ['display', token],
    queryFn: () => api.public<DisplayBootstrapDTO>(`/public/displays/${token}`),
    refetchInterval: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) || count < 1,
    retryDelay: 5000,
  });

  if (query.error && !query.data) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    return (
      <FullMessage
        title={status === 404 ? 'Pantalla no encontrada' : status === 403 ? 'Servicio suspendido' : 'Sin conexión con el servidor'}
        text={status === 404 ? 'Verifique el enlace de la pantalla en el panel de administración.' : 'Reintentando automáticamente…'}
        action={status === 404 ? { href: '/vincular?nuevo=1', label: 'Vincular este equipo con un código' } : undefined}
      />
    );
  }
  if (!query.data) return <FullMessage title="Gestión de Colas" text="Cargando pantalla…" />;
  return <DisplayScreen boot={query.data} token={token} refetch={() => void query.refetch()} />;
}

function FullMessage({ title, text, action }: { title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-slate-950 p-8 text-center text-white">
      <p className="text-4xl font-bold">{title}</p>
      <p className="mt-3 text-lg text-slate-400">{text}</p>
      {action && (
        <a href={action.href} className="mt-8 rounded-full bg-white px-6 py-3 text-lg font-semibold text-slate-900">
          {action.label}
        </a>
      )}
    </div>
  );
}

function useAudioUnlocked() {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      const nav = navigator as Navigator & { getAutoplayPolicy?: (type: string) => string };
      if (nav.getAutoplayPolicy) return nav.getAutoplayPolicy('mediaelement') === 'allowed';
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return true;
      const ctx = new Ctx();
      const running = ctx.state === 'running';
      void ctx.close();
      return running;
    } catch {
      return false;
    }
  });
  const unlock = () => {
    try {
      const Ctx = window.AudioContext;
      if (Ctx) void new Ctx().resume();
      // "Precalienta" la síntesis de voz dentro del gesto del usuario.
      if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
    } catch {
      /* ignorar */
    }
    setUnlocked(true);
  };
  return { unlocked, unlock };
}

function DisplayScreen({ boot, token, refetch }: { boot: DisplayBootstrapDTO; token: string; refetch: () => void }) {
  const [params] = useSearchParams();
  // Vista previa dentro del panel: sin audio para no molestar al administrador.
  const preview = params.get('preview') === '1';
  const config = useMemo<DisplayConfig>(() => {
    const cfg = boot.display.config;
    return preview ? { ...cfg, voice: { ...cfg.voice, enabled: false }, sound: { ...cfg.sound, enabled: false }, media: { ...cfg.media, muted: true } } : cfg;
  }, [boot.display.config, preview]);
  const { tenant, branch } = boot;
  const t = translator(tenant.locale, tenant.terminology);
  const [calls, setCalls] = useState<CallDTO[]>(boot.recentCalls);
  const [highlight, setHighlight] = useState<CallDTO | null>(null);
  const [online, setOnline] = useState(true);
  const { unlocked, unlock } = useAudioUnlocked();
  const { announce, speaking } = useAnnouncer(config, branch.name);
  const live = useRef({ config, announce, refetch });
  live.current = { config, announce, refetch };

  useEffect(() => setCalls(boot.recentCalls), [boot.recentCalls]);

  // Tiempo real: llamados y cambios de configuración.
  useEffect(() => {
    const socket = connectSocket('display', token);
    let wasConnected = false;
    socket.on('connect', () => {
      setOnline(true);
      if (wasConnected) live.current.refetch();
      wasConnected = true;
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on(RT.ticketCalled, ({ call }: { call: CallDTO }) => {
      const cfg = live.current.config;
      if (cfg.services.length > 0 && !cfg.services.includes(call.serviceId)) return;
      setCalls((prev) => [call, ...prev.filter((c) => c.ticketId !== call.ticketId)].slice(0, cfg.historySize + 1));
      setHighlight(call);
      live.current.announce(call);
    });
    socket.on(RT.displayConfig, () => live.current.refetch());
    socket.on(RT.tenantSettings, () => live.current.refetch());
    return () => {
      socket.close();
    };
  }, [token]);

  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), config.callHighlightSeconds * 1000);
    return () => clearTimeout(timer);
  }, [highlight, config.callHighlightSeconds]);

  // Tipografía, CSS propio, pantalla siempre encendida y título.
  useEffect(() => {
    loadFont(config.theme.fontFamily);
    if (config.theme.numberFontFamily) loadFont(config.theme.numberFontFamily);
    setCustomCss('gc-display-css', config.customCss);
    document.title = `${config.title || boot.display.name} · ${tenant.name}`;
    return () => setCustomCss('gc-display-css', '');
  }, [config.theme.fontFamily, config.theme.numberFontFamily, config.customCss, config.title, boot.display.name, tenant.name]);

  useEffect(() => {
    if (preview) return;
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    const request = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    void request();
    const onVisible = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [preview]);

  const playlistItems = useMemo(() => boot.playlist?.items ?? [], [boot.playlist]);
  const idle = useIdleCursor();
  const theme = config.theme;
  const overlay = `rgb(0 0 0 / ${theme.backgroundOverlay})`;
  const style = {
    '--d-scale': theme.fontScale,
    '--d-call': theme.callScale,
    '--d-hist': theme.historyScale,
    '--d-radius': `${theme.radius}vh`,
    '--d-num-font': fontStack(theme.numberFontFamily || theme.fontFamily),
    background: theme.backgroundImageUrl
      ? `linear-gradient(${overlay}, ${overlay}), url("${assetUrl(theme.backgroundImageUrl).replace(/["\\\n]/g, '')}") center / cover no-repeat, ${theme.background}`
      : theme.background,
    color: theme.text,
    fontFamily: fontStack(theme.fontFamily),
  } as CSSProperties;

  // Con música ambiental, la publicidad se reproduce sin sonido para no superponerse.
  const musicOn = config.music.enabled && boot.music.length > 0;
  const mediaSettings = useMemo(() => (musicOn ? { ...config.media, muted: true } : config.media), [config.media, musicOn]);
  const media = (
    <MediaPlayer
      items={playlistItems}
      settings={mediaSettings}
      ducked={speaking}
      audioUnlocked={unlocked}
      fallback={<MediaFallback tenant={tenant} />}
    />
  );

  const props: LayoutProps = { config, tenant, t, calls, highlight, media };

  return (
    <div
      className={cx('gc-display relative h-screen w-screen overflow-hidden select-none', idle && 'cursor-none')}
      style={style}
      onClick={() => !unlocked && unlock()}
    >
      {config.layout === 'fullscreen' ? <FullscreenLayout {...props} /> : config.layout === 'tickets' ? <TicketsLayout {...props} /> : <SplitLayout {...props} />}

      <ScreenQr config={config} />

      <BackgroundMusic
        tracks={boot.music}
        volume={config.music.volume}
        shuffle={config.music.shuffle}
        ducked={speaking}
        duckVolume={config.media.duckVolume}
        enabled={musicOn && unlocked && !preview}
      />

      {!unlocked && (config.voice.enabled || config.sound.enabled || musicOn) && (
        <button
          type="button"
          onClick={unlock}
          className="absolute inset-x-0 bottom-[12vh] mx-auto flex w-fit items-center gap-3 rounded-full bg-black/70 px-6 py-3 text-lg font-semibold text-white shadow-2xl backdrop-blur"
        >
          <Volume2 className="size-6" /> {t('display.start')}
        </button>
      )}
      {!online && (
        <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-sm font-medium text-white">
          <WifiOff className="size-4" /> Reconectando…
        </div>
      )}
      {!idle && !preview && (
        <button
          type="button"
          aria-label="Pantalla completa"
          onClick={(e) => {
            e.stopPropagation();
            unlock();
            void document.documentElement.requestFullscreen?.().catch(() => undefined);
          }}
          className="absolute top-3 right-3 rounded-full bg-black/50 p-2.5 text-white hover:bg-black/70"
        >
          <Maximize className="size-5" />
        </button>
      )}
    </div>
  );
}

function useIdleCursor(delay = 4000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), delay);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), delay);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, [delay]);
  return idle;
}

/* ------------------------------------------------------------------ */
/* Piezas comunes                                                      */
/* ------------------------------------------------------------------ */

interface LayoutProps {
  config: DisplayConfig;
  tenant: PublicTenantDTO;
  t: ReturnType<typeof translator>;
  calls: CallDTO[];
  highlight: CallDTO | null;
  media: ReactNode;
}

function Clock({ tenant, config, className }: { tenant: PublicTenantDTO; config: DisplayConfig; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const showDate = config.showDate;
  const locale = tenant.locale === 'pt' ? 'pt-BR' : tenant.locale;
  const tz = tenant.timezone && tenant.timezone !== 'UTC' ? tenant.timezone : undefined;
  // En formato de 12 h, «a. m./p. m.» va más chico para no quitarle lugar al nombre.
  const parts = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: config.showSeconds ? '2-digit' : undefined,
    hour12: config.clockFormat === '12h',
    timeZone: tz,
  }).formatToParts(now);
  const time = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  return (
    <div className={cx('shrink-0 text-right leading-tight', className)}>
      <p className="font-bold tabular-nums" style={fs(5)}>
        {time}
        {period && (
          <span className="ml-[0.6vh] font-semibold opacity-80" style={fs(2.2)}>
            {period}
          </span>
        )}
      </p>
      {showDate && (
        <p className="opacity-75 first-letter:uppercase" style={fs(1.9)}>
          {date}
        </p>
      )}
    </div>
  );
}

function Logo({ tenant, className }: { tenant: PublicTenantDTO; className?: string }) {
  if (tenant.branding.logoUrl) {
    return <img src={assetUrl(tenant.branding.logoUrl)} alt={tenant.name} className={cx('max-h-[8vh] max-w-[40%] object-contain', className)} />;
  }
  return (
    <p className={cx('line-clamp-2 min-w-0 leading-tight font-extrabold break-words', className)} style={fs(tenant.branding.appName.length > 18 ? 2.8 : 3.4)}>
      {tenant.branding.appName}
    </p>
  );
}

function MediaFallback({ tenant }: { tenant: PublicTenantDTO }) {
  const { branding } = tenant;
  return (
    <div
      className="flex size-full flex-col items-center justify-center gap-[3vh] p-[5%] text-center text-white"
      style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.accentColor})` }}
    >
      {branding.logoUrl && <img src={assetUrl(branding.logoUrl)} alt="" className="max-h-[22vh] max-w-[60%] object-contain drop-shadow-xl" />}
      <p className="font-extrabold drop-shadow" style={fs(7)}>
        {branding.appName}
      </p>
    </div>
  );
}

function PriorityTag({ call, config }: { call: CallDTO; config: DisplayConfig }) {
  if (call.priorityWeight <= 0) return null;
  return (
    <span className="inline-block rounded-full px-[1.2vh] py-[0.3vh] font-bold uppercase" style={{ ...fs(1.8), background: config.theme.priorityColor, color: '#111827' }}>
      {call.priority}
    </span>
  );
}

function CurrentCall({ call, config, t, flash, big = false }: { call: CallDTO | undefined; config: DisplayConfig; t: LayoutProps['t']; flash: boolean; big?: boolean }) {
  const theme = config.theme;
  if (!call) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-[var(--d-radius)] p-[3vh] text-center opacity-70" style={panel(theme, fs(2.6))}>
        {t('display.waitingCalls')}
      </div>
    );
  }
  return (
    <div
      key={`${call.ticketId}:${call.callCount}`}
      className={cx('flex flex-col justify-center rounded-[var(--d-radius)] p-[3vh] text-center shadow-2xl', callAnimationClass(config, flash))}
      style={{ background: theme.callBackground, color: theme.callText }}
    >
      <p className="font-semibold tracking-[0.3em] uppercase opacity-80" style={fsCall(2.1)}>
        {t('display.nowCalling')}
      </p>
      <p className="gc-num my-[1vh] leading-none font-black tracking-tight" style={fsCall(big ? 22 : 13)}>
        {call.code}
      </p>
      {call.customerName && (
        <p className="truncate font-semibold" style={fsCall(big ? 4 : 3)}>
          {call.customerName}
        </p>
      )}
      <p className="font-bold" style={fsCall(big ? 6 : 4.2)}>
        {call.counter}
      </p>
      <p className="mt-[0.6vh] opacity-80" style={fsCall(big ? 2.8 : 2.2)}>
        {call.service}
      </p>
      <div className="mt-[1vh]">
        <PriorityTag call={call} config={config} />
      </div>
    </div>
  );
}

function HistoryList({ calls, config, t }: { calls: CallDTO[]; config: DisplayConfig; t: LayoutProps['t'] }) {
  if (!config.showHistory || calls.length === 0) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-[1vh] font-semibold tracking-widest uppercase opacity-70" style={fs(1.8)}>
        {t('display.history')}
      </p>
      {/* Filas de igual alto: siempre caben todos los ítems del historial configurado. */}
      <ul className="grid min-h-0 flex-1 gap-[1vh] overflow-hidden" style={{ gridTemplateRows: `repeat(${config.historySize}, minmax(0, 1fr))` }}>
        {calls.slice(0, config.historySize).map((call) => (
          <li
            key={`${call.ticketId}:${call.callCount}`}
            className="gc-fade-in flex min-h-0 items-center justify-between gap-[1.5vh] overflow-hidden rounded-[calc(var(--d-radius)*0.7)] px-[2vh] py-[0.6vh]"
            style={panel(config.theme, { borderLeft: `0.7vh solid ${call.serviceColor}` })}
          >
            <span className="gc-num font-black tabular-nums" style={fsHist(4.2)}>
              {call.code}
            </span>
            <span className="min-w-0 text-right">
              <span className="block truncate font-semibold" style={fsHist(2.5)}>
                {call.counter}
              </span>
              <span className="block truncate opacity-70" style={fsHist(1.7)}>
                {call.service}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ticker({ config }: { config: DisplayConfig }) {
  const { ticker } = config;
  const content = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(30);
  const text = useMemo(() => ticker.messages.filter(Boolean).join('   •   '), [ticker.messages]);
  useEffect(() => {
    const width = content.current?.scrollWidth ?? 0;
    if (width > 0) setDuration(Math.max(8, width / 2 / ticker.speed));
  }, [text, ticker.speed]);
  if (!ticker.enabled || !text) return null;
  return (
    <div className="relative shrink-0 overflow-hidden py-[1.1vh] font-semibold whitespace-nowrap" style={{ background: ticker.background, color: ticker.color, ...fs(2.8) }}>
      <div ref={content} className="inline-flex" style={{ animation: `gc-marquee ${duration}s linear infinite` }}>
        <span className="px-[4vw]">{text}</span>
        <span className="px-[4vw]" aria-hidden>
          {text}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diseños                                                             */
/* ------------------------------------------------------------------ */

function SplitLayout({ config, tenant, t, calls, highlight, media }: LayoutProps) {
  const sidebar = (
    <aside className="flex min-h-0 flex-col gap-[2.2vh] p-[2.5vh]" style={{ width: `${config.sidebarWidth}%` }}>
      <header className="flex items-center justify-between gap-[2vh]">
        {config.showLogo ? <Logo tenant={tenant} /> : <span />}
        {config.showClock && <Clock tenant={tenant} config={config} />}
      </header>
      {config.title && (
        <p className="truncate font-semibold opacity-80" style={fs(2.4)}>
          {config.title}
        </p>
      )}
      <CurrentCall call={calls[0]} config={config} t={t} flash={Boolean(highlight && highlight.ticketId === calls[0]?.ticketId)} />
      <HistoryList calls={calls.slice(1)} config={config} t={t} />
    </aside>
  );
  return (
    <div className="flex h-full flex-col">
      <div className={cx('flex min-h-0 flex-1', config.sidebarPosition === 'left' && 'flex-row-reverse')}>
        <div className="min-w-0 flex-1">{media}</div>
        {sidebar}
      </div>
      <Ticker config={config} />
    </div>
  );
}

function FullscreenLayout({ config, tenant, t, calls, highlight, media }: LayoutProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {media}
        {highlight && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-[4vh] backdrop-blur-sm">
            <div className="w-[min(90vw,110vh)]">
              <CurrentCall call={highlight} config={config} t={t} flash big />
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-[3vh] px-[3vh] py-[1.6vh]" style={panel(config.theme)}>
        {config.showLogo && <Logo tenant={tenant} className="max-w-[18%]" />}
        <div className="flex min-w-0 flex-1 gap-[1.6vh] overflow-hidden [mask-image:linear-gradient(to_right,black_88%,transparent)]">
          {calls.slice(0, config.historySize).map((call, i) => (
            <div
              key={`${call.ticketId}:${call.callCount}`}
              className="gc-fade-in flex shrink-0 items-baseline gap-[1.2vh] rounded-[calc(var(--d-radius)*0.6)] px-[1.8vh] py-[0.8vh]"
              style={i === 0 ? { background: config.theme.callBackground, color: config.theme.callText } : { background: 'rgba(255,255,255,0.06)' }}
            >
              <span className="gc-num font-black tabular-nums" style={fsHist(i === 0 ? 4.6 : 3.4)}>
                {call.code}
              </span>
              <span className="font-semibold opacity-85" style={fsHist(i === 0 ? 2.6 : 2.1)}>
                {call.counter}
              </span>
            </div>
          ))}
        </div>
        {config.showClock && <Clock tenant={tenant} config={config} />}
      </div>
      <Ticker config={config} />
    </div>
  );
}

function TicketsLayout({ config, tenant, t, calls, highlight }: LayoutProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-[3vh] px-[4vh] py-[2vh]" style={panel(config.theme)}>
        {config.showLogo ? <Logo tenant={tenant} /> : <span />}
        {config.title && (
          <p className="truncate font-bold" style={fs(3.6)}>
            {config.title}
          </p>
        )}
        {config.showClock ? <Clock tenant={tenant} config={config} /> : <span />}
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[1.1fr_1fr] gap-[3vh] p-[3vh]">
        <CurrentCall call={calls[0]} config={config} t={t} flash={Boolean(highlight && highlight.ticketId === calls[0]?.ticketId)} big />
        <div className="flex min-h-0 flex-col">
          <p className="mb-[1.5vh] font-semibold tracking-widest uppercase opacity-70" style={fs(2.2)}>
            {t('display.history')}
          </p>
          {/* Filas de alto fijo: las tarjetas no se estiran cuando hay pocos llamados. */}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-[1.6vh]" style={{ gridTemplateRows: `repeat(${Math.ceil(config.historySize / 2)}, minmax(0, 1fr))` }}>
            {calls.slice(1, config.historySize + 1).map((call) => (
              <div
                key={`${call.ticketId}:${call.callCount}`}
                className="gc-fade-in flex flex-col justify-center rounded-[calc(var(--d-radius)*0.8)] px-[2.4vh]"
                style={panel(config.theme, { borderTop: `0.7vh solid ${call.serviceColor}` })}
              >
                <span className="gc-num font-black tabular-nums" style={fsHist(6)}>
                  {call.code}
                </span>
                <span className="truncate font-semibold" style={fsHist(2.8)}>
                  {call.counter}
                </span>
                <span className="truncate opacity-70" style={fsHist(1.8)}>
                  {call.service}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Ticker config={config} />
    </div>
  );
}

/** Código QR en una esquina: fila virtual, encuesta, WhatsApp... */
function ScreenQr({ config }: { config: DisplayConfig }) {
  const { qr } = config;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!qr.enabled || !qr.url) return setSrc(null);
    let alive = true;
    void import('qrcode')
      .then((m) => m.default.toDataURL(qr.url, { width: 480, margin: 1 }))
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [qr.enabled, qr.url]);
  if (!src) return null;
  const tickerOn = config.ticker.enabled && config.ticker.messages.some(Boolean);
  const vertical = qr.position.startsWith('top') ? { top: '2.5vh' } : { bottom: tickerOn ? '8vh' : '2.5vh' };
  const horizontal = qr.position.endsWith('left') ? { left: '2.5vh' } : { right: '2.5vh' };
  return (
    <div
      className="absolute z-10 flex items-center gap-[1.6vh] rounded-[var(--d-radius)] bg-white p-[1.2vh] pr-[2vh] text-slate-900 shadow-2xl"
      style={{ ...vertical, ...horizontal }}
    >
      <img src={src} alt="" className="size-[14vh]" />
      {qr.label && (
        <p className="max-w-[22vh] leading-tight font-bold" style={fs(2.2)}>
          {qr.label}
        </p>
      )}
    </div>
  );
}
