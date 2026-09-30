import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  SURVEY_QUESTION_LABELS,
  SURVEY_QUESTION_TYPES,
  SURVEY_TEMPLATES,
  surveyBodySchema,
  type SurveyBody,
  type SurveyDTO,
  type SurveyQuestion,
  type SurveyQuestionType,
} from '@gc/shared';
import { Button, ChipSelect, Field, Input, Loading, Select, Textarea, Toggle, cx, useFeedback } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { translator } from '../../lib/i18n';
import { useBranches, useServices } from '../../lib/queries';
import { describeError, sameJson } from './customization/common';
import { SurveyForm } from '../survey/SurveyForm';
import { surveyBody } from './SurveysPage';

const newId = () => Math.random().toString(36).slice(2, 10);

function blankQuestion(type: SurveyQuestionType): SurveyQuestion {
  const titles: Record<SurveyQuestionType, string> = {
    rating: '¿Cómo calificaría la atención recibida?',
    faces: '¿Cómo fue su experiencia?',
    nps: '¿Qué tan probable es que nos recomiende a un familiar o amigo?',
    choice: '¿Qué fue lo mejor de su visita?',
    multi: '¿Qué aspectos podemos mejorar?',
    yesno: '¿Resolvimos lo que vino a hacer?',
    text: 'Comentarios o sugerencias',
  };
  return {
    id: newId(),
    type,
    title: titles[type],
    help: '',
    required: type !== 'text',
    options: type === 'choice' || type === 'multi' ? ['Opción 1', 'Opción 2'] : [],
    lowLabel: type === 'nps' ? 'Nada probable' : '',
    highLabel: type === 'nps' ? 'Muy probable' : '',
  };
}

const EMPTY: SurveyBody = {
  name: 'Nueva encuesta',
  title: '¿Cómo fue su atención?',
  intro: '',
  thanks: '¡Gracias por su opinión! Nos ayuda a mejorar.',
  active: true,
  serviceIds: [],
  branchIds: [],
  questions: [blankQuestion('rating'), blankQuestion('text')],
  expiresDays: 7,
  allowAnonymous: true,
};

export default function SurveyEditorPage() {
  const { id = 'nueva' } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'nueva';
  const surveys = useQuery({ queryKey: ['surveys'], queryFn: () => api.get<SurveyDTO[]>('/surveys'), enabled: !isNew });
  const existing = surveys.data?.find((s) => s.id === id);

  const initial = useMemo<SurveyBody | null>(() => {
    if (!isNew) return existing ? surveyBody(existing) : null;
    const tpl = SURVEY_TEMPLATES.find((t) => t.key === params.get('plantilla'));
    return tpl ? { ...EMPTY, ...tpl.body, questions: tpl.body.questions.map((q) => ({ ...q })) } : EMPTY;
  }, [isNew, existing, params]);

  if (!isNew && surveys.isLoading) return <Loading />;
  if (!initial) return <p className="text-sm text-red-600">No se encontró la encuesta.</p>;
  return <Editor key={id} id={isNew ? null : id} initial={initial} existing={existing ?? null} />;
}

function Editor({ id, initial, existing }: { id: string | null; initial: SurveyBody; existing: SurveyDTO | null }) {
  const { terms, settings } = useAuth();
  const services = useServices();
  const branches = useBranches();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState<SurveyBody>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = !sameJson(form, initial);
  const t = translator(settings.locale, settings.terminology);
  const check = surveyBodySchema.safeParse(form);
  const problem = check.success ? null : check.error.issues[0];

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const set = <K extends keyof SurveyBody>(k: K, v: SurveyBody[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setQuestion = (i: number, patch: Partial<SurveyQuestion>) => setForm((f) => ({ ...f, questions: f.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const move = (i: number, delta: number) =>
    setForm((f) => {
      const qs = [...f.questions];
      const [q] = qs.splice(i, 1);
      qs.splice(i + delta, 0, q!);
      return { ...f, questions: qs };
    });

  async function save() {
    setSaving(true);
    try {
      if (id) await api.put(`/surveys/${id}`, form);
      else await api.post('/surveys', form);
      await qc.invalidateQueries({ queryKey: ['surveys'] });
      toast(id ? 'Encuesta guardada' : 'Encuesta creada');
      navigate('/app/encuestas?tab=encuestas');
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/app/encuestas?tab=encuestas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Encuestas
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{id ? form.name : 'Nueva encuesta'}</h1>
        {existing && existing.responses > 0 && <span className="text-xs text-muted">{existing.responses} respuestas: los cambios se aplican a las próximas.</span>}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <section className="gc-card gc-pad space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <Field label="Nombre interno" className="min-w-60 flex-1">
                <Input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <div className="pt-7">
                <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Activa" />
              </div>
            </div>
            <Field label="Título que ve el cliente">
              <Input value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Introducción" hint="Opcional. Ej.: «Son 3 preguntas y le lleva un minuto».">
                <Textarea rows={2} maxLength={500} value={form.intro} onChange={(e) => set('intro', e.target.value)} />
              </Field>
              <Field label="Mensaje de agradecimiento">
                <Textarea rows={2} maxLength={500} value={form.thanks} onChange={(e) => set('thanks', e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="gc-card gc-pad space-y-4">
            <header>
              <h3 className="text-base font-semibold">Dónde se usa</h3>
              <p className="text-sm text-muted">
                Sin elegir nada se usa en todos. Si hay varias encuestas activas, a cada {terms.ticket.toLowerCase()} le toca la más específica (la de su {terms.service.toLowerCase()} gana a la general).
              </p>
            </header>
            <Field label={terms.services}>
              <ChipSelect options={(services.data ?? []).map((s) => ({ value: s.id, label: s.name, color: s.color }))} value={form.serviceIds} onChange={(v) => set('serviceIds', v)} emptyLabel="Cargando…" />
            </Field>
            {(branches.data?.length ?? 0) > 1 && (
              <Field label={terms.branches}>
                <ChipSelect options={(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))} value={form.branchIds} onChange={(v) => set('branchIds', v)} />
              </Field>
            )}
            <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
              <Field label="El enlace del turno vence a los" hint="Días desde que terminó la atención.">
                <Select value={form.expiresDays} onChange={(e) => set('expiresDays', Number(e.target.value))}>
                  {[1, 2, 3, 7, 14, 30, 60].map((d) => (
                    <option key={d} value={d}>
                      {d} {d === 1 ? 'día' : 'días'}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="pt-1">
                <Toggle
                  checked={form.allowAnonymous}
                  onChange={(v) => set('allowAnonymous', v)}
                  label="Enlace general (QR)"
                  hint="Permite responder sin turno: QR en la salida, en la TV o un enlace en redes."
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-base font-semibold">Preguntas</h3>
            {form.questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                index={i}
                question={q}
                count={form.questions.length}
                onChange={(patch) => setQuestion(i, patch)}
                onMove={(d) => move(i, d)}
                onDuplicate={() => setForm((f) => ({ ...f, questions: [...f.questions.slice(0, i + 1), { ...q, id: newId() }, ...f.questions.slice(i + 1)] }))}
                onRemove={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))}
              />
            ))}
            {form.questions.length < 20 && (
              <div className="rounded-ui border border-dashed border-border p-4">
                <p className="mb-2 text-sm font-medium">Agregar una pregunta</p>
                <div className="flex flex-wrap gap-1.5">
                  {SURVEY_QUESTION_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, blankQuestion(type)] }))}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition hover:bg-subtle"
                      title={SURVEY_QUESTION_LABELS[type].description}
                    >
                      <Plus className="size-3.5" /> {SURVEY_QUESTION_LABELS[type].name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Vista previa en un celular */}
        <aside className="xl:sticky xl:top-6">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted">
            <Star className="size-4" /> Vista previa
          </p>
          <div className="mx-auto w-full max-w-[24rem] rounded-[2.2rem] border-[6px] border-fg/80 bg-bg shadow-xl">
            <div className="gc-scroll max-h-[70vh] overflow-y-auto rounded-[1.8rem] p-4">
              <SurveyForm survey={form} t={t} compact />
            </div>
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 z-20 border-t border-border bg-bg/90 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-sm text-muted" aria-live="polite">
            {problem ? <span className="text-red-600">{problem.message}</span> : dirty ? 'Tiene cambios sin guardar' : 'Sin cambios'}
          </p>
          <Button variant="secondary" onClick={() => navigate('/app/encuestas?tab=encuestas')}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={Boolean(problem) || (!dirty && Boolean(id))} onClick={() => void save()}>
            {id ? 'Guardar cambios' : 'Crear encuesta'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionEditor({
  index,
  question: q,
  count,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  index: number;
  question: SurveyQuestion;
  count: number;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const withOptions = q.type === 'choice' || q.type === 'multi';
  const withLabels = q.type === 'nps' || q.type === 'rating';
  return (
    <div className="gc-card gc-pad space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary-text">{index + 1}</span>
        <div className="w-60 max-w-full">
        <Select
          aria-label="Tipo de pregunta"
          value={q.type}
          onChange={(e) => {
            const type = e.target.value as SurveyQuestionType;
            const base = blankQuestion(type);
            onChange({ type, options: type === 'choice' || type === 'multi' ? (q.options.length >= 2 ? q.options : base.options) : [], lowLabel: base.lowLabel, highLabel: base.highLabel });
          }}
        >
          {SURVEY_QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {SURVEY_QUESTION_LABELS[t].name}
            </option>
          ))}
        </Select>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <Toggle checked={q.required} onChange={(v) => onChange({ required: v })} label="Obligatoria" />
          <span className="mx-1 h-6 w-px bg-border" />
          <IconAction label="Subir" disabled={index === 0} onClick={() => onMove(-1)} icon={<ArrowUp />} />
          <IconAction label="Bajar" disabled={index === count - 1} onClick={() => onMove(1)} icon={<ArrowDown />} />
          <IconAction label="Duplicar" disabled={count >= 20} onClick={onDuplicate} icon={<Copy />} />
          <IconAction label="Eliminar" disabled={count <= 1} onClick={onRemove} icon={<Trash2 />} danger />
        </div>
      </div>
      <Field label="Pregunta">
        <Input value={q.title} maxLength={300} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field label="Aclaración" hint="Opcional, en letra chica debajo de la pregunta.">
        <Input value={q.help} maxLength={300} onChange={(e) => onChange({ help: e.target.value })} />
      </Field>
      {withLabels && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Texto del extremo bajo">
            <Input value={q.lowLabel} maxLength={60} onChange={(e) => onChange({ lowLabel: e.target.value })} placeholder={q.type === 'nps' ? 'Nada probable' : 'Opcional'} />
          </Field>
          <Field label="Texto del extremo alto">
            <Input value={q.highLabel} maxLength={60} onChange={(e) => onChange({ highLabel: e.target.value })} placeholder={q.type === 'nps' ? 'Muy probable' : 'Opcional'} />
          </Field>
        </div>
      )}
      {withOptions && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Opciones</p>
          {q.options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={o}
                maxLength={120}
                aria-label={`Opción ${i + 1}`}
                onChange={(e) => onChange({ options: q.options.map((x, j) => (j === i ? e.target.value : x)) })}
                className={cx(!o.trim() && 'border-red-500')}
              />
              <IconAction label="Quitar opción" disabled={q.options.length <= 2} onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })} icon={<X />} />
            </div>
          ))}
          {q.options.length < 12 && (
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => onChange({ options: [...q.options, `Opción ${q.options.length + 1}`] })}>
              Agregar opción
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted">{SURVEY_QUESTION_LABELS[q.type].description}</p>
    </div>
  );
}

function IconAction({ label, icon, onClick, disabled, danger }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('grid size-8 place-items-center rounded-ui text-muted transition hover:bg-subtle hover:text-fg disabled:opacity-30 [&_svg]:size-4', danger && 'hover:text-red-600')}
    >
      {icon}
    </button>
  );
}
