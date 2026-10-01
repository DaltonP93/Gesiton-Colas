import { toMinor, type Currency } from './currency';
import { MODULES, effectiveModules, type ModuleId, type ModuleOverrides } from './modules';
import { PLANS, type PlanId } from './plans';
import type { PlatformSettings } from './platform';

/** Renglón de una factura (en la unidad mínima de la moneda). */
export interface InvoiceLine {
  description: string;
  amount: number;
  /** Módulo adicional que originó el renglón. */
  module?: ModuleId;
}

export interface MonthlyCharges {
  currency: Currency;
  lines: InvoiceLine[];
  total: number;
}

/**
 * Lo que paga una organización por mes: el precio de su plan más cada módulo activado
 * que su plan no incluye y que tiene precio de módulo adicional.
 */
export function monthlyCharges(settings: Pick<PlatformSettings, 'plans' | 'addons'>, tenant: { plan: PlanId; modules: ModuleOverrides }): MonthlyCharges {
  const plan = settings.plans[tenant.plan];
  const currency = plan.currency;
  const lines: InvoiceLine[] = [];
  if (plan.monthlyPrice > 0) lines.push({ description: `Plan ${PLANS[tenant.plan].name}`, amount: toMinor(plan.monthlyPrice, currency) });
  for (const module of effectiveModules(plan.modules, tenant.modules)) {
    const price = settings.addons[module] ?? 0;
    if (plan.modules.includes(module) || price <= 0) continue;
    lines.push({ description: `Módulo adicional: ${MODULES[module].name}`, amount: toMinor(price, currency), module });
  }
  return { currency, lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}
