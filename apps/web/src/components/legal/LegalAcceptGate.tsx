import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FileCheck2, LogOut } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Checkbox } from '../ui';

/**
 * Nueva versión de los términos o del acuerdo de tratamiento de datos: el administrador la acepta
 * en nombre de la organización antes de seguir. Los operadores siguen atendiendo mientras tanto.
 */
export function LegalAcceptGate() {
  const { me, refresh, logout, platformBrand } = useAuth();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = me?.legal ?? [];
  const accept = useMutation({
    mutationFn: () => api.post('/legal/accept', { documents: pending.map((d) => ({ kind: d.kind, version: d.version })) }),
    onSuccess: () => refresh(),
    onError: async (err) => {
      setError(errorMessage(err));
      // Se publicó otra versión mientras tanto: se muestra la nueva.
      if (err instanceof ApiError && err.status === 409) {
        setChecked(false);
        await refresh();
      }
    },
  });
  if (!me?.tenant || me.user.role !== 'admin' || !pending.length) return null;
  const several = pending.length > 1;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
      <div className="gc-fade-in w-full max-w-lg rounded-ui bg-surface p-6 text-fg shadow-2xl">
        <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
          <FileCheck2 className="size-6" />
        </span>
        <h2 id="legal-gate-title" className="mt-4 text-lg font-semibold">
          {several ? 'Actualizamos los documentos del servicio' : `Actualizamos ${pending[0]!.kind === 'terms' ? 'los términos del servicio' : 'el acuerdo de tratamiento de datos'}`}
        </h2>
        <p className="mt-1 text-sm text-muted">Para seguir administrando «{me.tenant.name}», revise y acepte en nombre de la organización:</p>
        <ul className="mt-4 space-y-2">
          {pending.map((d) => (
            <li key={d.kind} className="rounded-ui border border-border px-3 py-2 text-sm">
              <a href={d.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                {d.title} <ExternalLink className="size-3.5" />
              </a>
              <span className="block text-xs text-muted">
                Versión {d.version}
                {d.note ? ` · ${d.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Checkbox checked={checked} onChange={setChecked} label={`Leí y acepto ${several ? 'estos documentos' : 'este documento'} en nombre de ${me.tenant.name}.`} />
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={logout}>
            Salir
          </Button>
          <Button disabled={!checked} loading={accept.isPending} onClick={() => accept.mutate()}>
            Aceptar y continuar
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted">
          Mientras tanto, los operadores pueden seguir atendiendo.
          {platformBrand.supportEmail && (
            <>
              {' '}
              ¿Dudas? Escriba a{' '}
              <a href={`mailto:${platformBrand.supportEmail}`} className="font-medium text-primary hover:underline">
                {platformBrand.supportEmail}
              </a>
              .
            </>
          )}
        </p>
      </div>
    </div>,
    document.body,
  );
}
