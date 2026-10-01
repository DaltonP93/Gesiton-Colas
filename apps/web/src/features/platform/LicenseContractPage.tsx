import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LEGAL_TEMPLATES, LICENSE_VARIABLES, formatLegalDate, legalVars, renderLegal, type LegalAdminDTO, type LicenseVariable } from '@gc/shared';
import { Markdown } from '../../components/Markdown';
import { Button, Field, Input, Loading, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

const LONG: LicenseVariable[] = ['modulos', 'alcance', 'precio', 'mantenimiento', 'instalacion'];
const BLANK = '______________________';

/** Contrato de licencia para instalación propia: se completa, se imprime (o se guarda en PDF) y se firma. */
export default function LicenseContractPage() {
  const admin = useQuery({ queryKey: ['platform', 'legal'], queryFn: () => api.get<LegalAdminDTO>('/platform/legal') });
  const [values, setValues] = useState<Partial<Record<LicenseVariable, string>>>({});
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const text = useMemo(() => {
    if (!admin.data) return '';
    const vars = {
      ...legalVars(admin.data.settings.holder, { appName: admin.data.appName, publicUrl: admin.data.publicUrl }),
      ...Object.fromEntries(LICENSE_VARIABLES.map((v) => [v.key, values[v.key] ?? ''])),
      fecha: formatLegalDate(`${date}T12:00:00`),
    };
    return renderLegal(LEGAL_TEMPLATES.license, vars, BLANK).text;
  }, [admin.data, values, date]);

  if (admin.isLoading) return <Loading />;
  if (admin.isError || !admin.data) return <p className="p-6 text-sm text-red-600">{errorMessage(admin.error)}</p>;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/plataforma#legal" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Volver a Legal
          </Link>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Imprimir o guardar en PDF
          </Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[22rem_minmax(0,1fr)] print:block print:p-0">
        <aside className="space-y-4 print:hidden">
          <div>
            <h1 className="text-xl font-bold">Contrato de licencia</h1>
            <p className="mt-1 text-sm text-muted">Instalación en los servidores del cliente. Complete los datos del licenciatario: lo que quede vacío sale como línea para completar a mano.</p>
          </div>
          {admin.data.missing.length > 0 && (
            <p className="rounded-ui bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Faltan datos del titular ({admin.data.missing.join(', ')}). <Link to="/plataforma#legal" className="font-semibold underline">Complételos en Legal</Link>.
            </p>
          )}
          <Field label="Fecha de firma">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          {LICENSE_VARIABLES.map((v) => (
            <Field key={v.key} label={v.label}>
              {LONG.includes(v.key) ? (
                <Textarea rows={2} value={values[v.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))} />
              ) : (
                <Input value={values[v.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))} />
              )}
            </Field>
          ))}
          <p className="text-xs text-muted">Los datos del licenciatario no se guardan en el sistema. Revise el contrato con un abogado antes de firmarlo.</p>
        </aside>
        <article className="gc-card min-w-0 px-6 py-8 sm:px-10 print:border-0 print:p-0 print:shadow-none">
          <Markdown source={text} />
        </article>
      </main>
    </div>
  );
}
