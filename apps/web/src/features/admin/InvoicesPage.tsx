import { FileText } from 'lucide-react';
import { fromMinor } from '@gc/shared';
import { DocumentsList } from '../../components/sifen/DocumentsList';
import { PageHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useServices } from '../../lib/queries';

/** Facturas electrónicas de la organización (módulo «Factura electrónica SIFEN»). */
export default function InvoicesPage() {
  const { can, settings } = useAuth();
  const services = useServices();
  const currency = settings.payments.currency;
  const catalog = (services.data ?? []).filter((s) => s.price).map((s) => ({ name: s.name, price: fromMinor(s.price ?? 0, currency) }));
  return (
    <div className="space-y-6">
      <PageHeader icon={<FileText />} title="Facturas electrónicas" description="Facturas firmadas y enviadas a la SET (SIFEN), con su CDC, su estado y el KuDE para imprimir o enviar al cliente." />
      <DocumentsList base="/invoicing" catalog={catalog} canCancel={can('manager')} />
    </div>
  );
}
