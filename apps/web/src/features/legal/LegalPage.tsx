import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, History, Printer } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LEGAL_DOCS, formatLegalDate as formatDate, type LegalDocumentDTO, type LegalKind } from '@gc/shared';
import { Markdown } from '../../components/Markdown';
import { LegalFooter } from '../../components/legal/LegalFooter';
import { Button, EmptyState, Loading, Select, cx } from '../../components/ui';
import { api, assetUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { usePublicConfig } from '../../lib/queries';

/** Términos, política de privacidad o acuerdo de tratamiento de datos publicados (/terminos, /privacidad…). */
export default function LegalPage({ kind }: { kind: LegalKind }) {
  const { platformBrand: brand } = useAuth();
  const { data: config } = usePublicConfig();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const version = Number(params.get('version')) || undefined;
  const doc = useQuery({
    queryKey: ['legal', kind, version ?? 'current'],
    queryFn: () => api.public<LegalDocumentDTO>(`/public/legal/${kind}${version ? `?version=${version}` : ''}`),
    retry: false,
  });
  const title = LEGAL_DOCS[kind].title;
  useEffect(() => {
    document.title = `${title} · ${brand.appName}`;
  }, [title, brand.appName]);
  const published = config?.legal.documents ?? [];
  const logo = brand.logoUrl ? assetUrl(brand.logoUrl) : null;

  return (
    <div className="min-h-screen bg-subtle/40">
      <header className="z-10 border-b border-border bg-surface/90 backdrop-blur sm:sticky sm:top-0 print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            {logo ? <img src={logo} alt={brand.appName} className="h-7 max-w-40 object-contain" /> : <span>{brand.appName}</span>}
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {published.map((d) => (
              <Link
                key={d.kind}
                to={d.path}
                className={cx('rounded-ui px-3 py-1.5 hover:bg-subtle', d.kind === kind ? 'bg-subtle font-semibold text-fg' : 'text-muted')}
              >
                {LEGAL_DOCS[d.kind].short}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {doc.isLoading ? (
          <Loading />
        ) : !doc.data ? (
          <div className="gc-card gc-pad">
            <EmptyState icon={<FileText />} title={title} description="Este documento todavía no está publicado." action={<Link to="/"><Button variant="secondary" icon={<ArrowLeft className="size-4" />}>Volver al inicio</Button></Link>} />
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
              {doc.data.current ? (
                <p className="text-sm text-muted">Versión vigente desde el {formatDate(doc.data.publishedAt)}</p>
              ) : (
                <p className="rounded-ui bg-amber-100 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                  Versión anterior ({doc.data.version}).{' '}
                  <Link to={LEGAL_DOCS[kind].path} className="font-semibold underline">
                    Ver la vigente
                  </Link>
                </p>
              )}
              <div className="flex items-center gap-2">
                {doc.data.versions.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <History className="size-4" />
                    <Select
                      aria-label="Versiones"
                      className="w-auto"
                      value={doc.data.version}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        navigate(v === doc.data!.versions[0]!.version ? LEGAL_DOCS[kind].path : `${LEGAL_DOCS[kind].path}?version=${v}`);
                      }}
                    >
                      {doc.data.versions.map((v) => (
                        <option key={v.version} value={v.version}>
                          Versión {v.version} · {formatDate(v.publishedAt)}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                <Button variant="secondary" size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>
                  Imprimir
                </Button>
              </div>
            </div>
            <article className="gc-card px-6 py-8 sm:px-10 print:border-0 print:p-0 print:shadow-none">
              <Markdown source={doc.data.content} />
            </article>
          </>
        )}
        <LegalFooter className="mt-8 print:hidden" />
      </main>
    </div>
  );
}
