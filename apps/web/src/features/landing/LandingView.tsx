import { Check, ChevronDown, Clock, Mail, MapPin, Menu as MenuIcon, MessageCircle, Phone, Quote, Sparkles, Video, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  LANDING_SOCIALS,
  LANDING_SOCIAL_LABELS,
  LANDING_TEMPLATE_INFO,
  formatMoney,
  socialHref,
  toMinor,
  type LandingButton,
  type LandingPlanDTO,
  type LandingSection,
  type LandingSectionOf,
  type LandingSettings,
  type LandingTemplate,
  type PlatformBrand,
} from '@gc/shared';
import { initials } from '../../components/Avatar';
import { LegalFooter } from '../../components/legal/LegalFooter';
import { cx } from '../../components/ui';
import { assetUrl } from '../../lib/api';
import { fontStack, loadFont, readableOn } from '../../lib/theme';
import { LANDING_ICON_COMPONENTS } from './landingIcons';

/* ------------------------------------------------------------------ */
/* Estilo de cada plantilla                                             */
/* ------------------------------------------------------------------ */

type HeroStyle = 'mesh' | 'plain' | 'grid' | 'brand' | 'gradient';

export interface Look {
  bg: string;
  alt: string;
  fg: string;
  muted: string;
  border: string;
  hero: HeroStyle;
  /** Clases de las tarjetas. */
  card: string;
  radius: number;
  heading: string;
  /** Alterna el fondo de las secciones. */
  alternate: boolean;
  icon: 'soft' | 'gradient' | 'outline' | 'solid' | 'glow';
  pill: boolean;
  /** Título de la portada más grande. */
  bigTitle: boolean;
}

export const LANDING_LOOKS: Record<LandingTemplate, Look> = {
  moderna: {
    bg: '#ffffff',
    alt: '#f8fafc',
    fg: '#0f172a',
    muted: '#475569',
    border: 'rgba(15,23,42,0.08)',
    hero: 'mesh',
    card: 'border border-[var(--lp-border)] bg-white/75 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.12)] backdrop-blur',
    radius: 20,
    heading: 'font-extrabold tracking-tight',
    alternate: false,
    icon: 'gradient',
    pill: true,
    bigTitle: false,
  },
  clasica: {
    bg: '#ffffff',
    alt: '#f8fafc',
    fg: '#0f172a',
    muted: '#64748b',
    border: '#e2e8f0',
    hero: 'plain',
    card: 'border border-[var(--lp-border)] bg-[var(--lp-bg)]',
    radius: 12,
    heading: 'font-bold tracking-tight',
    alternate: true,
    icon: 'soft',
    pill: false,
    bigTitle: false,
  },
  minimalista: {
    bg: '#ffffff',
    alt: '#ffffff',
    fg: '#0a0a0a',
    muted: '#525252',
    border: '#e5e5e5',
    hero: 'plain',
    card: 'border-t border-[var(--lp-border)] pt-6',
    radius: 6,
    heading: 'font-semibold tracking-tighter',
    alternate: false,
    icon: 'outline',
    pill: false,
    bigTitle: true,
  },
  oscura: {
    bg: '#05070d',
    alt: '#0a0f1c',
    fg: '#e5e7eb',
    muted: '#94a3b8',
    border: 'rgba(255,255,255,0.09)',
    hero: 'grid',
    card: 'border border-[var(--lp-border)] bg-white/[0.03] backdrop-blur',
    radius: 16,
    heading: 'font-bold tracking-tight',
    alternate: true,
    icon: 'glow',
    pill: true,
    bigTitle: false,
  },
  corporativa: {
    bg: '#ffffff',
    alt: '#f1f5f9',
    fg: '#0f172a',
    muted: '#475569',
    border: '#e2e8f0',
    hero: 'brand',
    card: 'bg-white shadow-lg shadow-slate-900/[0.06] ring-1 ring-slate-900/[0.04]',
    radius: 8,
    heading: 'font-bold',
    alternate: true,
    icon: 'solid',
    pill: false,
    bigTitle: false,
  },
  vibrante: {
    bg: '#ffffff',
    alt: 'color-mix(in srgb, var(--lp-primary) 6%, #ffffff)',
    fg: '#111827',
    muted: '#4b5563',
    border: 'color-mix(in srgb, var(--lp-primary) 14%, #ffffff)',
    hero: 'gradient',
    card: 'border-2 border-[var(--lp-border)] bg-white transition-transform hover:-translate-y-1',
    radius: 24,
    heading: 'font-black tracking-tight',
    alternate: true,
    icon: 'gradient',
    pill: true,
    bigTitle: true,
  },
};

const RADIUS = { none: 0, sm: 6, md: 12, lg: 24 } as const;

export interface LandingContext {
  /** Registro y demo habilitados en la plataforma. */
  allowSignup: boolean;
  allowDemo: boolean;
  /** Dirección del panel cuando la presentación se abre desde su dominio propio. */
  appUrl: string | null;
  /** Vista previa del editor: los enlaces no navegan y las secciones vacías muestran una ayuda. */
  preview?: boolean;
}

/** Página de presentación con la plantilla y el contenido que armó el superadministrador. */
export function LandingView({ landing, brand, plans, ctx }: { landing: LandingSettings; brand: PlatformBrand; plans: LandingPlanDTO[]; ctx: LandingContext }) {
  const info = LANDING_TEMPLATE_INFO[landing.template];
  const look = LANDING_LOOKS[landing.template];
  const primary = landing.theme.primaryColor || brand.primaryColor;
  const accent = landing.theme.accentColor || info.accent;
  const font = landing.theme.font || info.font;
  const headingFont = landing.theme.headingFont || landing.theme.font || info.headingFont;
  const radius = landing.theme.radius === 'auto' ? look.radius : RADIUS[landing.theme.radius];
  const layout = landing.theme.heroLayout === 'auto' ? info.heroLayout : landing.theme.heroLayout;
  useEffect(() => {
    loadFont(font);
    loadFont(headingFont);
  }, [font, headingFont]);

  const style = {
    '--lp-primary': primary,
    '--lp-primary-fg': readableOn(primary),
    '--lp-accent': accent,
    '--lp-accent-fg': readableOn(accent),
    '--lp-bg': look.bg,
    '--lp-alt': look.alt,
    '--lp-fg': look.fg,
    '--lp-muted': look.muted,
    '--lp-border': look.border,
    '--lp-radius': `${radius}px`,
    '--lp-heading-font': fontStack(headingFont),
    fontFamily: fontStack(font),
  } as CSSProperties;

  const visible = landing.sections.filter((s) => s.enabled && (ctx.preview || hasContent(s, plans)));
  const name = brand.appName;

  // En la vista previa los enlaces no navegan (salvo las anclas de la misma página).
  const onClickCapture = ctx.preview
    ? (e: MouseEvent) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a && !a.getAttribute('href')?.startsWith('#')) e.preventDefault();
      }
    : undefined;

  return (
    <div className="min-h-screen bg-[var(--lp-bg)] text-[var(--lp-fg)] antialiased [&_:is(h1,h2,h3)]:[font-family:var(--lp-heading-font)]" style={style} onClickCapture={onClickCapture}>
      <Header landing={landing} brand={brand} look={look} ctx={ctx} sections={visible} />
      <Hero landing={landing} name={name} look={look} layout={layout} ctx={ctx} />
      {visible.map((section, i) => (
        <section
          key={section.id}
          id={section.id}
          className={cx('scroll-mt-20', section.type === 'cta' ? 'py-12 sm:py-16' : 'py-16 sm:py-24')}
          style={{ background: look.alternate && i % 2 === 0 ? 'var(--lp-alt)' : 'var(--lp-bg)' }}
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionBody section={section} look={look} plans={plans} ctx={ctx} name={name} />
          </div>
        </section>
      ))}
      <Footer landing={landing} brand={brand} look={look} />
    </div>
  );
}

/** Una sección sin elementos no se muestra en la página publicada. */
function hasContent(section: LandingSection, plans: LandingPlanDTO[]): boolean {
  switch (section.type) {
    case 'features':
    case 'steps':
    case 'stats':
    case 'testimonials':
    case 'logos':
    case 'faq':
      return section.items.length > 0;
    case 'pricing':
      return plans.some((p) => section.plans.includes(p.id));
    case 'contact':
      return Boolean(section.email || section.phone || section.whatsapp || section.address || section.hours);
    default:
      return true;
  }
}

/* ------------------------------------------------------------------ */
/* Botones                                                              */
/* ------------------------------------------------------------------ */

const PATHS = { signup: '/registro', demo: '/demo', login: '/login' } as const;

/** Dirección de un botón o `null` si esa opción está apagada (registro o demo). */
function hrefOf(button: LandingButton, ctx: LandingContext): string | null {
  if (button.action === 'url') return button.url || null;
  if (button.action === 'signup' && !ctx.allowSignup) return null;
  if (button.action === 'demo' && !ctx.allowDemo) return null;
  const path = PATHS[button.action];
  return ctx.appUrl ? `${ctx.appUrl}${path}` : path;
}

function SmartLink({ href, className, children, style }: { href: string; className?: string; children: ReactNode; style?: CSSProperties }) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link to={href} className={className} style={style}>
        {children}
      </Link>
    );
  }
  const external = /^https?:\/\//i.test(href);
  return (
    <a href={href} className={className} style={style} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'light' | 'outline-light';

function LpButton({ button, ctx, tone = 'primary', size = 'md', look, icon }: { button: LandingButton; ctx: LandingContext; tone?: ButtonTone; size?: 'md' | 'lg'; look: Look; icon?: ReactNode }) {
  const href = hrefOf(button, ctx);
  if (!href || !button.label) return null;
  const tones: Record<ButtonTone, string> = {
    primary: 'bg-[var(--lp-primary)] text-[var(--lp-primary-fg)] shadow-sm hover:brightness-110',
    secondary: 'border border-[color-mix(in_srgb,var(--lp-fg)_20%,transparent)] bg-[var(--lp-bg)] text-[var(--lp-fg)] hover:bg-[var(--lp-alt)]',
    ghost: 'text-[var(--lp-fg)] hover:bg-[color-mix(in_srgb,var(--lp-fg)_7%,transparent)]',
    light: 'bg-white text-slate-900 shadow-sm hover:bg-white/90',
    'outline-light': 'border border-white/40 text-white hover:bg-white/10',
  };
  return (
    <SmartLink
      href={href}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-[var(--lp-primary)] focus-visible:outline-none [&_svg]:size-5',
        size === 'lg' ? 'h-12 px-6 text-base' : 'h-10 px-4 text-sm',
        tones[tone],
      )}
      style={{ borderRadius: look.pill ? 999 : 'var(--lp-radius)' }}
    >
      {icon}
      {button.label}
    </SmartLink>
  );
}

/* ------------------------------------------------------------------ */
/* Encabezado                                                           */
/* ------------------------------------------------------------------ */

function Header({ landing, brand, look, ctx, sections }: { landing: LandingSettings; brand: PlatformBrand; look: Look; ctx: LandingContext; sections: LandingSection[] }) {
  const [open, setOpen] = useState(false);
  const nav = sections.filter((s) => s.navLabel);
  const { header } = landing;
  const login: LandingButton = { label: header.loginLabel, action: 'login', url: '' };
  const signup: LandingButton = { label: header.signupLabel, action: 'signup', url: '' };
  const demo: LandingButton = { label: header.demoLabel, action: 'demo', url: '' };
  const apiHref = ctx.appUrl ? `${ctx.appUrl}/api/docs` : '/api/docs';
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--lp-border)] bg-[color-mix(in_srgb,var(--lp-bg)_85%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="#inicio" className="flex min-w-0 items-center gap-2.5 text-base font-bold sm:text-lg xl:shrink-0">
          {brand.logoUrl ? (
            <img src={assetUrl(brand.logoUrl)} alt={brand.appName} className="h-9 max-w-44 min-w-0 object-contain" />
          ) : (
            <>
              <span className="grid size-9 shrink-0 place-items-center bg-[var(--lp-primary)] text-[var(--lp-primary-fg)]" style={{ borderRadius: 'var(--lp-radius)' }}>
                {brand.appName.charAt(0)}
              </span>
              <span className="truncate">{brand.appName}</span>
            </>
          )}
        </a>
        <nav className="ml-4 hidden items-center gap-0.5 xl:flex" aria-label="Secciones">
          {nav.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-md px-3 py-2 text-sm whitespace-nowrap text-[var(--lp-muted)] hover:text-[var(--lp-fg)]">
              {s.navLabel}
            </a>
          ))}
          {header.showApi && (
            <a href={apiHref} className="rounded-md px-3 py-2 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-fg)]">
              API
            </a>
          )}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="hidden sm:contents">
            <LpButton button={demo} ctx={ctx} tone="ghost" look={look} />
          </span>
          <LpButton button={login} ctx={ctx} tone={ctx.allowSignup ? 'ghost' : 'primary'} look={look} />
          <span className="hidden sm:contents">
            <LpButton button={signup} ctx={ctx} look={look} />
          </span>
          <button
            type="button"
            className="grid size-10 place-items-center rounded-md hover:bg-[color-mix(in_srgb,var(--lp-fg)_7%,transparent)] xl:hidden"
            aria-label={open ? 'Cerrar el menú' : 'Abrir el menú'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-[var(--lp-border)] bg-[var(--lp-bg)] px-4 py-3 xl:hidden">
          <nav className="flex flex-col" aria-label="Secciones">
            {nav.map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 text-[var(--lp-fg)] hover:bg-[var(--lp-alt)]">
                {s.navLabel}
              </a>
            ))}
            {header.showApi && (
              <a href={apiHref} className="rounded-md px-3 py-2.5 text-[var(--lp-fg)] hover:bg-[var(--lp-alt)]">
                Documentación de la API
              </a>
            )}
          </nav>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--lp-border)] pt-3 sm:hidden">
            <LpButton button={signup} ctx={ctx} look={look} />
            <LpButton button={demo} ctx={ctx} tone="secondary" look={look} />
          </div>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Portada                                                              */
/* ------------------------------------------------------------------ */

/** Título con la parte resaltada. */
function Title({ title, highlight, look, onColor }: { title: string; highlight: string; look: Look; onColor: boolean }) {
  const at = highlight ? title.indexOf(highlight) : -1;
  if (at < 0) return <>{title}</>;
  const gradient = look.icon === 'gradient' || look.icon === 'glow';
  const mark = onColor ? (
    <span className="underline decoration-[var(--lp-accent)] decoration-4 underline-offset-[0.18em]">{highlight}</span>
  ) : gradient ? (
    <span className="bg-gradient-to-r from-[var(--lp-primary)] to-[var(--lp-accent)] bg-clip-text text-transparent">{highlight}</span>
  ) : look.icon === 'outline' ? (
    <span className="italic">{highlight}</span>
  ) : (
    <span className="text-[var(--lp-primary)]">{highlight}</span>
  );
  return (
    <>
      {title.slice(0, at)}
      {mark}
      {title.slice(at + highlight.length)}
    </>
  );
}

function HeroBackground({ style }: { style: HeroStyle }) {
  if (style === 'mesh') {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-[var(--lp-primary)] opacity-[0.16] blur-3xl" />
        <div className="absolute -top-20 right-[-10rem] size-[30rem] rounded-full bg-[var(--lp-accent)] opacity-[0.16] blur-3xl" />
        <div className="absolute bottom-[-12rem] left-1/3 size-[28rem] rounded-full bg-sky-400 opacity-[0.10] blur-3xl" />
      </div>
    );
  }
  if (style === 'grid') {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.18] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.12) 1px, transparent 1px)', backgroundSize: '44px 44px' }}
        />
        <div className="absolute top-[-14rem] left-1/2 h-[28rem] w-[60rem] -translate-x-1/2 rounded-full bg-[var(--lp-accent)] opacity-25 blur-3xl" />
        <div className="absolute top-[-6rem] left-1/2 h-[18rem] w-[36rem] -translate-x-1/2 rounded-full bg-[var(--lp-primary)] opacity-30 blur-3xl" />
      </div>
    );
  }
  if (style === 'brand') return <div aria-hidden className="pointer-events-none absolute inset-0 bg-[var(--lp-primary)]" />;
  if (style === 'gradient') {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-br from-[var(--lp-primary)] to-[var(--lp-accent)]">
        <div className="absolute -right-24 -bottom-24 size-96 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute top-10 -left-16 size-72 rounded-full bg-white/10 blur-2xl" />
      </div>
    );
  }
  return null;
}

function Hero({ landing, name, look, layout, ctx }: { landing: LandingSettings; name: string; look: Look; layout: 'split' | 'centered'; ctx: LandingContext }) {
  const { hero } = landing;
  const onColor = look.hero === 'brand' || look.hero === 'gradient';
  const centered = layout === 'centered';
  const subtitle = hero.subtitle.replaceAll('{{nombre}}', name);
  const media =
    hero.media === 'image' && hero.imageUrl ? (
      <img src={assetUrl(hero.imageUrl)} alt="" className="w-full object-cover shadow-2xl" style={{ borderRadius: 'var(--lp-radius)' }} />
    ) : hero.media === 'none' ? null : (
      <ScreenMockup look={look} />
    );
  const login: LandingButton = { label: 'Ingrese aquí', action: 'login', url: '' };
  const loginHref = hrefOf(login, ctx)!;
  return (
    <section id="inicio" className={cx('relative isolate', onColor && 'text-white')} style={onColor ? ({ '--lp-muted': 'rgba(255,255,255,0.82)' } as CSSProperties) : undefined}>
      <HeroBackground style={look.hero} />
      <div className={cx('relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6', centered ? 'pt-16 pb-20 text-center sm:pt-24' : 'pt-12 pb-20 sm:pt-16 lg:grid-cols-2', !media && !centered && 'lg:grid-cols-1')}>
        <div className={cx('min-w-0', centered && 'mx-auto max-w-3xl')}>
          {hero.badge && (
            <span
              className={cx(
                'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium',
                onColor ? 'bg-white/15 text-white ring-1 ring-white/25' : 'bg-[color-mix(in_srgb,var(--lp-primary)_10%,transparent)] text-[var(--lp-primary)]',
                look.hero === 'grid' && 'text-[var(--lp-accent)] ring-1 ring-[var(--lp-border)] bg-white/5',
              )}
            >
              <Sparkles className="size-4" /> {hero.badge}
            </span>
          )}
          <h1 className={cx('mt-5 leading-[1.08]', look.heading, look.bigTitle ? 'text-4xl sm:text-6xl' : 'text-4xl sm:text-5xl')}>
            <Title title={hero.title} highlight={hero.highlight} look={look} onColor={onColor} />
          </h1>
          {subtitle && <p className={cx('mt-5 text-lg text-[var(--lp-muted)]', centered ? 'mx-auto max-w-2xl' : 'max-w-xl')}>{subtitle}</p>}
          <div className={cx('mt-8 flex flex-wrap gap-3', centered && 'justify-center')}>
            <LpButton button={hero.primary} ctx={ctx} size="lg" tone={onColor ? 'light' : 'primary'} look={look} />
            {hero.secondary && <LpButton button={hero.secondary} ctx={ctx} size="lg" tone={onColor ? 'outline-light' : 'secondary'} look={look} />}
          </div>
          {hero.showLoginHint && (
            <p className="mt-4 text-sm text-[var(--lp-muted)]">
              ¿Ya tiene cuenta?{' '}
              <SmartLink href={loginHref} className={cx('font-semibold hover:underline', onColor ? 'text-white' : 'text-[var(--lp-primary)]')}>
                Ingrese aquí
              </SmartLink>
            </p>
          )}
        </div>
        {media && <div className={cx('relative min-w-0', centered && 'mx-auto w-full max-w-3xl')}>{media}</div>}
      </div>
    </section>
  );
}

/** Ilustración de una pantalla con publicidad y llamados. */
export function ScreenMockup({ look }: { look: Pick<Look, 'radius'> }) {
  return (
    <div className="overflow-hidden border border-black/10 bg-slate-900 shadow-2xl" style={{ borderRadius: Math.max(look.radius, 10) }}>
      <div className="grid grid-cols-[1fr_38%]">
        <div className="relative aspect-video bg-gradient-to-br from-[var(--lp-primary)] via-sky-500 to-[var(--lp-accent)]">
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center text-white">
              <Video className="mx-auto size-10 opacity-80" />
              <p className="mt-2 text-sm font-semibold opacity-90">Su publicidad aquí</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col bg-slate-800 p-3 text-left text-white">
          <p className="text-[10px] tracking-widest text-sky-300 uppercase">Llamando</p>
          <p className="gc-flash text-3xl font-black">A015</p>
          <p className="text-xs text-slate-300">Ventanilla 2</p>
          <div className="mt-auto space-y-1 text-xs text-slate-400">
            <p className="flex justify-between">
              <span>C008</span>
              <span>Caja 1</span>
            </p>
            <p className="flex justify-between">
              <span>A014</span>
              <span>Ventanilla 3</span>
            </p>
            <p className="flex justify-between">
              <span>P002</span>
              <span>Box 1</span>
            </p>
          </div>
        </div>
      </div>
      <div className="overflow-hidden bg-amber-400 py-1 text-xs font-semibold text-slate-900">
        <div className="animate-[gc-marquee_18s_linear_infinite] whitespace-nowrap">
          Bienvenidos · Recuerde tener su documento a mano · Horario de atención de 8 a 18 h · Bienvenidos · Recuerde tener su documento a mano ·
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Secciones                                                            */
/* ------------------------------------------------------------------ */

function SectionTitle({ section, look, align = 'center' }: { section: LandingSection; look: Look; align?: 'center' | 'left' }) {
  if (!section.title && !section.subtitle) return null;
  return (
    <div className={cx('mb-12 max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      {section.title && <h2 className={cx('text-3xl sm:text-4xl', look.heading)}>{section.title}</h2>}
      {section.subtitle && <p className="mt-4 text-lg text-[var(--lp-muted)]">{section.subtitle}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-[var(--lp-radius)] border-2 border-dashed border-[var(--lp-border)] p-6 text-center text-sm text-[var(--lp-muted)]">{text}</p>;
}

function IconBox({ icon, look }: { icon: ReactNode; look: Look }) {
  const styles: Record<Look['icon'], string> = {
    soft: 'bg-[color-mix(in_srgb,var(--lp-primary)_12%,transparent)] text-[var(--lp-primary)]',
    gradient: 'bg-gradient-to-br from-[var(--lp-primary)] to-[var(--lp-accent)] text-white shadow-lg shadow-[color-mix(in_srgb,var(--lp-primary)_30%,transparent)]',
    outline: 'border border-[var(--lp-border)] text-[var(--lp-fg)]',
    solid: 'bg-[var(--lp-primary)] text-[var(--lp-primary-fg)]',
    glow: 'bg-[color-mix(in_srgb,var(--lp-accent)_14%,transparent)] text-[var(--lp-accent)] ring-1 ring-[color-mix(in_srgb,var(--lp-accent)_35%,transparent)] shadow-[0_0_24px_-4px_var(--lp-accent)]',
  };
  return (
    <span className={cx('grid size-11 shrink-0 place-items-center [&_svg]:size-5', styles[look.icon])} style={{ borderRadius: `calc(var(--lp-radius) * 0.6)` }}>
      {icon}
    </span>
  );
}

const COLS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;

function SectionBody({ section, look, plans, ctx, name }: { section: LandingSection; look: Look; plans: LandingPlanDTO[]; ctx: LandingContext; name: string }) {
  switch (section.type) {
    case 'features':
      return <Features section={section} look={look} ctx={ctx} />;
    case 'steps':
      return <Steps section={section} look={look} ctx={ctx} />;
    case 'showcase':
      return <Showcase section={section} look={look} ctx={ctx} />;
    case 'stats':
      return <Stats section={section} look={look} ctx={ctx} />;
    case 'pricing':
      return <Pricing section={section} look={look} plans={plans} ctx={ctx} />;
    case 'testimonials':
      return <Testimonials section={section} look={look} ctx={ctx} />;
    case 'logos':
      return <Logos section={section} look={look} ctx={ctx} />;
    case 'faq':
      return <Faq section={section} look={look} ctx={ctx} />;
    case 'cta':
      return <Cta section={section} look={look} ctx={ctx} name={name} />;
    case 'contact':
      return <Contact section={section} look={look} ctx={ctx} />;
  }
}

type Props<T extends LandingSection['type']> = { section: LandingSectionOf<T>; look: Look; ctx: LandingContext };

function Features({ section, look, ctx }: Props<'features'>) {
  return (
    <>
      <SectionTitle section={section} look={look} />
      {section.items.length === 0 && ctx.preview ? (
        <Empty text="Agregue funciones en el editor." />
      ) : (
        <div className={cx('grid gap-6', COLS[section.columns])}>
          {section.items.map((item, i) => {
            const Icon = LANDING_ICON_COMPONENTS[item.icon];
            return (
              <div key={i} className={cx('p-6', look.card)} style={{ borderRadius: 'var(--lp-radius)' }}>
                <IconBox icon={<Icon />} look={look} />
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--lp-muted)]">{item.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Steps({ section, look, ctx }: Props<'steps'>) {
  const cols = section.items.length >= 4 ? 'md:grid-cols-4' : section.items.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
  return (
    <>
      <SectionTitle section={section} look={look} />
      {section.items.length === 0 && ctx.preview ? (
        <Empty text="Agregue los pasos en el editor." />
      ) : (
        <ol className={cx('grid gap-8', cols)}>
          {section.items.map((item, i) => (
            <li key={i} className="relative">
              <span
                className={cx('grid size-12 place-items-center text-lg font-bold', look.icon === 'outline' ? 'border-2 border-[var(--lp-fg)]' : 'bg-[var(--lp-primary)] text-[var(--lp-primary-fg)]')}
                style={{ borderRadius: look.pill ? 999 : 'var(--lp-radius)' }}
              >
                {i + 1}
              </span>
              {i < section.items.length - 1 && <span aria-hidden className="absolute top-6 left-16 hidden h-px w-[calc(100%-4rem)] bg-[var(--lp-border)] md:block" />}
              <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--lp-muted)]">{item.text}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function Showcase({ section, look, ctx }: Props<'showcase'>) {
  const image = section.imageUrl ? (
    <img src={assetUrl(section.imageUrl)} alt="" className="w-full object-cover shadow-xl" style={{ borderRadius: 'var(--lp-radius)' }} />
  ) : (
    <ScreenMockup look={look} />
  );
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cx('min-w-0', section.imageSide === 'left' && 'lg:order-2')}>
        {section.title && <h2 className={cx('text-3xl sm:text-4xl', look.heading)}>{section.title}</h2>}
        {section.subtitle && <p className="mt-4 text-lg text-[var(--lp-muted)]">{section.subtitle}</p>}
        {section.bullets.length > 0 && (
          <ul className="mt-6 space-y-3">
            {section.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--lp-primary)_14%,transparent)] text-[var(--lp-primary)]">
                  <Check className="size-4" />
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        {section.button && (
          <div className="mt-8">
            <LpButton button={section.button} ctx={ctx} look={look} />
          </div>
        )}
      </div>
      <div className="min-w-0">{image}</div>
    </div>
  );
}

function Stats({ section, look, ctx }: Props<'stats'>) {
  return (
    <>
      <SectionTitle section={section} look={look} />
      {section.items.length === 0 && ctx.preview ? (
        <Empty text="Agregue cifras reales en el editor (por ejemplo, cantidad de clientes o de turnos atendidos)." />
      ) : (
        <dl className={cx('grid grid-cols-2 gap-6', section.items.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          {section.items.map((item, i) => (
            <div key={i} className={cx('flex flex-col-reverse p-6 text-center', look.card)} style={{ borderRadius: 'var(--lp-radius)' }}>
              <dt className="mt-1 text-sm text-[var(--lp-muted)]">{item.label}</dt>
              <dd className={cx('text-4xl sm:text-5xl', look.heading, 'text-[var(--lp-primary)]')}>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

const limitText = (n: number | null, one: string, many: string, unlimited: string) => (n === null ? unlimited : `Hasta ${n} ${n === 1 ? one : many}`);

function Pricing({ section, look, plans, ctx }: Props<'pricing'> & { plans: LandingPlanDTO[] }) {
  const list = plans.filter((p) => section.plans.includes(p.id));
  return (
    <>
      <SectionTitle section={section} look={look} />
      {list.length === 0 && ctx.preview ? (
        <Empty text="Elija los planes que se muestran." />
      ) : (
        <div className={cx('mx-auto grid max-w-5xl gap-6', list.length >= 3 ? 'md:grid-cols-3' : list.length === 2 ? 'md:grid-cols-2' : '')}>
          {list.map((plan) => {
            const featured = section.highlight === plan.id;
            const price = plan.monthlyPrice > 0 ? formatMoney(toMinor(plan.monthlyPrice, plan.currency), plan.currency) : plan.id === 'free' ? 'Gratis' : 'A consultar';
            return (
              <div
                key={plan.id}
                className={cx('relative flex flex-col p-7', look.card, featured && 'ring-2 ring-[var(--lp-primary)] md:-translate-y-2')}
                style={{ borderRadius: 'var(--lp-radius)' }}
              >
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--lp-primary)] px-3 py-1 text-xs font-semibold text-[var(--lp-primary-fg)]">Recomendado</span>
                )}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-4 flex items-baseline gap-1.5">
                  <span className={cx('text-3xl', look.heading)}>{price}</span>
                  {plan.monthlyPrice > 0 && <span className="text-sm text-[var(--lp-muted)]">/ mes</span>}
                </p>
                <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                  {[
                    limitText(plan.limits.branches, 'sucursal', 'sucursales', 'Sucursales ilimitadas'),
                    limitText(plan.limits.displays, 'pantalla', 'pantallas', 'Pantallas ilimitadas'),
                    limitText(plan.limits.users, 'usuario', 'usuarios', 'Usuarios ilimitados'),
                    ...(section.showModules ? plan.modules : []),
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--lp-primary)]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-7 [&>a]:w-full">
                  <LpButton button={section.button} ctx={ctx} tone={featured ? 'primary' : 'secondary'} look={look} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {section.note && <p className="mt-8 text-center text-sm text-[var(--lp-muted)]">{section.note}</p>}
    </>
  );
}

function Testimonials({ section, look, ctx }: Props<'testimonials'>) {
  return (
    <>
      <SectionTitle section={section} look={look} />
      {section.items.length === 0 && ctx.preview ? (
        <Empty text="Agregue testimonios reales de sus clientes (con su permiso)." />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {section.items.map((item, i) => (
            <figure key={i} className={cx('flex flex-col p-6', look.card)} style={{ borderRadius: 'var(--lp-radius)' }}>
              <Quote className="size-7 text-[var(--lp-primary)] opacity-70" />
              <blockquote className="mt-3 flex-1 leading-relaxed">{item.quote}</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                {item.photoUrl ? (
                  <img src={assetUrl(item.photoUrl)} alt="" className="size-11 rounded-full object-cover" />
                ) : (
                  <span className="grid size-11 place-items-center rounded-full bg-[var(--lp-primary)] text-sm font-semibold text-[var(--lp-primary-fg)]">{initials(item.name || '?')}</span>
                )}
                <span className="min-w-0">
                  <span className="block font-semibold">{item.name}</span>
                  {item.role && <span className="block text-sm text-[var(--lp-muted)]">{item.role}</span>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}

function Logos({ section, look, ctx }: Props<'logos'>) {
  return (
    <>
      <SectionTitle section={section} look={look} />
      {section.items.length === 0 && ctx.preview ? (
        <Empty text="Agregue los logos de sus clientes." />
      ) : (
        <ul className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
          {section.items.map((item, i) => (
            <li key={i} className="flex h-12 items-center">
              {item.imageUrl ? (
                <img src={assetUrl(item.imageUrl)} alt={item.name} title={item.name} className="max-h-12 max-w-40 object-contain opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0" />
              ) : (
                <span className="text-xl font-bold text-[var(--lp-muted)]">{item.name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Faq({ section, look, ctx }: Props<'faq'>) {
  return (
    <div className="mx-auto max-w-3xl">
      <SectionTitle section={section} look={look} />
      {section.items.length === 0 && ctx.preview ? (
        <Empty text="Agregue preguntas y respuestas." />
      ) : (
        <div className="space-y-3">
          {section.items.map((item, i) => (
            <details key={i} className={cx('group p-5', look.card)} style={{ borderRadius: 'var(--lp-radius)' }}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown className="size-5 shrink-0 text-[var(--lp-muted)] transition group-open:rotate-180" />
              </summary>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-[var(--lp-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function Cta({ section, look, ctx, name }: Props<'cta'> & { name: string }) {
  return (
    <div
      className="relative isolate overflow-hidden bg-gradient-to-br from-[var(--lp-primary)] to-[color-mix(in_srgb,var(--lp-primary)_55%,var(--lp-accent))] px-6 py-14 text-center text-white sm:px-12"
      style={{ borderRadius: `calc(var(--lp-radius) * 1.4)` }}
    >
      <div aria-hidden className="absolute -top-24 -right-24 -z-10 size-72 rounded-full bg-white/10 blur-2xl" />
      <h2 className={cx('mx-auto max-w-2xl text-3xl sm:text-4xl', look.heading)}>{section.title || `Empiece con ${name}`}</h2>
      {section.subtitle && <p className="mx-auto mt-4 max-w-2xl text-lg text-white/85">{section.subtitle}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LpButton button={section.button} ctx={ctx} size="lg" tone="light" look={look} />
        {section.secondary && <LpButton button={section.secondary} ctx={ctx} size="lg" tone="outline-light" look={look} />}
      </div>
    </div>
  );
}

function Contact({ section, look, ctx }: Props<'contact'>) {
  const whatsapp = section.whatsapp ? socialHref('whatsapp', section.whatsapp) : null;
  const items = [
    section.email && { icon: <Mail />, label: 'Correo', value: section.email, href: `mailto:${section.email}` },
    section.phone && { icon: <Phone />, label: 'Teléfono', value: section.phone, href: `tel:${section.phone.replace(/[^\d+]/g, '')}` },
    section.whatsapp && { icon: <MessageCircle />, label: 'WhatsApp', value: section.whatsapp, href: whatsapp },
    section.address && { icon: <MapPin />, label: 'Dirección', value: section.address, href: null },
    section.hours && { icon: <Clock />, label: 'Horario', value: section.hours, href: null },
  ].filter(Boolean) as { icon: ReactNode; label: string; value: string; href: string | null }[];
  return (
    <>
      <SectionTitle section={section} look={look} />
      {items.length === 0 && ctx.preview ? (
        <Empty text="Complete al menos un dato de contacto." />
      ) : (
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const body = (
              <>
                <IconBox icon={item.icon} look={look} />
                <span className="min-w-0">
                  <span className="block text-sm text-[var(--lp-muted)]">{item.label}</span>
                  <span className="block font-semibold break-words">{item.value}</span>
                </span>
              </>
            );
            return item.href ? (
              <a key={item.label} href={item.href} {...(item.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={cx('flex items-center gap-4 p-5 hover:brightness-[0.98]', look.card)} style={{ borderRadius: 'var(--lp-radius)' }}>
                {body}
              </a>
            ) : (
              <div key={item.label} className={cx('flex items-center gap-4 p-5', look.card)} style={{ borderRadius: 'var(--lp-radius)' }}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pie                                                                  */
/* ------------------------------------------------------------------ */

function Footer({ landing, brand, look }: { landing: LandingSettings; brand: PlatformBrand; look: Look }) {
  const { footer } = landing;
  const socials = LANDING_SOCIALS.map((n) => ({ n, href: socialHref(n, footer.social[n] ?? '') })).filter((s) => s.href);
  return (
    <footer className="border-t border-[var(--lp-border)] bg-[var(--lp-alt)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm min-w-0">
          <p className={cx('text-lg', look.heading)}>{brand.appName}</p>
          {footer.text && <p className="mt-2 text-sm leading-relaxed text-[var(--lp-muted)]">{footer.text}</p>}
          {socials.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {socials.map((s) => (
                <li key={s.n}>
                  <a
                    href={s.href!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-full border border-[var(--lp-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--lp-bg)]"
                  >
                    {LANDING_SOCIAL_LABELS[s.n]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(footer.links.length > 0 || landing.header.showApi) && (
          <ul className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-3">
            {footer.links
              .filter((l) => l.label && l.url)
              .map((l, i) => (
                <li key={i}>
                  <SmartLink href={l.url} className="text-[var(--lp-muted)] hover:text-[var(--lp-fg)]">
                    {l.label}
                  </SmartLink>
                </li>
              ))}
            {landing.header.showApi && (
              <li>
                <a href="/api/docs" className="text-[var(--lp-muted)] hover:text-[var(--lp-fg)]">
                  Documentación de la API
                </a>
              </li>
            )}
          </ul>
        )}
      </div>
      <div className="border-t border-[var(--lp-border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-[var(--lp-muted)] sm:flex-row sm:px-6">
          <p>
            © {new Date().getFullYear()} {brand.appName}
          </p>
          <LegalFooter copyright={false} className="text-xs! text-[var(--lp-muted)]! [&_a:hover]:text-[var(--lp-fg)]" />
        </div>
      </div>
    </footer>
  );
}
