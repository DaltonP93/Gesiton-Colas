import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, LogIn, Paintbrush, Presentation } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CURRENCIES, LANDING_TEMPLATE_INFO, MODULE_IDS, MODULES, PLAN_IDS, PLANS, type Currency, type HomePage, type ModuleId, type PlanId, type PlatformSettings } from '@gc/shared';
import { ImageField } from '../../components/ImageField';
import { Button, Checkbox, ColorInput, Field, Input, Loading, Select, Textarea, Toggle, cx, useFeedback } from '../../components/ui';
import { api, assetUrl, errorMessage } from '../../lib/api';

const HOME_OPTIONS: { value: HomePage; label: string; hint: string; icon: ReactNode }[] = [
  { value: 'login', label: 'Pantalla de ingreso', hint: 'Lo primero que se ve es el formulario para iniciar sesión. Ideal para uso interno.', icon: <LogIn /> },
  { value: 'landing', label: 'Página de presentación', hint: 'Muestra el producto con botones para registrarse, pedir una demo o ingresar.', icon: <Presentation /> },
  { value: 'redirect', label: 'Otra dirección', hint: 'Lleva a su sitio web; el ingreso sigue disponible en /login.', icon: <ExternalLink /> },
];

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Lo que se edita en esta pestaña (el resto tiene su propia pantalla). */
const ownFields = ({ backups: _b, notices: _n, legal: _l, landing: _p, ...rest }: PlatformSettings) => rest;

/** Ajustes globales: página principal, acceso, marca de la plataforma y correo saliente. */
export function PlatformSettingsTab() {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => api.get<PlatformSettings>('/platform/settings') });
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    // Las copias, los avisos, lo legal y la presentación se guardan en sus propias pantallas.
    mutationFn: (draft: PlatformSettings) => api.put<PlatformSettings>('/platform/settings', ownFields(draft)),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'settings'], data);
      void qc.invalidateQueries({ queryKey: ['public-config'] });
      setDraft(data);
      toast('Ajustes de la plataforma guardados');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (settings.isLoading || !draft) return <Loading />;
  if (settings.isError || !settings.data) return <p className="text-sm text-red-600">{errorMessage(settings.error)}</p>;

  const set = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setBrand = <K extends keyof PlatformSettings['brand']>(key: K, value: PlatformSettings['brand'][K]) =>
    setDraft((d) => (d ? { ...d, brand: { ...d.brand, [key]: value } } : d));
  const dirty = !sameJson(ownFields(draft), ownFields(settings.data));
  const origin = window.location.origin;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHead title="Página principal" description={`Qué se abre en ${origin.replace(/^https?:\/\//, '')} cuando nadie inició sesión.`} />
        <div className="gc-card gc-pad space-y-5">
          <div role="radiogroup" aria-label="Página principal" className="grid gap-3 md:grid-cols-3">
            {HOME_OPTIONS.map((o) => {
              const checked = draft.homePage === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => set('homePage', o.value)}
                  className={cx(
                    'flex items-start gap-3 rounded-ui border p-4 text-left transition',
                    checked ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:bg-subtle',
                  )}
                >
                  <span className={cx('mt-0.5 [&_svg]:size-5', checked ? 'text-primary' : 'text-muted')}>{o.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {draft.homePage === 'redirect' && (
            <Field label="Dirección de destino" required hint="Por ejemplo, el sitio web de su empresa.">
              <Input type="url" value={draft.homeRedirectUrl} onChange={(e) => set('homeRedirectUrl', e.target.value.trim())} placeholder="https://www.suempresa.com" />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-3 rounded-ui border border-border bg-subtle/50 p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary-text">
              <Paintbrush className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Página de presentación</p>
              <p className="text-xs text-muted">
                Plantilla {LANDING_TEMPLATE_INFO[settings.data.landing.template].name} · {settings.data.landing.enabled ? 'publicada' : 'no publicada'} en{' '}
                <a href="/presentacion" target="_blank" rel="noreferrer" className="font-medium text-primary-text hover:underline">
                  {origin}/presentacion
                </a>
                . Elija entre 6 plantillas y cambie textos, imágenes, secciones, colores y dominio.
              </p>
            </div>
            <Link to="/plataforma/presentacion">
              <Button icon={<Paintbrush className="size-4" />}>Personalizar</Button>
            </Link>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Globe className="size-3.5" /> El ingreso siempre está en{' '}
            <a href="/login" target="_blank" rel="noreferrer" className="font-medium text-primary-text hover:underline">
              {origin}/login
            </a>
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHead title="Acceso" description="Qué opciones aparecen en la pantalla de ingreso." />
        <div className="gc-card gc-pad grid gap-5 md:grid-cols-3">
          <Toggle
            checked={draft.allowSignup}
            onChange={(v) => set('allowSignup', v)}
            label="Registro de organizaciones"
            hint="Cualquiera puede crear su organización con «Crear cuenta». Apáguelo si usted da de alta a los clientes."
          />
          <Toggle checked={draft.allowDemo} onChange={(v) => set('allowDemo', v)} label="Demos por correo" hint="Permite pedir una organización de prueba con datos de ejemplo." />
          <Toggle
            checked={draft.allowEmailLogin}
            onChange={(v) => set('allowEmailLogin', v)}
            label="Ingreso con código por correo"
            hint="Entrar sin contraseña con un código de 6 dígitos. Requiere correo configurado."
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHead
          title="Planes y módulos"
          description="Qué incluye cada plan y cuánto cuesta por mes. Cada organización sigue su plan, salvo que usted fuerce un módulo desde Organizaciones → Módulos."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {PLAN_IDS.map((id) => (
            <PlanCard key={id} id={id} value={draft.plans[id]} onChange={(plan) => set('plans', { ...draft.plans, [id]: plan })} />
          ))}
        </div>
        <AddonPrices value={draft.addons} onChange={(addons) => set('addons', addons)} />
      </section>

      <section className="space-y-4">
        <SectionHead title="Marca de la plataforma" description="Se ve en la pantalla de ingreso, la página principal, los correos sin organización y este panel." />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="gc-card gc-pad @container space-y-5">
            <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_14rem]">
              <Field label="Nombre de la plataforma" required>
                <Input value={draft.brand.appName} maxLength={80} onChange={(e) => setBrand('appName', e.target.value)} />
              </Field>
              <ColorInput label="Color principal" value={draft.brand.primaryColor} onChange={(v) => setBrand('primaryColor', v)} />
            </div>
            <div className="grid gap-6 @xl:grid-cols-[minmax(0,1fr)_10rem]">
              <ImageField
                label="Logo"
                hint="Se muestra sobre un fondo blanco en la pantalla de ingreso."
                value={draft.brand.logoUrl}
                onChange={(v) => setBrand('logoUrl', v)}
                uploadName="Logo de la plataforma"
                uploadPath="/platform/assets"
              />
              <ImageField
                label="Ícono del navegador"
                value={draft.brand.faviconUrl}
                onChange={(v) => setBrand('faviconUrl', v)}
                uploadName="Favicon de la plataforma"
                uploadPath="/platform/assets"
                square
              />
            </div>
            <Field label="Frase principal del ingreso">
              <Input value={draft.brand.loginTitle} maxLength={160} onChange={(e) => setBrand('loginTitle', e.target.value)} />
            </Field>
            <Field label="Texto de apoyo">
              <Textarea rows={2} value={draft.brand.loginText} maxLength={400} onChange={(e) => setBrand('loginText', e.target.value)} />
            </Field>
            <ImageField
              label="Imagen de fondo del ingreso"
              hint="Opcional: una foto de su edificio o de la sala de espera. Se tiñe con el color principal."
              value={draft.brand.loginImageUrl}
              onChange={(v) => setBrand('loginImageUrl', v)}
              uploadName="Fondo del ingreso"
              uploadPath="/platform/assets"
            />
            <Field label="Correo de soporte" hint="Se muestra a quien no puede ingresar. Opcional.">
              <Input type="email" value={draft.brand.supportEmail} onChange={(e) => setBrand('supportEmail', e.target.value.trim())} placeholder="soporte@suempresa.com" />
            </Field>
          </div>
          <LoginPreview brand={draft.brand} />
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-ui border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className="mr-auto text-sm text-muted">{dirty ? 'Hay cambios sin guardar en la página principal, el acceso, los planes o la marca.' : 'Todo está guardado.'}</span>
        <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setDraft(settings.data!)}>
          Descartar
        </Button>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>
          Guardar cambios
        </Button>
      </div>

      <p className="rounded-ui border border-border bg-surface px-4 py-3 text-sm text-muted">
        El correo saliente, WhatsApp/SMS y los avisos de la plataforma están en{' '}
        <a href="#comunicaciones" className="font-medium text-primary hover:underline">
          Comunicaciones
        </a>
        .
      </p>
    </div>
  );
}

/** Precio y módulos de un plan. */
function PlanCard({ id, value, onChange }: { id: PlanId; value: PlatformSettings['plans'][PlanId]; onChange: (value: PlatformSettings['plans'][PlanId]) => void }) {
  const toggle = (module: ModuleId, on: boolean) =>
    onChange({ ...value, modules: on ? MODULE_IDS.filter((m) => m === module || value.modules.includes(m)) : value.modules.filter((m) => m !== module) });
  return (
    <div className="gc-card gc-pad space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{PLANS[id].name}</h3>
        <span className="text-xs text-muted">{value.modules.length} de {MODULE_IDS.length} módulos</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
        <Field label="Precio mensual">
          <Input
            type="number"
            min={0}
            step="any"
            value={value.monthlyPrice}
            onChange={(e) => onChange({ ...value, monthlyPrice: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Field>
        <Field label="Moneda">
          <Select value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Módulos incluidos</legend>
        {MODULE_IDS.map((m) => (
          <Checkbox key={m} checked={value.modules.includes(m)} onChange={(on) => toggle(m, on)} label={MODULES[m].name} />
        ))}
      </fieldset>
    </div>
  );
}

/** Precio mensual de cada módulo cuando se activa fuera del plan. */
function AddonPrices({ value, onChange }: { value: PlatformSettings['addons']; onChange: (value: PlatformSettings['addons']) => void }) {
  return (
    <div className="gc-card gc-pad">
      <h3 className="text-base font-semibold">Módulos adicionales</h3>
      <p className="mt-0.5 mb-4 text-sm text-muted">
        Precio mensual que se suma a la factura cuando le activa a una organización un módulo que su plan no incluye (Organizaciones → Módulos). En la moneda del plan de cada
        organización; 0 = sin cargo.
      </p>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODULE_IDS.map((m) => (
          <Field key={m} label={MODULES[m].name}>
            <Input
              type="number"
              min={0}
              step="any"
              value={value[m] ?? 0}
              onChange={(e) => onChange({ ...value, [m]: Math.max(0, Number(e.target.value) || 0) })}
              aria-label={`Precio mensual de ${MODULES[m].name}`}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted">{description}</p>
    </div>
  );
}

/** Miniatura del panel lateral de la pantalla de ingreso con la marca elegida. */
function LoginPreview({ brand }: { brand: PlatformSettings['brand'] }) {
  const background = brand.loginImageUrl
    ? `linear-gradient(160deg, color-mix(in srgb, ${brand.primaryColor} 92%, transparent), color-mix(in srgb, ${brand.primaryColor} 82%, #000 18%)), url("${assetUrl(brand.loginImageUrl)}") center/cover`
    : brand.primaryColor;
  return (
    <div className="xl:sticky xl:top-24">
      <p className="mb-2 text-sm font-semibold">Vista previa del ingreso</p>
      <div className="grid aspect-[16/10] grid-cols-2 overflow-hidden rounded-ui border border-border shadow-sm">
        <div className="flex flex-col justify-between p-3 text-white" style={{ background }}>
          {brand.logoUrl ? (
            <span className="inline-flex w-fit max-w-full rounded bg-white px-1.5 py-1">
              <img src={assetUrl(brand.logoUrl)} alt="" className="h-4 max-w-full object-contain" />
            </span>
          ) : (
            <span className="text-[10px] font-bold">{brand.appName}</span>
          )}
          <span className="line-clamp-3 text-[11px] leading-tight font-bold">{brand.loginTitle}</span>
          <span className="text-[7px] opacity-75">© {brand.appName}</span>
        </div>
        <div className="flex flex-col justify-center gap-1.5 bg-white p-3">
          <span className="text-[10px] font-bold text-slate-900">Iniciar sesión</span>
          <span className="h-3 rounded-sm border border-slate-200" />
          <span className="h-3 rounded-sm border border-slate-200" />
          <span className="h-3.5 rounded-sm" style={{ background: brand.primaryColor }} />
        </div>
      </div>
    </div>
  );
}
