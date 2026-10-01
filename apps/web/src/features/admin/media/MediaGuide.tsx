import { CircleHelp, Copy, Link2, UploadCloud } from 'lucide-react';
import { MEDIA_GUIDES, type MediaGuide } from '@gc/shared';
import { Button, Modal, cx, useFeedback } from '../../../components/ui';

/** Plataformas y formatos compatibles: cada uno abre su guía. */
export function GuideChips({ onOpen, active, className }: { onOpen: (guide: MediaGuide) => void; active?: string; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {MEDIA_GUIDES.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => onOpen(g)}
          title={`Cómo agregar contenido de ${g.label}`}
          className={cx(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition',
            active === g.id ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:border-primary/50 hover:bg-primary/5',
          )}
        >
          {g.label}
          <CircleHelp className="size-3 opacity-60" />
        </button>
      ))}
    </div>
  );
}

/** Pasos, ejemplos y recomendaciones de una plataforma. */
export function GuideContent({ guide, compact = false }: { guide: MediaGuide; compact?: boolean }) {
  const { toast } = useFeedback();
  return (
    <div className="space-y-4 text-sm">
      {!compact && <p className="text-muted">{guide.summary}</p>}
      <div>
        <p className="mb-1.5 font-semibold">{guide.via === 'upload' ? 'Cómo agregarlo' : 'Cómo obtener el enlace'}</p>
        <ol className="list-decimal space-y-1 pl-5">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      {guide.examples.length > 0 && (
        <div>
          <p className="mb-1.5 font-semibold">{guide.examples.length > 1 ? 'Enlaces que sirven' : 'Ejemplo'}</p>
          <ul className="space-y-1">
            {guide.examples.map((ex) => (
              <li key={ex} className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-subtle px-2 py-1 text-xs">{ex}</code>
                {!compact && (
                  <button type="button" className="text-muted hover:text-fg" aria-label="Copiar" onClick={() => void navigator.clipboard?.writeText(ex).then(() => toast('Ejemplo copiado'))}>
                    <Copy className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {guide.notes.length > 0 && (
        <div className="rounded-ui bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="mb-1 font-semibold">Para que se vea en la pantalla</p>
          <ul className="list-disc space-y-1 pl-5">
            {guide.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function GuideModal({ guide, onClose, onUrl, onUpload }: { guide: MediaGuide | null; onClose: () => void; onUrl: (g: MediaGuide) => void; onUpload: () => void }) {
  if (!guide) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={guide.label}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          {guide.via !== 'url' && (
            <Button variant={guide.via === 'upload' || guide.via === 'both' ? 'primary' : 'secondary'} icon={<UploadCloud className="size-4" />} onClick={onUpload}>
              Subir archivos
            </Button>
          )}
          {guide.via !== 'upload' && (
            <Button variant={guide.via === 'url' ? 'primary' : 'secondary'} icon={<Link2 className="size-4" />} onClick={() => onUrl(guide)}>
              Pegar el enlace
            </Button>
          )}
        </>
      }
    >
      <GuideContent guide={guide} />
    </Modal>
  );
}
