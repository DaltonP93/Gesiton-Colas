import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MODULE_IDS, MODULES, PLANS, formatMoney, monthlyCharges, toMinor, type ModuleId, type ModuleOverrides, type PlatformSettings, type TenantDTO } from '@gc/shared';
import { Badge, Button, Modal, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

type Choice = 'plan' | 'on' | 'off';

/**
 * Módulos de una organización: cada uno sigue lo que incluye su plan o se fuerza
 * activado / desactivado para esa organización.
 */
export function TenantModulesModal({
  tenant,
  settings,
  onClose,
}: {
  tenant: TenantDTO & { modules: ModuleId[] };
  /** Ajustes de la plataforma: módulos de cada plan y precios de los adicionales. */
  settings: PlatformSettings;
  onClose: () => void;
}) {
  const plan = settings.plans[tenant.plan];
  const planModules = plan.modules;
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const initial = Object.fromEntries(
    MODULE_IDS.map((id) => [id, tenant.moduleOverrides[id] === undefined ? 'plan' : tenant.moduleOverrides[id] ? 'on' : 'off']),
  ) as Record<ModuleId, Choice>;
  const [choices, setChoices] = useState(initial);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/platform/tenants/${tenant.id}`, {
        modules: Object.fromEntries(MODULE_IDS.map((id) => [id, choices[id] === 'plan' ? null : choices[id] === 'on'])) as Record<ModuleId, boolean | null>,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform'] });
      toast(`Módulos de «${tenant.name}» actualizados. Los usuarios los ven al recargar.`);
      onClose();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const effective = (id: ModuleId) => (choices[id] === 'plan' ? planModules.includes(id) : choices[id] === 'on');
  const overrides: ModuleOverrides = {};
  for (const id of MODULE_IDS) if (choices[id] !== 'plan') overrides[id] = choices[id] === 'on';
  const charges = monthlyCharges(settings, { plan: tenant.plan, modules: overrides });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Módulos de «${tenant.name}»`}
      description={`Plan ${PLANS[tenant.plan].name}. «Según el plan» toma lo que incluye el plan; puede forzar cada módulo para esta organización.`}
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            Cargo mensual: <strong className="text-fg tabular-nums">{formatMoney(charges.total, charges.currency)}</strong>
            {charges.lines.some((l) => l.module) && ` (plan + ${charges.lines.filter((l) => l.module).length} adicional)`}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar módulos
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-border">
        {MODULE_IDS.map((id) => {
          const on = effective(id);
          return (
            <li key={id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {MODULES[id].name}
                  {on ? <Badge color="#16a34a">Activo</Badge> : <Badge color="#64748b">Inactivo</Badge>}
                  {!planModules.includes(id) && (settings.addons[id] ?? 0) > 0 && (
                    <span className="text-xs font-normal text-muted">Adicional: {formatMoney(toMinor(settings.addons[id]!, plan.currency), plan.currency)}/mes</span>
                  )}
                </p>
                <p className="text-xs text-muted">{MODULES[id].description}</p>
              </div>
              <div role="radiogroup" aria-label={`Módulo ${MODULES[id].name}`} className="inline-flex rounded-ui bg-subtle p-1">
                {(
                  [
                    ['plan', `Según el plan (${planModules.includes(id) ? 'sí' : 'no'})`],
                    ['on', 'Activado'],
                    ['off', 'Desactivado'],
                  ] as [Choice, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={choices[id] === value}
                    onClick={() => setChoices((c) => ({ ...c, [id]: value }))}
                    className={cx(
                      'rounded-[calc(var(--gc-radius)*0.6)] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition',
                      choices[id] === value ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
