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

/** Aplica el branding de la organización a toda la interfaz (variables CSS, fuente, favicon, CSS propio). */
export function applyBranding(branding: Branding, options: { title?: string; applyCustomCss?: boolean } = {}) {
  const root = document.documentElement;
  const dark = branding.colorScheme === 'dark' || (branding.colorScheme === 'auto' && prefersDark());
  const vars: Record<string, string> = {
    '--gc-primary': branding.primaryColor,
    '--gc-primary-fg': readableOn(branding.primaryColor),
    '--gc-accent': branding.accentColor,
    '--gc-accent-fg': readableOn(branding.accentColor),
    '--gc-bg': dark ? '#0b1120' : branding.backgroundColor,
    '--gc-surface': dark ? '#131c2e' : branding.surfaceColor,
    '--gc-fg': dark ? '#e2e8f0' : branding.textColor,
    '--gc-radius': `${branding.borderRadius}px`,
    '--gc-font': fontStack(branding.fontFamily),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = dark ? 'dark' : 'light';
  loadFont(branding.fontFamily);
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
