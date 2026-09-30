import { ImagePlus, Link2, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import type { MediaDTO } from '@gc/shared';
import { assetUrl, errorMessage, upload } from '../lib/api';
import { Button, Input, cx, useFeedback } from './ui';

/* ------------------------------------------------------------------ */
/* Imagen (logo, favicon, fondos, íconos)                              */
/* ------------------------------------------------------------------ */

const IMAGE_TYPES = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif';

/**
 * Selector de imagen: vista previa grande (se hace clic o se arrastra un archivo),
 * botones debajo y la dirección web opcional. Se adapta a columnas angostas sin superponerse.
 */
export function ImageField({
  label,
  hint,
  value,
  onChange,
  uploadName,
  square,
  compact,
  uploadPath = '/media/upload',
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  uploadName: string;
  /** Vista previa cuadrada (favicon, íconos). */
  square?: boolean;
  /** Vista previa más baja (listas con varias imágenes). */
  compact?: boolean;
  /** Dónde se sube el archivo (la plataforma usa su propio almacenamiento). */
  uploadPath?: string;
}) {
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const urlId = useId();
  const [progress, setProgress] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const [dragging, setDragging] = useState(false);
  const external = Boolean(value && !value.startsWith('/uploads/'));
  const [showUrl, setShowUrl] = useState(external);
  useEffect(() => setBroken(false), [value]);

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Seleccione una imagen (PNG, JPG, SVG, WebP o GIF)', 'error');
      return;
    }
    setProgress(0);
    try {
      const media = await upload<Pick<MediaDTO, 'url'>>(uploadPath, file, { name: uploadName, tags: 'branding' }, setProgress);
      onChange(media.url);
      toast('Imagen subida. Guarde los cambios para aplicarla.', 'info');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onFile(file);
  };

  const src = value ? assetUrl(value) : '';
  const busy = progress !== null;
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-label={src ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`}
        className={cx(
          'group relative grid w-full place-items-center overflow-hidden rounded-ui border-2 border-dashed transition',
          square ? 'aspect-square max-w-36' : compact ? 'h-24' : 'h-32',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        )}
        style={
          src && !broken
            ? { backgroundImage: 'repeating-conic-gradient(var(--gc-subtle) 0% 25%, transparent 0% 50%)', backgroundSize: '14px 14px' }
            : undefined
        }
      >
        {src && !broken ? (
          <>
            <img src={src} alt={`${label} actual`} className="absolute inset-0 size-full object-contain p-2" onError={() => setBroken(true)} />
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              Cambiar imagen
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-3 text-center text-xs text-muted">
            <ImagePlus className={cx('size-6', broken ? 'text-red-500' : 'text-muted')} aria-hidden />
            {busy ? `Subiendo ${Math.round((progress ?? 0) * 100)} %` : broken ? 'No se pudo cargar la imagen' : 'Haga clic o arrastre una imagen'}
          </span>
        )}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>
          {busy ? `${Math.round((progress ?? 0) * 100)} %` : value ? 'Cambiar' : 'Subir'}
        </Button>
        <Button size="sm" variant="ghost" icon={<Link2 className="size-4" />} aria-expanded={showUrl} aria-controls={urlId} onClick={() => setShowUrl((v) => !v)}>
          Dirección web
        </Button>
        {value && (
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onChange(null)}>
            Quitar
          </Button>
        )}
      </div>
      {showUrl && (
        <Input
          id={urlId}
          aria-label={`Dirección web de ${label.toLowerCase()}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://…"
          className="text-xs"
        />
      )}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      {broken ? <p className="text-xs text-red-600">No se pudo cargar la imagen. Revise la dirección.</p> : hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
