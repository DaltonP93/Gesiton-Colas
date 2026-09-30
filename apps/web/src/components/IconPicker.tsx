import { ImageUp } from 'lucide-react';
import { useState } from 'react';
import { isImageIcon } from '@gc/shared';
import { ImageField } from './ImageField';
import { SERVICE_ICON_GROUPS } from './ServiceIcon';
import { cx } from './ui';

const CUSTOM = -1;

/**
 * Selector del ícono de un servicio: biblioteca agrupada por rubro o una imagen propia
 * (logo del servicio, pictograma de la institución...).
 */
export function IconPicker({ value, onChange, labelledBy }: { value: string; onChange: (value: string) => void; labelledBy?: string }) {
  const initial = isImageIcon(value) ? CUSTOM : Math.max(0, SERVICE_ICON_GROUPS.findIndex((g) => value in g.icons));
  const [group, setGroup] = useState(initial);
  const current = group === CUSTOM ? null : SERVICE_ICON_GROUPS[group]!;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Grupos de íconos">
        {SERVICE_ICON_GROUPS.map((g, i) => (
          <button
            key={g.label}
            type="button"
            role="tab"
            aria-selected={group === i}
            onClick={() => setGroup(i)}
            className={cx(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              group === i ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle',
            )}
          >
            {g.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={group === CUSTOM}
          onClick={() => setGroup(CUSTOM)}
          className={cx(
            'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition',
            group === CUSTOM ? 'border-primary bg-primary text-primary-fg' : 'border-dashed border-primary/50 text-primary-text hover:bg-primary/5',
          )}
        >
          <ImageUp className="size-3.5" /> Imagen propia
        </button>
      </div>

      {current ? (
        <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
          {Object.entries(current.icons).map(([key, { icon: Icon, label }]) => {
            const selected = value === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                onClick={() => onChange(key)}
                className={cx(
                  'grid aspect-square place-items-center rounded-ui border transition',
                  selected ? 'border-primary bg-primary text-primary-fg shadow-sm' : 'border-border bg-surface text-fg hover:bg-subtle',
                )}
              >
                <Icon className="size-5" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="max-w-xs">
          <ImageField
            label="Ícono propio"
            hint="PNG o SVG cuadrado con fondo transparente. Se ve en el kiosco, la consola y la TV."
            value={isImageIcon(value) ? value : null}
            onChange={(url) => onChange(url ?? 'ticket')}
            uploadName="Ícono de servicio"
            square
          />
        </div>
      )}
    </div>
  );
}
