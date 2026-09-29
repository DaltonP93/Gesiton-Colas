import type { Branding, CustomerField, Locale, Terminology } from '@gc/shared';

/* ------------------------------------------------------------------ */
/* Paletas de marca                                                    */
/* ------------------------------------------------------------------ */

export type PaletteColors = Pick<Branding, 'primaryColor' | 'accentColor' | 'backgroundColor' | 'surfaceColor' | 'textColor'>;

export interface Palette {
  name: string;
  colors: PaletteColors;
  /** Esquema de color que impone la paleta (las claras respetan "automático"). */
  colorScheme?: Branding['colorScheme'];
}

export const PALETTES: Palette[] = [
  {
    name: 'Azul corporativo',
    colors: { primaryColor: '#2563eb', accentColor: '#f59e0b', backgroundColor: '#f1f5f9', surfaceColor: '#ffffff', textColor: '#0f172a' },
  },
  {
    name: 'Verde salud',
    colors: { primaryColor: '#059669', accentColor: '#0ea5e9', backgroundColor: '#ecfdf5', surfaceColor: '#ffffff', textColor: '#0b2e24' },
  },
  {
    name: 'Violeta',
    colors: { primaryColor: '#7c3aed', accentColor: '#f472b6', backgroundColor: '#f5f3ff', surfaceColor: '#ffffff', textColor: '#1e1b4b' },
  },
  {
    name: 'Naranja retail',
    colors: { primaryColor: '#ea580c', accentColor: '#1f2937', backgroundColor: '#fff7ed', surfaceColor: '#ffffff', textColor: '#1c1917' },
  },
  {
    name: 'Rojo intenso',
    colors: { primaryColor: '#dc2626', accentColor: '#fbbf24', backgroundColor: '#fef2f2', surfaceColor: '#ffffff', textColor: '#1f1315' },
  },
  {
    name: 'Turquesa',
    colors: { primaryColor: '#0e7490', accentColor: '#f97316', backgroundColor: '#ecfeff', surfaceColor: '#ffffff', textColor: '#083344' },
  },
  {
    name: 'Grafito',
    colors: { primaryColor: '#334155', accentColor: '#10b981', backgroundColor: '#f8fafc', surfaceColor: '#ffffff', textColor: '#0f172a' },
  },
  {
    name: 'Oscuro elegante',
    colors: { primaryColor: '#6366f1', accentColor: '#22d3ee', backgroundColor: '#0b1120', surfaceColor: '#131c2e', textColor: '#e2e8f0' },
    colorScheme: 'dark',
  },
];

/** Colores que usa el sistema cuando el esquema es oscuro (ver `applyBranding`). */
export const DARK_COLORS = { backgroundColor: '#0b1120', surfaceColor: '#131c2e', textColor: '#e2e8f0' };

/* ------------------------------------------------------------------ */
/* Terminología                                                        */
/* ------------------------------------------------------------------ */

export const TERM_FIELDS: { key: keyof Terminology; label: string; plural?: keyof Terminology; pluralLabel?: string }[] = [
  { key: 'ticket', label: 'Turno (singular)', plural: 'tickets', pluralLabel: 'Turnos (plural)' },
  { key: 'counter', label: 'Puesto de atención (singular)', plural: 'counters', pluralLabel: 'Puestos de atención (plural)' },
  { key: 'service', label: 'Servicio (singular)', plural: 'services', pluralLabel: 'Servicios (plural)' },
  { key: 'branch', label: 'Sucursal (singular)', plural: 'branches', pluralLabel: 'Sucursales (plural)' },
  { key: 'customer', label: 'Persona atendida' },
  { key: 'agent', label: 'Persona que atiende' },
];

export const TERM_PRESETS: { name: string; description: string; terms: Partial<Terminology> }[] = [
  { name: 'Turno / Ventanilla', description: 'Bancos, oficinas públicas', terms: { ticket: 'Turno', tickets: 'Turnos', counter: 'Ventanilla', counters: 'Ventanillas' } },
  { name: 'Ficha / Box', description: 'Clínicas, laboratorios', terms: { ticket: 'Ficha', tickets: 'Fichas', counter: 'Box', counters: 'Boxes' } },
  { name: 'Ticket / Caja', description: 'Comercios, supermercados', terms: { ticket: 'Ticket', tickets: 'Tickets', counter: 'Caja', counters: 'Cajas' } },
  { name: 'Número / Mesa', description: 'Atención al público, trámites', terms: { ticket: 'Número', tickets: 'Números', counter: 'Mesa', counters: 'Mesas' } },
  {
    name: 'Turno / Consultorio',
    description: 'Centros médicos',
    terms: { ticket: 'Turno', tickets: 'Turnos', counter: 'Consultorio', counters: 'Consultorios', customer: 'Paciente', agent: 'Profesional' },
  },
  {
    name: 'Senha / Guichê',
    description: 'Portugués (Brasil)',
    terms: {
      ticket: 'Senha',
      tickets: 'Senhas',
      counter: 'Guichê',
      counters: 'Guichês',
      service: 'Serviço',
      services: 'Serviços',
      branch: 'Unidade',
      branches: 'Unidades',
      customer: 'Cliente',
      agent: 'Atendente',
    },
  },
];

/* ------------------------------------------------------------------ */
/* Campos del cliente                                                  */
/* ------------------------------------------------------------------ */

export const FIELD_TYPES: { value: CustomerField['type']; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'email', label: 'Correo electrónico' },
  { value: 'tel', label: 'Teléfono' },
  { value: 'document', label: 'Documento de identidad' },
  { value: 'select', label: 'Lista de opciones' },
  { value: 'date', label: 'Fecha' },
];

/* ------------------------------------------------------------------ */
/* Región                                                              */
/* ------------------------------------------------------------------ */

export const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English (inglés)' },
  { value: 'pt', label: 'Português (portugués)' },
];

export const COMMON_TIMEZONES = [
  'America/Mexico_City',
  'America/Monterrey',
  'America/Tijuana',
  'America/Cancun',
  'America/Guatemala',
  'America/El_Salvador',
  'America/Tegucigalpa',
  'America/Managua',
  'America/Costa_Rica',
  'America/Panama',
  'America/Havana',
  'America/Santo_Domingo',
  'America/Puerto_Rico',
  'America/Bogota',
  'America/Caracas',
  'America/Guayaquil',
  'America/Lima',
  'America/La_Paz',
  'America/Santiago',
  'America/Asuncion',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Atlantic/Canary',
  'UTC',
];
