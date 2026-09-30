import { Angry, Check, Frown, Laugh, Loader2, Meh, Smile, Star } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { SurveyAnswer, SurveyAnswers, SurveyBody, SurveyQuestion } from '@gc/shared';
import { cx } from '../../components/ui';
import type { translator } from '../../lib/i18n';

type T = ReturnType<typeof translator>;

export const FACE_ICONS = [Angry, Frown, Meh, Smile, Laugh];
export const FACE_COLORS = ['#dc2626', '#f97316', '#eab308', '#65a30d', '#059669'];

const isEmpty = (v: SurveyAnswer | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Formulario de una encuesta (lo ve el cliente y la vista previa del editor).
 * `onSubmit` recibe las respuestas; sin él, el formulario es solo una vista previa.
 */
export function SurveyForm({
  survey,
  t,
  onSubmit,
  header,
  compact,
}: {
  survey: Pick<SurveyBody, 'title' | 'intro' | 'questions'>;
  t: T;
  onSubmit?: (answers: SurveyAnswers) => Promise<void>;
  header?: ReactNode;
  compact?: boolean;
}) {
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (id: string, value: SurveyAnswer) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setMissing((m) => m.filter((x) => x !== id));
  };

  async function submit() {
    const lacking = survey.questions.filter((q) => q.required && isEmpty(answers[q.id])).map((q) => q.id);
    setMissing(lacking);
    if (lacking.length) {
      setError(t('survey.required'));
      document.getElementById(`q-${lacking[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!onSubmit) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(answers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cx('space-y-4', compact && 'text-[0.95em]')}>
      <div className={cx('text-center', !compact && 'rounded-3xl bg-surface px-5 py-6 shadow-xl')}>
        {header}
        <h1 className={cx('font-extrabold tracking-tight', compact ? 'text-xl' : 'text-2xl')}>{survey.title || '¿Cómo fue su atención?'}</h1>
        {survey.intro && <p className="mt-1 text-sm text-muted">{survey.intro}</p>}
      </div>

      {survey.questions.map((q, i) => (
        <section
          key={q.id}
          id={`q-${q.id}`}
          className={cx('rounded-2xl bg-surface p-4 shadow-sm ring-1 transition', missing.includes(q.id) ? 'ring-2 ring-red-500/70' : 'ring-border')}
          aria-labelledby={`q-${q.id}-title`}
        >
          <p id={`q-${q.id}-title`} className="font-semibold leading-snug">
            <span className="mr-1 text-muted tabular-nums">{i + 1}.</span>
            {q.title}
            {!q.required && <span className="ml-2 text-xs font-normal text-muted">{t('survey.optional')}</span>}
          </p>
          {q.help && <p className="mt-0.5 text-xs text-muted">{q.help}</p>}
          <div className="mt-3">
            <QuestionInput question={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} t={t} />
          </div>
        </section>
      ))}

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-center text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={sending}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-lg font-bold text-primary-fg shadow-lg transition active:scale-[0.99] disabled:opacity-60"
      >
        {sending ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
        {t('survey.send')}
      </button>
    </div>
  );
}

function QuestionInput({ question: q, value, onChange, t }: { question: SurveyQuestion; value: SurveyAnswer | undefined; onChange: (v: SurveyAnswer) => void; t: T }) {
  switch (q.type) {
    case 'nps':
      return (
        <div>
          <div className="grid grid-cols-6 gap-1.5 min-[420px]:grid-cols-11" role="radiogroup" aria-label={q.title}>
            {Array.from({ length: 11 }, (_, n) => {
              const active = value === n;
              const tone = n <= 6 ? 'bg-red-500 text-white' : n <= 8 ? 'bg-amber-400 text-black' : 'bg-emerald-500 text-white';
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(n)}
                  className={cx('h-11 rounded-xl text-base font-bold tabular-nums transition', active ? `${tone} scale-105 shadow` : 'bg-subtle hover:bg-fg/10')}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>{q.lowLabel || 'Nada probable'}</span>
            <span>{q.highLabel || 'Muy probable'}</span>
          </div>
        </div>
      );
    case 'rating':
      return (
        <div>
          <div className="flex justify-center gap-1.5" role="radiogroup" aria-label={q.title}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = typeof value === 'number' && value >= n;
              return (
                <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} de 5`} onClick={() => onChange(n)} className="p-1 transition active:scale-90">
                  <Star className={cx('size-10 transition', on ? 'fill-amber-400 text-amber-400' : 'text-fg/25')} strokeWidth={1.5} />
                </button>
              );
            })}
          </div>
          {(q.lowLabel || q.highLabel) && (
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{q.lowLabel}</span>
              <span>{q.highLabel}</span>
            </div>
          )}
        </div>
      );
    case 'faces':
      return (
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={q.title}>
          {FACE_ICONS.map((Icon, i) => {
            const n = i + 1;
            const active = value === n;
            const label = t(`survey.faces${n}` as 'survey.faces1');
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                onClick={() => onChange(n)}
                className={cx('flex flex-col items-center gap-1 rounded-xl px-1 py-2 transition', active ? 'scale-105 bg-subtle shadow-sm' : 'hover:bg-subtle')}
                style={active ? { boxShadow: `inset 0 0 0 2px ${FACE_COLORS[i]}` } : undefined}
              >
                <Icon className="size-10" strokeWidth={1.6} style={{ color: active || value === undefined ? FACE_COLORS[i] : 'color-mix(in srgb, var(--gc-fg) 30%, transparent)' }} />
                <span className={cx('text-[11px] leading-tight', active ? 'font-semibold' : 'text-muted')}>{label}</span>
              </button>
            );
          })}
        </div>
      );
    case 'choice':
    case 'multi': {
      const multi = q.type === 'multi';
      const selected = multi ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : [];
      return (
        <div className="grid gap-2" role={multi ? 'group' : 'radiogroup'} aria-label={q.title}>
          {q.options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={on}
                onClick={() => onChange(multi ? (on ? selected.filter((x) => x !== o) : [...selected, o]) : o)}
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition',
                  on ? 'border-primary bg-primary/10 font-semibold' : 'border-border hover:bg-subtle',
                )}
              >
                <span className={cx('grid size-5 shrink-0 place-items-center border-2', multi ? 'rounded-md' : 'rounded-full', on ? 'border-primary bg-primary text-primary-fg' : 'border-fg/30')}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'yesno':
      return (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={q.title}>
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => onChange(v)}
              className={cx(
                'rounded-xl border px-3 py-3 text-base font-semibold transition',
                value === v ? (v ? 'border-emerald-500 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300') : 'border-border hover:bg-subtle',
              )}
            >
              {v ? t('survey.yes') : t('survey.no')}
            </button>
          ))}
        </div>
      );
    case 'text':
      return (
        <textarea
          rows={3}
          maxLength={2000}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('survey.placeholder')}
          aria-label={q.title}
          className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      );
  }
}
