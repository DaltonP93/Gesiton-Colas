import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX2, Loader2, MapPin, Ticket, UserRound } from 'lucide-react';
import { useParams } from 'react-router';
import { APPOINTMENT_STATUS_LABELS, type PublicAppointmentDTO } from '@gc/shared';
import { Badge, Button, useFeedback } from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { Centered, Shell } from './BookingPage';

const STATUS_COLORS: Record<PublicAppointmentDTO['status'], string> = {
  booked: '#2563eb',
  confirmed: '#7c3aed',
  checked_in: '#d97706',
  completed: '#059669',
  cancelled: '#6b7280',
  no_show: '#dc2626',
};

/** Enlace del cliente: ver la cita, presentarse y cancelar. */
export default function AppointmentPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const { confirm } = useFeedback();
  const query = useQuery({ queryKey: ['appointment', token], queryFn: () => api.public<PublicAppointmentDTO>(`/public/appointments/${token}`), retry: false });
  const cancel = useMutation({
    mutationFn: () => api.public<PublicAppointmentDTO>(`/public/appointments/${token}/cancel`, {}),
    onSuccess: (data) => qc.setQueryData(['appointment', token], data),
  });
  const data = query.data;

  if (query.isLoading) return <Shell><Centered icon={<Loader2 className="size-10 animate-spin text-muted" />} title="Cargando…" /></Shell>;
  if (!data) {
    return (
      <Shell>
        <Centered icon={<CalendarX2 className="size-12 text-muted" />} title={query.error instanceof ApiError && query.error.status === 404 ? 'Cita no encontrada' : 'Sin conexión'} />
      </Shell>
    );
  }

  return (
    <Shell brand={{ name: data.organization.name, logoUrl: data.organization.logoUrl, color: data.organization.primaryColor }}>
      <AppointmentCard data={data} />
      {data.trackingUrl && (
        <a href={data.trackingUrl} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-fg shadow-lg">
          <Ticket className="size-5" /> Seguir mi turno
        </a>
      )}
      {data.canCancel && (
        <Button
          variant="secondary"
          className="h-12 w-full"
          loading={cancel.isPending}
          onClick={async () => {
            const ok = await confirm({ title: '¿Cancelar la cita?', message: 'Se libera el horario para otra persona.', confirmLabel: 'Cancelar la cita', danger: true });
            if (ok) cancel.mutate();
          }}
        >
          Cancelar la cita
        </Button>
      )}
      {cancel.isError && <p className="text-center text-sm text-red-600">{errorMessage(cancel.error)}</p>}
    </Shell>
  );
}

export function AppointmentCard({ data }: { data: PublicAppointmentDTO }) {
  return (
    <div className="rounded-3xl bg-surface p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted first-letter:uppercase">{data.date}</p>
          <p className="text-4xl font-black tracking-tight tabular-nums">{data.time}</p>
        </div>
        <Badge color={STATUS_COLORS[data.status]}>{APPOINTMENT_STATUS_LABELS[data.status]}</Badge>
      </div>
      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="text-muted">Servicio</dt>
          <dd className="font-semibold">{data.service}</dd>
        </div>
        {data.professional && (
          <div className="flex items-center gap-2">
            <UserRound className="size-4 text-muted" />
            <dd>{data.professional}</dd>
          </div>
        )}
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 text-muted" />
          <dd>
            {data.branch.name}
            {data.branch.address && <span className="block text-muted">{data.branch.address}</span>}
          </dd>
        </div>
      </dl>
      {['booked', 'confirmed'].includes(data.status) && (
        <div className="mt-5 rounded-2xl bg-subtle p-4 text-center">
          <p className="text-xs text-muted">Al llegar, preséntese en el kiosco con su documento o este código</p>
          <p className="mt-1 font-mono text-3xl font-extrabold tracking-[0.3em]">{data.code}</p>
        </div>
      )}
    </div>
  );
}
