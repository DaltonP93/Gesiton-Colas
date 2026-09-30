import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input, Select, useFeedback } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { Section, useSaveTenant } from './common';

const RETENTION_OPTIONS = [
  { days: 0, label: 'No borrar automáticamente' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 180, label: '6 meses' },
  { days: 365, label: '1 año' },
  { days: 730, label: '2 años' },
];

/** Plazo de conservación de datos personales y borrado a pedido del titular. */
export function PrivacySection() {
  const { settings, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const { toast, confirm } = useFeedback();
  const [retention, setRetention] = useState(settings.privacy.retentionDays);
  const [field, setField] = useState<'document' | 'phone' | 'email'>('document');
  const [value, setValue] = useState('');
  const erase = useMutation({ mutationFn: () => api.post<{ erased: number }>('/privacy/erase', { field, value: value.trim() }) });
  const customer = terms.customer.toLowerCase();

  async function onErase(e: FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: '¿Borrar los datos de esta persona?',
      message: `Se borran nombre, documento, teléfono, email y campos propios de todos sus ${terms.tickets.toLowerCase()}. Las estadísticas se conservan. No se puede deshacer.`,
      confirmLabel: 'Borrar datos',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await erase.mutateAsync();
      toast(res.erased ? `Se borraron los datos de ${res.erased} ${res.erased === 1 ? terms.ticket.toLowerCase() : terms.tickets.toLowerCase()}.` : 'No se encontraron datos con ese valor.');
      setValue('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const presets = RETENTION_OPTIONS.some((o) => o.days === retention) ? RETENTION_OPTIONS : [...RETENTION_OPTIONS, { days: retention, label: `${retention} días` }];

  return (
    <Section title="Privacidad y protección de datos" description={`Cuánto tiempo se guardan los datos personales del ${customer} y cómo borrarlos si la persona lo pide.`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Borrar datos personales después de" hint="Pasado ese plazo se borran nombre, documento, teléfono, email y campos propios. Los tiempos y cantidades quedan para los reportes.">
            <Select value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
              {presets.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            icon={<ShieldCheck className="size-4" />}
            loading={saving}
            disabled={retention === settings.privacy.retentionDays}
            onClick={() => void save({ settings: { privacy: { retentionDays: retention } } }, 'Plazo de conservación guardado')}
          >
            Guardar plazo
          </Button>
        </div>
        <form onSubmit={onErase} className="space-y-3 rounded-ui border border-border p-4">
          <p className="text-sm font-medium">Borrar los datos de una persona</p>
          <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
            <Select aria-label="Buscar por" value={field} onChange={(e) => setField(e.target.value as typeof field)}>
              <option value="document">Documento</option>
              <option value="phone">Teléfono</option>
              <option value="email">Email</option>
            </Select>
            <Input aria-label="Valor" value={value} onChange={(e) => setValue(e.target.value)} placeholder={field === 'email' ? 'persona@correo.com' : field === 'phone' ? '0981 123 456' : '1.234.567'} />
          </div>
          <Button type="submit" variant="danger" icon={<Trash2 className="size-4" />} loading={erase.isPending} disabled={value.trim().length < 3}>
            Borrar datos
          </Button>
        </form>
      </div>
    </Section>
  );
}
