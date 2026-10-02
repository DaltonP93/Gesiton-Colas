import { z } from 'zod';
import { MODULES, type ModuleId } from './modules';
import { PLAN_IDS, PLANS, type PlanId } from './plans';
import type { Currency } from './currency';

/* ------------------------------------------------------------------ */
/* Página de presentación del producto (la arma el superadministrador)  */
/* ------------------------------------------------------------------ */

/** Plantillas visuales. El contenido es el mismo: cambiar de plantilla no borra los textos. */
export const LANDING_TEMPLATES = ['moderna', 'clasica', 'minimalista', 'oscura', 'corporativa', 'vibrante'] as const;
export type LandingTemplate = (typeof LANDING_TEMPLATES)[number];

export interface LandingTemplateInfo {
  name: string;
  description: string;
  /** Fondo oscuro. */
  dark: boolean;
  /** Portada con el texto a la izquierda y la imagen a la derecha, o todo centrado. */
  heroLayout: 'split' | 'centered';
  font: string;
  headingFont: string;
  accent: string;
}

export const LANDING_TEMPLATE_INFO: Record<LandingTemplate, LandingTemplateInfo> = {
  moderna: {
    name: 'Moderna',
    description: 'Fondo con degradés suaves, tarjetas translúcidas y bordes redondeados.',
    dark: false,
    heroLayout: 'split',
    font: 'Manrope',
    headingFont: 'Manrope',
    accent: '#8b5cf6',
  },
  clasica: {
    name: 'Clásica',
    description: 'Limpia y directa: blanco, tarjetas con borde y la pantalla de ejemplo al costado.',
    dark: false,
    heroLayout: 'split',
    font: 'Inter',
    headingFont: 'Inter',
    accent: '#f59e0b',
  },
  minimalista: {
    name: 'Minimalista',
    description: 'Mucho aire, tipografía grande y casi sin color. Ideal para una marca sobria.',
    dark: false,
    heroLayout: 'centered',
    font: 'DM Sans',
    headingFont: 'DM Sans',
    accent: '#0f172a',
  },
  oscura: {
    name: 'Oscura',
    description: 'Fondo oscuro con brillo de color y cuadrícula, estilo tecnológico.',
    dark: true,
    heroLayout: 'centered',
    font: 'Outfit',
    headingFont: 'Outfit',
    accent: '#22d3ee',
  },
  corporativa: {
    name: 'Corporativa',
    description: 'Portada con el color de su marca, secciones alternadas y tarjetas con sombra.',
    dark: false,
    heroLayout: 'split',
    font: 'Source Sans 3',
    headingFont: 'Montserrat',
    accent: '#f59e0b',
  },
  vibrante: {
    name: 'Vibrante',
    description: 'Degradé intenso del color principal al de acento, botones grandes y mucho color.',
    dark: false,
    heroLayout: 'centered',
    font: 'Poppins',
    headingFont: 'Poppins',
    accent: '#ec4899',
  },
};

/** Íconos disponibles para las funciones (nombres de lucide). */
export const LANDING_ICONS = [
  'monitor-play',
  'video',
  'tablet',
  'smartphone',
  'headset',
  'bar-chart',
  'palette',
  'webhook',
  'building',
  'calendar',
  'message',
  'bell',
  'shield',
  'zap',
  'clock',
  'users',
  'credit-card',
  'receipt',
  'globe',
  'sparkles',
  'star',
  'heart',
  'ticket',
  'qr-code',
  'printer',
  'volume',
  'cloud',
  'lock',
  'rocket',
  'target',
  'thumbs-up',
  'layers',
  'settings',
  'mail',
  'phone',
  'map-pin',
  'award',
  'trending-up',
  'gauge',
  'smile',
] as const;
export type LandingIcon = (typeof LANDING_ICONS)[number];

/** Adónde lleva un botón. */
export const LANDING_ACTIONS = ['signup', 'demo', 'login', 'url'] as const;
export type LandingAction = (typeof LANDING_ACTIONS)[number];

export const LANDING_ACTION_LABELS: Record<LandingAction, string> = {
  signup: 'Crear cuenta (registro)',
  demo: 'Pedir una demo',
  login: 'Ingresar',
  url: 'Otra dirección',
};

/** Tipos de sección. */
export const LANDING_SECTION_TYPES = ['features', 'steps', 'showcase', 'stats', 'pricing', 'testimonials', 'logos', 'faq', 'cta', 'contact'] as const;
export type LandingSectionType = (typeof LANDING_SECTION_TYPES)[number];

export const LANDING_SECTION_INFO: Record<LandingSectionType, { name: string; description: string }> = {
  features: { name: 'Funciones', description: 'Tarjetas con ícono, título y texto.' },
  steps: { name: 'Cómo funciona', description: 'Pasos numerados para empezar.' },
  showcase: { name: 'Texto con imagen', description: 'Un bloque con imagen al costado y una lista de puntos.' },
  stats: { name: 'Números', description: 'Cifras destacadas (clientes, sucursales, turnos…).' },
  pricing: { name: 'Planes y precios', description: 'Los planes de la plataforma con su precio mensual.' },
  testimonials: { name: 'Testimonios', description: 'Lo que dicen sus clientes, con nombre y cargo.' },
  logos: { name: 'Clientes', description: 'Logos de las empresas que lo usan.' },
  faq: { name: 'Preguntas frecuentes', description: 'Preguntas y respuestas desplegables.' },
  cta: { name: 'Llamado a la acción', description: 'Una franja final con un botón destacado.' },
  contact: { name: 'Contacto', description: 'Correo, teléfono, WhatsApp, dirección y horario.' },
};

const color = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Color hexadecimal inválido');

/** Direcciones seguras para enlaces: web, correo, teléfono, rutas propias y anclas (nada de `javascript:`). */
export function isSafeLink(value: string): boolean {
  return value === '' || /^(https?:\/\/|mailto:|tel:|\/(?![/\\])|#)/i.test(value.trim());
}
/** Imágenes: subidas a la plataforma o en internet. */
export function isSafeImage(value: string): boolean {
  return /^(https?:\/\/|\/uploads\/)/i.test(value.trim());
}

const text = (max: number, value = '') => z.string().max(max).default(value);
const link = z.string().trim().max(2048).refine(isSafeLink, 'Use una dirección http(s)://, mailto:, tel:, /ruta o #sección').default('');
const image = z.string().trim().max(2048).refine(isSafeImage, 'Imagen inválida').nullable().default(null);

export const landingButtonSchema = z.object({
  label: text(60),
  action: z.enum(LANDING_ACTIONS).default('signup'),
  /** Solo con `action: 'url'`. */
  url: link,
});
export type LandingButton = z.infer<typeof landingButtonSchema>;

const button = (label: string, action: LandingAction) => landingButtonSchema.prefault({ label, action });

const base = <T extends LandingSectionType>(type: T) => ({
  id: z.string().min(1).max(40),
  type: z.literal(type),
  enabled: z.boolean().default(true),
  /** Si tiene texto, la sección aparece en el menú de arriba. */
  navLabel: text(30),
  title: text(140),
  subtitle: text(400),
});

const featureItem = z.object({ icon: z.enum(LANDING_ICONS).default('sparkles'), title: text(80), text: text(300) });
const stepItem = z.object({ title: text(80), text: text(300) });
const statItem = z.object({ value: text(20), label: text(80) });
const testimonialItem = z.object({ quote: text(500), name: text(80), role: text(100), photoUrl: image });
const logoItem = z.object({ name: text(80), imageUrl: image });
const faqItem = z.object({ question: text(200), answer: text(1000) });

export const landingSectionSchema = z.discriminatedUnion('type', [
  z.object({ ...base('features'), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3), items: z.array(featureItem).max(12).default([]) }),
  z.object({ ...base('steps'), items: z.array(stepItem).max(6).default([]) }),
  z.object({
    ...base('showcase'),
    imageUrl: image,
    imageSide: z.enum(['left', 'right']).default('right'),
    bullets: z.array(z.string().max(160)).max(8).default([]),
    button: landingButtonSchema.nullable().default(null),
  }),
  z.object({ ...base('stats'), items: z.array(statItem).max(6).default([]) }),
  z.object({
    ...base('pricing'),
    plans: z.array(z.enum(PLAN_IDS)).max(PLAN_IDS.length).default(() => [...PLAN_IDS]),
    highlight: z.enum(PLAN_IDS).nullable().default('pro'),
    showModules: z.boolean().default(true),
    note: text(300),
    button: button('Empezar', 'signup'),
  }),
  z.object({ ...base('testimonials'), items: z.array(testimonialItem).max(9).default([]) }),
  z.object({ ...base('logos'), items: z.array(logoItem).max(24).default([]) }),
  z.object({ ...base('faq'), items: z.array(faqItem).max(20).default([]) }),
  z.object({ ...base('cta'), button: button('Crear mi organización', 'signup'), secondary: landingButtonSchema.nullable().default(null) }),
  z.object({
    ...base('contact'),
    email: text(200),
    phone: text(40),
    whatsapp: text(40),
    address: text(300),
    hours: text(200),
  }),
]);
export type LandingSection = z.infer<typeof landingSectionSchema>;
export type LandingSectionOf<T extends LandingSectionType> = Extract<LandingSection, { type: T }>;

export const LANDING_SOCIALS = ['facebook', 'instagram', 'linkedin', 'x', 'youtube', 'tiktok', 'whatsapp'] as const;
export type LandingSocial = (typeof LANDING_SOCIALS)[number];
export const LANDING_SOCIAL_LABELS: Record<LandingSocial, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
};

/** Contenido de ejemplo de cada sección (texto real del producto, sin testimonios ni cifras inventadas). */
export function defaultLandingSection(type: LandingSectionType, id: string = type): LandingSection {
  const sections: { [K in LandingSectionType]: unknown } = {
    features: {
      id,
      type,
      navLabel: 'Funciones',
      title: 'Todo lo que necesita para gestionar la atención',
      subtitle: 'Turnos, pantallas, publicidad y reportes en una sola plataforma.',
      items: [
        { icon: 'monitor-play', title: 'Pantallas inteligentes', text: 'Llamados con voz y sonido, historial, reloj y diseños intercambiables para cualquier TV, Smart TV o Android TV.' },
        { icon: 'video', title: 'Publicidad multiplataforma', text: 'Suba videos e imágenes o agregue YouTube, Vimeo, TikTok, Instagram, Facebook, Twitch, Canva, Google Slides, HLS y páginas web.' },
        { icon: 'tablet', title: 'Kioscos táctiles', text: 'Emisión de turnos con impresión térmica, código QR, prioridades y datos del cliente configurables.' },
        { icon: 'smartphone', title: 'Fila virtual', text: 'El cliente saca su turno desde el celular y sigue su posición en vivo. Aviso cuando es llamado.' },
        { icon: 'headset', title: 'Consola de atención', text: 'Llamar, rellamar, derivar y finalizar con atajos de teclado. Varios operadores sin duplicados.' },
        { icon: 'bar-chart', title: 'Reportes', text: 'Tiempos de espera y atención por servicio, operador, hora y día. Exportación a Excel.' },
        { icon: 'palette', title: 'Totalmente personalizable', text: 'Logo, colores, tipografía, terminología (turno, ficha, ventanilla, box), campos y plantillas de impresión.' },
        { icon: 'webhook', title: 'Integración con todo', text: 'API REST documentada, API keys, webhooks firmados y eventos en tiempo real para ERP, CRM o WhatsApp.' },
        { icon: 'building', title: 'Multi-sucursal y SaaS', text: 'Organizaciones aisladas, planes, usuarios con roles y sucursales ilimitadas según el plan.' },
      ],
    },
    steps: {
      id,
      type,
      navLabel: 'Cómo funciona',
      title: 'Empiece a atender en minutos',
      subtitle: 'No hace falta instalar nada: funciona en el navegador.',
      items: [
        { title: 'Cree su organización', text: 'Regístrese con su correo y elija el nombre de su empresa.' },
        { title: 'Configure la atención', text: 'Cargue sus sucursales, servicios y puestos de atención con el asistente inicial.' },
        { title: 'Conecte las pantallas', text: 'Vincule TVs y kioscos con un código de 6 dígitos y empiece a llamar turnos.' },
      ],
    },
    showcase: {
      id,
      type,
      title: 'Su publicidad en cada sala de espera',
      subtitle: 'Mientras esperan, sus clientes ven sus promociones, novedades y videos en las mismas pantallas de los llamados.',
      bullets: ['Listas de reproducción con horarios', 'Videos, imágenes, YouTube y más', 'Texto que corre al pie de la pantalla'],
      imageSide: 'right',
    },
    stats: { id, type, title: 'En números', items: [] },
    pricing: {
      id,
      type,
      navLabel: 'Precios',
      title: 'Planes para cada etapa',
      subtitle: 'Precios mensuales. Puede cambiar de plan cuando quiera.',
    },
    testimonials: { id, type, title: 'Lo que dicen nuestros clientes', items: [] },
    logos: { id, type, title: 'Confían en nosotros', items: [] },
    faq: {
      id,
      type,
      navLabel: 'Preguntas',
      title: 'Preguntas frecuentes',
      items: [
        { question: '¿Necesito instalar algo?', answer: 'No. Todo funciona en el navegador: computadoras, tablets, celulares y televisores con navegador (Smart TV, Android TV, mini PC o Raspberry Pi).' },
        { question: '¿Puedo usar mi logo y mis colores?', answer: 'Sí. Puede cambiar el logo, los colores, la tipografía, los textos y la terminología de las pantallas, el kiosco y el ticket.' },
        { question: '¿Se integra con mi sistema?', answer: 'Sí. Tiene API REST documentada, API keys, webhooks firmados y eventos en tiempo real para conectarlo con su ERP, CRM o sistema de citas.' },
        { question: '¿Puedo tener varias sucursales?', answer: 'Sí. Cada sucursal tiene sus servicios, puestos, pantallas y kioscos, y los reportes se pueden ver juntos o por separado.' },
      ],
    },
    cta: {
      id,
      type,
      title: 'Empiece a ordenar la atención hoy',
      subtitle: 'Cree su organización en minutos o pida una demo con datos de ejemplo.',
      secondary: { label: 'Pedir una demo', action: 'demo' },
    },
    contact: { id, type, navLabel: 'Contacto', title: 'Hablemos', subtitle: 'Escríbanos y le ayudamos a ponerlo en marcha.' },
  };
  return landingSectionSchema.parse(sections[type]);
}

/** Dominio propio de la presentación, sin https:// ni barras (vacío = sin dominio propio). */
export const landingDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^$|^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, 'Dominio inválido (sin https:// ni barras), p. ej. www.suempresa.com')
  .default('');

export const landingSettingsSchema = z
  .object({
    /** Publicada en /presentacion (y en la dirección principal si se elige). */
    enabled: z.boolean().default(true),
    template: z.enum(LANDING_TEMPLATES).default('moderna'),
    theme: z
      .object({
        /** Vacío = el color principal de la marca de la plataforma. */
        primaryColor: z.union([color, z.literal('')]).default(''),
        /** Vacío = el de la plantilla. */
        accentColor: z.union([color, z.literal('')]).default(''),
        /** Vacío = la de la plantilla. */
        font: text(60),
        headingFont: text(60),
        /** Esquinas: las de la plantilla, rectas, suaves o muy redondeadas. */
        radius: z.enum(['auto', 'none', 'sm', 'md', 'lg']).default('auto'),
        heroLayout: z.enum(['auto', 'split', 'centered']).default('auto'),
      })
      .prefault({}),
    header: z
      .object({
        /** Enlace a la documentación de la API en el menú. */
        showApi: z.boolean().default(true),
        loginLabel: text(30, 'Ingresar'),
        signupLabel: text(30, 'Probar gratis'),
        demoLabel: text(30, 'Ver demo'),
      })
      .prefault({}),
    hero: z
      .object({
        badge: text(80, 'Plataforma SaaS de gestión de colas'),
        title: text(160, 'Atienda mejor, sin filas y con su marca en cada pantalla.'),
        /** Parte del título que se resalta con color. */
        highlight: text(80, 'sin filas'),
        /** `{{nombre}}` se reemplaza por el nombre de la plataforma. */
        subtitle: text(400, '{{nombre}} organiza los turnos de todas sus sucursales, muestra publicidad en las salas de espera y se integra con cualquier sistema.'),
        /** Ilustración de una pantalla con llamados, una imagen propia o nada. */
        media: z.enum(['mockup', 'image', 'none']).default('mockup'),
        imageUrl: image,
        primary: button('Crear mi organización', 'signup'),
        secondary: landingButtonSchema.nullable().default({ label: 'Recibir una demo por correo', action: 'demo', url: '' }),
        /** «¿Ya tiene cuenta? Ingrese aquí». */
        showLoginHint: z.boolean().default(true),
      })
      .prefault({}),
    sections: z
      .array(landingSectionSchema)
      .max(20)
      .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'Hay secciones con el mismo identificador')
      .default(() => [defaultLandingSection('features'), defaultLandingSection('steps'), defaultLandingSection('faq'), defaultLandingSection('cta')]),
    footer: z
      .object({
        text: text(300),
        links: z.array(z.object({ label: text(40), url: link })).max(8).default([]),
        /** Dirección de cada red social (vacío = no se muestra). */
        social: z
          .object(Object.fromEntries(LANDING_SOCIALS.map((n) => [n, z.string().trim().max(300).default('')])) as Record<LandingSocial, z.ZodDefault<z.ZodString>>)
          .prefault({}),
      })
      .prefault({}),
    seo: z
      .object({
        /** Título de la pestaña y al compartir el enlace. Vacío = nombre de la plataforma. */
        title: text(80),
        description: text(200),
        /** Imagen al compartir el enlace (WhatsApp, Facebook, LinkedIn…). */
        imageUrl: image,
      })
      .prefault({}),
    /**
     * Dominio propio de la presentación (p. ej. www.suempresa.com): si el sitio se abre con ese dominio,
     * la dirección principal muestra la presentación y los botones llevan al panel (PUBLIC_URL).
     */
    domain: landingDomainSchema,
  })
  .prefault({});
export type LandingSettings = z.infer<typeof landingSettingsSchema>;

/** Valida un enlace de red social: dirección web completa o, en WhatsApp, también un número. */
export function socialHref(network: LandingSocial, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (network === 'whatsapp' && /^\+?[\d\s()-]{6,}$/.test(v)) return `https://wa.me/${v.replace(/\D/g, '')}`;
  return /^https?:\/\//i.test(v) ? v : null;
}

/** Plan tal como se muestra en la sección de precios (público). */
export interface LandingPlanDTO {
  id: PlanId;
  name: string;
  /** En la unidad de la moneda (no en centavos). */
  monthlyPrice: number;
  currency: Currency;
  modules: string[];
  limits: { branches: number | null; displays: number | null; users: number | null };
}

/** Planes que muestra la sección de precios (solo si hay una sección de precios activa). */
export function landingPlansOf(settings: {
  plans: Record<PlanId, { monthlyPrice: number; currency: Currency; modules: ModuleId[] }>;
  landing: { sections: LandingSection[] };
}): LandingPlanDTO[] {
  const wanted = new Set(settings.landing.sections.flatMap((s) => (s.type === 'pricing' && s.enabled ? s.plans : [])));
  return PLAN_IDS.filter((id) => wanted.has(id)).map((id) => {
    const plan = settings.plans[id];
    const limits = PLANS[id];
    return {
      id,
      name: limits.name,
      monthlyPrice: plan.monthlyPrice,
      currency: plan.currency,
      modules: plan.modules.map((m) => MODULES[m].name),
      limits: { branches: limits.branches, displays: limits.displays, users: limits.users },
    };
  });
}
