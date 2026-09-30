import { useState } from 'react';
import { formatTicketCode, ticketNumberFor, type TicketSettings } from '@gc/shared';
import { NumberingStatus } from './NumberingStatus';
import { Field, Input, RangeInput, Select, Toggle, cx } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useServices } from '../../../lib/queries';
import { SaveBar, Section, sameJson, useReportDirty, useSaveTenant, type TabProps } from './common';

const RESET_TEXT: Record<TicketSettings['reset'], string> = {
  daily: 'Vuelve al número inicial automáticamente cada día.',
  weekly: 'Vuelve al número inicial automáticamente cada lunes.',
  monthly: 'Vuelve al número inicial automáticamente el primer día de cada mes.',
  yearly: 'Vuelve al número inicial automáticamente cada 1 de enero.',
  never: 'No se reinicia sola entre días.',
};

function clampInt(value: string, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function TicketsTab({ onDirtyChange }: TabProps) {
  const { settings, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const services = useServices();
  const source = settings.tickets;
  const [draft, setDraft] = useState<TicketSettings>(source);

  const sourceKey = JSON.stringify(source);
  const [base, setBase] = useState(sourceKey);
  if (base !== sourceKey) {
    setBase(sourceKey);
    setDraft(source);
  }

  const dirty = !sameJson(draft, source);
  useReportDirty(dirty, onDirtyChange);
  const set = <K extends keyof TicketSettings>(key: K, value: TicketSettings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const prefixes = (services.data ?? [])
    .filter((s) => s.active && s.prefix)
    .map((s) => s.prefix)
    .filter((p, i, all) => all.indexOf(p) === i)
    .slice(0, 2);
  const [p1, p2] = [prefixes[0] ?? 'A', prefixes[1] ?? 'B'];
  const code = (prefix: string, n: number) => formatTicketCode(prefix, n, draft.digits);
  const max = 10 ** draft.digits - 1;
  const ticket = terms.ticket.toLowerCase();
  const tickets = terms.tickets.toLowerCase();

  const n = (counter: number) => ticketNumberFor(counter, draft);
  const sequence =
    draft.scope === 'service'
      ? [code(p1, n(1)), code(p1, n(2)), code(p2, n(1)), code(p1, n(3)), code(p2, n(2))]
      : [code(p1, n(1)), code(p1, n(2)), code(p2, n(3)), code(p1, n(4)), code(p2, n(5))];

  const ratio = draft.priorityRatio;

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Numeración" description={`Cómo se forma el código de cada ${ticket}.`}>
          <div className="space-y-5">
            <RangeInput
              label="Cantidad de dígitos"
              min={1}
              max={6}
              value={draft.digits}
              onChange={(v) => set('digits', v)}
              format={(v) => `${v} ${v === 1 ? 'dígito' : 'dígitos'}`}
            />
            <div className="rounded-ui bg-subtle p-4">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">Ejemplo de secuencia</p>
              <div className="mt-2 flex flex-wrap gap-2" aria-label={`Ejemplo: ${sequence.join(', ')}`}>
                {sequence.map((c, i) => (
                  <span
                    key={`${c}-${i}`}
                    className={cx(
                      'rounded-ui border border-border bg-surface px-3 py-1.5 font-mono text-lg font-bold tracking-wide shadow-sm',
                      i === 0 && 'border-primary text-primary',
                    )}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Empieza en" hint={`El primer ${ticket} de cada período y después de un reinicio.`}>
                <Input type="number" min={0} max={Math.min(99_999, max)} value={draft.startAt} onChange={(e) => set('startAt', clampInt(e.target.value, 0, Math.min(99_999, max)))} />
              </Field>
              <Field label={`Después de ${code(p1, max)}`}>
                <Select value={draft.overflow} onChange={(e) => set('overflow', e.target.value as TicketSettings['overflow'])}>
                  <option value="wrap">Vuelve a {code(p1, draft.startAt)} (recomendado)</option>
                  <option value="grow">Sigue con {code(p1, max + 1)}</option>
                </Select>
              </Field>
              <Field label="Reinicio automático">
                <Select value={draft.reset} onChange={(e) => set('reset', e.target.value as TicketSettings['reset'])}>
                  <option value="daily">Cada día (recomendado)</option>
                  <option value="weekly">Cada semana (lunes)</option>
                  <option value="monthly">Cada mes</option>
                  <option value="yearly">Cada año</option>
                  <option value="never">Nunca (numeración continua)</option>
                </Select>
              </Field>
              <Field label="Alcance del contador">
                <Select value={draft.scope} onChange={(e) => set('scope', e.target.value as TicketSettings['scope'])}>
                  <option value="service">Por {terms.service.toLowerCase()}</option>
                  <option value="branch">Compartido por {terms.branch.toLowerCase()}</option>
                </Select>
              </Field>
            </div>
            <div className="rounded-ui border border-primary/25 bg-primary/5 p-4 text-sm">
              <p className="font-semibold">¿Qué pasa después de {code(p1, max)}?</p>
              <p className="mt-1 text-fg/85">
                {draft.overflow === 'wrap'
                  ? `El siguiente ${ticket} vuelve a ser ${code(p1, draft.startAt)} y la numeración sigue sola. No se mezclan: los ${tickets} anteriores con el mismo código ya fueron atendidos.`
                  : `El número crece un dígito (${code(p1, max + 1)}, ${code(p1, max + 2)}…) hasta el próximo reinicio.`}{' '}
                {draft.scope === 'service'
                  ? `Cada ${terms.service.toLowerCase()} lleva su propio contador (${code(p1, draft.startAt)}, ${code(p2, draft.startAt)}…).`
                  : `Un solo contador para toda la ${terms.branch.toLowerCase()}: el número no se repite entre ${terms.services.toLowerCase()}.`}{' '}
                {RESET_TEXT[draft.reset]} Además puede reiniciarla a mano abajo o con «Cerrar jornada» en el Monitor.
              </p>
            </div>
          </div>
        </Section>

        <div className="space-y-6">
          <Section title="Llamados" description={`Qué pasa cuando la persona no se presenta al ser llamada.`}>
            <Field
              label="Marcar «No se presentó» automáticamente después de"
              hint={
                draft.autoNoShowAfterCalls === 0
                  ? `Nunca: el ${terms.agent.toLowerCase()} decide cuándo marcarlo.`
                  : `Al llamar ${draft.autoNoShowAfterCalls} ${draft.autoNoShowAfterCalls === 1 ? 'vez' : 'veces'} sin respuesta, el siguiente llamado lo marca como ausente.`
              }
            >
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  className="w-24"
                  value={draft.autoNoShowAfterCalls}
                  onChange={(e) => set('autoNoShowAfterCalls', clampInt(e.target.value, 0, 20))}
                />
                <span className="text-sm text-muted">llamados (0 = nunca)</span>
              </div>
            </Field>
          </Section>

          <Section title="Prioridades" description={`Cómo se intercalan los ${tickets} preferenciales con los normales.`}>
            <Field label="Intercalar un normal cada">
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  className="w-24"
                  value={ratio}
                  onChange={(e) => set('priorityRatio', clampInt(e.target.value, 0, 20))}
                />
                <span className="text-sm text-muted">preferenciales (0 = siempre prioriza)</span>
              </div>
            </Field>
            <div className="mt-3 rounded-ui bg-subtle p-3 text-sm">
              {ratio === 0 ? (
                <p>Los {tickets} preferenciales siempre se llaman primero. Si hay muchos, la fila normal puede quedar esperando.</p>
              ) : (
                <p>
                  Después de {ratio} {ratio === 1 ? `${ticket} preferencial` : `${tickets} preferenciales`} seguidos se llama a uno normal, para que la fila normal
                  también avance.
                </p>
              )}
              <p className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
                {Array.from({ length: ratio === 0 ? 5 : Math.min(ratio, 6) + 1 }, (_, i) => {
                  const normal = ratio > 0 && i === Math.min(ratio, 6);
                  return (
                    <span
                      key={i}
                      className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', normal ? 'bg-surface text-fg ring-1 ring-border' : 'bg-accent text-accent-fg')}
                    >
                      {normal ? 'Normal' : 'Pref.'}
                    </span>
                  );
                })}
                {ratio > 6 && <span className="text-xs text-muted">…</span>}
              </p>
            </div>
          </Section>

          <Section title="Privacidad">
            <Toggle
              checked={draft.announceCustomerName}
              onChange={(v) => set('announceCustomerName', v)}
              label="Mostrar y anunciar el nombre del cliente"
              hint="El nombre aparece en las pantallas y en el anuncio por voz, si la persona lo ingresó. Útil en consultorios y farmacias."
            />
          </Section>
        </div>
      </div>

      <NumberingStatus />

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save({ settings: { tickets: draft } }, 'Configuración de turnos guardada')} onDiscard={() => setDraft(source)} />
    </div>
  );
}
