import { ImageOff, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaDTO } from '@gc/shared';
import { assetUrl, errorMessage, upload } from '../lib/api';
import { Button, Input, cx, useFeedback } from './ui';

/* ------------------------------------------------------------------ */
/* Imagen (logo, favicon, fondos)                                      */
/* ------------------------------------------------------------------ */

const IMAGE_TYPES = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif';

export function ImageField({
  label,
  hint,
  value,
  onChange,
  uploadName,
  square,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  uploadName: string;
  square?: boolean;
}) {
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [value]);

  const onFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Seleccione una imagen (PNG, JPG, SVG, WebP o GIF)', 'error');
      return;
    }
    setProgress(0);
    try {
      const media = await upload<MediaDTO>('/media/upload', file, { name: uploadName, tags: 'branding' }, setProgress);
      onChange(media.url);
      toast('Imagen subida. Guarde los cambios para aplicarla.', 'info');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const src = value ? assetUrl(value) : '';
  const inputId = `img-${uploadName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-3">
        <div
          className={cx('grid shrink-0 place-items-center overflow-hidden rounded-ui border border-border', square ? 'size-20' : 'h-20 w-28')}
          style={{ backgroundImage: 'repeating-conic-gradient(var(--gc-subtle) 0% 25%, transparent 0% 50%)', backgroundSize: '14px 14px' }}
        >
          {src && !broken ? (
            <img src={src} alt={`${label} actual`} className="max-h-full max-w-full object-contain p-1.5" onError={() => setBroken(true)} />
          ) : (
            <ImageOff className={cx('size-6', broken ? 'text-red-500' : 'text-muted')} aria-label={broken ? 'No se pudo cargar la imagen' : 'Sin imagen'} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Input id={inputId} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} placeholder="https://… o suba un archivo" className="text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} loading={progress !== null} onClick={() => input.current?.click()}>
              {progress !== null ? `Subiendo ${Math.round(progress * 100)} %` : 'Subir imagen'}
            </Button>
            {value && (
              <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onChange(null)}>
                Quitar
              </Button>
            )}
          </div>
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
        </div>
      </div>
      {broken && <p className="text-xs text-red-600">No se pudo cargar la imagen. Revise la dirección.</p>}
      {hint && !broken && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

