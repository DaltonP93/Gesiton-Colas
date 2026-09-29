export const PLAN_IDS = ['free', 'pro', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  name: string;
  /** `null` = ilimitado */
  branches: number | null;
  displays: number | null;
  kiosks: number | null;
  users: number | null;
  storageMb: number | null;
  webhooks: number | null;
  apiKeys: number | null;
  /** Tamaño máximo por archivo subido (MB). */
  maxUploadMb: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    name: 'Inicial',
    branches: 1,
    displays: 2,
    kiosks: 1,
    users: 5,
    storageMb: 500,
    webhooks: 2,
    apiKeys: 2,
    maxUploadMb: 100,
  },
  pro: {
    name: 'Profesional',
    branches: 10,
    displays: 30,
    kiosks: 20,
    users: 100,
    storageMb: 20_000,
    webhooks: 20,
    apiKeys: 20,
    maxUploadMb: 1024,
  },
  enterprise: {
    name: 'Empresa',
    branches: null,
    displays: null,
    kiosks: null,
    users: null,
    storageMb: null,
    webhooks: null,
    apiKeys: null,
    maxUploadMb: 4096,
  },
};

export type PlanResource = 'branches' | 'displays' | 'kiosks' | 'users' | 'webhooks' | 'apiKeys';
