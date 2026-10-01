import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Heart, Loader2, MessageSquareOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { PublicSurveyDTO, SurveyAnswers } from '@gc/shared';
import { ApiError, api, assetUrl } from '../../lib/api';
import { translator } from '../../lib/i18n';
import { applyBranding } from '../../lib/theme';
import { SurveyForm } from './SurveyForm';
import { PrivacyNotice } from '../../components/legal/PrivacyNotice';

/** Encuesta pública: del turno (/encuesta/:token) o por enlace general / QR (/encuesta/s/:token?sucursal=). */
export default function SurveyPage({ general = false }: { general?: boolean }) {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const path = general ? `/public/surveys/s/${token}` : `/public/surveys/t/${token}`;
  const query = useQuery({ queryKey: ['survey', path], queryFn: () => api.public<PublicSurveyDTO>(path), retry: false });
  const [thanks, setThanks] = useState<string | null>(null);
  const data = query.data;
  const t = translator(data?.tenant.locale ?? 'es', data?.tenant.terminology);

  useEffect(() => {
    if (data) applyBranding(data.tenant.branding, { title: `${data.survey.title} · ${data.tenant.name}`, applyCustomCss: false });
  }, [data]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="size-8 animate-spin text-muted" />
      </div>
    );
  }
  if (!data) {
    const offline = !(query.error instanceof ApiError);
    return (
      <Centered icon={<MessageSquareOff className="size-12 text-muted" />} title={offline ? 'Sin conexión' : t('survey.unavailable')}>
        {offline && <p className="text-sm text-muted">Revise su conexión e intente de nuevo.</p>}
      </Centered>
    );
  }

  async function submit(answers: SurveyAnswers) {
    try {
      const res = await api.public<{ thanks: string }>(path, general ? { answers, branchId: params.get('sucursal') || undefined } : { answers });
      setThanks(res.thanks);
      window.scrollTo({ top: 0 });
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.message : 'No se pudo enviar. Intente de nuevo.');
    }
  }

  const branding = data.tenant.branding;
  const status = thanks !== null ? 'thanks' : data.status;

  return (
    <div className="min-h-screen bg-bg pb-10">
      <header className="bg-primary px-6 pt-8 pb-16 text-center text-primary-fg">
        {branding.logoUrl ? (
          <img src={assetUrl(branding.logoUrl)} alt={data.tenant.name} className="mx-auto h-12 max-w-[60%] object-contain" />
        ) : (
          <p className="text-xl font-bold">{branding.appName}</p>
        )}
        {data.ticket && <p className="mt-2 text-sm opacity-85">{t('survey.ticket', { code: data.ticket.code, service: data.ticket.service })}</p>}
      </header>
      <main className="mx-auto -mt-10 max-w-lg px-4">
        {status === 'open' && (
          <SurveyForm survey={data.survey} t={t} onSubmit={submit} />
        )}
        {status === 'thanks' && (
          <Card icon={<Heart className="size-12 fill-rose-500 text-rose-500" />} title={t('survey.thanksTitle')}>
            <p className="text-muted">{thanks || data.survey.thanks}</p>
          </Card>
        )}
        {status === 'answered' && <Card icon={<CheckCircle2 className="size-12 text-emerald-600" />} title={t('survey.answered')} />}
        {status === 'not_ready' && <Card icon={<Clock className="size-12 text-primary" />} title={t('survey.notReady')} />}
        {status === 'expired' && <Card icon={<Clock className="size-12 text-muted" />} title={t('survey.expired')} />}
        <PrivacyNotice notice={data.tenant.privacyNotice} organization={data.tenant.name} label={t('privacy.notice')} className="mt-6 text-muted" />
      </main>
    </div>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="gc-pop flex flex-col items-center gap-3 rounded-3xl bg-surface p-8 text-center shadow-xl">
      {icon}
      <p className="text-xl font-bold">{title}</p>
      {children}
    </div>
  );
}

function Centered({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      {icon}
      <p className="text-xl font-semibold">{title}</p>
      {children}
    </div>
  );
}
