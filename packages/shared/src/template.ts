export type TemplateVars = Record<string, string | number | null | undefined>;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Compatibilidad con las etiquetas del sistema anterior: [ticket], [priority], [local], [service]. */
const LEGACY_TAGS: Record<string, string> = {
  ticket: 'code',
  priority: 'priority',
  local: 'counter',
  service: 'service',
};

/**
 * Reemplaza `{{variable}}` (y las etiquetas antiguas `[ticket]`, `[local]`...) por sus valores.
 * Las variables desconocidas se reemplazan por una cadena vacía.
 * Con `html: true` los valores se escapan, salvo los indicados en `raw` (p. ej. `qr`, `logo`).
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
  options: { html?: boolean; raw?: string[] } = {},
): string {
  const value = (key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return '';
    const s = String(v);
    return options.html && !options.raw?.includes(key) ? escapeHtml(s) : s;
  };
  return template
    .replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => value(key))
    .replace(/\[(ticket|priority|local|service)\]/g, (_, tag: string) => value(LEGACY_TAGS[tag]!));
}

/**
 * Prepara el código de un turno para la síntesis de voz.
 * - `spell`: "A 0 1 5" (dígito por dígito)
 * - `number`: "A 15" (número completo)
 */
export function codeForSpeech(code: string, mode: 'spell' | 'number' = 'number'): string {
  const match = /^([^\d]*)(\d+)$/.exec(code.trim());
  if (!match) return code.split('').join(' ');
  const [, prefix = '', digits = ''] = match;
  const letters = prefix.replace(/[-_\s]/g, '').split('').join(' ');
  const number = mode === 'spell' ? digits.split('').join(' ') : String(parseInt(digits, 10));
  return `${letters} ${number}`.trim();
}

export function formatTicketCode(prefix: string, number: number, digits: number): string {
  return `${prefix}${String(number).padStart(Math.max(1, digits), '0')}`;
}

/**
 * Número a mostrar a partir del contador (que siempre crece): respeta el número inicial y,
 * con `wrap`, vuelve a empezar al superar el máximo de dígitos (A999 → A001).
 */
export function ticketNumberFor(counter: number, options: { digits: number; startAt: number; overflow: 'wrap' | 'grow' }): number {
  const start = Math.max(0, options.startAt);
  const value = start + Math.max(0, counter - 1);
  const max = 10 ** Math.max(1, options.digits) - 1;
  if (options.overflow === 'grow' || value <= max || start > max) return value;
  const span = max - start + 1;
  return start + ((value - start) % span);
}

/** Clave del período de numeración de un día (YYYY-MM-DD) según el reinicio elegido. */
export function numberingPeriod(day: string, reset: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'): string {
  if (reset === 'daily') return day;
  if (reset === 'monthly') return day.slice(0, 7);
  if (reset === 'yearly') return day.slice(0, 4);
  if (reset === 'weekly') {
    // Semana ISO (lunes a domingo): el jueves de la semana define el año.
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return 'all';
}

export const TEMPLATE_VARIABLES = {
  voice: ['code', 'service', 'counter', 'priority', 'customer', 'branch'],
  ticket: [
    'code',
    'service',
    'priority',
    'branch',
    'organization',
    'date',
    'time',
    'waiting',
    'customer',
    'trackingUrl',
    'header',
    'footer',
    'qr',
    'logo',
  ],
} as const;
