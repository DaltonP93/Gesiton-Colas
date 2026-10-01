import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, ExternalLink, Eye, Monitor, Pencil, RotateCcw, Rocket, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  LANDING_SOCIALS,
  LANDING_SOCIAL_LABELS,
  LANDING_TEMPLATES,
  LANDING_TEMPLATE_INFO,
  landingPlansOf,
  landingDomainSchema,
  type LandingSettings,
  type LandingTemplate,
  type PlatformSettings,
} from '@gc/shared';
import { ImageField } from '../../../components/ImageField';
import { Badge, Button, ColorInput, EmptyState, Field, IconButton, Input, Loading, Select, Tabs, Textarea, Toggle, cx, useFeedback } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { usePublicConfig } from '../../../lib/queries';
import { FONT_OPTIONS } from '../../../lib/theme';
import type { LandingPreviewMessage } from '../../landing/LandingPage';
import { LANDING_LOOKS } from '../../landing/LandingView';
import { ButtonEditor, ListEditor, SectionsPanel, type EditorFlags } from './SectionsPanel';

type Panel = 'diseno' | 'portada' | 'secciones' | 'menu' | 'publicacion';
type Device = 'desktop' | 'tablet' | 'mobile';
const DEVICES: Record<Device, { width: number; label: string; icon: ReactNode }> = {
  desktop: { width: 1280, label: 'Computadora', icon: <Monitor className="size-4" /> },
  tablet: { width: 820, label: 'Tablet', icon: <Tablet className="size-4" /> },
  mobile: { width: 390, label: 'Celular', icon: <Smartphone className="size-4" /> },
};

/** Editor de la página de presentación con vista previa en vivo (/plataforma/presentacion). */
export default function LandingEditorPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const settings = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => api.get<PlatformSettings>('/platform/settings') });
  const { data: config } = usePublicConfig();
  const [draft, setDraft] = useState<LandingSettings | null>(null);
  const [panel, setPanel] = useState<Panel>('diseno');
  const [device, setDevice] = useState<Device>('desktop');
  const [mobileView, setMobileView] = useState<'editar' | 'vista'>('editar');

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data.landing);
  }, [settings.data, draft]);

  const saved = settings.data?.landing;
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (landing: LandingSettings) => api.put<PlatformSettings>('/platform/settings', { landing }),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'settings'], data);
      setDraft(data.landing);
      void qc.invalidateQueries({ queryKey: ['public-config'] });
    },
  });

  const flags: EditorFlags = { allowSignup: config?.allowSignup ?? true, allowDemo: config?.allowDemo ?? true };
  const message = useMemo<LandingPreviewMessage | null>(
    () =>
      draft && settings.data
        ? { type: 'gc-landing-preview', landing: draft, plans: landingPlansOf({ plans: settings.data.plans, landing: draft }), brand: settings.data.brand, ...flags }
        : null,
    [draft, settings.data, flags.allowSignup, flags.allowDemo],
  );

  if (settings.isLoading) return <Loading />;
  if (settings.isError || !settings.data) {
    return (
      <div className="p-6">
        <EmptyState title="No se pudo cargar la página de presentación" description={errorMessage(settings.error)} />
      </div>
    );
  }
  if (!draft || !message) return <Loading />;

  const patch = <K extends keyof LandingSettings>(key: K, value: Partial<LandingSettings[K]>) =>
    setDraft((d) => (d ? { ...d, [key]: Array.isArray(value) ? value : { ...(d[key] as object), ...value } } : d));

  async function publish() {
    try {
      await save.mutateAsync(draft!);
      toast(draft!.enabled ? 'Página de presentación publicada.' : 'Cambios guardados.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function discard() {
    if (await confirm({ title: '¿Descartar los cambios?', message: 'Vuelve a lo que está publicado.', confirmLabel: 'Descartar', danger: true })) setDraft(saved!);
  }

  const homeIsLanding = settings.data.homePage === 'landing';
  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
        <Link
          to="/plataforma#ajustes"
          className="grid size-9 shrink-0 place-items-center rounded-ui hover:bg-subtle"
          aria-label="Volver a los ajustes de la plataforma"
          title="Volver"
          onClick={(e) => {
            if (!dirty) return;
            e.preventDefault();
            void confirm({ title: '¿Salir sin publicar?', message: 'Los cambios que no publicó se pierden.', confirmLabel: 'Salir', danger: true }).then((ok) => ok && navigate('/plataforma#ajustes'));
          }}
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">
            <span className="sm:hidden">Presentación</span>
            <span className="hidden sm:inline">Página de presentación</span>
          </h1>
          <p className="truncate text-xs text-muted">
            {dirty ? 'Cambios sin publicar' : draft.enabled ? 'Publicada' : 'No publicada'} · {LANDING_TEMPLATE_INFO[draft.template].name}
          </p>
        </div>
        <div className="hidden items-center rounded-ui border border-border p-0.5 lg:flex" role="group" aria-label="Tamaño de la vista previa">
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              title={DEVICES[d].label}
              onClick={() => setDevice(d)}
              className={cx('flex items-center gap-1.5 rounded-[calc(var(--gc-radius)-3px)] px-2.5 py-1.5 text-sm', device === d ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-subtle')}
            >
              {DEVICES[d].icon}
              <span className="hidden xl:inline">{DEVICES[d].label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <a href="/presentacion" target="_blank" rel="noopener noreferrer" className="hidden sm:block">
            <Button variant="ghost" icon={<ExternalLink className="size-4" />}>
              Ver publicada
            </Button>
          </a>
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} disabled={!dirty || save.isPending} onClick={() => void discard()}>
            <span className="hidden sm:inline">Descartar</span>
          </Button>
          <Button icon={<Rocket className="size-4" />} loading={save.isPending} disabled={!dirty} onClick={() => void publish()}>
            Publicar
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={cx('min-h-0 w-full shrink-0 flex-col border-r border-border bg-surface lg:flex lg:w-[27rem] xl:w-[30rem]', mobileView === 'editar' ? 'flex' : 'hidden')}>
          <div className="shrink-0 px-3 pt-2">
            <Tabs<Panel>
              value={panel}
              onChange={setPanel}
              tabs={[
                { value: 'diseno', label: 'Diseño' },
                { value: 'portada', label: 'Portada' },
                { value: 'secciones', label: 'Secciones' },
                { value: 'menu', label: 'Menú y pie' },
                { value: 'publicacion', label: 'Publicación' },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pb-24 lg:pb-6">
            {panel === 'diseno' && <DesignPanel draft={draft} brandColor={settings.data.brand.primaryColor} onTemplate={(template) => setDraft({ ...draft, template })} onTheme={(t) => patch('theme', t)} />}
            {panel === 'portada' && <HeroPanel draft={draft} onChange={(h) => patch('hero', h)} flags={flags} />}
            {panel === 'secciones' && <SectionsPanel sections={draft.sections} onChange={(sections) => setDraft({ ...draft, sections })} flags={flags} />}
            {panel === 'menu' && <MenuPanel draft={draft} onHeader={(h) => patch('header', h)} onFooter={(f) => patch('footer', f)} />}
            {panel === 'publicacion' && (
              <PublishPanel
                draft={draft}
                homeIsLanding={homeIsLanding}
                appUrl={config?.appUrl ?? window.location.origin}
                onChange={(p) => setDraft({ ...draft, ...p })}
                onSeo={(s) => patch('seo', s)}
              />
            )}
          </div>
        </aside>
        <main className={cx('min-w-0 flex-1 bg-subtle lg:block', mobileView === 'vista' ? 'block' : 'hidden')}>
          <PreviewFrame message={message} device={device} />
        </main>
      </div>

      {/* Celular y tablet: alterna entre el editor y la vista previa. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center gap-2 border-t border-border bg-surface/95 p-2 backdrop-blur lg:hidden">
        <Button variant={mobileView === 'editar' ? 'primary' : 'secondary'} icon={<Pencil className="size-4" />} onClick={() => setMobileView('editar')}>
          Editar
        </Button>
        <Button variant={mobileView === 'vista' ? 'primary' : 'secondary'} icon={<Eye className="size-4" />} onClick={() => setMobileView('vista')}>
          Vista previa
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista previa                                                         */
/* ------------------------------------------------------------------ */

function PreviewFrame({ message, device }: { message: LandingPreviewMessage; device: Device }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const latest = useRef(message);
  latest.current = message;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry!.contentRect.width, h: entry!.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: string })?.type === 'gc-landing-preview-ready') {
        setReady(true);
        frame.current?.contentWindow?.postMessage(latest.current, window.location.origin);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Envía el borrador a la vista previa (con una pequeña espera mientras se escribe).
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => frame.current?.contentWindow?.postMessage(message, window.location.origin), 120);
    return () => clearTimeout(t);
  }, [message, ready]);

  const pad = size.w < 640 ? 0 : 24;
  const width = DEVICES[device].width;
  const narrow = size.w > 0 && size.w < 640;
  // En pantallas angostas la vista previa usa el ancho disponible (sin achicar).
  const frameWidth = narrow ? size.w : width;
  const scale = narrow || !size.w ? 1 : Math.min(1, (size.w - pad * 2) / width);
  const height = Math.max(400, (size.h - pad * 2) / scale);
  return (
    <div ref={box} className="relative h-full overflow-hidden" style={{ padding: pad }}>
      <div className="mx-auto" style={{ width: frameWidth * scale, height: height * scale }}>
        <iframe
          ref={frame}
          title="Vista previa de la página de presentación"
          src="/presentacion?vista-previa"
          className={cx('origin-top-left bg-white', !narrow && 'rounded-xl border border-border shadow-xl')}
          style={{ width: frameWidth, height, transform: `scale(${scale})` }}
        />
      </div>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <Loading label="Cargando la vista previa…" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paneles                                                              */
/* ------------------------------------------------------------------ */

/** Dirección con enlace y botón para copiarla. */
function UrlRow({ url }: { url: string }) {
  const { toast } = useFeedback();
  return (
    <div className="flex items-center gap-1 rounded-ui bg-subtle py-1 pr-1 pl-3">
      <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs text-primary-text hover:underline" title={url}>
        {url}
      </a>
      <IconButton
        label="Copiar"
        className="size-8"
        icon={<Copy className="size-4" />}
        onClick={() =>
          void navigator.clipboard?.writeText(url).then(
            () => toast('Dirección copiada.'),
            () => toast('No se pudo copiar.', 'error'),
          )
        }
      />
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Miniatura de una plantilla con sus colores. */
/** «#abc» → «#aabbcc» (para sumarle transparencia). */
const hex6 = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);

function TemplateThumb({ template, primary: rawPrimary, accent: rawAccent }: { template: LandingTemplate; primary: string; accent: string }) {
  const look = LANDING_LOOKS[template];
  const primary = hex6(rawPrimary);
  const accent = hex6(rawAccent);
  const info = LANDING_TEMPLATE_INFO[template];
  const heroBg =
    look.hero === 'brand'
      ? primary
      : look.hero === 'gradient'
        ? `linear-gradient(135deg, ${primary}, ${accent})`
        : look.hero === 'mesh'
          ? `radial-gradient(circle at 15% 20%, ${primary}33, transparent 45%), radial-gradient(circle at 85% 10%, ${accent}33, transparent 45%), ${look.bg}`
          : look.hero === 'grid'
            ? `radial-gradient(ellipse at top, ${accent}55, transparent 60%), ${look.bg}`
            : look.bg;
  const onColor = look.hero === 'brand' || look.hero === 'gradient';
  const line = onColor ? 'rgba(255,255,255,.9)' : look.fg;
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-[6px] border border-border" style={{ background: look.bg, '--lp-primary': primary } as CSSProperties} aria-hidden>
      <div className="flex h-[16%] items-center gap-1 px-2" style={{ borderBottom: `1px solid ${look.border}` }}>
        <span className="size-2 rounded-sm" style={{ background: primary }} />
        <span className="h-1 w-6 rounded-full opacity-60" style={{ background: look.fg }} />
        <span className="ml-auto h-2 w-5 rounded-full" style={{ background: primary }} />
      </div>
      <div className={cx('flex h-[52%] gap-2 px-2.5 py-2', info.heroLayout === 'centered' ? 'flex-col items-center justify-center' : 'items-center')} style={{ background: heroBg }}>
        <div className={cx('space-y-1', info.heroLayout === 'centered' ? 'flex flex-col items-center' : 'flex-1')}>
          <span className="block h-1.5 w-16 rounded-full" style={{ background: line }} />
          <span className="block h-1.5 w-12 rounded-full" style={{ background: onColor ? 'rgba(255,255,255,.9)' : primary }} />
          <span className="mt-1 block h-2 w-7" style={{ background: onColor ? '#fff' : primary, borderRadius: look.pill ? 99 : 2 }} />
        </div>
        {info.heroLayout === 'split' && <span className="block h-[70%] w-[40%] rounded-[3px] bg-slate-800" />}
      </div>
      <div className="grid h-[32%] grid-cols-3 gap-1.5 px-2.5 py-2" style={{ background: look.alternate ? look.alt : look.bg }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="block rounded-[3px]" style={{ background: look.icon === 'outline' ? 'transparent' : info.dark ? 'rgba(255,255,255,.06)' : '#fff', border: `1px solid ${look.border}` }} />
        ))}
      </div>
    </div>
  );
}

function DesignPanel({
  draft,
  brandColor,
  onTemplate,
  onTheme,
}: {
  draft: LandingSettings;
  brandColor: string;
  onTemplate: (t: LandingTemplate) => void;
  onTheme: (t: Partial<LandingSettings['theme']>) => void;
}) {
  const info = LANDING_TEMPLATE_INFO[draft.template];
  const primary = draft.theme.primaryColor || brandColor;
  return (
    <>
      <Group title="Plantilla" hint="Cambia el estilo sin perder los textos ni las imágenes.">
        <div className="grid grid-cols-2 gap-3">
          {LANDING_TEMPLATES.map((t) => {
            const selected = draft.template === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={selected}
                onClick={() => onTemplate(t)}
                className={cx('relative rounded-ui border p-2 text-left transition', selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40')}
              >
                <TemplateThumb template={t} primary={primary} accent={draft.theme.accentColor || LANDING_TEMPLATE_INFO[t].accent} />
                <span className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                  {LANDING_TEMPLATE_INFO[t].name}
                  {selected && <Check className="size-4 text-primary-text" />}
                </span>
                <span className="block text-xs leading-snug text-muted">{LANDING_TEMPLATE_INFO[t].description}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Colores">
        <Toggle
          checked={!draft.theme.primaryColor}
          onChange={(on) => onTheme({ primaryColor: on ? '' : brandColor })}
          label="Color principal de la marca"
          hint={`El mismo de la plataforma (${brandColor}). Apáguelo para elegir otro.`}
        />
        {draft.theme.primaryColor && <ColorInput label="Color principal" value={draft.theme.primaryColor} onChange={(v) => onTheme({ primaryColor: v })} />}
        <Toggle
          checked={!draft.theme.accentColor}
          onChange={(on) => onTheme({ accentColor: on ? '' : info.accent })}
          label="Color de acento de la plantilla"
          hint="Se usa en degradés, resaltados y detalles."
        />
        {draft.theme.accentColor && <ColorInput label="Color de acento" value={draft.theme.accentColor} onChange={(v) => onTheme({ accentColor: v })} />}
      </Group>

      <Group title="Tipografía">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Textos">
            <Select value={draft.theme.font} onChange={(e) => onTheme({ font: e.target.value })}>
              <option value="">De la plantilla ({info.font})</option>
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Títulos">
            <Select value={draft.theme.headingFont} onChange={(e) => onTheme({ headingFont: e.target.value })}>
              <option value="">{draft.theme.font ? `Igual que los textos (${draft.theme.font})` : `De la plantilla (${info.headingFont})`}</option>
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="Forma">
        <Field label="Esquinas">
          <Select value={draft.theme.radius} onChange={(e) => onTheme({ radius: e.target.value as LandingSettings['theme']['radius'] })}>
            <option value="auto">De la plantilla</option>
            <option value="none">Rectas</option>
            <option value="sm">Suaves</option>
            <option value="md">Redondeadas</option>
            <option value="lg">Muy redondeadas</option>
          </Select>
        </Field>
        <Field label="Portada">
          <Select value={draft.theme.heroLayout} onChange={(e) => onTheme({ heroLayout: e.target.value as LandingSettings['theme']['heroLayout'] })}>
            <option value="auto">De la plantilla ({info.heroLayout === 'split' ? 'texto e imagen lado a lado' : 'todo centrado'})</option>
            <option value="split">Texto a la izquierda, imagen a la derecha</option>
            <option value="centered">Todo centrado</option>
          </Select>
        </Field>
      </Group>
    </>
  );
}

function HeroPanel({ draft, onChange, flags }: { draft: LandingSettings; onChange: (h: Partial<LandingSettings['hero']>) => void; flags: EditorFlags }) {
  const { hero } = draft;
  const missingHighlight = hero.highlight && !hero.title.includes(hero.highlight);
  return (
    <>
      <Field label="Etiqueta" hint="Texto corto sobre el título. Vacío = sin etiqueta.">
        <Input value={hero.badge} maxLength={80} onChange={(e) => onChange({ badge: e.target.value })} />
      </Field>
      <Field label="Título">
        <Textarea rows={2} value={hero.title} maxLength={160} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field label="Palabras resaltadas" hint={missingHighlight ? undefined : 'Una parte del título que se pinta con color.'} error={missingHighlight ? 'No aparece tal cual en el título.' : undefined}>
        <Input value={hero.highlight} maxLength={80} onChange={(e) => onChange({ highlight: e.target.value })} />
      </Field>
      <Field label="Texto de apoyo" hint="{{nombre}} se reemplaza por el nombre de la plataforma.">
        <Textarea rows={3} value={hero.subtitle} maxLength={400} onChange={(e) => onChange({ subtitle: e.target.value })} />
      </Field>
      <Field label="Imagen de la portada">
        <Select value={hero.media} onChange={(e) => onChange({ media: e.target.value as LandingSettings['hero']['media'] })}>
          <option value="mockup">Pantalla de ejemplo con llamados</option>
          <option value="image">Imagen propia</option>
          <option value="none">Sin imagen</option>
        </Select>
      </Field>
      {hero.media === 'image' && (
        <ImageField label="Imagen" hint="Foto de su producto o de una sala de espera. Mejor horizontal." value={hero.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} uploadName="Portada de la presentación" uploadPath="/platform/assets" />
      )}
      <ButtonEditor label="Botón principal" value={hero.primary} onChange={(primary) => onChange({ primary })} flags={flags} />
      <Toggle checked={hero.secondary !== null} onChange={(on) => onChange({ secondary: on ? { label: 'Recibir una demo por correo', action: 'demo', url: '' } : null })} label="Segundo botón" />
      {hero.secondary && <ButtonEditor label="Segundo botón" value={hero.secondary} onChange={(secondary) => onChange({ secondary })} flags={flags} />}
      <Toggle checked={hero.showLoginHint} onChange={(showLoginHint) => onChange({ showLoginHint })} label="Mostrar «¿Ya tiene cuenta? Ingrese aquí»" />
    </>
  );
}

function MenuPanel({ draft, onHeader, onFooter }: { draft: LandingSettings; onHeader: (h: Partial<LandingSettings['header']>) => void; onFooter: (f: Partial<LandingSettings['footer']>) => void }) {
  const { header, footer } = draft;
  return (
    <>
      <Group title="Menú de arriba" hint="Las secciones con «Nombre en el menú» aparecen como enlaces.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ingresar">
            <Input value={header.loginLabel} maxLength={30} onChange={(e) => onHeader({ loginLabel: e.target.value })} />
          </Field>
          <Field label="Registro">
            <Input value={header.signupLabel} maxLength={30} onChange={(e) => onHeader({ signupLabel: e.target.value })} />
          </Field>
          <Field label="Demo">
            <Input value={header.demoLabel} maxLength={30} onChange={(e) => onHeader({ demoLabel: e.target.value })} />
          </Field>
        </div>
        <Toggle checked={header.showApi} onChange={(showApi) => onHeader({ showApi })} label="Enlace a la documentación de la API" hint="Útil si vende integraciones a otros sistemas." />
      </Group>
      <Group title="Pie de página">
        <Field label="Texto">
          <Textarea rows={2} value={footer.text} maxLength={300} onChange={(e) => onFooter({ text: e.target.value })} placeholder="Una frase sobre su empresa" />
        </Field>
        <ListEditor
          label="Enlaces"
          items={footer.links}
          max={8}
          create={() => ({ label: '', url: '' })}
          onChange={(links) => onFooter({ links })}
          render={(item, change) => (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
              <Input aria-label="Texto del enlace" value={item.label} maxLength={40} onChange={(e) => change({ ...item, label: e.target.value })} placeholder="Blog" />
              <Input aria-label="Dirección del enlace" value={item.url} maxLength={2048} onChange={(e) => change({ ...item, url: e.target.value })} placeholder="https://…" />
            </div>
          )}
        />
      </Group>
      <Group title="Redes sociales" hint="Dirección completa de cada perfil. Las vacías no se muestran.">
        {LANDING_SOCIALS.map((n) => (
          <Field key={n} label={LANDING_SOCIAL_LABELS[n]}>
            <Input
              value={footer.social[n] ?? ''}
              maxLength={300}
              onChange={(e) => onFooter({ social: { ...footer.social, [n]: e.target.value } })}
              placeholder={n === 'whatsapp' ? 'Número con código de país o enlace wa.me' : `https://${n === 'x' ? 'x' : n}.com/suempresa`}
            />
          </Field>
        ))}
      </Group>
    </>
  );
}

function PublishPanel({
  draft,
  homeIsLanding,
  appUrl,
  onChange,
  onSeo,
}: {
  draft: LandingSettings;
  homeIsLanding: boolean;
  appUrl: string;
  onChange: (p: Partial<LandingSettings>) => void;
  onSeo: (s: Partial<LandingSettings['seo']>) => void;
}) {
  const origin = window.location.origin;
  const [domain, setDomain] = useState(draft.domain);
  useEffect(() => setDomain(draft.domain), [draft.domain]);
  const domainOk = landingDomainSchema.safeParse(domain).success;
  return (
    <>
      <Group title="Publicación">
        <Toggle
          checked={draft.enabled}
          disabled={homeIsLanding && draft.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label="Página de presentación publicada"
          hint={homeIsLanding ? 'Es la página principal. Para despublicarla, elija otra en Ajustes → Página principal.' : 'Apagada, /presentacion lleva al ingreso.'}
        />
      </Group>
      <Group title="Direcciones" hint="La presentación y el ingreso tienen direcciones distintas.">
        <div className="space-y-3 rounded-ui border border-border p-3 text-sm">
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium">
              Presentación <Badge color={draft.enabled ? '#16a34a' : '#64748b'}>{draft.enabled ? 'Publicada' : 'No publicada'}</Badge>
            </p>
            <UrlRow url={`${origin}/presentacion`} />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Dirección principal</p>
            <UrlRow url={`${origin}/`} />
            <p className="text-xs text-muted">
              Hoy muestra {homeIsLanding ? 'esta presentación' : 'otra página'}.{' '}
              <Link to="/plataforma#ajustes" className="font-medium text-primary-text hover:underline">
                Cambiarlo en Ajustes → Página principal
              </Link>
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Ingreso al panel</p>
            <UrlRow url={`${appUrl}/login`} />
          </div>
        </div>
      </Group>
      <Group
        title="Dominio propio (opcional)"
        hint="Por ejemplo, la presentación en www.suempresa.com y el panel en app.suempresa.com. Abierto con este dominio, la dirección principal muestra siempre la presentación y los botones llevan al panel."
      >
        <Field label="Dominio de la presentación" error={!domainOk ? 'Escríbalo sin https:// ni barras, p. ej. www.suempresa.com' : undefined}>
          <Input value={domain} maxLength={253} onChange={(e) => setDomain(e.target.value)} onBlur={() => domainOk && onChange({ domain: domain.trim().toLowerCase() })} placeholder="www.suempresa.com" />
        </Field>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>En su proveedor de dominio, apunte ese dominio (registro A o CNAME) al mismo servidor del panel.</li>
          <li>En el proxy (Caddy, Nginx o Traefik) agregue el dominio al mismo sitio, con su certificado HTTPS.</li>
          <li>
            El panel sigue en <span className="font-mono">{appUrl}</span> (variable PUBLIC_URL).
          </li>
        </ol>
      </Group>
      <Group title="Buscadores y redes" hint="Cómo se ve el enlace al compartirlo por WhatsApp, Facebook o LinkedIn, y en Google.">
        <Field label="Título" hint={`${draft.seo.title.length} de 80. Vacío = nombre de la plataforma.`}>
          <Input value={draft.seo.title} maxLength={80} onChange={(e) => onSeo({ title: e.target.value })} />
        </Field>
        <Field label="Descripción" hint={`${draft.seo.description.length} de 200. Vacío = el texto de apoyo de la portada.`}>
          <Textarea rows={3} value={draft.seo.description} maxLength={200} onChange={(e) => onSeo({ description: e.target.value })} />
        </Field>
        <ImageField label="Imagen al compartir" hint="Horizontal, 1200 × 630 px. Vacía = la de la portada o el logo." value={draft.seo.imageUrl} onChange={(imageUrl) => onSeo({ imageUrl })} uploadName="Imagen para compartir" uploadPath="/platform/assets" />
      </Group>
    </>
  );
}
