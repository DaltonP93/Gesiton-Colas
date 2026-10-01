import { FileText } from 'lucide-react';
import { IssuerSettings } from '../../components/sifen/IssuerSettings';
import { PageHeader } from '../../components/ui';

/** Configuración → Factura electrónica: emisor, timbrado, certificado y CSC. */
export default function InvoicingSettingsPage() {
  return (
    <div>
      <PageHeader
        icon={<FileText />}
        title="Factura electrónica (SIFEN)"
        description="Datos de su RUC y timbrado, certificado digital y código de seguridad para emitir facturas electrónicas ante la SET."
      />
      <IssuerSettings base="/invoicing" scope="tenant" />
    </div>
  );
}
