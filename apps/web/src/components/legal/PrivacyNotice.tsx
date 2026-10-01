import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { PrivacyNoticeDTO } from '@gc/shared';
import { Modal, cx } from '../ui';

/**
 * Aviso de privacidad de la organización para sus clientes (reserva en línea, kiosco, fila virtual y encuestas).
 * Muestra una línea con un enlace que abre el texto completo.
 */
export function PrivacyNotice({
  notice,
  organization,
  label = 'Aviso de privacidad',
  intro,
  className,
}: {
  notice: PrivacyNoticeDTO | null | undefined;
  organization: string;
  label?: string;
  /** Frase antes del enlace (por ejemplo «Al confirmar, sus datos se tratan según el»). */
  intro?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!notice) return null;
  return (
    <>
      <p className={cx('flex flex-wrap items-center justify-center gap-1 text-center text-xs opacity-75', className)}>
        <ShieldCheck className="size-3.5 shrink-0" />
        {intro && <span>{intro}</span>}
        <button type="button" onClick={() => setOpen(true)} className="font-semibold underline underline-offset-2">
          {label}
        </button>
      </p>
      <Modal open={open} onClose={() => setOpen(false)} title={label} description={organization} size="sm">
        <p className="text-sm leading-relaxed whitespace-pre-line">{notice.text}</p>
        {notice.url && (
          <a href={notice.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            Ver la política completa <ExternalLink className="size-3.5" />
          </a>
        )}
      </Modal>
    </>
  );
}
