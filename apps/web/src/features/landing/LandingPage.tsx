import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { landingSettingsSchema, type LandingPlanDTO, type LandingSettings, type PlatformBrand } from '@gc/shared';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { usePublicConfig } from '../../lib/queries';
import { LandingView } from './LandingView';

/** Mensaje que manda el editor a la vista previa con el borrador sin guardar. */
export interface LandingPreviewMessage {
  type: 'gc-landing-preview';
  landing: LandingSettings;
  plans: LandingPlanDTO[];
  brand: PlatformBrand;
  allowSignup: boolean;
  allowDemo: boolean;
}

/** ¿El sitio se abrió con el dominio propio de la presentación? */
export function onLandingDomain(domain: string) {
  return domain !== '' && window.location.hostname.toLowerCase() === domain;
}

/**
 * Página de presentación: en la dirección principal (si así se eligió), en /presentacion y en su dominio propio.
 * Con `?vista-previa` muestra el borrador que manda el editor.
 */
export function LandingPage({ standalone = false }: { standalone?: boolean }) {
  const { platformBrand } = useAuth();
  const { data: config, isLoading } = usePublicConfig();
  const [params] = useSearchParams();
  const preview = params.has('vista-previa');
  const [draft, setDraft] = useState<LandingPreviewMessage | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as Partial<LandingPreviewMessage> | null;
      if (data?.type !== 'gc-landing-preview' || !data.landing) return;
      const parsed = landingSettingsSchema.safeParse(data.landing);
      if (parsed.success) setDraft({ ...(data as LandingPreviewMessage), landing: parsed.data });
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'gc-landing-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [preview]);

  const landing = draft?.landing ?? config?.landing;
  const brand = draft?.brand ?? platformBrand;
  useEffect(() => {
    if (!landing || preview) return;
    document.title = landing.seo.title || brand.appName;
  }, [landing, brand.appName, preview]);

  if (isLoading || !config || !landing) return <Loading />;
  if (standalone && !preview && !config.landing.enabled) return <Navigate to="/login" replace />;

  const appUrl = onLandingDomain(config.landing.domain) && config.appUrl && !config.appUrl.includes(window.location.host) ? config.appUrl : null;
  return (
    <LandingView
      landing={landing}
      brand={brand}
      plans={draft?.plans ?? config.landingPlans}
      ctx={{ allowSignup: draft?.allowSignup ?? config.allowSignup, allowDemo: draft?.allowDemo ?? config.allowDemo, appUrl, preview }}
    />
  );
}
