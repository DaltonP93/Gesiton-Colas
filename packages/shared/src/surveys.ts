import { z } from 'zod';
import type { PublicTenantDTO } from './types';

/* ------------------------------------------------------------------ */
/* Encuestas de satisfacción                                           */
/* ------------------------------------------------------------------ */

/**
 * - `nps`: 0 a 10 («¿nos recomendaría?») → Net Promoter Score
 * - `rating`: 1 a 5 estrellas → CSAT
 * - `faces`: 1 a 5 caritas → CSAT
 * - `choice` / `multi`: una o varias opciones
 * - `yesno`: sí / no
 * - `text`: comentario libre
 */
export const SURVEY_QUESTION_TYPES = ['rating', 'faces', 'nps', 'choice', 'multi', 'yesno', 'text'] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const SURVEY_QUESTION_LABELS: Record<SurveyQuestionType, { name: string; description: string }> = {
  rating: { name: 'Estrellas (1 a 5)', description: 'Calificación general; cuenta para la satisfacción (CSAT).' },
  faces: { name: 'Caritas (1 a 5)', description: 'Más simple para todo público; cuenta para la satisfacción (CSAT).' },
  nps: { name: 'Recomendación (0 a 10)', description: '«¿Nos recomendaría?»: calcula el NPS.' },
  choice: { name: 'Una opción', description: 'Elegir una respuesta de una lista.' },
  multi: { name: 'Varias opciones', description: 'Marcar todas las que correspondan.' },
  yesno: { name: 'Sí / No', description: 'Pregunta cerrada.' },
  text: { name: 'Comentario', description: 'Texto libre (sugerencias, reclamos, felicitaciones).' },
};

export const FACE_LABELS = ['Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'] as const;

export const surveyQuestionSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    type: z.enum(SURVEY_QUESTION_TYPES),
    title: z.string().trim().min(1, 'Escriba la pregunta').max(300),
    help: z.string().trim().max(300).default(''),
    required: z.boolean().default(true),
    options: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    /** Textos de los extremos (NPS y estrellas). */
    lowLabel: z.string().trim().max(60).default(''),
    highLabel: z.string().trim().max(60).default(''),
  })
  .superRefine((q, ctx) => {
    if ((q.type === 'choice' || q.type === 'multi') && q.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Agregue al menos dos opciones' });
    }
  });
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

export const surveyBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Póngale un nombre').max(120),
    /** Título que ve el cliente. */
    title: z.string().trim().max(200).default('¿Cómo fue su atención?'),
    intro: z.string().trim().max(500).default(''),
    thanks: z.string().trim().max(500).default('¡Gracias por su opinión! Nos ayuda a mejorar.'),
    active: z.boolean().default(true),
    /** Servicios y sucursales donde se usa (vacío = todos). */
    serviceIds: z.array(z.uuid()).max(300).default([]),
    branchIds: z.array(z.uuid()).max(300).default([]),
    questions: z.array(surveyQuestionSchema).min(1, 'Agregue al menos una pregunta').max(20),
    /** Días que el enlace de un turno queda abierto después de la atención. */
    expiresDays: z.number().int().min(1).max(60).default(7),
    /** Enlace general (QR en la salida o en la TV) para responder sin turno. */
    allowAnonymous: z.boolean().default(true),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    s.questions.forEach((q, i) => {
      if (ids.has(q.id)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'id'], message: 'Pregunta repetida' });
      ids.add(q.id);
    });
  });
export type SurveyBody = z.infer<typeof surveyBodySchema>;

export interface SurveyDTO extends SurveyBody {
  id: string;
  /** Token del enlace general (/encuesta/s/:token). */
  publicToken: string;
  responses: number;
  lastResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SurveyAnswer = number | string | string[] | boolean | null;
export type SurveyAnswers = Record<string, SurveyAnswer>;

export const surveyAnswersSchema = z.record(
  z.string().max(40),
  z.union([z.number(), z.string().max(2000), z.array(z.string().max(120)).max(12), z.boolean(), z.null()]),
);

export interface SurveyScores {
  nps: number | null;
  rating: number | null;
  comment: string | null;
}

/** Valida las respuestas contra las preguntas; devuelve las respuestas limpias o el primer error. */
export function validateAnswers(questions: SurveyQuestion[], answers: SurveyAnswers): { ok: true; answers: SurveyAnswers } | { ok: false; error: string } {
  const clean: SurveyAnswers = {};
  for (const q of questions) {
    const raw = answers[q.id];
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (q.required) return { ok: false, error: `Responda: «${q.title}»` };
      continue;
    }
    const invalid = { ok: false as const, error: `Respuesta inválida en «${q.title}»` };
    switch (q.type) {
      case 'nps':
      case 'rating':
      case 'faces': {
        const n = Number(raw);
        const [min, max] = q.type === 'nps' ? [0, 10] : [1, 5];
        if (!Number.isInteger(n) || n < min || n > max) return invalid;
        clean[q.id] = n;
        break;
      }
      case 'choice':
        if (typeof raw !== 'string' || !q.options.includes(raw)) return invalid;
        clean[q.id] = raw;
        break;
      case 'multi':
        if (!Array.isArray(raw) || raw.some((v) => !q.options.includes(v))) return invalid;
        clean[q.id] = [...new Set(raw)];
        break;
      case 'yesno':
        if (typeof raw !== 'boolean') return invalid;
        clean[q.id] = raw;
        break;
      case 'text':
        if (typeof raw !== 'string') return invalid;
        clean[q.id] = raw.trim().slice(0, 2000);
        break;
    }
  }
  return { ok: true, answers: clean };
}

/** Indicadores de una respuesta: la primera pregunta de recomendación, de estrellas/caritas y de comentario. */
export function scoreAnswers(questions: SurveyQuestion[], answers: SurveyAnswers): SurveyScores {
  const first = (types: SurveyQuestionType[]) => {
    const q = questions.find((x) => types.includes(x.type) && answers[x.id] !== undefined && answers[x.id] !== null && answers[x.id] !== '');
    return q ? answers[q.id] : null;
  };
  const nps = first(['nps']);
  const rating = first(['rating', 'faces']);
  const comment = first(['text']);
  return {
    nps: typeof nps === 'number' ? nps : null,
    rating: typeof rating === 'number' ? rating : null,
    comment: typeof comment === 'string' && comment ? comment : null,
  };
}

/** NPS = % promotores (9-10) − % detractores (0-6), de −100 a 100. */
export function npsOf(promoters: number, detractors: number, total: number): number | null {
  return total ? Math.round(((promoters - detractors) / total) * 100) : null;
}

/* ------------------------------ Plantillas ----------------------------- */

const q = (id: string, type: SurveyQuestionType, title: string, extra: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id,
  type,
  title,
  help: '',
  required: type !== 'text',
  options: [],
  lowLabel: type === 'nps' ? 'Nada probable' : '',
  highLabel: type === 'nps' ? 'Muy probable' : '',
  ...extra,
});

export const SURVEY_TEMPLATES: { key: string; name: string; description: string; body: Pick<SurveyBody, 'name' | 'title' | 'intro' | 'questions'> }[] = [
  {
    key: 'general',
    name: 'Satisfacción general',
    description: 'Estrellas, recomendación (NPS) y un comentario. La más usada.',
    body: {
      name: 'Satisfacción general',
      title: '¿Cómo fue su atención?',
      intro: 'Son 3 preguntas y le lleva menos de un minuto.',
      questions: [
        q('atencion', 'rating', '¿Cómo calificaría la atención recibida?'),
        q('recomienda', 'nps', '¿Qué tan probable es que nos recomiende a un familiar o amigo?'),
        q('mejorar', 'text', '¿Qué podemos mejorar?'),
      ],
    },
  },
  {
    key: 'rapida',
    name: 'Rápida con caritas',
    description: 'Una sola pregunta con caritas y un comentario opcional. Ideal para el QR de la salida.',
    body: {
      name: 'Encuesta rápida',
      title: '¿Cómo fue su experiencia hoy?',
      intro: '',
      questions: [q('experiencia', 'faces', '¿Cómo fue su experiencia hoy?'), q('comentario', 'text', '¿Quiere contarnos algo más?')],
    },
  },
  {
    key: 'salud',
    name: 'Pacientes (salud)',
    description: 'Trato del personal, tiempo de espera, claridad de la información y recomendación.',
    body: {
      name: 'Experiencia del paciente',
      title: '¿Cómo fue su atención?',
      intro: 'Su opinión nos ayuda a cuidar mejor de usted y de su familia.',
      questions: [
        q('trato', 'faces', '¿Cómo fue el trato del personal?'),
        q('espera', 'rating', '¿Cómo calificaría el tiempo de espera?', { lowLabel: 'Muy largo', highLabel: 'Muy corto' }),
        q('claridad', 'yesno', '¿Le explicaron con claridad los pasos a seguir?'),
        q('aspecto', 'choice', '¿Qué fue lo mejor de su visita?', { options: ['La atención del personal', 'La rapidez', 'La limpieza', 'La información recibida', 'Otro'], required: false }),
        q('recomienda', 'nps', '¿Qué tan probable es que nos recomiende?'),
        q('comentario', 'text', 'Comentarios o sugerencias'),
      ],
    },
  },
  {
    key: 'nps',
    name: 'Solo NPS',
    description: 'La pregunta de recomendación y el porqué, para medir la lealtad.',
    body: {
      name: 'Recomendación (NPS)',
      title: 'Una pregunta rápida',
      intro: '',
      questions: [q('recomienda', 'nps', '¿Qué tan probable es que nos recomiende a un familiar o amigo?'), q('porque', 'text', '¿Por qué eligió esa nota?')],
    },
  },
];

/* ------------------------------ Público ------------------------------- */

export type PublicSurveyStatus = 'open' | 'answered' | 'expired' | 'not_ready';

export interface PublicSurveyDTO {
  status: PublicSurveyStatus;
  survey: Pick<SurveyBody, 'title' | 'intro' | 'thanks' | 'questions'>;
  tenant: PublicTenantDTO;
  /** Turno al que corresponde (enlace del turno). */
  ticket: { code: string; service: string; branch: string; counter: string | null } | null;
}

/* ------------------------------ Métricas ------------------------------ */

export interface SurveyGroupStat {
  id: string;
  name: string;
  color?: string | null;
  responses: number;
  nps: number | null;
  /** Fracción de calificaciones 4-5 sobre 5. */
  csat: number | null;
  ratingAvg: number | null;
}

export interface SurveyQuestionStat {
  id: string;
  title: string;
  type: SurveyQuestionType;
  responses: number;
  /** Promedio (estrellas, caritas, NPS). */
  average: number | null;
  distribution: { label: string; count: number }[];
}

export interface SurveyCommentDTO {
  id: string;
  createdAt: string;
  comment: string;
  rating: number | null;
  nps: number | null;
  ticketCode: string | null;
  service: string | null;
  agent: string | null;
  branch: string | null;
}

export interface SurveyResultsDTO {
  from: string;
  to: string;
  totals: {
    responses: number;
    /** Turnos atendidos en el período (para la tasa de respuesta). */
    finished: number;
    /** Respuestas vinculadas a un turno / atendidos. */
    responseRate: number | null;
    nps: number | null;
    promoters: number;
    passives: number;
    detractors: number;
    npsResponses: number;
    csat: number | null;
    ratingAvg: number | null;
    ratingResponses: number;
    comments: number;
  };
  byDay: { day: string; responses: number; nps: number | null; ratingAvg: number | null }[];
  byService: SurveyGroupStat[];
  byAgent: SurveyGroupStat[];
  byBranch: SurveyGroupStat[];
  /** Detalle por pregunta (cuando se elige una encuesta). */
  questions: SurveyQuestionStat[];
  comments: SurveyCommentDTO[];
}
