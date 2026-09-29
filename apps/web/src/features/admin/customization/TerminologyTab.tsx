import { Info, MonitorPlay, Smartphone, Tablet, Volume2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { terminologySchema, type Terminology } from '@gc/shared';
import { Button, Field, Input, cx } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { Callout, SaveBar, Section, sameJson, useReportDirty, useSaveTenant, type TabProps } from './common';
import { TERM_FIELDS, TERM_PRESETS } from './presets';

const DEFAULTS = terminologySchema.parse({});

export function TerminologyTab({ onDirtyChange }: TabProps) {
  const { settings } = useAuth();
  const { save, saving } = useSaveTenant();
  const source = settings.terminology;
  const [draft, setDraft] = useState<Terminology>(source);

  const sourceKey = JSON.stringify(source);
  const [base, setBase] = useState(sourceKey);
  if (base !== sourceKey) {
    setBase(sourceKey);
    setDraft(source);
  }

  const dirty = !sameJson(draft, source);
  useReportDirty(dirty, onDirtyChange);

  const set = (key: keyof Terminology, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const errorFor = (key: keyof Terminology) => (!draft[key].trim() ? 'Obligatorio' : draft[key].length > 40 ? 'Máximo 40 caracteres' : null);
  const invalid = (Object.keys(draft) as (keyof Terminology)[]).some((k) => errorFor(k));

  const isPresetActive = (terms: Partial<Terminology>) => (Object.keys(terms) as (keyof Terminology)[]).every((k) => draft[k] === terms[k]);

  const onSave = async () => {
    const terminology = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()])) as Terminology;
    await save({ settings: { terminology } }, 'Terminología actualizada');
  };

  const t = draft;
  const lower = (s: string) => s.toLowerCase();

  return (
    <div className="space-y-6">
      <Callout icon={<Info />}>
        <p className="font-medium">Use las palabras con las que su público ya está familiarizado.</p>
        <p className="text-muted">
          Estas palabras aparecen en el panel, las pantallas de llamado, los kioscos, los tickets impresos, la página de seguimiento en el celular y los
          anuncios por voz. Revise también la frase de voz de cada pantalla si la personalizó.
        </p>
      </Callout>

      <Section title="Plantillas rápidas" description="Un clic completa las palabras más comunes para su rubro. Luego puede ajustarlas.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {TERM_PRESETS.map((p) => {
            const active = isPresetActive(p.terms);
            return (
              <button
                key={p.name}
                type="button"
                aria-pressed={active}
                onClick={() => setDraft((d) => ({ ...d, ...p.terms }))}
                className={cx(
                  'rounded-ui border p-3 text-left transition',
                  active ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:border-primary/40 hover:bg-subtle',
                )}
              >
                <span className="block text-sm font-semibold">{p.name}</span>
                <span className="block text-xs text-muted">{p.description}</span>
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setDraft(DEFAULTS)}>
          Restablecer palabras originales
        </Button>
      </Section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Section title="Palabras">
          <div className="space-y-4">
            {TERM_FIELDS.map((f) => (
              <div key={f.key} className={cx('grid gap-3', f.plural && 'sm:grid-cols-2')}>
                <Field label={f.label} error={errorFor(f.key)}>
                  <Input value={draft[f.key]} maxLength={40} placeholder={DEFAULTS[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                </Field>
                {f.plural && (
                  <Field label={f.pluralLabel} error={errorFor(f.plural)}>
                    <Input value={draft[f.plural]} maxLength={40} placeholder={DEFAULTS[f.plural]} onChange={(e) => set(f.plural!, e.target.value)} />
                  </Field>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Así se verá" className="lg:sticky lg:top-6">
          <ul className="space-y-3 text-sm">
            <Example icon={<Tablet />} where="Kiosco">
              Toque el {lower(t.service)} que necesita · Su {lower(t.ticket)} es <b>A001</b>
            </Example>
            <Example icon={<MonitorPlay />} where="Pantalla de llamados">
              {t.ticket} <b>A001</b> → {t.counter} 3
            </Example>
            <Example icon={<Volume2 />} where="Anuncio por voz">
              «{t.ticket} A001, por favor diríjase a {lower(t.counter)} 3»
            </Example>
            <Example icon={<Smartphone />} where="Seguimiento en el celular">
              Seguimiento de su {lower(t.ticket)} · {t.branch} Centro
            </Example>
            <Example icon={<Info />} where="Panel">
              {t.tickets} en espera · {t.counters} · {t.services} · {t.branches} · {t.customer} · {t.agent}
            </Example>
          </ul>
        </Section>
      </div>

      <SaveBar dirty={dirty} saving={saving} invalid={invalid} onSave={() => void onSave()} onDiscard={() => setDraft(source)} />
    </div>
  );
}

function Example({ icon, where, children }: { icon: ReactNode; where: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-muted">{where}</span>
        <span className="block break-words">{children}</span>
      </span>
    </li>
  );
}
