import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, MonitorPlay, Plus, Tablet } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { DisplayDTO, KioskDTO } from '@gc/shared';
import { Button, Card, Field, Input, PageHeader, Select, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useBranches, useDisplays, useKiosks } from '../../lib/queries';

type Target = 'display' | 'kiosk';

/** Vincula el dispositivo que muestra un código (en /vincular) con una pantalla o un kiosco. */
export default function PairDevicePage() {
  const [params] = useSearchParams();
  const { terms } = useAuth();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const displays = useDisplays();
  const kiosks = useKiosks();
  const branches = useBranches();
  const [code, setCode] = useState(params.get('code')?.replace(/\D/g, '').slice(0, 6) ?? '');
  const [type, setType] = useState<Target>('display');
  const [targetId, setTargetId] = useState('');
  const [newName, setNewName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const list: (DisplayDTO | KioskDTO)[] = (type === 'display' ? displays.data : kiosks.data) ?? [];
  useEffect(() => {
    setTargetId(list[0]?.id ?? 'new');
  }, [type, list.length]);
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data[0].id);
  }, [branches.data, branchId]);

  const claim = useMutation({
    mutationFn: async () => {
      let id = targetId;
      if (id === 'new') {
        const created = await api.post<DisplayDTO | KioskDTO>(type === 'display' ? '/displays' : '/kiosks', {
          name: newName || (type === 'display' ? 'Nueva pantalla' : 'Nuevo kiosco'),
          branchId,
        });
        id = created.id;
        void qc.invalidateQueries({ queryKey: [type === 'display' ? 'displays' : 'kiosks'] });
      }
      return api.post<{ ok: boolean; name: string }>('/pairings/claim', { code, type, targetId: id });
    },
    onSuccess: (res) => {
      setDone(res.name);
      setCode('');
      toast(`Dispositivo vinculado a «${res.name}»`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    claim.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Vincular dispositivo"
        description={
          <>
            En la TV, tablet o tótem abra <strong className="text-fg">{window.location.host}/vincular</strong>: aparecerá un código de 6 dígitos. Escríbalo aquí y elija qué será ese equipo.
          </>
        }
      />
      {done && (
        <div className="mb-6 flex items-center gap-3 rounded-ui border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          <CheckCircle2 className="size-5 text-emerald-600" />
          <span>
            ¡Listo! El dispositivo ya muestra <strong>{done}</strong>. Puede vincular otro con un código nuevo.
          </span>
        </div>
      )}
      <Card>
        <form onSubmit={submit} className="space-y-6">
          <Field label="Código que muestra el dispositivo">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="h-16 text-center font-mono text-3xl tracking-[0.4em]"
              autoFocus
            />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">¿Qué será este equipo?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { value: 'display', label: 'Panel TV', hint: 'Llamados, voz y publicidad', icon: <MonitorPlay /> },
                  { value: 'kiosk', label: 'Kiosco / triage', hint: `Emisión de ${terms.tickets.toLowerCase()}`, icon: <Tablet /> },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setType(o.value)}
                  className={cx(
                    'flex items-center gap-3 rounded-ui border-2 p-4 text-left transition [&_svg]:size-6',
                    type === o.value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-subtle',
                  )}
                >
                  {o.icon}
                  <span>
                    <span className="block font-semibold text-fg">{o.label}</span>
                    <span className="block text-xs text-muted">{o.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Field label={type === 'display' ? 'Pantalla' : 'Kiosco'}>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {list.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {branches.data?.find((b) => b.id === item.branchId)?.name}
                </option>
              ))}
              <option value="new">+ Crear {type === 'display' ? 'una pantalla nueva' : 'un kiosco nuevo'}</option>
            </Select>
          </Field>
          {targetId === 'new' && (
            <div className="grid gap-4 rounded-ui bg-subtle p-4 sm:grid-cols-2">
              <Field label="Nombre">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={type === 'display' ? 'Ej.: TV sala de espera' : 'Ej.: Tótem entrada'} />
              </Field>
              <Field label={terms.branch}>
                <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" icon={targetId === 'new' ? <Plus className="size-5" /> : <Link2 className="size-5" />} loading={claim.isPending} disabled={code.length !== 6 || !targetId}>
            Vincular dispositivo
          </Button>
        </form>
      </Card>
    </div>
  );
}
