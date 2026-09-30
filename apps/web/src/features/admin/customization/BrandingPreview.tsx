import { BarChart3, Bell, Headset, LayoutDashboard, Megaphone, Settings } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Branding, Terminology } from '@gc/shared';
import { assetUrl } from '../../../lib/api';
import { brandingVars, fontStack } from '../../../lib/theme';
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
  return {
    ...brandingVars(b, dark),
    fontFamily: fontStack(b.fontFamily),
    background: 'var(--gc-page-bg)',
    color: 'var(--gc-fg)',
    colorScheme: dark ? 'dark' : 'light',
  } as CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Vista previa                                                        */
/* ------------------------------------------------------------------ */

export function BrandingPreview({ branding, orgName, terms, dark }: { branding: Branding; orgName: string; terms: Terminology; dark: boolean }) {
  const logo = branding.logoUrl ? assetUrl(branding.logoUrl) : '';
  const appName = branding.appName || 'Gestión de Colas';
  const heading = { fontFamily: fontStack(branding.headingFontFamily || branding.fontFamily) };
  return (
    <div style={previewVars(branding, dark)} className="flex min-h-[26rem] overflow-hidden rounded-ui border border-border text-fg shadow-lg" aria-label="Vista previa de la marca">
      {/* Menú lateral */}
      <nav className="flex w-36 shrink-0 flex-col border-r border-[var(--gc-nav-border)] bg-[var(--gc-nav-bg)] text-[var(--gc-nav-fg)]" aria-hidden>
        <div className="flex items-center gap-2 px-3 py-3">
          {logo ? (
            <img src={logo} alt="" className="max-h-7 max-w-full object-contain" />
          ) : (
            <>
              <span className="grid size-7 shrink-0 place-items-center rounded-ui bg-primary text-sm font-bold text-primary-fg">{appName.charAt(0).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] leading-tight font-bold">{appName}</span>
                <span className="block truncate text-[10px] leading-tight text-[var(--gc-nav-muted)]">{orgName || 'Su organización'}</span>
              </span>
            </>
          )}
        </div>
        <p className="px-3 pt-1 pb-1 text-[9px] font-semibold tracking-wider text-[var(--gc-nav-muted)] uppercase">Operación</p>
        <div className="space-y-0.5 px-2">
          {[
            { icon: <LayoutDashboard />, label: 'Inicio', active: true },
            { icon: <Headset />, label: 'Atención' },
            { icon: <BarChart3 />, label: 'Reportes' },
            { icon: <Megaphone />, label: 'Publicidad' },
            { icon: <Settings />, label: 'Configuración' },
          ].map((item) => (
            <span
              key={item.label}
              className={`relative flex items-center gap-2 rounded-ui px-2 py-1.5 text-[11px] font-medium [&_svg]:size-3.5 ${
                item.active
                  ? 'bg-[var(--gc-nav-active-bg)] font-semibold text-[var(--gc-nav-active-fg)] before:absolute before:inset-y-1 before:-left-2 before:w-0.5 before:rounded-full before:bg-[var(--gc-nav-indicator)]'
                  : 'opacity-80'
              }`}
            >
              {item.icon}
              {item.label}
            </span>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-bold tracking-tight" style={heading}>
            Buenos días
          </p>
          <Bell className="size-4 text-muted" aria-hidden />
        </div>
        <div className="gc-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold" style={heading}>
              {terms.ticket} en atención
            </p>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'color-mix(in srgb, var(--gc-accent) 18%, transparent)' }}>
              Preferencial
            </span>
          </div>
          <p className="mt-2 text-4xl font-extrabold tracking-tight text-primary-text">A001</p>
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
            <div key={s.label} className="gc-card p-2.5">
              <p className="truncate text-[11px] text-muted">{s.label}</p>
              <p className="text-base font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="gc-card overflow-hidden">
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
  );
}
