import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  ExternalLink,
  Headset,
  Link2,
  Loader2,
  Minus,
  MonitorPlay,
  Plus,
  Sparkles,
  Tablet,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  defaultDisplayConfig,
  deepMerge,
  type Branding,
  type CounterDTO,
  type DisplayConfig,
  type MediaDTO,
  type ServiceDTO,
  type Terminology,
} from '@gc/shared';
import { SERVICE_ICONS, ServiceIcon } from '../../../components/ServiceIcon';
import { Button, Field, Input, Loading, Toggle, cx, useFeedback } from '../../../components/ui';
import { api, assetUrl, errorMessage, upload } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useBranches, useCounters, useDisplays, useKiosks, useServices } from '../../../lib/queries';
import { readableOn } from '../../../lib/theme';
import { BrandingPreview } from '../customization/BrandingPreview';
import { PALETTES } from '../customization/presets';
import { LAYOUTS, LayoutThumb } from '../DisplaysPage';
import { INDUSTRIES, type Industry } from './industries';

/* ------------------------------------------------------------------ */
/* Estado del asistente                                                */
/* ------------------------------------------------------------------ */

interface ServiceRow {
  key: string;
  existingId: string | null;
  name: string;
  prefix: string;
  color: string;
  icon: string;
  minutes: number;
  enabled: boolean;
}

type TvTheme = 'brand' | 'dark' | 'light';

interface Draft {
  orgName: string;
  industry: string;
  terms: Terminology;
  logoUrl: string | null;
  palette: string;
  sidebarStyle: Branding['sidebarStyle'];
  branchName: string;
  address: string;
  counterCount: number;
  services: ServiceRow[];
  layout: DisplayConfig['layout'];
  tvTheme: TvTheme;
  askPriority: boolean;
  askName: boolean;
  print: boolean;
}

const STEPS = ['Su rubro', 'Marca', 'Sucursal', 'Servicios', 'Pantalla y kiosco'] as const;

const newKey = () => Math.random().toString(36).slice(2, 10);

const ICON_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  users: 'Personas',
  user: 'Persona',
  wallet: 'Billetera',
  cash: 'Efectivo',
  card: 'Tarjeta',
  bank: 'Banco',
  receipt: 'Recibo',
  file: 'Documento',
  clipboard: 'Planilla',
  calendar: 'Agenda',
  health: 'Salud',
  doctor: 'Médico',
  pharmacy: 'Farmacia',
  baby: 'Bebé',
  shield: 'Seguro',
  cart: 'Compras',
  package: 'Paquete',
  truck: 'Envíos',
  tools: 'Herramientas',
  briefcase: 'Maletín',
  building: 'Edificio',
  help: 'Ayuda',
};

function tvThemeColors(choice: TvTheme, primary: string, accent: string): Partial<DisplayConfig['theme']> {
  if (choice === 'light') return { background: '#f1f5f9', text: '#0f172a', panelBackground: '#ffffff', accent: primary, callBackground: primary, callText: readableOn(primary) };
  if (choice === 'dark') return { background: '#0f172a', text: '#f8fafc', panelBackground: '#1e293b', accent: '#38bdf8', callBackground: '#2563eb', callText: '#ffffff' };
  return { background: '#0b1220', text: '#f8fafc', panelBackground: '#1a2438', accent, callBackground: primary, callText: readableOn(primary) };
}

/** Siguiente letra libre para el prefijo de un servicio. */
function freePrefix(wanted: string, used: Set<string>) {
  const clean = wanted.trim().toUpperCase().slice(0, 5) || 'A';
  if (!used.has(clean)) return clean;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(letter)) return letter;
  return clean;
}

export default function SetupWizard() {
  const { me, settings, terms: currentTerms, refresh } = useAuth();
  const branches = useBranches();
  const services = useServices();
  const displays = useDisplays();
  const kiosks = useKiosks();
  const branch = branches.data?.[0] ?? null;
  const counters = useCounters(branch?.id);
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paletteTouched, setPaletteTouched] = useState(false);
  const [applying, setApplying] = useState<null | { done: number; failed?: string }>(null);
  const [finished, setFinished] = useState(false);

  const ready = branches.isSuccess && services.isSuccess && counters.isSuccess && displays.isSuccess && kiosks.isSuccess;

  // Estado inicial a partir de lo que ya tiene la organización.
  useEffect(() => {
    if (!ready || draft) return;
    const industry = INDUSTRIES.find((i) => i.id === settings.onboarding.industry)?.id ?? '';
    const palette = PALETTES.find((p) => p.colors.primaryColor.toLowerCase() === settings.branding.primaryColor.toLowerCase())?.name ?? PALETTES[0]!.name;
    const kiosk = kiosks.data?.[0];
    const display = displays.data?.[0];
    setDraft({
      orgName: me?.tenant?.name ?? '',
      industry,
      terms: currentTerms,
      logoUrl: settings.branding.logoUrl,
      palette,
      sidebarStyle: settings.branding.sidebarStyle,
      branchName: branch?.name ?? 'Casa central',
      address: branch?.address ?? '',
      counterCount: Math.max(1, counters.data?.filter((c) => c.active).length ?? 3),
      services: (services.data ?? []).map((s) => ({
        key: s.id,
        existingId: s.id,
        name: s.name,
        prefix: s.prefix,
        color: s.color,
        icon: s.icon,
        minutes: s.estimatedMinutes,
        enabled: s.active,
      })),
      layout: display?.config.layout ?? 'split',
      tvTheme: 'brand',
      askPriority: kiosk ? kiosk.config.priorityMode !== 'none' : true,
      askName: kiosk ? kiosk.config.askFields.includes('name') : false,
      print: kiosk ? kiosk.config.print.enabled : true,
    });
  }, [ready, draft, me, settings, currentTerms, branch, counters.data, services.data, displays.data, kiosks.data]);

  if (!ready || !draft) return <Loading label="Preparando el asistente…" />;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const industry = INDUSTRIES.find((i) => i.id === draft.industry) ?? null;
  const palette = PALETTES.find((p) => p.name === draft.palette) ?? PALETTES[0]!;
  const branding: Branding = { ...settings.branding, ...palette.colors, colorScheme: palette.colorScheme ?? 'light', logoUrl: draft.logoUrl, sidebarStyle: draft.sidebarStyle };

  function chooseIndustry(next: Industry) {
    if (!draft) return;
    const terms = { ...draft.terms, ...next.terms } as Terminology;
    // Servicios: se conservan los existentes y se agregan los sugeridos que falten.
    // Con un rubro elegido, los servicios genéricos de ejemplo quedan desactivados (se pueden volver a marcar).
    const generic = new Set(['atención al cliente', 'caja']);
    const existing = draft.services
      .filter((s) => s.existingId)
      .map((s) =>
        next.services.length > 0 && generic.has(s.name.toLowerCase()) && !next.services.some((t) => t.name.toLowerCase() === s.name.toLowerCase())
          ? { ...s, enabled: false }
          : s,
      );
    const names = new Set(existing.map((s) => s.name.trim().toLowerCase()));
    const used = new Set(existing.filter((s) => s.enabled).map((s) => s.prefix.toUpperCase()));
    const suggested = next.services
      .filter((t) => !names.has(t.name.toLowerCase()))
      .map((t) => {
        const prefix = freePrefix(t.prefix, used);
        used.add(prefix);
        return { key: newKey(), existingId: null, name: t.name, prefix, color: t.color, icon: t.icon, minutes: t.minutes, enabled: true };
      });
    set({
      industry: next.id,
      terms,
      services: [...existing, ...suggested],
      layout: next.layout,
      askName: next.askName,
      ...(!paletteTouched && next.palette ? { palette: next.palette } : {}),
    });
  }

  const enabledServices = draft.services.filter((s) => s.enabled && s.name.trim());
  const prefixes = enabledServices.map((s) => s.prefix.trim().toUpperCase());
  const duplicatePrefix = prefixes.find((p, i) => p && prefixes.indexOf(p) !== i);
  const canContinue = [
    draft.orgName.trim().length >= 2 && Boolean(draft.industry),
    true,
    draft.branchName.trim().length > 0 && draft.counterCount >= 1,
    enabledServices.length > 0 && !duplicatePrefix,
    true,
  ][step];

  async function dismiss() {
    try {
      await api.put('/tenant', { settings: { onboarding: { dismissed: true } } });
      await refresh();
    } finally {
      navigate('/app');
    }
  }

  /* ------------------------------ Aplicar ------------------------------ */
  async function apply() {
    if (!draft || !branch) return;
    const d = draft;
    const tasks: { label: string; run: () => Promise<unknown> }[] = [
      {
        label: 'Marca y terminología',
        run: () =>
          api.put('/tenant', {
            name: d.orgName.trim(),
            settings: {
              branding: { ...palette.colors, colorScheme: palette.colorScheme ?? 'light', logoUrl: d.logoUrl, sidebarStyle: d.sidebarStyle },
              terminology: d.terms,
            },
          }),
      },
      {
        label: `${d.terms.branch} y ${d.terms.counters.toLowerCase()}`,
        run: async () => {
          await api.put(`/branches/${branch.id}`, { name: d.branchName.trim(), address: d.address.trim() });
          const list = [...(counters.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
          const generic = /^\S+\s+\d+$/;
          const jobs: Promise<unknown>[] = [];
          list.forEach((c: CounterDTO, i) => {
            if (i < d.counterCount) {
              const name = generic.test(c.name) ? `${d.terms.counter} ${i + 1}` : c.name;
              if (name !== c.name || !c.active) jobs.push(api.put(`/counters/${c.id}`, { name, active: true }));
            } else if (c.active) {
              jobs.push(api.put(`/counters/${c.id}`, { active: false }));
            }
          });
          for (let i = list.length; i < d.counterCount; i++) {
            jobs.push(api.post('/counters', { branchId: branch.id, name: `${d.terms.counter} ${i + 1}`, sortOrder: i + 1 }));
          }
          await Promise.all(jobs);
        },
      },
      {
        label: d.terms.services,
        run: async () => {
          const original = new Map((services.data ?? []).map((s: ServiceDTO) => [s.id, s]));
          let order = 0;
          for (const row of d.services) {
            const payload = {
              name: row.name.trim(),
              prefix: row.prefix.trim().toUpperCase(),
              color: row.color,
              icon: row.icon,
              estimatedMinutes: Math.max(1, Math.round(row.minutes)),
              active: row.enabled,
              sortOrder: order++,
            };
            if (!payload.name) continue;
            if (row.existingId) {
              const before = original.get(row.existingId);
              const changed =
                !before ||
                before.name !== payload.name ||
                before.prefix !== payload.prefix ||
                before.active !== payload.active ||
                before.color !== payload.color ||
                before.icon !== payload.icon ||
                before.estimatedMinutes !== payload.estimatedMinutes;
              if (changed) await api.put(`/services/${row.existingId}`, payload);
            } else if (row.enabled) {
              await api.post('/services', payload);
            }
          }
        },
      },
      {
        label: 'Pantalla y kiosco',
        run: async () => {
          const display = displays.data?.[0];
          const kiosk = kiosks.data?.[0];
          const jobs: Promise<unknown>[] = [];
          if (display) {
            const theme = { ...display.config.theme, ...tvThemeColors(d.tvTheme, palette.colors.primaryColor, palette.colors.accentColor) };
            jobs.push(api.put(`/displays/${display.id}`, { config: { layout: d.layout, theme } }));
          }
          if (kiosk) {
            const askFields = d.askName ? [...new Set(['name', ...kiosk.config.askFields])] : kiosk.config.askFields.filter((f) => f !== 'name');
            jobs.push(
              api.put(`/kiosks/${kiosk.id}`, {
                config: {
                  priorityMode: d.askPriority ? (kiosk.config.priorityMode === 'none' ? 'buttons' : kiosk.config.priorityMode) : 'none',
                  askFields,
                  print: { ...kiosk.config.print, enabled: d.print },
                  theme: {
                    ...kiosk.config.theme,
                    buttonBackground: palette.colors.primaryColor,
                    buttonText: readableOn(palette.colors.primaryColor),
                    priorityButtonBackground: palette.colors.accentColor,
                  },
                },
              }),
            );
          }
          await Promise.all(jobs);
        },
      },
      {
        label: 'Terminar',
        run: () => api.put('/tenant', { settings: { onboarding: { completed: true, dismissed: false, industry: d.industry } } }),
      },
    ];

    setApplying({ done: 0 });
    for (let i = 0; i < tasks.length; i++) {
      try {
        await tasks[i]!.run();
        setApplying({ done: i + 1 });
      } catch (e) {
        setApplying({ done: i, failed: `${tasks[i]!.label}: ${errorMessage(e)}` });
        toast(errorMessage(e), 'error');
        return;
      }
    }
    await refresh();
    await qc.invalidateQueries();
    setFinished(true);
  }

  /* ------------------------------ Vista ------------------------------ */
  if (finished) return <Finished />;

  const applyLabels = ['Marca y terminología', `${draft.terms.branch} y ${draft.terms.counters.toLowerCase()}`, draft.terms.services, 'Pantalla y kiosco', 'Terminar'];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-primary-text uppercase">
            <Sparkles className="size-4" /> Asistente de configuración
          </p>
          <h1 className="mt-1 text-[1.9rem] leading-tight font-bold tracking-tight">Configuremos {draft.orgName.trim() || 'su organización'}</h1>
          <p className="mt-1 text-sm text-muted">Cinco pasos cortos. Puede cambiar todo después desde Configuración.</p>
        </div>
        {!settings.onboarding.completed && (
          <Button variant="ghost" icon={<X className="size-4" />} onClick={() => void dismiss()}>
            Omitir por ahora
          </Button>
        )}
      </div>

      <Stepper step={step} onJump={(i) => i < step && setStep(i)} />

      <div className="gc-card mt-6 p-5 sm:p-8">
        {applying ? (
          <ApplyProgress labels={applyLabels} done={applying.done} failed={applying.failed} onRetry={() => void apply()} onBack={() => setApplying(null)} />
        ) : (
          <>
            {step === 0 && <IndustryStep draft={draft} set={set} onChoose={chooseIndustry} />}
            {step === 1 && (
              <BrandStep
                draft={draft}
                set={set}
                branding={branding}
                onPalette={(name) => {
                  setPaletteTouched(true);
                  set({ palette: name });
                }}
              />
            )}
            {step === 2 && <BranchStep draft={draft} set={set} />}
            {step === 3 && <ServicesStep draft={draft} set={set} industry={industry} duplicatePrefix={duplicatePrefix} />}
            {step === 4 && <DevicesStep draft={draft} set={set} primary={palette.colors.primaryColor} accent={palette.colors.accentColor} />}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                Atrás
              </Button>
              <p className="text-sm text-muted">
                Paso {step + 1} de {STEPS.length}
              </p>
              {step < STEPS.length - 1 ? (
                <Button disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
                  Siguiente <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button icon={<Check className="size-4" />} disabled={!canContinue} onClick={() => void apply()}>
                  Aplicar configuración
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Pasos">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={!done}
              aria-current={current ? 'step' : undefined}
              className={cx('flex min-w-0 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium whitespace-nowrap', done && 'hover:bg-subtle')}
            >
              <span
                className={cx(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                  done ? 'bg-primary text-primary-fg' : current ? 'bg-primary/15 text-primary-text ring-2 ring-primary' : 'bg-subtle text-muted',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cx(current ? 'text-fg' : 'text-muted', 'hidden sm:inline')}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={cx('h-0.5 min-w-4 flex-1 rounded-full', done ? 'bg-primary' : 'bg-border')} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function StepTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  );
}

type StepProps = { draft: Draft; set: (patch: Partial<Draft>) => void };

function IndustryStep({ draft, set, onChoose }: StepProps & { onChoose: (i: Industry) => void }) {
  return (
    <div>
      <StepTitle title="¿A qué se dedica su organización?" description="Con esto proponemos las palabras, los servicios y los colores. Nada queda fijo." />
      <Field label="Nombre de la organización" required className="mb-6 max-w-lg">
        <Input value={draft.orgName} onChange={(e) => set({ orgName: e.target.value })} maxLength={120} placeholder="Ej.: Clínica San José" />
      </Field>
      <div role="radiogroup" aria-label="Rubro" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INDUSTRIES.map((ind) => {
          const checked = draft.industry === ind.id;
          const example = ind.terms.ticket ? `${ind.terms.ticket} · ${ind.terms.counter}` : 'Terminología actual';
          return (
            <button
              key={ind.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChoose(ind)}
              className={cx(
                'flex items-start gap-3 rounded-ui border p-4 text-left transition',
                checked ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'border-border hover:border-primary/40 hover:bg-subtle',
              )}
            >
              <span className={cx('grid size-11 shrink-0 place-items-center rounded-ui', checked ? 'bg-primary text-primary-fg' : 'bg-subtle text-muted')}>
                <ServiceIcon name={ind.icon} className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{ind.name}</span>
                <span className="block text-xs text-muted">{ind.description}</span>
                <span className="mt-1.5 inline-block rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium">{example}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BrandStep({ draft, set, branding, onPalette }: StepProps & { branding: Branding; onPalette: (name: string) => void }) {
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast('Seleccione una imagen (PNG, JPG, SVG o WebP)', 'error');
    setUploading(true);
    try {
      const media = await upload<MediaDTO>('/media/upload', file, { name: 'Logo', tags: 'branding' });
      set({ logoUrl: media.url });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
      <div>
        <StepTitle title="Su marca" description="El logo y los colores se usan en el panel, las pantallas, el kiosco y el ticket." />
        <div className="space-y-6">
          <div>
            <span className="mb-2 block text-sm font-medium">Logo</span>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="grid h-16 w-28 place-items-center overflow-hidden rounded-ui border border-border"
                style={{ backgroundImage: 'repeating-conic-gradient(var(--gc-subtle) 0% 25%, transparent 0% 50%)', backgroundSize: '12px 12px' }}
              >
                {draft.logoUrl ? <img src={assetUrl(draft.logoUrl)} alt="Logo" className="max-h-full max-w-full object-contain p-1" /> : <Upload className="size-5 text-muted" />}
              </span>
              <Button variant="secondary" icon={<Upload className="size-4" />} loading={uploading} onClick={() => input.current?.click()}>
                {draft.logoUrl ? 'Cambiar logo' : 'Subir logo'}
              </Button>
              {draft.logoUrl && (
                <Button variant="ghost" icon={<X className="size-4" />} onClick={() => set({ logoUrl: null })}>
                  Quitar
                </Button>
              )}
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">Opcional. PNG o SVG con fondo transparente queda mejor.</p>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium">Colores</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PALETTES.map((p) => {
                const checked = p.name === draft.palette;
                return (
                  <button
                    key={p.name}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => onPalette(p.name)}
                    className={cx('rounded-ui border p-2 text-left transition', checked ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-primary/40')}
                  >
                    <span className="flex h-7 overflow-hidden rounded-md" aria-hidden>
                      <span className="flex-[3]" style={{ background: p.colors.primaryColor }} />
                      <span className="flex-1" style={{ background: p.colors.accentColor }} />
                      <span className="flex-[2]" style={{ background: p.colors.backgroundColor }} />
                    </span>
                    <span className="mt-1.5 flex items-center gap-1 text-xs font-medium">
                      {p.name}
                      {checked && <Check className="size-3.5 text-primary-text" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium">Menú lateral</span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: 'light', label: 'Claro' },
                  { value: 'dark', label: 'Oscuro' },
                  { value: 'brand', label: 'Color de la marca' },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={draft.sidebarStyle === o.value}
                  onClick={() => set({ sidebarStyle: o.value })}
                  className={cx(
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition',
                    draft.sidebarStyle === o.value ? 'border-primary bg-primary text-primary-fg' : 'border-border hover:bg-subtle',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Así se verá el panel</p>
        <BrandingPreview branding={branding} orgName={draft.orgName} terms={draft.terms} dark={branding.colorScheme === 'dark'} />
      </div>
    </div>
  );
}

const stepperBtn = 'grid size-11 place-items-center rounded-ui border border-border bg-surface transition hover:bg-subtle disabled:opacity-40';

function BranchStep({ draft, set }: StepProps) {
  const t = draft.terms;
  const names = Array.from({ length: draft.counterCount }, (_, i) => `${t.counter} ${i + 1}`);
  return (
    <div>
      <StepTitle title={`Su ${t.branch.toLowerCase()} y sus ${t.counters.toLowerCase()}`} description={`Si tiene más de una ${t.branch.toLowerCase()}, podrá agregarlas después.`} />
      <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
        <Field label={`Nombre de la ${t.branch.toLowerCase()}`} required>
          <Input value={draft.branchName} onChange={(e) => set({ branchName: e.target.value })} maxLength={120} placeholder="Ej.: Casa central" />
        </Field>
        <Field label="Dirección" hint="Opcional. Aparece en el kiosco y en el seguimiento.">
          <Input value={draft.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} placeholder="Ej.: Av. España 1234" />
        </Field>
      </div>
      <div className="mt-8">
        <span className="block text-sm font-medium">¿Cuántos puestos de atención ({t.counters.toLowerCase()}) tiene?</span>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" aria-label="Uno menos" className={stepperBtn} disabled={draft.counterCount <= 1} onClick={() => set({ counterCount: draft.counterCount - 1 })}>
            <Minus className="size-4" />
          </button>
          <span className="w-16 text-center text-4xl font-extrabold tabular-nums" aria-live="polite">
            {draft.counterCount}
          </span>
          <button type="button" aria-label="Uno más" className={stepperBtn} disabled={draft.counterCount >= 50} onClick={() => set({ counterCount: draft.counterCount + 1 })}>
            <Plus className="size-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {names.slice(0, 24).map((n) => (
            <span key={n} className="rounded-full bg-subtle px-3 py-1 text-sm font-medium">
              {n}
            </span>
          ))}
          {names.length > 24 && <span className="px-2 py-1 text-sm text-muted">y {names.length - 24} más</span>}
        </div>
        <p className="mt-3 text-xs text-muted">Los nombres se pueden cambiar uno por uno en Configuración.</p>
      </div>
    </div>
  );
}

function ServicesStep({ draft, set, industry, duplicatePrefix }: StepProps & { industry: Industry | null; duplicatePrefix: string | undefined }) {
  const t = draft.terms;
  const update = (key: string, patch: Partial<ServiceRow>) => set({ services: draft.services.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const icons = Object.keys(SERVICE_ICONS);
  const iconLabel = (key: string) => ICON_LABELS[key] ?? key;
  const add = () => {
    const used = new Set(draft.services.filter((s) => s.enabled).map((s) => s.prefix.toUpperCase()));
    set({
      services: [
        ...draft.services,
        { key: newKey(), existingId: null, name: '', prefix: freePrefix('A', used), color: '#475569', icon: 'ticket', minutes: 5, enabled: true },
      ],
    });
  };
  return (
    <div>
      <StepTitle
        title={`¿Qué ${t.services.toLowerCase()} ofrece?`}
        description={`Cada ${t.service.toLowerCase()} tiene su letra (${t.ticket.toLowerCase()} A001, C001...) y su color. ${industry && industry.services.length ? `Le sugerimos los más comunes para ${industry.name.toLowerCase()}.` : ''}`}
      />
      <div className="overflow-hidden rounded-ui border border-border">
        <div className="hidden grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_6.5rem_12rem_2.5rem] items-center gap-3 bg-subtle px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase sm:grid">
          <span />
          <span>Nombre</span>
          <span>Letra</span>
          <span>Minutos</span>
          <span>Color e ícono</span>
          <span />
        </div>
        <ul className="divide-y divide-border">
          {draft.services.map((s) => (
            <li
              key={s.key}
              className={cx('grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 px-4 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_6.5rem_12rem_2.5rem]', !s.enabled && 'opacity-55')}
            >
              <input
                type="checkbox"
                aria-label={`Ofrecer ${s.name || 'este servicio'}`}
                checked={s.enabled}
                onChange={(e) => update(s.key, { enabled: e.target.checked })}
                className="size-5 accent-[var(--gc-primary)]"
              />
              <Input value={s.name} onChange={(e) => update(s.key, { name: e.target.value })} placeholder={`Nombre del ${t.service.toLowerCase()}`} aria-label="Nombre" />
              <span className="sm:hidden" />
              <Input
                value={s.prefix}
                onChange={(e) => update(s.key, { prefix: e.target.value.toUpperCase().slice(0, 5) })}
                aria-label="Letra"
                className={cx('col-start-2 text-center font-mono font-bold sm:col-start-auto', s.enabled && duplicatePrefix === s.prefix.toUpperCase() && 'border-red-500')}
              />
              <Input type="number" min={1} max={600} value={s.minutes} onChange={(e) => update(s.key, { minutes: Number(e.target.value) || 1 })} aria-label="Minutos estimados" className="col-start-2 sm:col-start-auto" />
              <span className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                <input type="color" value={s.color} onChange={(e) => update(s.key, { color: e.target.value })} aria-label="Color" className="h-9 w-10 shrink-0 cursor-pointer rounded-ui border border-border bg-surface p-0.5" />
                <span className="grid size-9 shrink-0 place-items-center rounded-ui" style={{ background: `color-mix(in srgb, ${s.color} 15%, transparent)`, color: s.color }} aria-hidden>
                  <ServiceIcon name={s.icon} className="size-4" />
                </span>
                <select
                  value={s.icon}
                  onChange={(e) => update(s.key, { icon: e.target.value })}
                  aria-label="Ícono"
                  className="h-9 min-w-0 flex-1 rounded-ui border border-border bg-surface px-1.5 text-xs"
                >
                  {icons.map((i) => (
                    <option key={i} value={i}>
                      {iconLabel(i)}
                    </option>
                  ))}
                </select>
              </span>
              <span className="row-start-1 flex justify-end sm:row-start-auto">
                {!s.existingId && (
                  <button type="button" aria-label="Quitar" onClick={() => set({ services: draft.services.filter((x) => x.key !== s.key) })} className="rounded-ui p-2 text-muted hover:bg-subtle hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={add}>
          Agregar otro
        </Button>
        {duplicatePrefix && <p className="text-sm text-red-600">La letra «{duplicatePrefix}» está repetida: cada servicio activo necesita una distinta.</p>}
      </div>
      <p className="mt-3 text-xs text-muted">Los que desmarque quedan desactivados (no se borran) y los puede activar cuando quiera.</p>
    </div>
  );
}

function DevicesStep({ draft, set, primary, accent }: StepProps & { primary: string; accent: string }) {
  const t = draft.terms;
  const preview = useMemo(
    () => deepMerge(defaultDisplayConfig(), { layout: draft.layout, theme: tvThemeColors(draft.tvTheme, primary, accent), ticker: { enabled: true, background: accent } }),
    [draft.layout, draft.tvTheme, primary, accent],
  );
  const themes: { value: TvTheme; label: string; colors: [string, string] }[] = [
    { value: 'brand', label: 'Con mi marca', colors: ['#0b1220', primary] },
    { value: 'dark', label: 'Noche', colors: ['#0f172a', '#2563eb'] },
    { value: 'light', label: 'Claro', colors: ['#f1f5f9', primary] },
  ];
  return (
    <div>
      <StepTitle title="Pantalla de TV y kiosco" description="Elija cómo se ven los llamados en la sala de espera y qué pregunta el kiosco." />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-6">
          <div>
            <span className="mb-2 block text-sm font-medium">Diseño de la pantalla</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {LAYOUTS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  aria-pressed={draft.layout === l.value}
                  onClick={() => set({ layout: l.value })}
                  className={cx('rounded-ui border p-3 text-left transition', draft.layout === l.value ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'border-border hover:bg-subtle')}
                >
                  <span className="text-sm font-semibold">{l.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{l.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium">Colores de la pantalla</span>
            <div className="flex flex-wrap gap-2">
              {themes.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  aria-pressed={draft.tvTheme === th.value}
                  onClick={() => set({ tvTheme: th.value })}
                  className={cx(
                    'flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm font-medium transition',
                    draft.tvTheme === th.value ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:bg-subtle',
                  )}
                >
                  <span className="flex overflow-hidden rounded-full ring-1 ring-black/10">
                    <span className="size-5" style={{ background: th.colors[0] }} />
                    <span className="size-5" style={{ background: th.colors[1] }} />
                  </span>
                  {th.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-4 rounded-ui bg-subtle p-4">
            <p className="text-sm font-semibold">Kiosco para sacar {t.ticket.toLowerCase()}</p>
            <Toggle checked={draft.askPriority} onChange={(askPriority) => set({ askPriority })} label="Preguntar si es atención preferencial" hint="Embarazadas, adultos mayores, personas con discapacidad." />
            <Toggle checked={draft.askName} onChange={(askName) => set({ askName })} label={`Pedir el nombre del ${t.customer.toLowerCase()}`} hint="Para saludarlo o llamarlo por su nombre." />
            <Toggle checked={draft.print} onChange={(print) => set({ print })} label="Imprimir el ticket" hint="Con impresora térmica de 58 u 80 mm." />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Vista previa de la TV</p>
          <div className="overflow-hidden rounded-ui border border-border shadow-sm">
            <LayoutThumb config={preview} counter={draft.terms.counter} />
          </div>
          <p className="text-xs text-muted">Luego puede ajustar tipografías, imagen de fondo, QR, voz y mucho más en Pantallas.</p>
        </div>
      </div>
    </div>
  );
}

function ApplyProgress({ labels, done, failed, onRetry, onBack }: { labels: string[]; done: number; failed?: string; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-md py-6">
      <h2 className="text-xl font-bold tracking-tight">{failed ? 'No se pudo terminar' : 'Aplicando la configuración…'}</h2>
      <ul className="mt-6 space-y-3">
        {labels.map((label, i) => {
          const state = i < done ? 'done' : i === done ? (failed ? 'failed' : 'running') : 'pending';
          return (
            <li key={label} className="flex items-center gap-3 text-sm">
              {state === 'done' ? (
                <CircleCheck className="size-5 text-emerald-600" />
              ) : state === 'running' ? (
                <Loader2 className="size-5 animate-spin text-primary-text" />
              ) : state === 'failed' ? (
                <X className="size-5 text-red-600" />
              ) : (
                <span className="size-5 rounded-full border-2 border-border" />
              )}
              <span className={cx(state === 'pending' && 'text-muted')}>{label}</span>
            </li>
          );
        })}
      </ul>
      {failed && (
        <>
          <p className="mt-5 rounded-ui bg-red-500/10 p-3 text-sm text-red-700">{failed}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={onRetry}>Reintentar</Button>
            <Button variant="secondary" onClick={onBack}>
              Volver a revisar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Finished() {
  const displays = useDisplays();
  const kiosks = useKiosks();
  const display = displays.data?.[0];
  const kiosk = kiosks.data?.[0];
  const actions: { title: string; description: string; icon: ReactNode; href?: string; to?: string }[] = [
    { title: 'Abrir la pantalla de TV', description: 'Llamados, voz y publicidad', icon: <MonitorPlay />, href: display ? `/pantalla/${display.token}` : undefined, to: display ? undefined : '/app/pantallas' },
    { title: 'Abrir el kiosco', description: 'Para sacar turno en una tablet o tótem', icon: <Tablet />, href: kiosk ? `/kiosco/${kiosk.token}` : undefined, to: kiosk ? undefined : '/app/kioscos' },
    { title: 'Vincular una TV con un código', description: 'Sin escribir enlaces largos', icon: <Link2 />, to: '/app/vincular' },
    { title: 'Empezar a atender', description: 'Consola para llamar y atender', icon: <Headset />, to: '/app/atencion' },
  ];
  return (
    <div className="mx-auto max-w-3xl py-6 text-center">
      <span className="gc-pop mx-auto grid size-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg">
        <Check className="size-9" />
      </span>
      <h1 className="mt-5 text-[1.9rem] font-bold tracking-tight">¡Su sistema está listo!</h1>
      <p className="mt-2 text-muted">Ya puede abrir la pantalla y el kiosco. Todo lo demás se ajusta desde Configuración.</p>
      <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
        {actions.map((a) =>
          a.href ? (
            <a key={a.title} href={a.href} target="_blank" rel="noreferrer" className="gc-card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5">
              <ActionBody {...a} external />
            </a>
          ) : (
            <Link key={a.title} to={a.to!} className="gc-card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5">
              <ActionBody {...a} />
            </Link>
          ),
        )}
      </div>
      <Link to="/app" className="mt-8 inline-block">
        <Button variant="ghost">Ir al inicio</Button>
      </Link>
    </div>
  );
}

function ActionBody({ title, description, icon, external }: { title: string; description: string; icon: ReactNode; external?: boolean }) {
  return (
    <>
      <span className="grid size-11 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary-text [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold group-hover:text-primary-text">{title}</span>
        <span className="block text-sm text-muted">{description}</span>
      </span>
      {external && <ExternalLink className="size-4 text-muted" />}
    </>
  );
}
