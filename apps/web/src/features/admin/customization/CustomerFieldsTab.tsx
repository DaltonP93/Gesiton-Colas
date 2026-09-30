import { ArrowDown, ArrowUp, Info, Lock, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BUILTIN_CUSTOMER_FIELDS, type CustomerField } from '@gc/shared';
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Select } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { Callout, SaveBar, Section, sameJson, useReportDirty, useSaveTenant, type TabProps } from './common';
import { PrivacySection } from './PrivacySection';
import { FIELD_TYPES } from './presets';

const MAX_FIELDS = 30;
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const BUILTIN_KEYS = new Set(BUILTIN_CUSTOMER_FIELDS.map((f) => f.key));

interface Row {
  uid: string;
  key: string;
  label: string;
  type: CustomerField['type'];
  required: boolean;
  placeholder: string;
  /** Opciones separadas por comas (solo para listas). */
  optionsText: string;
  /** La clave se genera desde la etiqueta hasta que el usuario la edita. */
  keyTouched: boolean;
}

let counter = 0;
const uid = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

const toRow = (f: CustomerField): Row => ({
  uid: uid(),
  key: f.key,
  label: f.label,
  type: f.type,
  required: f.required,
  placeholder: f.placeholder,
  optionsText: f.options.join(', '),
  keyTouched: true,
});

const parseOptions = (text: string) =>
  text
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

// Mismo orden de claves que `customerFieldSchema`, para comparar cambios con la versión guardada.
const toField = (r: Row): CustomerField => ({
  key: r.key.trim(),
  label: r.label.trim(),
  type: r.type,
  required: r.required,
  options: r.type === 'select' ? parseOptions(r.optionsText) : [],
  placeholder: r.placeholder.trim(),
});

/** "Número de afiliado" → "numero_de_afiliado" */
function slugKey(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
  return base.slice(0, 40);
}

export function CustomerFieldsTab({ onDirtyChange }: TabProps) {
  const { settings, terms, can } = useAuth();
  const { save, saving } = useSaveTenant();
  const source = settings.customerFields;
  const [rows, setRows] = useState<Row[]>(() => source.map(toRow));

  const sourceKey = JSON.stringify(source);
  const [base, setBase] = useState(sourceKey);
  if (base !== sourceKey) {
    setBase(sourceKey);
    setRows(source.map(toRow));
  }

  const fields = rows.map(toField);
  const savedFields = useMemo(() => source.map((f) => toField(toRow(f))), [source]);
  const dirty = !sameJson(fields, savedFields);
  useReportDirty(dirty, onDirtyChange);

  const keyCounts = new Map<string, number>();
  for (const f of fields) keyCounts.set(f.key, (keyCounts.get(f.key) ?? 0) + 1);

  const errorsFor = (r: Row, f: CustomerField) => ({
    key: !f.key
      ? 'Obligatoria'
      : !KEY_PATTERN.test(f.key)
        ? 'Use letras, números y _ (debe empezar con una letra)'
        : BUILTIN_KEYS.has(f.key)
          ? 'Esa clave ya existe como campo estándar'
          : (keyCounts.get(f.key) ?? 0) > 1
            ? 'Clave repetida'
            : null,
    label: !f.label ? 'Obligatoria' : f.label.length > 80 ? 'Máximo 80 caracteres' : null,
    options:
      r.type === 'select' && f.options.length === 0
        ? 'Agregue al menos una opción'
        : f.options.length > 50
          ? 'Máximo 50 opciones'
          : f.options.some((o) => o.length > 80)
            ? 'Cada opción admite hasta 80 caracteres'
            : null,
    placeholder: f.placeholder.length > 120 ? 'Máximo 120 caracteres' : null,
  });
  const allErrors = rows.map((r, i) => errorsFor(r, fields[i]!));
  const invalid = allErrors.some((e) => Object.values(e).some(Boolean));

  const update = (id: string, patch: Partial<Row>) =>
    setRows((list) =>
      list.map((r) => {
        if (r.uid !== id) return r;
        const next = { ...r, ...patch };
        if (patch.label !== undefined && !r.keyTouched) next.key = slugKey(patch.label);
        return next;
      }),
    );
  const move = (index: number, delta: number) =>
    setRows((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  const add = () =>
    setRows((list) => [...list, { uid: uid(), key: '', label: '', type: 'text', required: false, placeholder: '', optionsText: '', keyTouched: false }]);
  const remove = (id: string) => setRows((list) => list.filter((r) => r.uid !== id));

  return (
    <div className="space-y-6">
      <Callout icon={<Info />}>
        <p className="font-medium">Datos que puede pedir al emitir un {terms.ticket.toLowerCase()}.</p>
        <p className="text-muted">
          Los campos estándar siempre están disponibles. Aquí puede agregar otros propios (por ejemplo, número de afiliado u obra social). Cada{' '}
          <Link to="/app/kioscos" className="font-medium text-primary underline-offset-2 hover:underline">
            kiosco
          </Link>{' '}
          elige qué datos solicita. Quitar un campo no borra lo que ya se registró en {terms.tickets.toLowerCase()} anteriores.
        </p>
      </Callout>

      <Section title="Campos estándar" description="Incluidos siempre; no se pueden modificar.">
        <div className="flex flex-wrap gap-2">
          {BUILTIN_CUSTOMER_FIELDS.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-2 rounded-full border border-border bg-subtle px-3 py-1.5 text-sm">
              <Lock className="size-3.5 text-muted" aria-hidden />
              {f.label}
              <code className="text-xs text-muted">{f.key}</code>
            </span>
          ))}
        </div>
      </Section>

      <Section
        title="Campos personalizados"
        description={`${rows.length} de ${MAX_FIELDS} campos`}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Todavía no agregó campos propios"
            description="Agregue los datos adicionales que necesita conocer de cada persona."
            action={
              <Button icon={<Plus className="size-4" />} onClick={add}>
                Agregar campo
              </Button>
            }
          />
        ) : (
          <ol className="space-y-3">
            {rows.map((r, i) => {
              const errors = allErrors[i]!;
              return (
                <li key={r.uid} className="rounded-ui border border-border bg-bg/40 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Badge>{i + 1}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.label.trim() || 'Nuevo campo'}</span>
                    {r.required && <Badge color="#dc2626">Obligatorio</Badge>}
                    <IconButton label="Subir" icon={<ArrowUp className="size-4" />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton label="Bajar" icon={<ArrowDown className="size-4" />} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                    <IconButton
                      label={`Eliminar el campo ${r.label || i + 1}`}
                      icon={<Trash2 className="size-4" />}
                      className="text-red-600 hover:bg-red-600/10"
                      onClick={() => remove(r.uid)}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Etiqueta" required error={errors.label} className="lg:col-span-2">
                      <Input value={r.label} maxLength={80} placeholder="Ej.: Número de afiliado" onChange={(e) => update(r.uid, { label: e.target.value })} />
                    </Field>
                    <Field label="Clave" required error={errors.key} hint="Identificador en la API y en el CSV.">
                      <Input
                        value={r.key}
                        maxLength={40}
                        className="font-mono text-xs"
                        placeholder="numero_afiliado"
                        onChange={(e) => update(r.uid, { key: e.target.value, keyTouched: true })}
                      />
                    </Field>
                    <Field label="Tipo">
                      <Select value={r.type} onChange={(e) => update(r.uid, { type: e.target.value as CustomerField['type'] })}>
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {r.type === 'select' ? (
                      <Field label="Opciones" required error={errors.options} hint="Separadas por comas." className="sm:col-span-2">
                        <Input value={r.optionsText} placeholder="Ej.: OSDE, Swiss Medical, Particular" onChange={(e) => update(r.uid, { optionsText: e.target.value })} />
                      </Field>
                    ) : (
                      <Field label="Texto de ayuda" error={errors.placeholder} hint="Se muestra dentro del campo vacío." className="sm:col-span-2">
                        <Input value={r.placeholder} maxLength={120} placeholder="Ej.: Solo números" onChange={(e) => update(r.uid, { placeholder: e.target.value })} />
                      </Field>
                    )}
                    <div className="flex items-end pb-2 sm:col-span-2">
                      <Checkbox checked={r.required} onChange={(v) => update(r.uid, { required: v })} label="Obligatorio cuando el kiosco lo solicita" />
                    </div>
                  </div>
                  {r.type === 'select' && parseOptions(r.optionsText).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {parseOptions(r.optionsText).map((o, j) => (
                        <Badge key={`${o}-${j}`}>{o}</Badge>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > 0 && (
          <Button variant="secondary" icon={<Plus className="size-4" />} className="mt-4" disabled={rows.length >= MAX_FIELDS} onClick={add}>
            Agregar campo
          </Button>
        )}
      </Section>

      {can('admin') && <PrivacySection />}

      <SaveBar
        dirty={dirty}
        saving={saving}
        invalid={invalid}
        onSave={() => void save({ settings: { customerFields: fields } }, 'Campos del cliente guardados')}
        onDiscard={() => setRows(source.map(toRow))}
      />
    </div>
  );
}
