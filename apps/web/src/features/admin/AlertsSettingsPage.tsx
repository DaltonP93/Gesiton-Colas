import { useMutation } from '@tanstack/react-query';
import { BellRing, Plus, Send, X } from 'lucide-react';
import { useState } from 'react';
import type { DeviceAlertSettings } from '@gc/shared';
import { Button, Field, Input, PageHeader, Select, Toggle, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { SaveBar, Section, sameJson, useSaveTenant } from './customization/common';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Configuración → Alertas de equipos: aviso cuando una TV o un kiosco se desconecta. */
export default function AlertsSettingsPage() {
  const { settings, hasModule } = useAuth();
  const { save, saving } = useSaveTenant();
  const { toast } = useFeedback();
  const [form, setForm] = useState<DeviceAlertSettings>(settings.alerts.devices);
  const dirty = !sameJson(form, settings.alerts.devices);
  const set = <K extends keyof DeviceAlertSettings>(k: K, v: DeviceAlertSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const test = useMutation({
    mutationFn: () => api.post<{ message: string }>('/alerts/devices/test'),
    onSuccess: (r) => toast(r.message),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="space-y-[var(--gc-gap)]">
      <PageHeader
        icon={<BellRing />}
        title="Alertas de equipos"
        description="Le avisamos por correo (y por WhatsApp o SMS si tiene el módulo de avisos) cuando una TV o un kiosco deja de responder, y cuando vuelve."
      />

      <Section title="Cuándo avisar">
        <div className="space-y-5">
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Avisar cuando un equipo se desconecta" hint="Una sola alerta por desconexión; si se cortan varios a la vez llega un único mensaje." />
          <div className={cx('grid gap-5 lg:grid-cols-3', !form.enabled && 'pointer-events-none opacity-50')}>
            <Field label="Después de" hint="Minutos sin conexión.">
              <Select value={form.minutes} onChange={(e) => set('minutes', Number(e.target.value))}>
                {[2, 3, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </Select>
            </Field>
            <div className="lg:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Días y horario</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {DAYS.map((d, i) => {
                  const on = form.days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('days', on ? form.days.filter((x) => x !== i) : [...form.days, i].sort())}
                      className={cx('h-9 w-12 rounded-ui border text-sm font-medium transition', on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
                    >
                      {d}
                    </button>
                  );
                })}
                <span className="mx-2 text-sm text-muted">de</span>
                <Input type="time" className="w-32" value={form.from} onChange={(e) => set('from', e.target.value)} aria-label="Desde" />
                <span className="text-sm text-muted">a</span>
                <Input type="time" className="w-32" value={form.to} onChange={(e) => set('to', e.target.value)} aria-label="Hasta" />
              </div>
              <p className="mt-1.5 text-xs text-muted">Fuera de este horario no se avisa (las TVs suelen apagarse a la noche).</p>
            </div>
          </div>
          <Toggle checked={form.recovery} onChange={(v) => set('recovery', v)} label="Avisar también cuando vuelve a conectarse" />
        </div>
      </Section>

      <Section title="A quién avisar">
        <div className="grid gap-6 lg:grid-cols-2">
          <ListInput
            label="Correos"
            hint="Vacío = todos los administradores."
            type="email"
            placeholder="soporte@suempresa.com"
            values={form.emails}
            max={10}
            onChange={(v) => set('emails', v)}
          />
          <ListInput
            label="WhatsApp / SMS"
            hint={hasModule('notifications') ? 'Se envía con el canal de Configuración → Avisos.' : 'Requiere el módulo «Avisos por WhatsApp y SMS».'}
            type="tel"
            placeholder="0981 123 456"
            values={form.phones}
            max={5}
            disabled={!hasModule('notifications')}
            onChange={(v) => set('phones', v)}
          />
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <Button variant="secondary" icon={<Send className="size-4" />} loading={test.isPending} disabled={dirty} onClick={() => test.mutate()} title={dirty ? 'Guarde los cambios antes de probar' : undefined}>
            Enviar alerta de prueba
          </Button>
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={saving} onDiscard={() => setForm(settings.alerts.devices)} onSave={() => void save({ settings: { alerts: { devices: form } } }, 'Alertas guardadas')} />
    </div>
  );
}

function ListInput({
  label,
  hint,
  type,
  placeholder,
  values,
  max,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  type: string;
  placeholder: string;
  values: string[];
  max: number;
  disabled?: boolean;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v) || values.length >= max) return;
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className={cx(disabled && 'opacity-60')}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <Input
          type={type}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-label={label}
        />
        <Button variant="secondary" icon={<Plus className="size-4" />} disabled={disabled || !draft.trim()} onClick={add}>
          Agregar
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v} className="inline-flex items-center gap-1 rounded-full bg-subtle px-3 py-1 text-sm">
              {v}
              <button type="button" aria-label={`Quitar ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted hover:text-red-600">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
