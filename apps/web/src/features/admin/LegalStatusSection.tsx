import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock3, ExternalLink, FileCheck2 } from 'lucide-react';
import { LEGAL_DOCS, formatLegalDate, type LegalStatusDTO } from '@gc/shared';
import { Badge, EmptyState, Loading, PageHeader, Table } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

/** Configuración → Términos y contrato: qué documentos aceptó la organización y cuándo. */
export default function LegalStatusSection() {
  const status = useQuery({ queryKey: ['legal', 'status'], queryFn: () => api.get<LegalStatusDTO>('/legal/status') });
  return (
    <div>
      <PageHeader
        icon={<FileCheck2 />}
        title="Términos y contrato"
        description="Los términos del servicio, el acuerdo de tratamiento de datos y la política de privacidad vigentes, con la constancia de quién los aceptó en nombre de la organización."
      />
      {status.isLoading ? (
        <Loading />
      ) : status.isError || !status.data ? (
        <p className="text-sm text-red-600">{errorMessage(status.error)}</p>
      ) : !status.data.documents.length ? (
        <div className="gc-card gc-pad">
          <EmptyState icon={<FileCheck2 />} title="Todavía no hay documentos publicados" description="Cuando la plataforma publique sus términos del servicio aparecerán aquí." />
        </div>
      ) : (
        <div className="gc-card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <th className="w-full">Documento</th>
                <th>Versión vigente</th>
                <th>Aceptación</th>
              </tr>
            </thead>
            <tbody>
              {status.data.documents.map((d) => (
                <tr key={d.kind}>
                  <td>
                    <a href={d.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                      {d.title} <ExternalLink className="size-3.5" />
                    </a>
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {d.version} · {formatLegalDate(d.publishedAt)}
                  </td>
                  <td className="min-w-56">
                    {!LEGAL_DOCS[d.kind].accept ? (
                      <span className="text-xs text-muted">Informativa (no requiere aceptación)</span>
                    ) : d.pending ? (
                      <Badge color="#d97706">
                        <Clock3 className="mr-1 inline size-3" />
                        Falta aceptar la versión {d.version}
                      </Badge>
                    ) : d.accepted ? (
                      <span className="text-sm">
                        <CheckCircle2 className="mr-1 inline size-4 text-emerald-600" />
                        Versión {d.accepted.version}, por {d.accepted.userName}, el {formatLegalDate(d.accepted.acceptedAt)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Sin aceptación registrada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
