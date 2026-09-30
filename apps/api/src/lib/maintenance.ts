import { and, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import { authTokens, devicePairings, tenants, webhookDeliveries } from '../db/schema';

/** Días que se conservan las demos vencidas antes de borrarlas definitivamente. */
const DEMO_RETENTION_DAYS = 30;
/** Días que se conserva el historial de entregas de webhooks (incluye datos del turno). */
const WEBHOOK_RETENTION_DAYS = 30;

/** Limpieza periódica: enlaces vencidos, vinculaciones viejas y demos abandonadas. */
export async function runMaintenance(ctx: Pick<AppContext, 'db' | 'log'> & Partial<Pick<AppContext, 'payments'>>) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  await ctx.db.delete(authTokens).where(or(lt(authTokens.expiresAt, weekAgo), and(isNotNull(authTokens.usedAt), lt(authTokens.usedAt, weekAgo))));
  await ctx.db.delete(devicePairings).where(lt(devicePairings.expiresAt, new Date(now.getTime() - 24 * 3600 * 1000)));
  const removed = await ctx.db
    .delete(tenants)
    .where(and(sql`${tenants.isDemo} = true`, lt(tenants.demoExpiresAt, new Date(now.getTime() - DEMO_RETENTION_DAYS * 24 * 3600 * 1000))))
    .returning({ id: tenants.id });
  if (removed.length) ctx.log.info({ count: removed.length }, 'mantenimiento: demos vencidas eliminadas');
  await ctx.db.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * 24 * 3600 * 1000)));
  // Borrado de datos personales según el plazo que eligió cada organización (queda la estadística).
  const anonymized = await ctx.db.execute(sql`
    UPDATE tickets t SET customer = '{}'::jsonb
    FROM tenants o
    WHERE t.tenant_id = o.id
      AND coalesce((o.settings->'privacy'->>'retentionDays')::int, 0) > 0
      AND t.customer <> '{}'::jsonb
      AND t.created_at < now() - make_interval(days => (o.settings->'privacy'->>'retentionDays')::int)`);
  if (anonymized.rowCount) ctx.log.info({ count: anonymized.rowCount }, 'mantenimiento: datos personales vencidos borrados');
  // Facturación: factura del mes y suspensión por falta de pago (si el superadministrador lo activó).
  await ctx.payments?.runCycle();
}

export function startMaintenance(ctx: Pick<AppContext, 'db' | 'log' | 'payments'>, intervalMs = 6 * 3600 * 1000) {
  const run = () => runMaintenance(ctx).catch((error) => ctx.log.error({ err: error }, 'mantenimiento: error'));
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
