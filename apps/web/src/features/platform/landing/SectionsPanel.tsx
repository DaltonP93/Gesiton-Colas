import { ArrowDown, ArrowUp, ChevronDown, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  LANDING_ACTIONS,
  LANDING_ACTION_LABELS,
  LANDING_ICONS,
  LANDING_SECTION_INFO,
  LANDING_SECTION_TYPES,
  PLAN_IDS,
  PLANS,
  defaultLandingSection,
  type LandingButton,
  type LandingSection,
  type LandingSectionOf,
  type LandingSectionType,
} from '@gc/shared';
import { ImageField } from '../../../components/ImageField';
import { Button, Checkbox, Field, IconButton, Input, Menu, Modal, Select, Textarea, Toggle, cx, useFeedback } from '../../../components/ui';
import { LANDING_ICON_COMPONENTS, LANDING_ICON_LABELS } from '../../landing/landingIcons';

/** Opciones de la plataforma que cambian lo que muestran los botones. */
export interface EditorFlags {
  allowSignup: boolean;
  allowDemo: boolean;
}

const newId = (type: LandingSectionType) => `${type}-${Math.random().toString(36).slice(2, 8)}`;

/** Lista de secciones: visibles u ocultas, en orden, con su editor desplegable. */
export function SectionsPanel({ sections, onChange, flags }: { sections: LandingSection[]; onChange: (next: LandingSection[]) => void; flags: EditorFlags }) {
  const { confirm } = useFeedback();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const update = (id: string, next: LandingSection) => onChange(sections.map((s) => (s.id === id ? next : s)));
  const move = (index: number, delta: number) => {
    const list = [...sections];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item!);
    onChange(list);
  };
  const add = (type: LandingSectionType) => {
    const section = { ...defaultLandingSection(type), id: sections.some((s) => s.id === type) ? newId(type) : type };
    onChange([...sections, section]);
    setOpen(section.id);
    setAdding(false);
    setTimeout(() => document.getElementById(`editor-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Debajo de la portada, en este orden. Las secciones ocultas se guardan pero no se muestran.</p>
      {sections.map((section, i) => {
        const expanded = open === section.id;
        return (
          <div key={section.id} id={`editor-${section.id}`} className={cx('scroll-mt-4 rounded-ui border bg-surface', expanded ? 'border-primary/40 shadow-sm' : 'border-border')}>
            <div className="flex items-center gap-2 p-2 pl-3">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : section.id)}>
                <ChevronDown className={cx('size-4 shrink-0 text-muted transition', expanded && 'rotate-180')} />
                <span className="min-w-0">
                  <span className={cx('block truncate text-sm font-semibold', !section.enabled && 'text-muted line-through')}>{LANDING_SECTION_INFO[section.type].name}</span>
                  {section.title && <span className="block truncate text-xs text-muted">{section.title}</span>}
                </span>
              </button>
              <IconButton
                label={section.enabled ? 'Ocultar' : 'Mostrar'}
                icon={section.enabled ? <Eye className="size-4" /> : <EyeOff className="size-4 text-muted" />}
                onClick={() => update(section.id, { ...section, enabled: !section.enabled })}
              />
              <Menu
                items={[
                  i > 0 && { label: 'Subir', icon: <ArrowUp />, onSelect: () => move(i, -1) },
                  i < sections.length - 1 && { label: 'Bajar', icon: <ArrowDown />, onSelect: () => move(i, 1) },
                  sections.length < 20 && {
                    label: 'Duplicar',
                    icon: <Copy />,
                    onSelect: () => {
                      const copy = { ...structuredClone(section), id: newId(section.type) };
                      onChange([...sections.slice(0, i + 1), copy, ...sections.slice(i + 1)]);
                      setOpen(copy.id);
                    },
                  },
                  {
                    label: 'Quitar',
                    icon: <Trash2 />,
                    danger: true,
                    onSelect: async () => {
                      const ok = await confirm({ title: `¿Quitar «${LANDING_SECTION_INFO[section.type].name}»?`, message: 'Se borra su contenido. Si solo quiere esconderla, use el ojo.', confirmLabel: 'Quitar', danger: true });
                      if (ok) onChange(sections.filter((s) => s.id !== section.id));
                    },
                  },
                ]}
              />
            </div>
            {expanded && (
              <div className="space-y-4 border-t border-border p-4">
                <SectionEditor section={section} onChange={(next) => update(section.id, next)} flags={flags} />
              </div>
            )}
          </div>
        );
      })}
      <Button variant="secondary" icon={<Plus className="size-4" />} className="w-full" disabled={sections.length >= 20} onClick={() => setAdding(true)}>
        Agregar sección
      </Button>
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Agregar sección" description="Se agrega al final con un texto de ejemplo para que lo cambie." size="lg">
          <div className="grid gap-2 sm:grid-cols-2">
            {LANDING_SECTION_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => add(type)} className="rounded-ui border border-border p-3 text-left hover:border-primary/50 hover:bg-subtle">
                <span className="block text-sm font-semibold">{LANDING_SECTION_INFO[type].name}</span>
                <span className="block text-xs text-muted">{LANDING_SECTION_INFO[type].description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editores                                                             */
/* ------------------------------------------------------------------ */

function SectionEditor({ section, onChange, flags }: { section: LandingSection; onChange: (s: LandingSection) => void; flags: EditorFlags }) {
  const common = (
    <>
      <Field label="Título">
        <Input value={section.title} maxLength={140} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </Field>
      <Field label="Texto de apoyo">
        <Textarea rows={2} value={section.subtitle} maxLength={400} onChange={(e) => onChange({ ...section, subtitle: e.target.value })} />
      </Field>
      <Field label="Nombre en el menú" hint="Si lo completa, la sección aparece en el menú de arriba.">
        <Input value={section.navLabel} maxLength={30} onChange={(e) => onChange({ ...section, navLabel: e.target.value })} placeholder="Sin enlace en el menú" />
      </Field>
    </>
  );
  const set = <T extends LandingSection>(patch: Partial<T>) => onChange({ ...section, ...patch } as LandingSection);
  switch (section.type) {
    case 'features':
      return (
        <>
          {common}
          <Field label="Columnas en computadora">
            <Select value={section.columns} onChange={(e) => set({ columns: Number(e.target.value) as 2 | 3 | 4 })} className="w-40">
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </Select>
          </Field>
          <ListEditor
            label="Funciones"
            items={section.items}
            max={12}
            create={() => ({ icon: 'sparkles' as const, title: 'Nueva función', text: '' })}
            onChange={(items) => set<LandingSectionOf<'features'>>({ items })}
            render={(item, change) => (
              <>
                <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                  <IconSelect value={item.icon} onChange={(icon) => change({ ...item, icon })} />
                  <Input aria-label="Título" value={item.title} maxLength={80} onChange={(e) => change({ ...item, title: e.target.value })} placeholder="Título" />
                </div>
                <Textarea aria-label="Texto" rows={2} value={item.text} maxLength={300} onChange={(e) => change({ ...item, text: e.target.value })} placeholder="Texto" />
              </>
            )}
          />
        </>
      );
    case 'steps':
      return (
        <>
          {common}
          <ListEditor
            label="Pasos"
            items={section.items}
            max={6}
            create={() => ({ title: 'Nuevo paso', text: '' })}
            onChange={(items) => set<LandingSectionOf<'steps'>>({ items })}
            render={(item, change) => (
              <>
                <Input aria-label="Título" value={item.title} maxLength={80} onChange={(e) => change({ ...item, title: e.target.value })} placeholder="Título" />
                <Textarea aria-label="Texto" rows={2} value={item.text} maxLength={300} onChange={(e) => change({ ...item, text: e.target.value })} placeholder="Texto" />
              </>
            )}
          />
        </>
      );
    case 'showcase':
      return (
        <>
          <Field label="Título">
            <Input value={section.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Texto">
            <Textarea rows={3} value={section.subtitle} maxLength={400} onChange={(e) => set({ subtitle: e.target.value })} />
          </Field>
          <ImageField
            label="Imagen"
            hint="Sin imagen se muestra la pantalla de ejemplo."
            value={section.imageUrl}
            onChange={(imageUrl) => set<LandingSectionOf<'showcase'>>({ imageUrl })}
            uploadName="Imagen de la presentación"
            uploadPath="/platform/assets"
            compact
          />
          <Field label="Imagen a la">
            <Select value={section.imageSide} onChange={(e) => set<LandingSectionOf<'showcase'>>({ imageSide: e.target.value as 'left' | 'right' })} className="w-40">
              <option value="right">Derecha</option>
              <option value="left">Izquierda</option>
            </Select>
          </Field>
          <ListEditor
            label="Puntos"
            items={section.bullets}
            max={8}
            create={() => ''}
            onChange={(bullets) => set<LandingSectionOf<'showcase'>>({ bullets })}
            render={(item, change) => <Input aria-label="Punto" value={item} maxLength={160} onChange={(e) => change(e.target.value)} />}
          />
          <OptionalButton label="Botón" value={section.button} onChange={(button) => set<LandingSectionOf<'showcase'>>({ button })} flags={flags} />
          <Field label="Nombre en el menú" hint="Si lo completa, la sección aparece en el menú de arriba.">
            <Input value={section.navLabel} maxLength={30} onChange={(e) => set({ navLabel: e.target.value })} placeholder="Sin enlace en el menú" />
          </Field>
        </>
      );
    case 'stats':
      return (
        <>
          {common}
          <p className="rounded-ui bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Use cifras reales y comprobables de su empresa.</p>
          <ListEditor
            label="Cifras"
            items={section.items}
            max={6}
            create={() => ({ value: '', label: '' })}
            onChange={(items) => set<LandingSectionOf<'stats'>>({ items })}
            render={(item, change) => (
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <Input aria-label="Cifra" value={item.value} maxLength={20} onChange={(e) => change({ ...item, value: e.target.value })} placeholder="+120" />
                <Input aria-label="Qué mide" value={item.label} maxLength={80} onChange={(e) => change({ ...item, label: e.target.value })} placeholder="sucursales atendiendo" />
              </div>
            )}
          />
        </>
      );
    case 'pricing':
      return (
        <>
          {common}
          <Field label="Planes que se muestran" hint="El precio y los módulos salen de Ajustes → Planes y módulos.">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {PLAN_IDS.map((id) => (
                <Checkbox
                  key={id}
                  checked={section.plans.includes(id)}
                  label={PLANS[id].name}
                  onChange={(on) => set<LandingSectionOf<'pricing'>>({ plans: on ? PLAN_IDS.filter((p) => p === id || section.plans.includes(p)) : section.plans.filter((p) => p !== id) })}
                />
              ))}
            </div>
          </Field>
          <Field label="Plan destacado">
            <Select value={section.highlight ?? ''} onChange={(e) => set<LandingSectionOf<'pricing'>>({ highlight: (e.target.value || null) as LandingSectionOf<'pricing'>['highlight'] })} className="w-52">
              <option value="">Ninguno</option>
              {section.plans.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle checked={section.showModules} onChange={(showModules) => set<LandingSectionOf<'pricing'>>({ showModules })} label="Mostrar los módulos de cada plan" />
          <Field label="Nota al pie" hint="Por ejemplo: «Precios con IVA incluido».">
            <Input value={section.note} maxLength={300} onChange={(e) => set<LandingSectionOf<'pricing'>>({ note: e.target.value })} />
          </Field>
          <ButtonEditor label="Botón de cada plan" value={section.button} onChange={(button) => set<LandingSectionOf<'pricing'>>({ button })} flags={flags} />
        </>
      );
    case 'testimonials':
      return (
        <>
          {common}
          <p className="rounded-ui bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Publique solo testimonios reales, con el permiso de cada persona.</p>
          <ListEditor
            label="Testimonios"
            items={section.items}
            max={9}
            create={() => ({ quote: '', name: '', role: '', photoUrl: null })}
            onChange={(items) => set<LandingSectionOf<'testimonials'>>({ items })}
            render={(item, change) => (
              <>
                <Textarea aria-label="Testimonio" rows={3} value={item.quote} maxLength={500} onChange={(e) => change({ ...item, quote: e.target.value })} placeholder="Lo que dijo" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="Nombre" value={item.name} maxLength={80} onChange={(e) => change({ ...item, name: e.target.value })} placeholder="Nombre" />
                  <Input aria-label="Cargo y empresa" value={item.role} maxLength={100} onChange={(e) => change({ ...item, role: e.target.value })} placeholder="Cargo y empresa" />
                </div>
                <ImageField label="Foto" value={item.photoUrl} onChange={(photoUrl) => change({ ...item, photoUrl })} uploadName="Foto de testimonio" uploadPath="/platform/assets" square compact />
              </>
            )}
          />
        </>
      );
    case 'logos':
      return (
        <>
          {common}
          <ListEditor
            label="Clientes"
            items={section.items}
            max={24}
            create={() => ({ name: '', imageUrl: null })}
            onChange={(items) => set<LandingSectionOf<'logos'>>({ items })}
            render={(item, change) => (
              <>
                <Input aria-label="Nombre" value={item.name} maxLength={80} onChange={(e) => change({ ...item, name: e.target.value })} placeholder="Nombre de la empresa" />
                <ImageField label="Logo" hint="Sin logo se muestra el nombre." value={item.imageUrl} onChange={(imageUrl) => change({ ...item, imageUrl })} uploadName="Logo de cliente" uploadPath="/platform/assets" compact />
              </>
            )}
          />
        </>
      );
    case 'faq':
      return (
        <>
          {common}
          <ListEditor
            label="Preguntas"
            items={section.items}
            max={20}
            create={() => ({ question: '', answer: '' })}
            onChange={(items) => set<LandingSectionOf<'faq'>>({ items })}
            render={(item, change) => (
              <>
                <Input aria-label="Pregunta" value={item.question} maxLength={200} onChange={(e) => change({ ...item, question: e.target.value })} placeholder="Pregunta" />
                <Textarea aria-label="Respuesta" rows={3} value={item.answer} maxLength={1000} onChange={(e) => change({ ...item, answer: e.target.value })} placeholder="Respuesta" />
              </>
            )}
          />
        </>
      );
    case 'cta':
      return (
        <>
          {common}
          <ButtonEditor label="Botón principal" value={section.button} onChange={(button) => set<LandingSectionOf<'cta'>>({ button })} flags={flags} />
          <OptionalButton label="Segundo botón" value={section.secondary} onChange={(secondary) => set<LandingSectionOf<'cta'>>({ secondary })} flags={flags} />
        </>
      );
    case 'contact':
      return (
        <>
          {common}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Correo">
              <Input type="email" value={section.email} maxLength={200} onChange={(e) => set<LandingSectionOf<'contact'>>({ email: e.target.value })} placeholder="ventas@suempresa.com" />
            </Field>
            <Field label="Teléfono">
              <Input type="tel" value={section.phone} maxLength={40} onChange={(e) => set<LandingSectionOf<'contact'>>({ phone: e.target.value })} placeholder="021 123 456" />
            </Field>
            <Field label="WhatsApp" hint="Número con código de país.">
              <Input type="tel" value={section.whatsapp} maxLength={40} onChange={(e) => set<LandingSectionOf<'contact'>>({ whatsapp: e.target.value })} placeholder="+595 981 123 456" />
            </Field>
            <Field label="Horario">
              <Input value={section.hours} maxLength={200} onChange={(e) => set<LandingSectionOf<'contact'>>({ hours: e.target.value })} placeholder="Lunes a viernes de 8 a 18 h" />
            </Field>
          </div>
          <Field label="Dirección">
            <Input value={section.address} maxLength={300} onChange={(e) => set<LandingSectionOf<'contact'>>({ address: e.target.value })} />
          </Field>
        </>
      );
  }
}

/** Lista de elementos con agregar, ordenar y quitar. */
export function ListEditor<T>({
  label,
  items,
  onChange,
  create,
  render,
  max,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  render: (item: T, change: (next: T) => void) => ReactNode;
  max: number;
}) {
  const change = (i: number, next: T) => onChange(items.map((it, j) => (j === i ? next : it)));
  const move = (i: number, delta: number) => {
    const list = [...items];
    const [item] = list.splice(i, 1);
    list.splice(i + delta, 0, item!);
    onChange(list);
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {label} <span className="font-normal text-muted">({items.length} de {max})</span>
      </p>
      {items.map((item, i) => (
        <div key={i} className="space-y-2 rounded-ui border border-border bg-subtle/40 p-3">
          <div className="-mt-1 -mr-1 flex items-center justify-end gap-0.5">
            <span className="mr-auto text-xs font-medium text-muted">{i + 1}</span>
            <IconButton label="Subir" className="size-7" icon={<ArrowUp className="size-3.5" />} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton label="Bajar" className="size-7" icon={<ArrowDown className="size-3.5" />} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
            <IconButton label="Quitar" className="size-7" icon={<Trash2 className="size-3.5 text-red-600" />} onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          {render(item, (next) => change(i, next))}
        </div>
      ))}
      {items.length < max && (
        <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...items, create()])}>
          Agregar
        </Button>
      )}
    </div>
  );
}

function IconSelect({ value, onChange }: { value: (typeof LANDING_ICONS)[number]; onChange: (icon: (typeof LANDING_ICONS)[number]) => void }) {
  const Icon = LANDING_ICON_COMPONENTS[value];
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-primary-text" />
      <Select aria-label="Ícono" value={value} onChange={(e) => onChange(e.target.value as typeof value)} className="pl-8">
        {LANDING_ICONS.map((icon) => (
          <option key={icon} value={icon}>
            {LANDING_ICON_LABELS[icon]}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Texto del botón y adónde lleva. */
export function ButtonEditor({ label, value, onChange, flags }: { label: string; value: LandingButton; onChange: (b: LandingButton) => void; flags: EditorFlags }) {
  const off = (value.action === 'signup' && !flags.allowSignup) || (value.action === 'demo' && !flags.allowDemo);
  return (
    <fieldset className="space-y-2 rounded-ui border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label={`${label}: texto`} value={value.label} maxLength={60} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="Texto del botón" />
        <Select aria-label={`${label}: adónde lleva`} value={value.action} onChange={(e) => onChange({ ...value, action: e.target.value as LandingButton['action'] })}>
          {LANDING_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {LANDING_ACTION_LABELS[a]}
            </option>
          ))}
        </Select>
      </div>
      {value.action === 'url' && (
        <Input aria-label={`${label}: dirección`} value={value.url} maxLength={2048} onChange={(e) => onChange({ ...value, url: e.target.value })} placeholder="https://… , mailto:… , tel:… o #seccion" />
      )}
      {off && <p className="text-xs text-amber-700 dark:text-amber-300">{value.action === 'signup' ? 'El registro está apagado' : 'Las demos están apagadas'} en Ajustes → Acceso: este botón no se muestra.</p>}
    </fieldset>
  );
}

function OptionalButton({ label, value, onChange, flags }: { label: string; value: LandingButton | null; onChange: (b: LandingButton | null) => void; flags: EditorFlags }) {
  return (
    <div className="space-y-2">
      <Toggle checked={value !== null} onChange={(on) => onChange(on ? { label: 'Pedir una demo', action: 'demo', url: '' } : null)} label={label} />
      {value && <ButtonEditor label={label} value={value} onChange={onChange} flags={flags} />}
    </div>
  );
}
