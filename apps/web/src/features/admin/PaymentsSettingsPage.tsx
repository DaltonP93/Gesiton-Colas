import { CreditCard, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { CURRENCIES, type TenantPaymentSettings } from '@gc/shared';
import { GatewayForm } from '../../components/GatewayForm';
import { Field, PageHeader, Select, Toggle } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { Callout, SaveBar, Section, sameJson, useSaveTenant } from './customization/common';

/** Configuración → Cobros y pagos (módulo «Pagos»). */
export default function PaymentsSettingsPage() {
  const { settings, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const [form, setForm] = useState<TenantPaymentSettings>(settings.payments);
  const dirty = !sameJson(form, settings.payments);

  return (
    <div className="space-y-[var(--gc-gap)]">
      <PageHeader
        icon={<CreditCard />}
        title="Cobros y pagos"
        description={`Cobre los ${terms.services.toLowerCase()} con precio: en línea desde el celular del ${terms.customer.toLowerCase()} o en el puesto de atención.`}
      />

      <Callout icon={<Tag />}>
        <p>
          El precio se define en cada servicio (
          <Link to="/app/configuracion/servicios" className="font-medium text-primary-text underline-offset-2 hover:underline">
            {terms.services}
          </Link>
          ). Los {terms.services.toLowerCase()} sin precio no se cobran. El operador ve si el {terms.ticket.toLowerCase()} está pagado y puede registrar el cobro en efectivo, POS o transferencia.
        </p>
      </Callout>

      <Section title="Opciones">
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Moneda">
            <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as TenantPaymentSettings['currency'] }))}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Toggle
            checked={form.online}
            onChange={(online) => setForm((f) => ({ ...f, online }))}
            label="Pago en línea en el seguimiento"
            hint={`El ${terms.customer.toLowerCase()} ve el importe y un botón «Pagar en línea» al seguir su ${terms.ticket.toLowerCase()}.`}
          />
          <Toggle checked={form.showPriceOnKiosk} onChange={(showPriceOnKiosk) => setForm((f) => ({ ...f, showPriceOnKiosk }))} label="Mostrar precios en el kiosco" />
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={saving} onDiscard={() => setForm(settings.payments)} onSave={() => void save({ settings: { payments: form } }, 'Cobros guardados')} />

      <div>
        <h2 className="mb-1 text-lg font-semibold">Pasarela de pagos en línea</h2>
        <p className="mb-4 text-sm text-muted">Los pagos se acreditan directamente en su cuenta de la pasarela.</p>
        <GatewayForm scope="tenant" currency={settings.payments.currency} />
      </div>
    </div>
  );
}
