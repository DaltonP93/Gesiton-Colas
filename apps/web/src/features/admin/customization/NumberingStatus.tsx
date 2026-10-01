import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { NumberingStatusDTO } from '@gc/shared';
import { Button, Select, Table, useFeedback } from '../../../components/ui';
import { api, errorMessage } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useBranches } from '../../../lib/queries';
import { Section } from './common';

/** Último número emitido en el período actual, próximo número y reinicio manual. */
export function NumberingStatus() {
  const { terms } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  const status = useQuery({
    queryKey: ['numbering', branchId],
    queryFn: () => api.get<NumberingStatusDTO>(`/numbering${branchId ? `?branchId=${branchId}` : ''}`),
    refetchInterval: 30_000,
  });

  const reset = useMutation({
    mutationFn: () => api.post<{ reset: number }>('/numbering/reset', branchId ? { branchId } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['numbering'] }),
  });

  async function onReset() {
    const where = branchId ? `de ${branches.data?.find((b) => b.id === branchId)?.name}` : `de todas las ${terms.branches.toLowerCase()}`;
    const ok = await confirm({
      title: '¿Reiniciar la numeración?',
      message: `El próximo ${terms.ticket.toLowerCase()} ${where} vuelve al número inicial. Los ${terms.tickets.toLowerCase()} en espera no se cancelan (para eso use «Cerrar jornada» en el Monitor).`,
      confirmLabel: 'Reiniciar',
      danger: true,
    });
    if (!ok) return;
    try {
      await reset.mutateAsync();
      toast('Numeración reiniciada');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const rows = status.data?.rows ?? [];
  return (
    <Section title="Numeración de hoy" description={`Último ${terms.ticket.toLowerCase()} emitido y el próximo, por ${terms.branch.toLowerCase()} y ${terms.service.toLowerCase()}. Período actual: ${status.data?.period ?? '…'}.`}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 space-y-1.5 sm:flex-none">
          <span className="block text-sm font-medium">{terms.branch}</span>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Todas</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="secondary" icon={<RotateCcw className="size-4" />} loading={reset.isPending} onClick={() => void onReset()}>
          Reiniciar numeración ahora
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{status.isLoading ? 'Cargando…' : `No hay ${terms.services.toLowerCase()} habilitados.`}</p>
      ) : (
        <div className="-mx-[var(--gc-pad)]">
          <Table>
            <thead>
              <tr>
                <th>{terms.branch}</th>
                <th>{terms.service}</th>
                <th className="text-right">Emitidos</th>
                <th>Último</th>
                <th>Próximo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.branchId}-${r.scopeKey}`}>
                  <td>{r.branchName}</td>
                  <td>{r.label}</td>
                  <td className="text-right tabular-nums">{r.issued}</td>
                  <td className="font-mono font-semibold">{r.lastCode ?? '—'}</td>
                  <td className="font-mono font-semibold text-primary-text">{r.nextCode}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Section>
  );
}
