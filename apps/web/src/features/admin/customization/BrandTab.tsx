import { Check, Moon, RotateCcw, Sun, SunMoon, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { brandingSchema, type Branding } from '@gc/shared';
import { ImageField } from '../../../components/ImageField';
import { Button, ColorInput, Field, Input, RangeInput, Select, Textarea, cx } from '../../../components/ui';
import { assetUrl } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { FONT_OPTIONS, fontStack, loadFont, readableOn } from '../../../lib/theme';
import { BrandingPreview, contrastRatio, effectiveColors } from './BrandingPreview';
import { Callout, SaveBar, Section, sameJson, useReportDirty, useSaveTenant, type TabProps } from './common';
import { PALETTES, type Palette } from './presets';

const SCHEMES: { value: Branding['colorScheme']; label: string; icon: ReactNode; hint: string }[] = [
  { value: 'light', label: 'Mis colores', icon: <Sun />, hint: 'Usa los colores de fondo, superficie y texto elegidos' },
  { value: 'dark', label: 'Oscuro', icon: <Moon />, hint: 'Fondos oscuros del sistema con sus colores principal y de acento' },
  { value: 'auto', label: 'Automático', icon: <SunMoon />, hint: 'Claro u oscuro según la preferencia de cada dispositivo' },
];

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function prefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function BrandTab({ onDirtyChange }: TabProps) {
  const { me, settings, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const source = settings.branding;
  const sourceName = me?.tenant?.name ?? '';

  const [draft, setDraft] = useState<Branding>(source);
  const [name, setName] = useState(sourceName);
  const [previewDark, setPreviewDark] = useState(prefersDark);

  // Si la configuración guardada cambia (al guardar o desde otra sesión), se toma como nueva base.
  const sourceKey = `${JSON.stringify(source)}|${sourceName}`;
  const [base, setBase] = useState(sourceKey);
  if (base !== sourceKey) {
    setBase(sourceKey);
    setDraft(source);
    setName(sourceName);
  }

  const dirty = !sameJson(draft, source) || name.trim() !== sourceName;
  useReportDirty(dirty, onDirtyChange);

  useEffect(() => loadFont(draft.fontFamily), [draft.fontFamily]);
  useEffect(() => {
    if (draft.headingFontFamily) loadFont(draft.headingFontFamily);
  }, [draft.headingFontFamily]);

  const set = <K extends keyof Branding>(key: K, value: Branding[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const errors = {
    name: name.trim().length < 2 ? 'Ingrese al menos 2 caracteres' : name.trim().length > 120 ? 'Máximo 120 caracteres' : null,
    appName: !draft.appName.trim() ? 'Ingrese un nombre' : draft.appName.length > 80 ? 'Máximo 80 caracteres' : null,
    customCss: draft.customCss.length > 50_000 ? 'Máximo 50 000 caracteres' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const applyPalette = (p: Palette) =>
    setDraft((d) => ({ ...d, ...p.colors, colorScheme: p.colorScheme ?? (d.colorScheme === 'dark' ? 'light' : d.colorScheme) }));
  const activePalette = PALETTES.find(
    (p) =>
      (Object.keys(p.colors) as (keyof Palette['colors'])[]).every((k) => sameColor(p.colors[k], draft[k])) &&
      (p.colorScheme ? p.colorScheme === draft.colorScheme : draft.colorScheme !== 'dark'),
  );

  const resetStyle = () => {
    const d = brandingSchema.parse({});
    setDraft((cur) => ({
      ...cur,
      primaryColor: d.primaryColor,
      accentColor: d.accentColor,
      backgroundColor: d.backgroundColor,
      surfaceColor: d.surfaceColor,
      textColor: d.textColor,
      fontFamily: d.fontFamily,
      headingFontFamily: d.headingFontFamily,
      borderRadius: d.borderRadius,
      colorScheme: d.colorScheme,
      cardStyle: d.cardStyle,
      sidebarStyle: d.sidebarStyle,
      density: d.density,
      backgroundStyle: d.backgroundStyle,
    }));
  };

  const onSave = async () => {
    const branding: Branding = {
      ...draft,
      appName: draft.appName.trim(),
      logoUrl: draft.logoUrl?.trim() || null,
      faviconUrl: draft.faviconUrl?.trim() || null,
    };
    const trimmedName = name.trim();
    await save({ ...(trimmedName !== sourceName ? { name: trimmedName } : {}), settings: { branding } }, 'Marca actualizada');
  };

  const dark = draft.colorScheme === 'dark' || (draft.colorScheme === 'auto' && previewDark);
  const colors = effectiveColors(draft, dark);
  const warnings: string[] = [];
  const textOnBg = contrastRatio(colors.fg, colors.bg);
  const textOnSurface = contrastRatio(colors.fg, colors.surface);
  const onPrimary = contrastRatio(readableOn(draft.primaryColor), draft.primaryColor);
  if (textOnBg !== null && textOnBg < 4.5) warnings.push(`El texto tiene poco contraste con el fondo (${textOnBg.toFixed(1)}:1). Se recomienda al menos 4.5:1.`);
  if (textOnSurface !== null && textOnSurface < 4.5) warnings.push(`El texto tiene poco contraste con las tarjetas (${textOnSurface.toFixed(1)}:1).`);
  if (onPrimary !== null && onPrimary < 3) warnings.push('El texto de los botones principales puede leerse con dificultad. Pruebe un color principal más oscuro o más claro.');

  const fonts = FONT_OPTIONS.includes(draft.fontFamily) ? FONT_OPTIONS : [draft.fontFamily, ...FONT_OPTIONS];

  return (
    <div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        {/* Vista previa */}
        <aside className="space-y-3 lg:sticky lg:top-6 lg:order-last">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Vista previa</h3>
            {draft.colorScheme === 'auto' ? (
              <div className="inline-flex rounded-ui border border-border bg-surface p-0.5" role="group" aria-label="Modo de la vista previa">
                {[
                  { dark: false, label: 'Claro', icon: <Sun className="size-3.5" /> },
                  { dark: true, label: 'Oscuro', icon: <Moon className="size-3.5" /> },
                ].map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    aria-pressed={previewDark === m.dark}
                    onClick={() => setPreviewDark(m.dark)}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-[calc(var(--gc-radius)-2px)] px-2 py-1 text-xs font-medium',
                      previewDark === m.dark ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted">Se aplica al guardar</span>
            )}
          </div>
          <BrandingPreview branding={draft} orgName={name} terms={terms} dark={dark} />
          {warnings.length > 0 && (
            <ul className="space-y-1.5 rounded-ui border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-fg">
              {warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          <Section title="Identidad" description="Nombre y logo que verán su equipo y sus clientes.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre de la organización" required error={errors.name} hint="Aparece en el panel, los tickets impresos y la página de seguimiento.">
                <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Nombre del sistema" required error={errors.appName} hint="Título de la aplicación y de la pestaña del navegador.">
                <Input value={draft.appName} maxLength={80} onChange={(e) => set('appName', e.target.value)} placeholder="Gestión de Colas" />
              </Field>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <ImageField
                label="Logo"
                hint="PNG o SVG con fondo transparente, idealmente horizontal."
                value={draft.logoUrl}
                onChange={(v) => set('logoUrl', v)}
                uploadName="Logo"
              />
              <ImageField
                label="Ícono del navegador (favicon)"
                hint="Opcional. Imagen cuadrada de 64 × 64 px o más. Si no se indica, se usa el logo."
                value={draft.faviconUrl}
                onChange={(v) => set('faviconUrl', v)}
                uploadName="Favicon"
                square
              />
            </div>
          </Section>

          <Section title="Colores" description="Elija una paleta prediseñada o ajuste cada color a su gusto.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PALETTES.map((p) => {
                const active = activePalette?.name === p.name;
                return (
                  <button
                    key={p.name}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyPalette(p)}
                    className={cx(
                      'group relative rounded-ui border p-2.5 text-left transition hover:shadow-sm',
                      active ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-primary/40',
                    )}
                  >
                    <span className="flex h-8 overflow-hidden rounded-[calc(var(--gc-radius)*0.6)] border border-black/5" aria-hidden>
                      <span className="flex-[3]" style={{ background: p.colors.primaryColor }} />
                      <span className="flex-1" style={{ background: p.colors.accentColor }} />
                      <span className="flex-[2]" style={{ background: p.colors.backgroundColor }} />
                    </span>
                    <span className="mt-2 flex items-center gap-1 text-xs font-medium">
                      {p.name}
                      {active && <Check className="size-3.5 text-primary" aria-hidden />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <ColorInput label="Color principal" value={draft.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorInput label="Color de acento" value={draft.accentColor} onChange={(v) => set('accentColor', v)} />
              <ColorInput label="Fondo" value={draft.backgroundColor} onChange={(v) => set('backgroundColor', v)} />
              <ColorInput label="Tarjetas y paneles" value={draft.surfaceColor} onChange={(v) => set('surfaceColor', v)} />
              <ColorInput label="Texto" value={draft.textColor} onChange={(v) => set('textColor', v)} />
            </div>

            <div className="mt-5">
              <span className="mb-1.5 block text-sm font-medium" id="scheme-label">
                Esquema de color
              </span>
              <div role="radiogroup" aria-labelledby="scheme-label" className="grid gap-2 sm:grid-cols-3">
                {SCHEMES.map((s) => {
                  const checked = draft.colorScheme === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => set('colorScheme', s.value)}
                      className={cx(
                        'flex items-start gap-3 rounded-ui border p-3 text-left transition',
                        checked ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:bg-subtle',
                      )}
                    >
                      <span className={cx('mt-0.5 [&_svg]:size-4', checked ? 'text-primary' : 'text-muted')}>{s.icon}</span>
                      <span>
                        <span className="block text-sm font-medium">{s.label}</span>
                        <span className="block text-xs text-muted">{s.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {draft.colorScheme !== 'light' && (
                <p className="mt-2 text-xs text-muted">
                  En modo oscuro, el fondo, las tarjetas y el texto usan tonos oscuros predefinidos; sus colores principal y de acento se mantienen.
                </p>
              )}
            </div>
          </Section>

          <Section title="Apariencia del panel" description="Cómo se ven el menú, las tarjetas y el fondo. Combine a gusto: la vista previa muestra el resultado.">
            <div className="space-y-6">
              <OptionTiles
                label="Tarjetas y paneles"
                value={draft.cardStyle}
                onChange={(v) => set('cardStyle', v)}
                options={CARD_STYLES}
              />
              <OptionTiles
                label="Menú lateral"
                value={draft.sidebarStyle}
                onChange={(v) => set('sidebarStyle', v)}
                options={SIDEBAR_STYLES.map((o) => ({ ...o, preview: o.render(draft.primaryColor) }))}
              />
              <OptionTiles
                label="Fondo"
                value={draft.backgroundStyle}
                onChange={(v) => set('backgroundStyle', v)}
                options={BACKGROUND_STYLES.map((o) => ({ ...o, preview: o.render(draft) }))}
              />
              {draft.backgroundStyle === 'image' && (
                <ImageField
                  label="Imagen de fondo"
                  hint="Una foto o textura clara. Se aclara automáticamente para que el texto se lea bien."
                  value={draft.backgroundImageUrl}
                  onChange={(v) => set('backgroundImageUrl', v)}
                  uploadName="Fondo"
                />
              )}
              <OptionTiles
                label="Espaciado"
                value={draft.density}
                onChange={(v) => set('density', v)}
                options={DENSITIES}
                columns={2}
              />
            </div>
          </Section>

          <Section title="Tipografía y forma">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Fuente del texto" hint="Fuentes de Google Fonts. La vista previa se actualiza al instante.">
                <Select value={draft.fontFamily} onChange={(e) => set('fontFamily', e.target.value)} style={{ fontFamily: fontStack(draft.fontFamily) }}>
                  {fonts.map((f) => (
                    <option key={f} value={f}>
                      {f === 'system-ui' ? 'Fuente del sistema' : f}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fuente de los títulos" hint="Opcional: una fuente con más personalidad para títulos y encabezados.">
                <Select
                  value={draft.headingFontFamily}
                  onChange={(e) => set('headingFontFamily', e.target.value)}
                  style={{ fontFamily: fontStack(draft.headingFontFamily || draft.fontFamily) }}
                >
                  <option value="">La misma del texto</option>
                  {HEADING_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <RangeInput label="Redondeo de esquinas" min={0} max={32} value={draft.borderRadius} onChange={(v) => set('borderRadius', v)} format={(v) => `${v} px`} />
                <div className="mt-2 flex items-center gap-2" aria-hidden>
                  {[0, 8, 16, 24].map((r) => (
                    <button
                      key={r}
                      type="button"
                      tabIndex={-1}
                      onClick={() => set('borderRadius', r)}
                      className={cx('h-7 w-10 border-2 bg-surface transition', draft.borderRadius === r ? 'border-primary' : 'border-border hover:border-primary/40')}
                      style={{ borderRadius: r / 2 }}
                      title={`${r} px`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-ui bg-subtle px-4 py-3">
              <p className="text-xl font-bold" style={{ fontFamily: fontStack(draft.headingFontFamily || draft.fontFamily) }}>
                Bienvenidos a {name || 'su organización'}
              </p>
              <p className="mt-1 text-base" style={{ fontFamily: fontStack(draft.fontFamily) }}>
                {terms.ticket} A001 · {terms.counter} 3 — ÁÉÍÓÚ ñ 0123456789
              </p>
            </div>
          </Section>

          <Section
            title="CSS personalizado"
            description="Para ajustes finos de diseño. Se aplica en todo el sistema al guardar (no se refleja en la vista previa)."
          >
            <Field error={errors.customCss} hint={`${draft.customCss.length.toLocaleString('es')} / 50 000 caracteres`}>
              <Textarea
                aria-label="CSS personalizado"
                rows={8}
                spellCheck={false}
                value={draft.customCss}
                onChange={(e) => set('customCss', e.target.value)}
                placeholder={'/* Ejemplo */\nh1 { letter-spacing: -0.02em; }'}
                className="font-mono text-xs"
              />
            </Field>
          </Section>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        invalid={invalid}
        onSave={() => void onSave()}
        onDiscard={() => {
          setDraft(source);
          setName(sourceName);
        }}
        extra={
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={resetStyle} title="Vuelve a los colores, fuente y forma originales">
            Estilo original
          </Button>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Apariencia del panel                                                */
/* ------------------------------------------------------------------ */

/** Fuentes con personalidad para títulos (se suman a las del texto). */
const HEADING_FONTS = [...new Set(['Poppins', 'Montserrat', 'Outfit', 'Playfair Display', 'Merriweather', 'Oswald', 'Raleway', 'Rubik', 'DM Sans', ...FONT_OPTIONS.filter((f) => f !== 'system-ui')])];

interface Tile<T extends string> {
  value: T;
  label: string;
  hint?: string;
  preview: ReactNode;
}

const miniCard = (style: CSSProperties) => <span className="block h-7 w-4/5 rounded-md" style={style} />;

const CARD_STYLES: Tile<Branding['cardStyle']>[] = [
  {
    value: 'elevated',
    label: 'Sombra suave',
    hint: 'Moderno y liviano',
    preview: miniCard({ background: '#fff', boxShadow: '0 6px 14px -6px rgb(15 23 42 / .35)', border: '1px solid rgb(15 23 42 / .05)' }),
  },
  { value: 'bordered', label: 'Con borde', hint: 'Clásico y ordenado', preview: miniCard({ background: '#fff', border: '1.5px solid rgb(15 23 42 / .2)' }) },
  { value: 'flat', label: 'Plano', hint: 'Sin bordes ni sombras', preview: miniCard({ background: '#fff' }) },
  {
    value: 'glass',
    label: 'Vidrio',
    hint: 'Translúcido, luce con degradado o imagen',
    preview: miniCard({ background: 'rgb(255 255 255 / .55)', border: '1px solid rgb(255 255 255 / .8)', backdropFilter: 'blur(4px)', boxShadow: '0 6px 14px -8px rgb(15 23 42 / .4)' }),
  },
];

const SIDEBAR_STYLES: (Omit<Tile<Branding['sidebarStyle']>, 'preview'> & { render: (primary: string) => ReactNode })[] = [
  { value: 'light', label: 'Claro', hint: 'Del color de las tarjetas', render: () => <MiniLayout nav="#ffffff" navFg="#0f172a" border /> },
  { value: 'dark', label: 'Oscuro', hint: 'Contraste elegante', render: () => <MiniLayout nav="#0f172a" navFg="#e2e8f0" /> },
  { value: 'brand', label: 'Color de la marca', hint: 'Con su color principal', render: (primary) => <MiniLayout nav={primary} navFg={readableOn(primary)} /> },
];

const BACKGROUND_STYLES: (Omit<Tile<Branding['backgroundStyle']>, 'preview'> & { render: (b: Branding) => ReactNode })[] = [
  { value: 'solid', label: 'Liso', render: (b) => <span className="block size-full" style={{ background: b.backgroundColor }} /> },
  {
    value: 'gradient',
    label: 'Degradado suave',
    render: (b) => (
      <span
        className="block size-full"
        style={{
          background: `radial-gradient(circle at 100% 0%, color-mix(in srgb, ${b.primaryColor} 30%, transparent), transparent 60%), radial-gradient(circle at 0% 100%, color-mix(in srgb, ${b.accentColor} 26%, transparent), transparent 60%), ${b.backgroundColor}`,
        }}
      />
    ),
  },
  {
    value: 'dots',
    label: 'Puntos',
    render: (b) => (
      <span className="block size-full" style={{ background: `radial-gradient(color-mix(in srgb, ${b.textColor} 22%, transparent) 1px, transparent 1.4px) 0 0 / 8px 8px, ${b.backgroundColor}` }} />
    ),
  },
  {
    value: 'image',
    label: 'Imagen propia',
    render: (b) =>
      b.backgroundImageUrl ? (
        <span className="block size-full bg-cover bg-center" style={{ backgroundImage: `url("${assetUrl(b.backgroundImageUrl)}")` }} />
      ) : (
        <span className="grid size-full place-items-center text-muted" style={{ background: b.backgroundColor }}>
          <Upload className="size-4" />
        </span>
      ),
  },
];

const DENSITIES: Tile<Branding['density']>[] = [
  {
    value: 'comfortable',
    label: 'Cómodo',
    hint: 'Más aire entre elementos',
    preview: (
      <span className="flex w-4/5 flex-col gap-1.5">
        <span className="h-2 rounded-full bg-fg/15" />
        <span className="h-2 rounded-full bg-fg/15" />
      </span>
    ),
  },
  {
    value: 'compact',
    label: 'Compacto',
    hint: 'Entra más información en pantalla',
    preview: (
      <span className="flex w-4/5 flex-col gap-0.5">
        <span className="h-1.5 rounded-full bg-fg/15" />
        <span className="h-1.5 rounded-full bg-fg/15" />
        <span className="h-1.5 rounded-full bg-fg/15" />
      </span>
    ),
  },
];

function MiniLayout({ nav, navFg, border }: { nav: string; navFg: string; border?: boolean }) {
  return (
    <span className="flex size-full overflow-hidden rounded-md" style={{ background: '#eef2f7' }}>
      <span className="flex w-1/3 flex-col gap-1 p-1.5" style={{ background: nav, borderRight: border ? '1px solid rgb(15 23 42 / .1)' : undefined }}>
        {[0.9, 0.5, 0.5].map((o, i) => (
          <span key={i} className="h-1.5 rounded-full" style={{ background: navFg, opacity: o }} />
        ))}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-1.5">
        <span className="h-3 rounded bg-white shadow-sm" />
        <span className="h-3 rounded bg-white shadow-sm" />
      </span>
    </span>
  );
}

function OptionTiles<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 4,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Tile<T>[];
  columns?: 2 | 3 | 4;
}) {
  const id = `tiles-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <span id={id} className="mb-2 block text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className={cx('grid grid-cols-2 gap-2', columns === 4 ? 'sm:grid-cols-4' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(o.value)}
              className={cx(
                'group rounded-ui border p-2 text-left transition',
                checked ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:border-primary/40 hover:bg-subtle',
              )}
            >
              <span className="grid h-14 place-items-center overflow-hidden rounded-[calc(var(--gc-radius)*0.6)] bg-gradient-to-br from-slate-100 to-slate-200">{o.preview}</span>
              <span className="mt-2 flex items-center gap-1 text-xs font-semibold">
                {o.label}
                {checked && <Check className="size-3.5 text-primary-text" aria-hidden />}
              </span>
              {o.hint && <span className="block text-[11px] leading-snug text-muted">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
