import { Save } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { TenantDTO, TenantSettings } from '@gc/shared';
import { Button, cx, useFeedback } from '../../../components/ui';
import { ApiError, api, errorMessage } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

export interface TabProps {
  /** Informa a la página si la pestaña tiene cambios sin guardar. */
  onDirtyChange: (dirty: boolean) => void;
}

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Mensaje legible para errores de validación de la configuración (issues de zod). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError && error.code !== 'validation_error' && Array.isArray(error.details) && error.details.length > 0) {
    const first = error.details[0] as { message?: string; path?: unknown[] };
    if (first?.message) {
      const where = Array.isArray(first.path) && first.path.length > 0 ? ` (${first.path.join('.')})` : '';
      return `${error.message}${where}: ${first.message}`;
    }
  }
  return errorMessage(error);
}

type SettingsPatch = { [K in keyof TenantSettings]?: unknown };

/**
 * Guarda una parte de la configuración (`PUT /tenant`). El servidor mezcla el objeto con lo existente;
 * los arrays (p. ej. `customerFields`) se reemplazan completos.
 */
export function useSaveTenant() {
  const { refresh } = useAuth();
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const save = useCallback(
    async (body: { name?: string; settings?: SettingsPatch }, successMessage: string): Promise<TenantDTO | null> => {
      setSaving(true);
      try {
        const tenant = await api.put<TenantDTO>('/tenant', body);
        await refresh();
        toast(successMessage);
        return tenant;
      } catch (e) {
        toast(describeError(e), 'error');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [refresh, toast],
  );
  return { save, saving };
}

/** Notifica a la página el estado "sucio" de la pestaña. */
export function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void) {
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
}

export function SaveBar({
  dirty,
  saving,
  invalid,
  onSave,
  onDiscard,
  extra,
}: {
  dirty: boolean;
  saving: boolean;
  invalid?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-20 mt-6 border-t border-border bg-bg/90 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <span aria-hidden className={cx('size-2 rounded-full', dirty ? 'bg-accent' : 'bg-emerald-500')} />
          {invalid ? 'Corrija los campos marcados para guardar' : dirty ? 'Tiene cambios sin guardar' : 'Todo está guardado'}
        </p>
        {extra}
        <Button variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>
          Descartar
        </Button>
        <Button icon={<Save className="size-4" />} loading={saving} disabled={!dirty || invalid} onClick={onSave}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

export function Section({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('gc-card gc-pad', className)}>
      <header className="mb-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function Callout({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex gap-3 rounded-ui border border-primary/25 bg-primary/5 p-4 text-sm', className)}>
      {icon && <span className="mt-0.5 shrink-0 text-primary [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 space-y-1 text-fg/85">{children}</div>
    </div>
  );
}
