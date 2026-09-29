import { Check, ImageOff, Moon, RotateCcw, Sun, SunMoon, TriangleAlert, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { brandingSchema, type Branding, type MediaDTO } from '@gc/shared';
import { Button, ColorInput, Field, Input, RangeInput, Select, Textarea, cx, useFeedback } from '../../../components/ui';
import { assetUrl, errorMessage, upload } from '../../../lib/api';
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
      borderRadius: d.borderRadius,
      colorScheme: d.colorScheme,
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

          <Section title="Tipografía y forma">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Fuente" hint="Fuentes de Google Fonts. La vista previa se actualiza al instante.">
                <Select value={draft.fontFamily} onChange={(e) => set('fontFamily', e.target.value)} style={{ fontFamily: fontStack(draft.fontFamily) }}>
                  {fonts.map((f) => (
                    <option key={f} value={f}>
                      {f === 'system-ui' ? 'Fuente del sistema' : f}
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
            <p className="mt-4 rounded-ui bg-subtle px-4 py-3 text-lg" style={{ fontFamily: fontStack(draft.fontFamily) }}>
              {terms.ticket} A001 · {terms.counter} 3 — ÁÉÍÓÚ ñ 0123456789
            </p>
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
/* Imagen (logo / favicon)                                             */
/* ------------------------------------------------------------------ */

const IMAGE_TYPES = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif';

function ImageField({
  label,
  hint,
  value,
  onChange,
  uploadName,
  square,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  uploadName: string;
  square?: boolean;
}) {
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [value]);

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Seleccione una imagen (PNG, JPG, SVG, WebP o GIF)', 'error');
      return;
    }
    setProgress(0);
    try {
      const media = await upload<MediaDTO>('/media/upload', file, { name: uploadName, tags: 'branding' }, setProgress);
      onChange(media.url);
      toast('Imagen subida. Guarde los cambios para aplicarla.', 'info');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const src = value ? assetUrl(value) : '';
  const inputId = `img-${uploadName.toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-3">
        <div
          className={cx('grid shrink-0 place-items-center overflow-hidden rounded-ui border border-border', square ? 'size-20' : 'h-20 w-28')}
          style={{ backgroundImage: 'repeating-conic-gradient(var(--gc-subtle) 0% 25%, transparent 0% 50%)', backgroundSize: '14px 14px' }}
        >
          {src && !broken ? (
            <img src={src} alt={`${label} actual`} className="max-h-full max-w-full object-contain p-1.5" onError={() => setBroken(true)} />
          ) : (
            <ImageOff className={cx('size-6', broken ? 'text-red-500' : 'text-muted')} aria-label={broken ? 'No se pudo cargar la imagen' : 'Sin imagen'} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Input id={inputId} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} placeholder="https://… o suba un archivo" className="text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} loading={progress !== null} onClick={() => input.current?.click()}>
              {progress !== null ? `Subiendo ${Math.round(progress * 100)} %` : 'Subir imagen'}
            </Button>
            {value && (
              <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onChange(null)}>
                Quitar
              </Button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES}
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </div>
      </div>
      {broken && <p className="text-xs text-red-600">No se pudo cargar la imagen. Revise la dirección.</p>}
      {hint && !broken && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
