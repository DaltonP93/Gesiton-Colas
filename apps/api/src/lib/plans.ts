import { count, eq, and, isNull } from 'drizzle-orm';
import { PLANS, type PlanLimits, type PlanResource } from '@gc/shared';
import type { DbOrTx } from '../db/client';
import { apiKeys, branches, displays, kiosks, tenants, users, webhooks } from '../db/schema';
import { notFound, planLimit } from './errors';

const LABELS: Record<PlanResource, string> = {
  branches: 'sucursales',
  displays: 'pantallas',
  kiosks: 'kioscos',
  users: 'usuarios',
  webhooks: 'webhooks',
  apiKeys: 'API keys',
};

export async function limitsOf(db: DbOrTx, tenantId: string): Promise<PlanLimits> {
  const [tenant] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw notFound('Organización');
  return PLANS[tenant.plan] ?? PLANS.free;
}

export async function usageOf(db: DbOrTx, tenantId: string): Promise<Record<PlanResource, number> & { storageBytes: number }> {
  const c = async (table: typeof branches | typeof displays | typeof kiosks | typeof users | typeof webhooks) => {
    const [row] = await db.select({ n: count() }).from(table).where(eq(table.tenantId, tenantId));
    return row?.n ?? 0;
  };
  const [b, d, k, u, w, a, t] = await Promise.all([
    c(branches),
    c(displays),
    c(kiosks),
    c(users),
    c(webhooks),
    db
      .select({ n: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt))),
    db.select({ s: tenants.storageBytes }).from(tenants).where(eq(tenants.id, tenantId)),
  ]);
  return { branches: b, displays: d, kiosks: k, users: u, webhooks: w, apiKeys: a[0]?.n ?? 0, storageBytes: t[0]?.s ?? 0 };
}

/** Lanza un error 402 si la organización alcanzó el límite de su plan para el recurso. */
export async function assertWithinLimit(db: DbOrTx, tenantId: string, resource: PlanResource) {
  const limits = await limitsOf(db, tenantId);
  const max = limits[resource];
  if (max === null) return;
  const usage = await usageOf(db, tenantId);
  if (usage[resource] >= max) {
    throw planLimit(`Su plan ${limits.name} permite hasta ${max} ${LABELS[resource]}. Actualice el plan para agregar más.`);
  }
}
