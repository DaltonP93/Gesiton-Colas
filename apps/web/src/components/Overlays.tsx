import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { OVERLAY_POSITIONS, type Overlay, type OverlayPosition } from '@gc/shared';
import { assetUrl } from '../lib/api';
import { ImageField } from './ImageField';
import { Button, IconButton, RangeInput, Toggle, cx } from './ui';

/* ------------------------------------------------------------------ */
/* Capa de imágenes (logos, íconos, sellos) sobre la TV o el kiosco      */
/* ------------------------------------------------------------------ */

function placement(position: OverlayPosition, margin: number): CSSProperties {
  const [v, h] = position === 'center' ? ['middle', 'center'] : position.split('-');
  const m = `${margin}%`;
  const style: CSSProperties = {};
  const translate: string[] = [];
  if (v === 'top') style.top = m;
  else if (v === 'bottom') style.bottom = m;
  else {
    style.top = '50%';
    translate.push('translateY(-50%)');
  }
  if (h === 'left') style.left = m;
  else if (h === 'right') style.right = m;
  else {
    style.left = '50%';
    translate.push('translateX(-50%)');
  }
  if (translate.length) style.transform = translate.join(' ');
  return style;
}

/**
 * Dibuja las imágenes configuradas en su posición. No intercepta toques ni clics:
 * el kiosco sigue funcionando aunque un logo quede encima de un botón.
 */
export function OverlayLayer({ overlays, layer, fixed }: { overlays: Overlay[]; layer: 'front' | 'back'; fixed?: boolean }) {
  const list = overlays.filter((o) => o.url && (layer === 'front' ? o.front : !o.front));
  if (!list.length) return null;
  return (
    <div aria-hidden className={cx('pointer-events-none inset-0 overflow-hidden', fixed ? 'fixed' : 'absolute', layer === 'front' ? 'z-30' : 'z-0')}>
      {list.map((o) => (
        <img
          key={o.id}
          src={assetUrl(o.url)}
          alt=""
          className="absolute h-auto object-contain"
          style={{ ...placement(o.position, o.margin), width: `${o.size}%`, opacity: o.opacity }}
        />
      ))}
    </div>
  );
}

const POSITION_LABELS: Record<OverlayPosition, string> = {
  'top-left': 'Arriba a la izquierda',
  'top-center': 'Arriba al centro',
  'top-right': 'Arriba a la derecha',
  'middle-left': 'Al medio a la izquierda',
  center: 'En el centro',
  'middle-right': 'Al medio a la derecha',
  'bottom-left': 'Abajo a la izquierda',
  'bottom-center': 'Abajo al centro',
  'bottom-right': 'Abajo a la derecha',
};

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Editor de las imágenes superpuestas: cada una con su posición (grilla de 3 × 3),
 * tamaño, transparencia y si va delante o detrás del contenido.
 */
export function OverlaysEditor({
  value,
  onChange,
  aspect = '16 / 9',
  max = 12,
}: {
  value: Overlay[];
  onChange: (value: Overlay[]) => void;
  /** Proporción de la pantalla para la vista previa (16 / 9 TV, 9 / 16 kiosco vertical). */
  aspect?: string;
  max?: number;
}) {
  const update = (id: string, patch: Partial<Overlay>) => onChange(value.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const move = (index: number, delta: number) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };
  const add = () =>
    onChange([...value, { id: newId(), url: '', position: value.length ? 'top-left' : 'top-right', size: 12, opacity: 1, margin: 2, front: true }]);

  return (
    <div className="space-y-4">
      {value.length > 0 && (
        <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_13rem]">
          <ul className="space-y-3">
            {value.map((o, i) => (
              <li key={o.id} className="rounded-ui border border-border p-3">
                <div className="grid gap-4 @xl:grid-cols-[11rem_minmax(0,1fr)]">
                  <ImageField label={`Imagen ${i + 1}`} value={o.url || null} onChange={(url) => update(o.id, { url: url ?? '' })} uploadName="Imagen en pantalla" compact />
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="mb-1.5 text-sm font-medium">Ubicación</p>
                      <div role="radiogroup" aria-label={`Ubicación de la imagen ${i + 1}`} className="grid w-fit grid-cols-3 gap-1 rounded-ui bg-subtle p-1">
                        {OVERLAY_POSITIONS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={o.position === p}
                            aria-label={POSITION_LABELS[p]}
                            title={POSITION_LABELS[p]}
                            onClick={() => update(o.id, { position: p })}
                            className={cx(
                              'grid size-8 place-items-center rounded-[calc(var(--gc-radius)*0.5)] transition',
                              o.position === p ? 'bg-primary text-primary-fg shadow-sm' : 'bg-surface hover:bg-primary/10',
                            )}
                          >
                            <span className={cx('size-2 rounded-full', o.position === p ? 'bg-current' : 'bg-fg/30')} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 @lg:grid-cols-3">
                      <RangeInput label="Tamaño" min={2} max={60} value={o.size} onChange={(size) => update(o.id, { size })} format={(v) => `${v} %`} />
                      <RangeInput label="Opacidad" min={0.1} max={1} step={0.05} value={o.opacity} onChange={(opacity) => update(o.id, { opacity })} format={(v) => `${Math.round(v * 100)} %`} />
                      <RangeInput label="Margen" min={0} max={15} step={0.5} value={o.margin} onChange={(margin) => update(o.id, { margin })} format={(v) => `${v} %`} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Toggle checked={o.front} onChange={(front) => update(o.id, { front })} label={o.front ? 'Delante del contenido' : 'Detrás del contenido'} />
                      <div className="flex gap-1">
                        <IconButton label="Subir" icon={<ArrowUp className="size-4" />} disabled={i === 0} onClick={() => move(i, -1)} />
                        <IconButton label="Bajar" icon={<ArrowDown className="size-4" />} disabled={i === value.length - 1} onClick={() => move(i, 1)} />
                        <IconButton label="Quitar imagen" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => onChange(value.filter((x) => x.id !== o.id))} />
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="@3xl:sticky @3xl:top-4">
            <p className="mb-1.5 text-xs font-medium text-muted">Vista previa de la ubicación</p>
            <div className="relative w-full overflow-hidden rounded-ui border border-border bg-gradient-to-br from-slate-700 to-slate-900" style={{ aspectRatio: aspect }}>
              <OverlayLayer overlays={value.map((o) => ({ ...o, front: true }))} layer="front" />
            </div>
          </div>
        </div>
      )}
      <Button variant="secondary" icon={<ImagePlus className="size-4" />} disabled={value.length >= max} onClick={add}>
        {value.length ? 'Agregar otra imagen' : 'Agregar logo o imagen'}
      </Button>
    </div>
  );
}
