import { FileText, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentsList } from '../../components/sifen/DocumentsList';
import { IssuerSettings } from '../../components/sifen/IssuerSettings';
import { Tabs } from '../../components/ui';

/** Plataforma → Factura electrónica: las facturas SIFEN de los planes y el emisor de la plataforma. */
export function SifenTab() {
  const [tab, setTab] = useState<'documentos' | 'emisor'>('documentos');
  return (
    <div className="space-y-5">
      <Tabs<'documentos' | 'emisor'>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'documentos', label: 'Facturas emitidas', icon: <FileText className="size-4" /> },
          { value: 'emisor', label: 'Emisor, timbrado y certificado', icon: <Settings2 className="size-4" /> },
        ]}
      />
      {tab === 'documentos' ? <DocumentsList base="/platform/invoicing" /> : <IssuerSettings base="/platform/invoicing" scope="platform" />}
    </div>
  );
}
