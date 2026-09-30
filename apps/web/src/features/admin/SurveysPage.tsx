import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Copy, Download, ListChecks, MessageSquareQuote, Pencil, Plus, QrCode as QrIcon, Star, ThumbsUp, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SURVEY_TEMPLATES, type SurveyBody, type SurveyDTO, type SurveyGroupStat, type SurveyQuestionStat, type SurveyResultsDTO } from '@gc/shared';
import { CopyField } from '../../components/CopyField';
import { QrCode } from '../../components/QrCode';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Toggle, cx, useFeedback } from '../../components/ui';
import { api, download, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, shiftDays, todayISO } from '../../lib/format';
import { useBranches, useServices, useUsers } from '../../lib/queries';
import { ChartTooltip } from './reports/charts';
import { formatNumber, formatPercent } from './reports/shared';

type TabKey = 'resultados' | 'encuestas';

/* Escala divergente (detractores ↔ promotores) con punto medio gris; validada para daltonismo. */
export const POLARITY = { bad: '#e0533d', badSoft: '#f0a08f', mid: '#9a9892', goodSoft: '#8fb8ea', good: '#2f7fd6' } as const;
const FIVE_STEPS = [POLARITY.bad, POLARITY.badSoft, POLARITY.mid, POLARITY.goodSoft, POLARITY.good];

const npsColor = (score: number) => (score <= 6 ? POLARITY.bad : score <= 8 ? POLARITY.mid : POLARITY.good);
export function npsVerdict(nps: number | null) {
  if (nps === null) return 'Sin datos';
  if (nps >= 70) return 'Excelente';
  if (nps >= 30) return 'Muy bueno';
  if (nps >= 0) return 'Bueno';
  return 'A mejorar';
}

export default function SurveysPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const tab: TabKey = params.get('tab') === 'encuestas' ? 'encuestas' : 'resultados';
  const surveys = useQuery({ queryKey: ['surveys'], queryFn: () => api.get<SurveyDTO[]>('/surveys') });
  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params);
    if (t === 'resultados') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };
  const empty = surveys.data?.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Star />}
        title="Encuestas de satisfacción"
        description="Cree encuestas, envíelas al terminar la atención (seguimiento, WhatsApp o SMS, QR) y vea el NPS, la satisfacción y los comentarios."
        actions={
          can('admin') && (
            <Button icon={<Plus className="size-4" />} onClick={() => navigate('/app/encuestas/nueva')}>
              Nueva encuesta
            </Button>
          )
        }
      />
      <Tabs<TabKey>
        value={empty ? 'encuestas' : tab}
        onChange={setTab}
        tabs={[
          { value: 'resultados', label: 'Resultados', icon: <BarChart3 className="size-4" /> },
          { value: 'encuestas', label: `Encuestas${surveys.data ? ` (${surveys.data.length})` : ''}`, icon: <ListChecks className="size-4" /> },
        ]}
      />
      {surveys.isLoading ? (
        <Loading />
      ) : surveys.isError ? (
        <p className="text-sm text-red-600">{errorMessage(surveys.error)}</p>
      ) : empty || tab === 'encuestas' ? (
        <SurveysList surveys={surveys.data ?? []} />
      ) : (
        <Results surveys={surveys.data ?? []} />
      )}
    </div>
  );
}

/* ------------------------------ Resultados ----------------------------- */

const PRESETS = [
  { key: '7d', label: '7 días', range: (t: string) => ({ from: shiftDays(t, -6), to: t }) },
  { key: '30d', label: '30 días', range: (t: string) => ({ from: shiftDays(t, -29), to: t }) },
  { key: 'month', label: 'Este mes', range: (t: string) => ({ from: `${t.slice(0, 8)}01`, to: t }) },
  { key: '90d', label: '90 días', range: (t: string) => ({ from: shiftDays(t, -89), to: t }) },
];

function Results({ surveys }: { surveys: SurveyDTO[] }) {
  const { terms } = useAuth();
  const { toast } = useFeedback();
  const today = todayISO();
  const [range, setRange] = useState(PRESETS[1]!.range(today));
  const [surveyId, setSurveyId] = useState(surveys.length === 1 ? surveys[0]!.id : '');
  const [branchId, setBranchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [exporting, setExporting] = useState(false);
  const branches = useBranches();
  const services = useServices();
  const users = useUsers();

  const qs = new URLSearchParams(Object.entries({ ...range, surveyId, branchId, serviceId, agentId }).filter(([, v]) => v) as [string, string][]).toString();
  const results = useQuery({ queryKey: ['survey-results', qs], queryFn: () => api.get<SurveyResultsDTO>(`/surveys/results?${qs}`), enabled: range.from <= range.to });
  const activePreset = PRESETS.find((p) => {
    const r = p.range(today);
    return r.from === range.from && r.to === range.to;
  })?.key;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await download(`/surveys/responses.csv?${qs}`, `encuestas_${range.from}_${range.to}.csv`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  };

  const data = results.data;
  const t = data?.totals;

  return (
    <div className="space-y-6">
      {/* Filtros en una fila sobre los gráficos */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <span className="mb-1.5 block text-sm font-medium">Período</span>
            <div role="group" aria-label="Períodos rápidos" className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={activePreset === p.key}
                  onClick={() => setRange(p.range(today))}
                  className={cx('h-10 rounded-ui border px-3 text-sm font-medium transition', activePreset === p.key ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Desde" className="w-40">
            <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
          </Field>
          <Field label="Hasta" className="w-40">
            <Input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
          </Field>
          <Button variant="secondary" className="ml-auto" icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportCsv()}>
            Exportar CSV
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Encuesta">
            <Select value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
              <option value="">Todas</option>
              {surveys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={terms.branch}>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Todas</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={terms.service}>
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Todos</option>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={terms.agent}>
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Todos</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {results.isLoading || !data || !t ? (
        results.isError ? <p className="text-sm text-red-600">{errorMessage(results.error)}</p> : <Loading />
      ) : t.responses === 0 ? (
        <EmptyState icon={<MessageSquareQuote />} title="Todavía no hay respuestas en este período" description="Cuando los clientes respondan, aquí verá el NPS, la satisfacción, los comentarios y el detalle por servicio y operador." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="NPS (recomendación)"
              value={t.nps === null ? '—' : t.nps > 0 ? `+${t.nps}` : t.nps}
              hint={t.nps === null ? 'Agregue una pregunta de recomendación' : `${npsVerdict(t.nps)} · ${formatNumber(t.npsResponses)} respuestas`}
              icon={<ThumbsUp />}
              tone={t.nps === null ? undefined : t.nps >= 0 ? POLARITY.good : POLARITY.bad}
            />
            <Stat
              label="Satisfacción (CSAT)"
              value={t.csat === null ? '—' : formatPercent(t.csat)}
              hint={t.ratingAvg === null ? 'Agregue una pregunta de estrellas o caritas' : `Promedio ${t.ratingAvg.toFixed(1)} de 5 · 4 o 5 = satisfecho`}
              icon={<Star />}
            />
            <Stat
              label="Respuestas"
              value={formatNumber(t.responses)}
              hint={t.responseRate === null ? `${formatNumber(t.finished)} atendidos` : `${formatPercent(t.responseRate)} de ${formatNumber(t.finished)} atendidos`}
              icon={<Users />}
            />
            <Stat label="Comentarios" value={formatNumber(t.comments)} hint="Los últimos se listan abajo" icon={<MessageSquareQuote />} />
          </div>

          {t.npsResponses > 0 && <NpsBreakdown promoters={t.promoters} passives={t.passives} detractors={t.detractors} />}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card title="Respuestas por día" description="Pase el mouse sobre una barra para ver el NPS y la calificación de ese día.">
              <DailyResponses data={data.byDay} from={data.from} to={data.to} />
            </Card>
            <Card title="Últimos comentarios">
              <Comments comments={data.comments} />
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <GroupTable title={`Por ${terms.service.toLowerCase()}`} rows={data.byService} />
            <GroupTable title={`Por ${terms.agent.toLowerCase()}`} rows={data.byAgent} />
            <GroupTable title={`Por ${terms.branch.toLowerCase()}`} rows={data.byBranch} />
          </div>

          {data.questions.length > 0 ? (
            <div>
              <h2 className="mb-3 text-lg font-semibold">Detalle por pregunta</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {data.questions.map((q) => (
                  <QuestionCard key={q.id} question={q} />
                ))}
              </div>
            </div>
          ) : (
            surveys.length > 1 && <p className="text-sm text-muted">Elija una encuesta arriba para ver el detalle de cada pregunta.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Promotores / pasivos / detractores en una barra con etiquetas (no solo color). */
function NpsBreakdown({ promoters, passives, detractors }: { promoters: number; passives: number; detractors: number }) {
  const total = promoters + passives + detractors;
  const parts = [
    { key: 'd', label: 'Detractores (0-6)', value: detractors, color: POLARITY.bad },
    { key: 'p', label: 'Pasivos (7-8)', value: passives, color: POLARITY.mid },
    { key: 'r', label: 'Promotores (9-10)', value: promoters, color: POLARITY.good },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">¿Nos recomendarían?</h3>
        <p className="text-xs text-muted">NPS = % promotores − % detractores</p>
      </div>
      <div className="mt-3 flex h-4 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label}: ${formatPercent(p.value / total)}`).join(', ')}>
        {parts.map((p) =>
          p.value ? <span key={p.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} /> : null,
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted">{p.label}</span>
            <strong className="tabular-nums">{formatPercent(p.value / total)}</strong>
            <span className="text-xs text-muted tabular-nums">({formatNumber(p.value)})</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const dayShort = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const dayLong = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

function DailyResponses({ data, from, to }: { data: SurveyResultsDTO['byDay']; from: string; to: string }) {
  const rows = useMemo(() => {
    const byDay = new Map(data.map((d) => [d.day, d]));
    const out: SurveyResultsDTO['byDay'] = [];
    for (let d = from; d <= to && out.length < 400; d = shiftDays(d, 1)) out.push(byDay.get(d) ?? { day: d, responses: 0, nps: null, ratingAvg: null });
    return out;
  }, [data, from, to]);
  return (
    <div style={{ height: 240 }} role="img" aria-label="Gráfico de barras: respuestas por día">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--gc-border)" />
          <XAxis dataKey="day" tickFormatter={dayShort} tickLine={false} axisLine={{ stroke: 'var(--gc-border)' }} tick={{ fill: 'var(--gc-muted)', fontSize: 12 }} minTickGap={16} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--gc-muted)', fontSize: 12 }} width={44} />
          <Tooltip
            cursor={{ fill: 'var(--gc-subtle)' }}
            content={(props) => {
              const row = props.payload?.[0]?.payload as SurveyResultsDTO['byDay'][number] | undefined;
              return (
                <div>
                  <ChartTooltip {...props} formatLabel={(l) => (typeof l === 'string' ? dayLong(l) : l)} />
                  {row && row.responses > 0 && (
                    <div className="-mt-1 rounded-b-ui border border-t-0 border-border bg-surface px-3 pb-2 text-xs text-muted">
                      NPS <strong className="text-fg">{row.nps ?? '—'}</strong> · Calificación <strong className="text-fg">{row.ratingAvg?.toFixed(1) ?? '—'}</strong>
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="responses" name="Respuestas" fill="var(--gc-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cx('size-3.5', n <= value ? 'fill-amber-400 text-amber-400' : 'text-fg/20')} />
      ))}
    </span>
  );
}

function Comments({ comments }: { comments: SurveyResultsDTO['comments'] }) {
  if (!comments.length) return <p className="py-6 text-center text-sm text-muted">Sin comentarios en este período.</p>;
  return (
    <ul className="gc-scroll -mr-2 max-h-72 space-y-3 overflow-y-auto pr-2">
      {comments.map((c) => (
        <li key={c.id} className="rounded-ui bg-subtle p-3">
          <p className="text-sm">«{c.comment}»</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {c.rating !== null && <Stars value={c.rating} />}
            {c.nps !== null && (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="size-2 rounded-full" style={{ background: npsColor(c.nps) }} />
                Recomendación {c.nps}
              </span>
            )}
            <span>{formatDateTime(c.createdAt)}</span>
            {c.ticketCode && <span>· {c.ticketCode}</span>}
            {c.service && <span>· {c.service}</span>}
            {c.agent && <span>· {c.agent}</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function GroupTable({ title, rows }: { title: string; rows: SurveyGroupStat[] }) {
  return (
    <div className="gc-card overflow-hidden">
      <h3 className="px-4 pt-4 text-base font-semibold">{title}</h3>
      <Table className="mt-2">
        <thead>
          <tr>
            <th className="w-full">Nombre</th>
            <th className="text-right">Resp.</th>
            <th className="text-right">NPS</th>
            <th className="text-right">CSAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="inline-flex items-center gap-2">
                  {r.color && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />}
                  <span className="truncate">{r.name}</span>
                </span>
              </td>
              <td className="text-right tabular-nums">{formatNumber(r.responses)}</td>
              <td className="text-right font-semibold tabular-nums">{r.nps === null ? '—' : r.nps > 0 ? `+${r.nps}` : r.nps}</td>
              <td className="text-right tabular-nums">{r.csat === null ? '—' : formatPercent(r.csat)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function QuestionCard({ question: q }: { question: SurveyQuestionStat }) {
  const max = Math.max(1, ...q.distribution.map((d) => d.count));
  const total = q.distribution.reduce((a, d) => a + d.count, 0) || 1;
  const polar = q.type === 'nps' || q.type === 'rating' || q.type === 'faces';
  const colorOf = (i: number) => (!polar ? 'var(--gc-primary)' : q.type === 'nps' ? npsColor(i) : FIVE_STEPS[i]!);
  return (
    <div className="gc-card gc-pad">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold leading-snug">{q.title}</p>
        <Badge className="shrink-0">{formatNumber(q.responses)} resp.</Badge>
      </div>
      {q.average !== null && (
        <p className="mt-1 text-sm text-muted">
          Promedio <strong className="text-fg">{q.average.toFixed(1)}</strong> {q.type === 'nps' ? 'de 10' : 'de 5'}
        </p>
      )}
      {q.type === 'text' ? (
        <p className="mt-3 text-sm text-muted">Respuestas abiertas: véalas en «Últimos comentarios» o en el CSV.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {q.distribution.map((d, i) => (
            <li key={d.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm" title={`${d.label}: ${d.count}`}>
              <span className="truncate text-muted">{q.type === 'rating' ? `${d.label} ★` : d.label}</span>
              <span className="h-3 rounded-r-[4px] bg-subtle">
                <span className="block h-full rounded-r-[4px]" style={{ width: `${(d.count / max) * 100}%`, background: colorOf(i) }} />
              </span>
              <span className="text-right text-xs tabular-nums">
                <strong>{formatNumber(d.count)}</strong> <span className="text-muted">{formatPercent(d.count / total)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------ Encuestas ----------------------------- */

function SurveysList({ surveys }: { surveys: SurveyDTO[] }) {
  const { can, terms, hasModule } = useAuth();
  const services = useServices();
  const branches = useBranches();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [qrFor, setQrFor] = useState<SurveyDTO | null>(null);
  const admin = can('admin');

  const toggle = useMutation({
    mutationFn: (s: SurveyDTO) => api.put<SurveyDTO>(`/surveys/${s.id}`, { ...surveyBody(s), active: !s.active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['surveys'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  async function remove(s: SurveyDTO) {
    const ok = await confirm({
      title: `¿Eliminar «${s.name}»?`,
      message: s.responses ? `Se borran también sus ${s.responses} respuestas. No se puede deshacer.` : 'No se puede deshacer.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/surveys/${s.id}`);
      await qc.invalidateQueries({ queryKey: ['surveys'] });
      toast('Encuesta eliminada');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const names = (ids: string[], list: { id: string; name: string }[] | undefined, all: string) =>
    ids.length ? ids.map((id) => list?.find((x) => x.id === id)?.name ?? '…').join(', ') : all;

  return (
    <div className="space-y-6">
      {surveys.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {surveys.map((s) => (
            <div key={s.id} className={cx('gc-card gc-pad flex flex-col gap-3', !s.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold">{s.name}</p>
                  <p className="text-sm text-muted">
                    {s.questions.length} {s.questions.length === 1 ? 'pregunta' : 'preguntas'} · {formatNumber(s.responses)} respuestas
                    {s.lastResponseAt && ` · última ${formatDateTime(s.lastResponseAt)}`}
                  </p>
                </div>
                {admin ? <Toggle checked={s.active} onChange={() => toggle.mutate(s)} ariaLabel={s.active ? 'Desactivar' : 'Activar'} /> : <Badge>{s.active ? 'Activa' : 'Inactiva'}</Badge>}
              </div>
              <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">{terms.services}</dt>
                <dd className="truncate">{names(s.serviceIds, services.data, 'Todos')}</dd>
                <dt className="text-muted">{terms.branches}</dt>
                <dd className="truncate">{names(s.branchIds, branches.data, 'Todas')}</dd>
                <dt className="text-muted">Enlace general</dt>
                <dd>{s.allowAnonymous ? 'Habilitado (QR)' : 'Solo desde el turno'}</dd>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
                {admin && (
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => navigate(`/app/encuestas/${s.id}`)}>
                    Editar
                  </Button>
                )}
                {s.allowAnonymous && (
                  <Button size="sm" variant="secondary" icon={<QrIcon className="size-3.5" />} onClick={() => setQrFor(s)}>
                    Enlace y QR
                  </Button>
                )}
                {admin && (
                  <Button size="sm" variant="ghost" className="ml-auto text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => void remove(s)}>
                    Eliminar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {admin && (
        <div>
          <h2 className="text-lg font-semibold">{surveys.length ? 'Crear otra desde una plantilla' : 'Empiece con una plantilla'}</h2>
          <p className="mb-3 text-sm text-muted">Puede cambiar las preguntas, el texto y dónde se usa antes de guardarla.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SURVEY_TEMPLATES.map((tpl) => (
              <Link key={tpl.key} to={`/app/encuestas/nueva?plantilla=${tpl.key}`} className="gc-card group flex flex-col gap-1 p-4 transition hover:-translate-y-0.5">
                <span className="font-semibold group-hover:text-primary-text">{tpl.name}</span>
                <span className="text-xs text-muted">{tpl.description}</span>
                <span className="mt-2 text-xs font-medium text-fg/70">{tpl.body.questions.length} preguntas</span>
              </Link>
            ))}
            <Link to="/app/encuestas/nueva?plantilla=vacia" className="flex flex-col items-center justify-center gap-1 rounded-ui border border-dashed border-border p-4 text-center text-sm font-medium text-muted transition hover:border-primary hover:text-primary-text">
              <Plus className="size-5" /> En blanco
            </Link>
          </div>
        </div>
      )}

      {hasModule('notifications') && surveys.length > 0 && (
        <p className="text-sm text-muted">
          ¿Quiere enviarla por WhatsApp o SMS al terminar la atención? Active el aviso «Al terminar la atención» en{' '}
          <Link to="/app/configuracion/avisos" className="font-medium text-primary-text underline-offset-2 hover:underline">
            Configuración → Avisos
          </Link>
          .
        </p>
      )}

      <Modal open={Boolean(qrFor)} onClose={() => setQrFor(null)} title={qrFor ? `Enlace general · ${qrFor.name}` : ''} description="Para responder sin turno: imprímalo en la salida, póngalo en la TV (Pantallas → Código QR) o envíelo.">
        {qrFor && <GeneralLink survey={qrFor} />}
      </Modal>
    </div>
  );
}

function GeneralLink({ survey }: { survey: SurveyDTO }) {
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  const url = `${window.location.origin}/encuesta/s/${survey.publicToken}${branchId ? `?sucursal=${branchId}` : ''}`;
  return (
    <div className="space-y-4">
      {(branches.data?.length ?? 0) > 1 && (
        <Field label="Sucursal del QR" hint="Así las respuestas quedan asociadas a esa sucursal.">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Sin sucursal</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex justify-center rounded-ui bg-white p-4">
        <QrCode text={url} size={200} />
      </div>
      <CopyField value={url} open />
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Copy className="size-3.5" /> Para turnos atendidos, el enlace propio de cada turno se envía solo (seguimiento y avisos) y evita respuestas repetidas.
      </p>
    </div>
  );
}

/** Los campos editables de una encuesta (lo que acepta la API). */
export function surveyBody(s: SurveyDTO): SurveyBody {
  return {
    name: s.name,
    title: s.title,
    intro: s.intro,
    thanks: s.thanks,
    active: s.active,
    serviceIds: s.serviceIds,
    branchIds: s.branchIds,
    questions: s.questions,
    expiresDays: s.expiresDays,
    allowAnonymous: s.allowAnonymous,
  };
}
