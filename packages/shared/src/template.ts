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
