import { BarChart3, Bell, Headset, LayoutDashboard, Megaphone } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Branding, Terminology } from '@gc/shared';
import { assetUrl } from '../../../lib/api';
import { fontStack, readableOn } from '../../../lib/theme';
import { DARK_COLORS } from './presets';

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

function channels(hex: string): [number, number, number] | null {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(h)) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number | null {
  const rgb = channels(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG entre dos colores (1–21). */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Colores efectivos según el esquema (en oscuro se usan los fondos oscuros del sistema). */
export function effectiveColors(b: Branding, dark: boolean) {
  return dark ? { bg: DARK_COLORS.backgroundColor, surface: DARK_COLORS.surfaceColor, fg: DARK_COLORS.textColor } : { bg: b.backgroundColor, surface: b.surfaceColor, fg: b.textColor };
}

/**
 * Variables CSS equivalentes a `applyBranding`, pero limitadas al contenedor de la vista previa,
 * para ver los cambios sin afectar al resto del panel hasta guardar.
 */
export function previewVars(b: Branding, dark: boolean): CSSProperties {
  const { bg, surface, fg } = effectiveColors(b, dark);
  const font = fontStack(b.fontFamily);
  return {
    '--gc-primary': b.primaryColor,
    '--gc-primary-fg': readableOn(b.primaryColor),
    '--gc-accent': b.accentColor,
    '--gc-accent-fg': readableOn(b.accentColor),
    '--gc-bg': bg,
    '--gc-surface': surface,
    '--gc-fg': fg,
    '--gc-radius': `${b.borderRadius}px`,
    '--gc-font': font,
    '--gc-muted': `color-mix(in srgb, ${fg} 58%, transparent)`,
    '--gc-border': `color-mix(in srgb, ${fg} 12%, transparent)`,
    '--gc-subtle': `color-mix(in srgb, ${fg} 5%, transparent)`,
    fontFamily: font,
    background: bg,
    color: fg,
    colorScheme: dark ? 'dark' : 'light',
  } as CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Vista previa                                                        */
/* ------------------------------------------------------------------ */

export function BrandingPreview({ branding, orgName, terms, dark }: { branding: Branding; orgName: string; terms: Terminology; dark: boolean }) {
  const logo = branding.logoUrl ? assetUrl(branding.logoUrl) : '';
  const appName = branding.appName || 'Gestión de Colas';
  return (
    <div style={previewVars(branding, dark)} className="overflow-hidden rounded-ui border border-border text-fg shadow-lg" aria-label="Vista previa de la marca">
      {/* Barra superior */}
      <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-fg">
        {logo ? (
          <span className="grid h-9 max-w-[120px] place-items-center overflow-hidden rounded-ui bg-white/95 px-1.5">
            <img src={logo} alt="" className="max-h-7 max-w-full object-contain" />
          </span>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-ui bg-black/15 text-lg font-bold">{appName.charAt(0).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-bold">{appName}</p>
          <p className="truncate text-xs leading-tight opacity-80">{orgName || 'Su organización'}</p>
        </div>
        <Bell className="size-4 opacity-80" aria-hidden />
      </div>

      <div className="flex bg-bg">
        {/* Menú lateral */}
        <nav className="hidden w-32 shrink-0 space-y-1 border-r border-border bg-surface p-2 sm:block" aria-hidden>
          {[
            { icon: <LayoutDashboard />, label: 'Inicio', active: true },
            { icon: <Headset />, label: 'Atención' },
            { icon: <BarChart3 />, label: 'Reportes' },
            { icon: <Megaphone />, label: 'Publicidad' },
          ].map((item) => (
            <span
              key={item.label}
              className={`flex items-center gap-2 rounded-ui px-2 py-1.5 text-xs font-medium [&_svg]:size-3.5 ${item.active ? 'bg-primary text-primary-fg' : 'text-fg/75'}`}
            >
              {item.icon}
              {item.label}
            </span>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-4">
          <div className="rounded-ui border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{terms.ticket} en atención</p>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'color-mix(in srgb, var(--gc-accent) 18%, transparent)' }}>
                Preferencial
              </span>
            </div>
            <p className="mt-2 text-4xl font-extrabold tracking-tight text-primary">A001</p>
            <p className="text-xs text-muted">
              Consultas generales · {terms.counter} 3
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex h-8 items-center rounded-ui bg-primary px-3 text-xs font-medium text-primary-fg shadow-sm">Llamar siguiente</span>
              <span className="inline-flex h-8 items-center rounded-ui bg-accent px-3 text-xs font-medium text-accent-fg shadow-sm">Rellamar</span>
              <span className="inline-flex h-8 items-center rounded-ui border border-border bg-surface px-3 text-xs font-medium">Finalizar</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'En espera', value: '12' },
              { label: 'Atendidos', value: '48' },
              { label: 'Espera', value: '6 min' },
            ].map((s) => (
              <div key={s.label} className="rounded-ui border border-border bg-surface p-2.5">
                <p className="truncate text-[11px] text-muted">{s.label}</p>
                <p className="text-base font-bold">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-ui border border-border bg-surface">
            {['A002', 'B001', 'A003'].map((code, i) => (
              <div key={code} className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs first:border-t-0">
                <span className="font-mono font-bold">{code}</span>
                <span className="text-muted">{i === 1 ? 'Caja' : 'Consultas generales'}</span>
                <span className="ml-auto tabular-nums text-muted">0{i + 2}:1{i}</span>
              </div>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Texto secundario de ejemplo. Así se verán las descripciones y ayudas del panel y de la página de seguimiento de {terms.tickets.toLowerCase()}.
          </p>
        </div>
      </div>
    </div>
  );
}
