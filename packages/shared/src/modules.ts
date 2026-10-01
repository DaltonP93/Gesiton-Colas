import { z } from 'zod';
import type { PlanId } from './plans';

/* ------------------------------------------------------------------ */
/* Módulos activables                                                  */
/* ------------------------------------------------------------------ */

/**
 * Funciones que el superadministrador activa o desactiva por organización.
 * La atención (sucursales, servicios, usuarios, consola) es la base y siempre está activa.
 */
export const MODULE_IDS = ['displays', 'kiosks', 'advertising', 'reports', 'integrations', 'notifications', 'surveys', 'payments', 'appointments', 'invoicing'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleInfo {
  name: string;
  description: string;
}

export const MODULES: Record<ModuleId, ModuleInfo> = {
  displays: { name: 'Pantallas TV', description: 'Llamados en televisores con voz, historial y diseño propio.' },
  kiosks: { name: 'Kioscos y fila virtual', description: 'Emisión de turnos en tótems, tablets y desde el celular con QR.' },
  advertising: { name: 'Publicidad', description: 'Videos, imágenes, YouTube y listas de reproducción en las pantallas.' },
  reports: { name: 'Reportes', description: 'Tiempos de espera y atención, exportación a Excel.' },
  integrations: { name: 'Integraciones y API', description: 'API REST, API keys y webhooks para otros sistemas.' },
  notifications: { name: 'Avisos por WhatsApp y SMS', description: 'Confirmación, «faltan N turnos», llamado y encuesta en el celular del cliente.' },
  surveys: { name: 'Encuestas de satisfacción', description: 'Constructor de encuestas, envío tras la atención y métricas (NPS, CSAT).' },
  payments: { name: 'Cobros a clientes', description: 'Cobro de servicios con Bancard, PagoPar, Stripe o registro manual.' },
  invoicing: {
    name: 'Factura electrónica SIFEN',
    description: 'Facturas electrónicas firmadas y enviadas a la SET (Paraguay), con CDC, QR y KuDE; también al cobrar.',
  },
  appointments: {
    name: 'Citas con fecha y hora',
    description: 'Citas de su sistema (API, webhook o CSV) o reservadas en línea; llegada en el kiosco con prioridad por horario y recordatorios.',
  },
};

/** Módulos incluidos en cada plan si el superadministrador no define otra cosa. */
export const DEFAULT_PLAN_MODULES: Record<PlanId, ModuleId[]> = {
  free: ['displays', 'kiosks', 'advertising', 'reports', 'integrations'],
  pro: ['displays', 'kiosks', 'advertising', 'reports', 'integrations', 'notifications', 'surveys'],
  enterprise: [...MODULE_IDS],
};

/** Ajuste por organización: `true`/`false` fuerza el módulo; sin clave, vale lo que diga el plan. */
export const moduleOverridesSchema = z.partialRecord(z.enum(MODULE_IDS), z.boolean());
export type ModuleOverrides = z.infer<typeof moduleOverridesSchema>;

/** Módulos activos: los del plan, con los ajustes que hizo el superadministrador para la organización. */
export function effectiveModules(planModules: readonly ModuleId[], overrides: ModuleOverrides | null | undefined): ModuleId[] {
  return MODULE_IDS.filter((id) => overrides?.[id] ?? planModules.includes(id));
}
