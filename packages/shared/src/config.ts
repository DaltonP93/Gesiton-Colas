import { z } from 'zod';
import { ALERT_SOUNDS, DISPLAY_LAYOUTS, LOCALES } from './enums';

const color = z.string().regex(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'Color hexadecimal inválido');
const cssText = z.string().max(50_000);

/* ------------------------------------------------------------------ */
/* Configuración de la organización (tenant)                           */
/* ------------------------------------------------------------------ */

export const brandingSchema = z.object({
  appName: z.string().min(1).max(80).default('Gestión de Colas'),
  logoUrl: z.string().max(2048).nullable().default(null),
  faviconUrl: z.string().max(2048).nullable().default(null),
  primaryColor: color.default('#2563eb'),
  accentColor: color.default('#f59e0b'),
  backgroundColor: color.default('#f1f5f9'),
  surfaceColor: color.default('#ffffff'),
  textColor: color.default('#0f172a'),
  fontFamily: z.string().max(120).default('Inter'),
  /** Tipografía de los títulos (vacío = la misma que el texto). */
  headingFontFamily: z.string().max(120).default(''),
  borderRadius: z.number().int().min(0).max(32).default(12),
  colorScheme: z.enum(['light', 'dark', 'auto']).default('light'),
  /** Aspecto de tarjetas y paneles. */
  cardStyle: z.enum(['elevated', 'bordered', 'flat', 'glass']).default('elevated'),
  /** Menú lateral: claro, oscuro o con el color principal. */
  sidebarStyle: z.enum(['light', 'dark', 'brand']).default('light'),
  /** Espaciado general de la interfaz. */
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  /** Fondo del panel. */
  backgroundStyle: z.enum(['solid', 'gradient', 'dots', 'image']).default('gradient'),
  backgroundImageUrl: z.string().max(2048).nullable().default(null),
  customCss: cssText.default(''),
});
export type Branding = z.infer<typeof brandingSchema>;

/** Términos que cada organización puede renombrar (Turno/Ficha/Ticket, Ventanilla/Box/Mesa...). */
export const terminologySchema = z.object({
  ticket: z.string().max(40).default('Turno'),
  tickets: z.string().max(40).default('Turnos'),
  counter: z.string().max(40).default('Ventanilla'),
  counters: z.string().max(40).default('Ventanillas'),
  service: z.string().max(40).default('Servicio'),
  services: z.string().max(40).default('Servicios'),
  branch: z.string().max(40).default('Sucursal'),
  branches: z.string().max(40).default('Sucursales'),
  customer: z.string().max(40).default('Cliente'),
  agent: z.string().max(40).default('Operador'),
});
export type Terminology = z.infer<typeof terminologySchema>;

export const customerFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'Clave inválida (letras, números y _)'),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'number', 'email', 'tel', 'document', 'select', 'date']).default('text'),
  required: z.boolean().default(false),
  options: z.array(z.string().max(80)).max(50).default([]),
  placeholder: z.string().max(120).default(''),
});
export type CustomerField = z.infer<typeof customerFieldSchema>;

export const ticketSettingsSchema = z.object({
  /** Cantidad de dígitos del número (A001 = 3). */
  digits: z.number().int().min(1).max(6).default(3),
  /** Cada cuánto vuelve a empezar la numeración (además del reinicio manual). */
  reset: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'never']).default('daily'),
  /** Número con el que empieza (y al que vuelve al reiniciar). */
  startAt: z.number().int().min(0).max(99_999).default(1),
  /**
   * Qué pasa al llegar al máximo de dígitos (A999 con 3 dígitos):
   * - `wrap`: vuelve al número inicial (A001)
   * - `grow`: sigue con un dígito más (A1000)
   */
  overflow: z.enum(['wrap', 'grow']).default('wrap'),
  /** Numeración independiente por servicio o compartida por sucursal. */
  scope: z.enum(['service', 'branch']).default('service'),
  /** Veces que se puede rellamar antes de marcar "no se presentó" automáticamente (0 = nunca). */
  autoNoShowAfterCalls: z.number().int().min(0).max(20).default(0),
  /**
   * Cada cuántos turnos preferenciales se intercala un turno normal para evitar
   * que la cola normal quede bloqueada (0 = siempre prioriza por peso).
   */
  priorityRatio: z.number().int().min(0).max(20).default(0),
  /** Mostrar/anunciar el nombre del cliente en pantallas (consultorios, farmacias...). */
  announceCustomerName: z.boolean().default(false),
});
export type TicketSettings = z.infer<typeof ticketSettingsSchema>;

/** Estado del asistente de configuración inicial. */
export const onboardingSchema = z.object({
  completed: z.boolean().default(false),
  /** El administrador eligió configurar por su cuenta. */
  dismissed: z.boolean().default(false),
  /** Rubro elegido en el asistente (banco, salud, farmacia...). */
  industry: z.string().max(40).default(''),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

export const tenantSettingsSchema = z.object({
  branding: brandingSchema.prefault({}),
  terminology: terminologySchema.prefault({}),
  tickets: ticketSettingsSchema.prefault({}),
  customerFields: z.array(customerFieldSchema).max(30).default([]),
  locale: z.enum(LOCALES).default('es'),
  timezone: z.string().max(64).default('UTC'),
  onboarding: onboardingSchema.prefault({}),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/* ------------------------------------------------------------------ */
/* Imágenes superpuestas (logos, íconos, sellos) en TV y kiosco          */
/* ------------------------------------------------------------------ */

export const OVERLAY_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const overlaySchema = z.object({
  id: z.string().min(1).max(40),
  /** Imagen subida (/uploads/...) o URL (vacía = todavía sin elegir, no se muestra). */
  url: z.string().max(2048).default(''),
  position: z.enum(OVERLAY_POSITIONS).default('top-right'),
  /** Ancho en % del ancho de la pantalla. */
  size: z.number().min(2).max(80).default(12),
  opacity: z.number().min(0.1).max(1).default(1),
  /** Separación desde el borde en % de la pantalla. */
  margin: z.number().min(0).max(20).default(2),
  /** Mostrar por encima de todo (sí) o detrás de los paneles y botones (no). */
  front: z.boolean().default(true),
});
export type Overlay = z.infer<typeof overlaySchema>;

const overlays = z.array(overlaySchema).max(12).default([]);

/* ------------------------------------------------------------------ */
/* Pantallas (TV / cartelería)                                          */
/* ------------------------------------------------------------------ */

export const displayConfigSchema = z.object({
  layout: z.enum(DISPLAY_LAYOUTS).default('split'),
  title: z.string().max(120).default(''),
  sidebarPosition: z.enum(['left', 'right']).default('right'),
  /** Ancho del panel de turnos en el layout dividido (% de la pantalla). */
  sidebarWidth: z.number().int().min(20).max(60).default(32),
  /** Servicios que muestra la pantalla (vacío = todos los de la sucursal). */
  services: z.array(z.string()).default([]),
  showClock: z.boolean().default(true),
  showDate: z.boolean().default(true),
  showLogo: z.boolean().default(true),
  showHistory: z.boolean().default(true),
  historySize: z.number().int().min(1).max(20).default(5),
  /** Segundos que se destaca un llamado (overlay en layout de pantalla completa). */
  callHighlightSeconds: z.number().int().min(2).max(60).default(10),
  /** Animación con la que aparece cada llamado. */
  callAnimation: z.enum(['pop', 'slide', 'zoom', 'flash', 'none']).default('pop'),
  clockFormat: z.enum(['24h', '12h']).default('24h'),
  showSeconds: z.boolean().default(false),
  /** Código QR en pantalla: fila virtual, encuesta, WhatsApp, menú... */
  qr: z
    .object({
      enabled: z.boolean().default(false),
      url: z.string().max(2048).default(''),
      label: z.string().max(120).default('Saque su turno desde el celular'),
      position: z.enum(['bottom-left', 'bottom-right', 'top-left', 'top-right']).default('bottom-left'),
    })
    .prefault({}),
  /** Logos, íconos o sellos ubicados donde se quiera sobre la pantalla. */
  overlays,
  theme: z
    .object({
      background: color.default('#0f172a'),
      text: color.default('#f8fafc'),
      panelBackground: color.default('#1e293b'),
      accent: color.default('#38bdf8'),
      callBackground: color.default('#2563eb'),
      callText: color.default('#ffffff'),
      priorityColor: color.default('#f59e0b'),
      fontFamily: z.string().max(120).default('Inter'),
      /** Tipografía de los números de turno (vacío = la misma). */
      numberFontFamily: z.string().max(120).default(''),
      /** Escala tipográfica (1 = normal). */
      fontScale: z.number().min(0.5).max(3).default(1),
      /** Escala del llamado actual y del historial. */
      callScale: z.number().min(0.5).max(2).default(1),
      historyScale: z.number().min(0.5).max(2).default(1),
      /** Imagen de fondo de la pantalla (se ve detrás de los paneles). */
      backgroundImageUrl: z.string().max(2048).nullable().default(null),
      /** Oscurecimiento sobre la imagen de fondo (0 a 0,9). */
      backgroundOverlay: z.number().min(0).max(0.9).default(0.45),
      /** Paneles sólidos, translúcidos (vidrio) o solo con borde. */
      panelStyle: z.enum(['solid', 'glass', 'outline']).default('solid'),
      /** Redondeo de los paneles (en % de la altura de la pantalla). */
      radius: z.number().min(0).max(6).default(2),
    })
    .prefault({}),
  voice: z
    .object({
      enabled: z.boolean().default(true),
      lang: z.string().max(20).default('es-ES'),
      voiceName: z.string().max(200).default(''),
      rate: z.number().min(0.5).max(2).default(0.95),
      pitch: z.number().min(0).max(2).default(1),
      volume: z.number().min(0).max(1).default(1),
      /** Variables: {{code}} {{service}} {{counter}} {{priority}} {{customer}} {{branch}} */
      template: z.string().max(300).default('Turno {{code}}, por favor diríjase a {{counter}}'),
      codeMode: z.enum(['number', 'spell']).default('spell'),
      repeat: z.number().int().min(1).max(3).default(1),
      /** Pausa entre repeticiones (segundos). */
      repeatDelay: z.number().min(0).max(10).default(0.6),
      /** Frase propia por servicio (id del servicio → frase). Sin frase se usa la general. */
      serviceTemplates: z.record(z.string(), z.string().max(300)).default({}),
      /** Repite el anuncio en un segundo idioma (zonas turísticas, fronteras...). */
      secondary: z
        .object({
          enabled: z.boolean().default(false),
          lang: z.string().max(20).default('en-US'),
          voiceName: z.string().max(200).default(''),
          template: z.string().max(300).default('Ticket {{code}}, please go to {{counter}}'),
        })
        .prefault({}),
    })
    .prefault({}),
  sound: z
    .object({
      enabled: z.boolean().default(true),
      /** Uno de los sonidos incluidos, un audio subido (/uploads/...) o una URL propia. */
      file: z
        .string()
        .max(2048)
        .refine((v) => (ALERT_SOUNDS as readonly string[]).includes(v) || /^https?:\/\//i.test(v) || v.startsWith('/uploads/'), 'Sonido inválido')
        .default('airport-bingbong'),
      volume: z.number().min(0).max(1).default(0.9),
    })
    .prefault({}),
  ticker: z
    .object({
      enabled: z.boolean().default(false),
      messages: z.array(z.string().max(300)).max(50).default([]),
      /** Velocidad en píxeles por segundo. */
      speed: z.number().int().min(10).max(400).default(80),
      background: color.default('#f59e0b'),
      color: color.default('#0f172a'),
    })
    .prefault({}),
  /** Música ambiental: audios de la biblioteca que suenan de fondo (se atenúan en cada llamado). */
  music: z
    .object({
      enabled: z.boolean().default(false),
      mediaIds: z.array(z.string()).max(200).default([]),
      volume: z.number().min(0).max(1).default(0.35),
      shuffle: z.boolean().default(true),
    })
    .prefault({}),
  media: z
    .object({
      /** Silenciar todo el contenido publicitario. */
      muted: z.boolean().default(false),
      /** Volumen general del contenido (0-1). */
      volume: z.number().min(0).max(1).default(0.6),
      /** Volumen al que baja el contenido mientras se anuncia un turno. */
      duckVolume: z.number().min(0).max(1).default(0.1),
      /** Duración por defecto de imágenes y páginas web (segundos). */
      defaultDuration: z.number().int().min(3).max(3600).default(15),
      /** Transición entre elementos. */
      transition: z.enum(['none', 'fade', 'slide']).default('fade'),
      shuffle: z.boolean().default(false),
      /** Ajuste de imágenes y videos: completo sin recortar (con fondo difuminado) o llenando el área. */
      fitMode: z.enum(['contain', 'cover']).default('contain'),
    })
    .prefault({}),
  customCss: cssText.default(''),
});
export type DisplayConfig = z.infer<typeof displayConfigSchema>;

/* ------------------------------------------------------------------ */
/* Kioscos (dispensadores de turnos)                                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_TICKET_TEMPLATE = `<div class="t">
  {{logo}}
  <div class="head">{{header}}</div>
  <div class="org">{{organization}}</div>
  <div class="branch">{{branch}}</div>
  <div class="label">Su turno</div>
  <div class="code">{{code}}</div>
  <div class="service">{{service}}</div>
  <div class="priority">{{priority}}</div>
  <div class="meta">{{date}} · {{time}}</div>
  <div class="meta">Personas antes que usted: {{waiting}}</div>
  {{qr}}
  <div class="foot">Escanee el código para seguir su turno desde el celular</div>
  <div class="note">{{footer}}</div>
</div>`;

export const DEFAULT_TICKET_CSS = `.t{font-family:system-ui,sans-serif;text-align:center;color:#000;padding:4mm 2mm}
.t img.logo{max-width:40mm;max-height:18mm;margin:0 auto 2mm;display:block}
.t .org{font-weight:700;font-size:14pt}
.t .branch{font-size:10pt;margin-bottom:3mm}
.t .label{font-size:10pt;text-transform:uppercase;letter-spacing:1px}
.t .code{font-size:40pt;font-weight:800;line-height:1.1}
.t .service{font-size:13pt;font-weight:600}
.t .priority{font-size:10pt;margin-bottom:2mm}
.t .meta{font-size:9pt}
.t img.qr{width:28mm;height:28mm;margin:3mm auto 1mm;display:block}
.t .foot{font-size:8pt}
.t .head,.t .note{font-size:9pt;margin:1mm 0}
.t .head:empty,.t .note:empty,.t .priority:empty{display:none}`;

export const kioskConfigSchema = z.object({
  title: z.string().max(120).default('¡Bienvenido!'),
  subtitle: z.string().max(200).default('Toque el servicio que necesita'),
  /** Agrupar servicios por departamento. */
  groupByDepartment: z.boolean().default(false),
  /** Servicios disponibles (vacío = todos los habilitados en la sucursal). */
  services: z.array(z.string()).default([]),
  /**
   * - `buttons`: pregunta Normal / Preferencial
   * - `list`: muestra todas las prioridades
   * - `none`: siempre emite turnos normales
   */
  priorityMode: z.enum(['buttons', 'list', 'none']).default('buttons'),
  /** Campos del cliente que se piden antes de emitir el turno (claves de customerFields o name/document/phone/email). */
  askFields: z.array(z.string()).default([]),
  showQr: z.boolean().default(true),
  showWaitingCount: z.boolean().default(true),
  showBranch: z.boolean().default(true),
  /** Texto al pie de la pantalla (horarios, avisos...). */
  footerText: z.string().max(300).default(''),
  /** Segundos antes de volver a la pantalla inicial. */
  returnSeconds: z.number().int().min(3).max(120).default(8),
  /** Pantalla de espera después de un tiempo sin uso. */
  idle: z
    .object({
      enabled: z.boolean().default(false),
      seconds: z.number().int().min(10).max(3600).default(60),
      title: z.string().max(120).default('Toque la pantalla para sacar su turno'),
      showClock: z.boolean().default(true),
      /**
       * Qué se ve mientras nadie usa el kiosco:
       * - `message`: el logo, la hora y el mensaje
       * - `playlist`: imágenes y videos de una lista de Publicidad (galería o video promocional)
       */
      mode: z.enum(['message', 'playlist']).default('message'),
      playlistId: z.string().nullable().default(null),
      /** Muestra el mensaje «Toque la pantalla» sobre las imágenes y videos. */
      showMessage: z.boolean().default(true),
      /** Los videos de la pantalla de espera suenan (si no, se reproducen en silencio). */
      sound: z.boolean().default(false),
    })
    .prefault({}),
  overlays,
  print: z
    .object({
      enabled: z.boolean().default(true),
      paperWidthMm: z.number().int().min(40).max(210).default(80),
      template: z.string().max(20_000).default(DEFAULT_TICKET_TEMPLATE),
      css: cssText.default(DEFAULT_TICKET_CSS),
      /** Textos libres que las plantillas muestran con {{header}} y {{footer}}. */
      headerText: z.string().max(200).default(''),
      footerText: z.string().max(300).default(''),
    })
    .prefault({}),
  theme: z
    .object({
      background: color.default('#f1f5f9'),
      text: color.default('#0f172a'),
      buttonBackground: color.default('#2563eb'),
      buttonText: color.default('#ffffff'),
      priorityButtonBackground: color.default('#f59e0b'),
      fontFamily: z.string().max(120).default('Inter'),
      fontScale: z.number().min(0.5).max(3).default(1),
      columns: z.number().int().min(1).max(6).default(2),
      /** Fondo liso, degradado o con imagen. */
      backgroundStyle: z.enum(['solid', 'gradient', 'image']).default('solid'),
      /** Segundo color del degradado. */
      backgroundTo: color.default('#dbeafe'),
      backgroundImageUrl: z.string().max(2048).nullable().default(null),
      backgroundOverlay: z.number().min(0).max(0.9).default(0.35),
      /** Forma de los botones de servicio. */
      buttonStyle: z.enum(['rounded', 'pill', 'square', 'outline', 'tile']).default('rounded'),
      buttonSize: z.enum(['md', 'lg', 'xl']).default('lg'),
      /** Cada botón usa el color de su servicio. */
      serviceColors: z.boolean().default(false),
      showIcons: z.boolean().default(true),
      /** Ubicación del ícono dentro del botón. */
      iconPosition: z.enum(['left', 'top', 'right']).default('left'),
      iconSize: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
      logoSize: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
      /** Logo a la izquierda y sucursal a la derecha, o todo centrado. */
      headerAlign: z.enum(['split', 'center']).default('split'),
    })
    .prefault({}),
  customCss: cssText.default(''),
});
export type KioskConfig = z.infer<typeof kioskConfigSchema>;

/* ------------------------------------------------------------------ */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mezcla profunda: los arrays y valores primitivos de `patch` reemplazan a los de `base`. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** Normaliza una configuración guardada completando valores por defecto y descartando valores inválidos. */
export function normalizeConfig<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  let candidate: unknown = isPlainObject(value) ? structuredClone(value) : {};
  for (let attempt = 0; attempt < 20; attempt++) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) removePath(candidate, issue.path);
  }
  return schema.parse({});
}

function removePath(target: unknown, path: PropertyKey[]) {
  if (path.length === 0) return;
  let node: unknown = target;
  for (const key of path.slice(0, -1)) {
    if (!node || typeof node !== 'object') return;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  if (!node || typeof node !== 'object') return;
  const last = path[path.length - 1]!;
  if (Array.isArray(node) && typeof last === 'number') node.splice(last, 1);
  else delete (node as Record<PropertyKey, unknown>)[last];
}

export const defaultTenantSettings = (): TenantSettings => tenantSettingsSchema.parse({});
export const defaultDisplayConfig = (): DisplayConfig => displayConfigSchema.parse({});
export const defaultKioskConfig = (): KioskConfig => kioskConfigSchema.parse({});

/** Campos estándar del cliente siempre disponibles. */
export const BUILTIN_CUSTOMER_FIELDS: CustomerField[] = [
  { key: 'name', label: 'Nombre', type: 'text', required: false, options: [], placeholder: '' },
  { key: 'document', label: 'Documento', type: 'document', required: false, options: [], placeholder: '' },
  { key: 'phone', label: 'Teléfono', type: 'tel', required: false, options: [], placeholder: '' },
  { key: 'email', label: 'Email', type: 'email', required: false, options: [], placeholder: '' },
];
