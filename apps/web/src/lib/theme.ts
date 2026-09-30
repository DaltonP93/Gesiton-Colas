import type { Branding } from '@gc/shared';
import { assetUrl } from './api';

const SYSTEM_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Georgia', 'Verdana', 'Tahoma']);

/** Fuentes de Google Fonts sugeridas en el editor de marca. */
export const FONT_OPTIONS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Source Sans 3',
  'Raleway',
  'Work Sans',
  'Rubik',
  'Manrope',
  'DM Sans',
  'Outfit',
  'Merriweather',
  'Playfair Display',
  'Oswald',
  'Barlow',
  'Fira Sans',
  'system-ui',
];

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG entre dos colores. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Color de texto legible (blanco o casi negro) sobre un fondo dado: el de mayor contraste. */
export function readableOn(hex: string): string {
  try {
    return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#0f172a') ? '#ffffff' : '#0f172a';
  } catch {
    return '#ffffff';
  }
}

export function loadFont(family: string) {
  if (!family || SYSTEM_FONTS.has(family)) return;
  const id = `gc-font-${family.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

export function fontStack(family: string) {
  return SYSTEM_FONTS.has(family) ? `${family}, ui-sans-serif, sans-serif` : `'${family}', ui-sans-serif, system-ui, sans-serif`;
}

/** Inserta (o reemplaza) CSS personalizado en la página. */
export function setCustomCss(id: string, css: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  // Evita cerrar la etiqueta <style> desde el contenido.
  el.textContent = css.replace(/<\/style/gi, '');
}

function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Colores base que usa el sistema cuando el esquema es oscuro. */
export const DARK_BASE = { bg: '#0b1120', surface: '#131c2e', fg: '#e2e8f0' };

const cssUrl = (url: string) => `url("${assetUrl(url).replace(/["\\\n]/g, '')}")`;

/** Fondo del panel según el estilo elegido. */
function pageBackground(b: Branding, bg: string, fg: string, dark: boolean) {
  switch (b.backgroundStyle) {
    case 'gradient':
      return [
        `radial-gradient(1100px 520px at 100% -8%, color-mix(in srgb, ${b.primaryColor} ${dark ? 22 : 14}%, transparent), transparent 62%)`,
        `radial-gradient(900px 480px at -8% 108%, color-mix(in srgb, ${b.accentColor} ${dark ? 14 : 11}%, transparent), transparent 60%)`,
        bg,
      ].join(', ');
    case 'dots':
      return `radial-gradient(color-mix(in srgb, ${fg} ${dark ? 12 : 10}%, transparent) 1px, transparent 1.3px) 0 0 / 20px 20px, ${bg}`;
    case 'image':
      if (!b.backgroundImageUrl) return bg;
      return `linear-gradient(color-mix(in srgb, ${bg} 80%, transparent), color-mix(in srgb, ${bg} 80%, transparent)), ${cssUrl(b.backgroundImageUrl)} center / cover no-repeat, ${bg}`;
    default:
      return bg;
  }
}

/**
 * Variables CSS de la marca. Las usa todo el panel (`applyBranding`) y la vista previa del editor,
 * que las aplica solo a su contenedor.
 */
export function brandingVars(b: Branding, dark: boolean): Record<string, string> {
  const bg = dark ? DARK_BASE.bg : b.backgroundColor;
  const surface = dark ? DARK_BASE.surface : b.surfaceColor;
  const fg = dark ? DARK_BASE.fg : b.textColor;
  const primaryFg = readableOn(b.primaryColor);
  const tint = dark ? '0 0 0' : '15 23 42';

  const cards: Record<Branding['cardStyle'], [bg: string, border: string, shadow: string, blur: string]> = {
    elevated: [
      surface,
      `color-mix(in srgb, ${fg} ${dark ? 9 : 6}%, transparent)`,
      `0 1px 2px rgb(${tint} / ${dark ? 0.4 : 0.04}), 0 8px 24px -10px rgb(${tint} / ${dark ? 0.6 : 0.16})`,
      'none',
    ],
    bordered: [surface, `color-mix(in srgb, ${fg} 14%, transparent)`, `0 1px 2px rgb(${tint} / ${dark ? 0.3 : 0.05})`, 'none'],
    flat: [surface, 'transparent', 'none', 'none'],
    glass: [
      `color-mix(in srgb, ${surface} ${dark ? 62 : 68}%, transparent)`,
      dark ? 'rgb(255 255 255 / 0.09)' : 'rgb(255 255 255 / 0.7)',
      `0 10px 36px -14px rgb(${tint} / ${dark ? 0.7 : 0.22})`,
      'blur(16px) saturate(1.4)',
    ],
  };
  const [cardBg, cardBorder, cardShadow, cardBlur] = cards[b.cardStyle] ?? cards.elevated;

  const primaryText = dark ? `color-mix(in srgb, ${b.primaryColor} 55%, white)` : b.primaryColor;
  const navs: Record<Branding['sidebarStyle'], Record<string, string>> = {
    light: {
      bg: surface,
      fg,
      muted: `color-mix(in srgb, ${fg} 55%, transparent)`,
      hover: `color-mix(in srgb, ${fg} 6%, transparent)`,
      activeBg: `color-mix(in srgb, ${b.primaryColor} ${dark ? 24 : 11}%, transparent)`,
      activeFg: primaryText,
      indicator: b.primaryColor,
      border: `color-mix(in srgb, ${fg} 8%, transparent)`,
    },
    dark: {
      bg: dark ? '#070b16' : '#0f172a',
      fg: '#e2e8f0',
      muted: 'rgb(226 232 240 / 0.55)',
      hover: 'rgb(255 255 255 / 0.06)',
      activeBg: 'rgb(255 255 255 / 0.1)',
      activeFg: '#ffffff',
      indicator: b.primaryColor,
      border: 'rgb(255 255 255 / 0.06)',
    },
    brand: {
      bg: b.primaryColor,
      fg: primaryFg,
      muted: `color-mix(in srgb, ${primaryFg} 72%, transparent)`,
      hover: `color-mix(in srgb, ${primaryFg} 10%, transparent)`,
      activeBg: `color-mix(in srgb, ${primaryFg} 18%, transparent)`,
      activeFg: primaryFg,
      indicator: primaryFg,
      border: `color-mix(in srgb, ${primaryFg} 14%, transparent)`,
    },
  };
  const nav = navs[b.sidebarStyle] ?? navs.light;
  const compact = b.density === 'compact';

  return {
    '--gc-primary': b.primaryColor,
    '--gc-primary-fg': primaryFg,
    '--gc-primary-text': primaryText,
    '--gc-accent': b.accentColor,
    '--gc-accent-fg': readableOn(b.accentColor),
    '--gc-bg': bg,
    '--gc-surface': surface,
    '--gc-fg': fg,
    '--gc-muted': `color-mix(in srgb, ${fg} 58%, transparent)`,
    '--gc-border': `color-mix(in srgb, ${fg} 12%, transparent)`,
    '--gc-subtle': `color-mix(in srgb, ${fg} 5%, transparent)`,
    '--gc-radius': `${b.borderRadius}px`,
    '--gc-font': fontStack(b.fontFamily),
    '--gc-font-heading': fontStack(b.headingFontFamily || b.fontFamily),
    '--gc-card-bg': cardBg,
    '--gc-card-border': cardBorder,
    '--gc-card-shadow': cardShadow,
    '--gc-card-blur': cardBlur,
    '--gc-nav-bg': nav.bg!,
    '--gc-nav-fg': nav.fg!,
    '--gc-nav-muted': nav.muted!,
    '--gc-nav-hover': nav.hover!,
    '--gc-nav-active-bg': nav.activeBg!,
    '--gc-nav-active-fg': nav.activeFg!,
    '--gc-nav-indicator': nav.indicator!,
    '--gc-nav-border': nav.border!,
    '--gc-pad': compact ? '0.875rem' : '1.25rem',
    '--gc-gap': compact ? '1rem' : '1.5rem',
    '--gc-control-h': compact ? '2.125rem' : '2.5rem',
    '--gc-page-bg': pageBackground(b, bg, fg, dark),
  };
}

export function isDarkScheme(branding: Branding) {
  return branding.colorScheme === 'dark' || (branding.colorScheme === 'auto' && prefersDark());
}

/** Aplica el branding de la organización a toda la interfaz (variables CSS, fuente, favicon, CSS propio). */
export function applyBranding(branding: Branding, options: { title?: string; applyCustomCss?: boolean } = {}) {
  const root = document.documentElement;
  const dark = isDarkScheme(branding);
  for (const [k, v] of Object.entries(brandingVars(branding, dark))) root.style.setProperty(k, v);
  root.style.colorScheme = dark ? 'dark' : 'light';
  loadFont(branding.fontFamily);
  if (branding.headingFontFamily) loadFont(branding.headingFontFamily);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', branding.primaryColor);
  if (branding.faviconUrl || branding.logoUrl) {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.href = assetUrl(branding.faviconUrl ?? branding.logoUrl);
      icon.removeAttribute('type');
    }
  }
  if (options.title !== undefined) document.title = options.title || branding.appName;
  if (options.applyCustomCss !== false) setCustomCss('gc-branding-css', branding.customCss);
}
