import { Globe, Hash, Palette, TextCursorInput, Type } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { BrandTab } from './customization/BrandTab';
import type { TabProps } from './customization/common';
import { CustomerFieldsTab } from './customization/CustomerFieldsTab';
import { RegionTab } from './customization/RegionTab';
import { TerminologyTab } from './customization/TerminologyTab';
import { TicketsTab } from './customization/TicketsTab';

type TabKey = 'marca' | 'terminologia' | 'turnos' | 'cliente' | 'region';

export default function CustomizationPage() {
  const { terms } = useAuth();
  const [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState<Record<TabKey, boolean>>({ marca: false, terminologia: false, turnos: false, cliente: false, region: false });

  const tabs: { value: TabKey; label: string; icon: ReactNode; Component: ComponentType<TabProps> }[] = [
    { value: 'marca', label: 'Marca', icon: <Palette className="size-4" />, Component: BrandTab },
    { value: 'terminologia', label: 'Terminología', icon: <Type className="size-4" />, Component: TerminologyTab },
    { value: 'turnos', label: terms.tickets, icon: <Hash className="size-4" />, Component: TicketsTab },
    { value: 'cliente', label: `Datos del ${terms.customer.toLowerCase()}`, icon: <TextCursorInput className="size-4" />, Component: CustomerFieldsTab },
    { value: 'region', label: 'Región', icon: <Globe className="size-4" />, Component: RegionTab },
  ];
  const requested = params.get('tab');
  const current: TabKey = tabs.some((t) => t.value === requested) ? (requested as TabKey) : 'marca';

  const markDirty = useCallback((key: TabKey, value: boolean) => setDirty((d) => (d[key] === value ? d : { ...d, [key]: value })), []);
  const handlers = useMemo(
    () =>
      Object.fromEntries((['marca', 'terminologia', 'turnos', 'cliente', 'region'] as TabKey[]).map((k) => [k, (v: boolean) => markDirty(k, v)])) as Record<
        TabKey,
        (v: boolean) => void
      >,
    [markDirty],
  );

  // Avisa antes de salir de la página con cambios sin guardar.
  const anyDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  return (
    <div>
      <PageHeader
        title="Personalización"
        description="Adapte el sistema a su organización: marca, vocabulario, numeración, datos que se piden a cada persona e idioma. Cada pestaña se guarda por separado."
      />
      <Tabs
        value={current}
        onChange={(tab) => setParams({ tab }, { replace: true })}
        tabs={tabs.map((t) => ({
          value: t.value,
          icon: t.icon,
          label: (
            <>
              {t.label}
              {dirty[t.value] && (
                <span className="size-1.5 rounded-full bg-accent" title="Cambios sin guardar">
                  <span className="sr-only">(cambios sin guardar)</span>
                </span>
              )}
            </>
          ),
        }))}
      />
      <div className="pt-6">
        {/* Las pestañas quedan montadas para no perder los cambios al cambiar de pestaña. */}
        {tabs.map(({ value, label, Component }) => (
          <div key={value} role="tabpanel" aria-label={label} hidden={value !== current}>
            <Component onDirtyChange={handlers[value]} />
          </div>
        ))}
      </div>
    </div>
  );
}
