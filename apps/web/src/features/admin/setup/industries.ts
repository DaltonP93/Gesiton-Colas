import type { DisplayConfig, Terminology } from '@gc/shared';

/** Servicio sugerido por el asistente. `icon` es una clave de SERVICE_ICONS. */
export interface ServiceTemplate {
  name: string;
  prefix: string;
  color: string;
  icon: string;
  minutes: number;
}

export interface Industry {
  id: string;
  name: string;
  description: string;
  /** Ícono de SERVICE_ICONS que representa al rubro. */
  icon: string;
  terms: Partial<Terminology>;
  /** Nombre de una de las paletas de marca (PALETTES). */
  palette: string;
  services: ServiceTemplate[];
  layout: DisplayConfig['layout'];
  /** Pedir el nombre al sacar turno (para llamar por nombre). */
  askName: boolean;
}

export const INDUSTRIES: Industry[] = [
  {
    id: 'banco',
    name: 'Banco o financiera',
    description: 'Cajas, atención al cliente y créditos',
    icon: 'bank',
    terms: { ticket: 'Turno', tickets: 'Turnos', counter: 'Ventanilla', counters: 'Ventanillas', customer: 'Cliente', agent: 'Operador' },
    palette: 'Azul corporativo',
    layout: 'split',
    askName: false,
    services: [
      { name: 'Caja', prefix: 'C', color: '#16a34a', icon: 'cash', minutes: 4 },
      { name: 'Atención al cliente', prefix: 'A', color: '#2563eb', icon: 'users', minutes: 8 },
      { name: 'Créditos y préstamos', prefix: 'P', color: '#7c3aed', icon: 'briefcase', minutes: 15 },
      { name: 'Tarjetas', prefix: 'T', color: '#ea580c', icon: 'card', minutes: 10 },
      { name: 'Apertura de cuentas', prefix: 'N', color: '#0e7490', icon: 'bank', minutes: 20 },
    ],
  },
  {
    id: 'salud',
    name: 'Clínica, sanatorio o laboratorio',
    description: 'Admisión, consultorios y estudios',
    icon: 'doctor',
    terms: { ticket: 'Turno', tickets: 'Turnos', counter: 'Consultorio', counters: 'Consultorios', customer: 'Paciente', agent: 'Profesional' },
    palette: 'Verde salud',
    layout: 'split',
    askName: true,
    services: [
      { name: 'Admisión', prefix: 'A', color: '#0d9488', icon: 'clipboard', minutes: 5 },
      { name: 'Consultas', prefix: 'C', color: '#2563eb', icon: 'doctor', minutes: 15 },
      { name: 'Laboratorio', prefix: 'L', color: '#7c3aed', icon: 'health', minutes: 8 },
      { name: 'Imágenes y estudios', prefix: 'E', color: '#ea580c', icon: 'calendar', minutes: 12 },
      { name: 'Retiro de resultados', prefix: 'R', color: '#64748b', icon: 'file', minutes: 4 },
    ],
  },
  {
    id: 'farmacia',
    name: 'Farmacia',
    description: 'Recetas, venta libre y obras sociales',
    icon: 'pharmacy',
    terms: { ticket: 'Número', tickets: 'Números', counter: 'Mostrador', counters: 'Mostradores', customer: 'Cliente', agent: 'Farmacéutico' },
    palette: 'Turquesa',
    layout: 'fullscreen',
    askName: false,
    services: [
      { name: 'Recetas', prefix: 'R', color: '#0e7490', icon: 'pharmacy', minutes: 5 },
      { name: 'Venta libre', prefix: 'V', color: '#16a34a', icon: 'cart', minutes: 3 },
      { name: 'Perfumería', prefix: 'P', color: '#db2777', icon: 'package', minutes: 4 },
      { name: 'Obras sociales y seguros', prefix: 'O', color: '#7c3aed', icon: 'shield', minutes: 8 },
    ],
  },
  {
    id: 'publico',
    name: 'Oficina pública o municipalidad',
    description: 'Mesa de entrada, pagos y trámites',
    icon: 'building',
    terms: { ticket: 'Número', tickets: 'Números', counter: 'Mesa', counters: 'Mesas', customer: 'Ciudadano', agent: 'Funcionario' },
    palette: 'Grafito',
    layout: 'tickets',
    askName: false,
    services: [
      { name: 'Mesa de entrada', prefix: 'M', color: '#334155', icon: 'file', minutes: 6 },
      { name: 'Pagos y tasas', prefix: 'P', color: '#16a34a', icon: 'receipt', minutes: 5 },
      { name: 'Licencias y permisos', prefix: 'L', color: '#2563eb', icon: 'card', minutes: 15 },
      { name: 'Trámites generales', prefix: 'T', color: '#7c3aed', icon: 'clipboard', minutes: 10 },
      { name: 'Informes', prefix: 'I', color: '#ea580c', icon: 'help', minutes: 5 },
    ],
  },
  {
    id: 'comercio',
    name: 'Comercio o atención al cliente',
    description: 'Cajas, retiros, garantías y ventas',
    icon: 'cart',
    terms: { ticket: 'Ticket', tickets: 'Tickets', counter: 'Caja', counters: 'Cajas', customer: 'Cliente', agent: 'Vendedor' },
    palette: 'Naranja retail',
    layout: 'fullscreen',
    askName: false,
    services: [
      { name: 'Cajas', prefix: 'C', color: '#16a34a', icon: 'cash', minutes: 3 },
      { name: 'Atención al cliente', prefix: 'A', color: '#2563eb', icon: 'users', minutes: 6 },
      { name: 'Retiro de pedidos', prefix: 'R', color: '#ea580c', icon: 'package', minutes: 4 },
      { name: 'Garantías y cambios', prefix: 'G', color: '#dc2626', icon: 'tools', minutes: 10 },
      { name: 'Ventas y asesoramiento', prefix: 'V', color: '#7c3aed', icon: 'cart', minutes: 8 },
    ],
  },
  {
    id: 'educacion',
    name: 'Universidad o colegio',
    description: 'Inscripciones, tesorería y certificados',
    icon: 'briefcase',
    terms: { ticket: 'Turno', tickets: 'Turnos', counter: 'Box', counters: 'Boxes', customer: 'Estudiante', agent: 'Personal' },
    palette: 'Violeta',
    layout: 'split',
    askName: true,
    services: [
      { name: 'Inscripciones', prefix: 'I', color: '#7c3aed', icon: 'file', minutes: 10 },
      { name: 'Tesorería', prefix: 'T', color: '#16a34a', icon: 'wallet', minutes: 5 },
      { name: 'Certificados y constancias', prefix: 'C', color: '#2563eb', icon: 'clipboard', minutes: 6 },
      { name: 'Consultas', prefix: 'A', color: '#ea580c', icon: 'help', minutes: 5 },
    ],
  },
  {
    id: 'otro',
    name: 'Otro rubro',
    description: 'Empiece con lo básico y ajuste a su medida',
    icon: 'ticket',
    terms: {},
    palette: '',
    layout: 'split',
    askName: false,
    services: [],
  },
];
