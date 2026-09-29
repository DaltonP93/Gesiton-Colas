import { Loader2, X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* Botones                                                             */
/* ------------------------------------------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:brightness-110 shadow-sm',
  accent: 'bg-accent text-accent-fg hover:brightness-105 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm',
  secondary: 'bg-surface text-fg border border-border hover:bg-subtle',
  ghost: 'text-fg hover:bg-subtle',
  danger: 'bg-red-600 text-white hover:bg-red-500 shadow-sm',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
  xl: 'h-16 px-7 text-lg gap-3',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-ui font-medium whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, ...rest }: ButtonProps & { label: string }) {
  return <Button variant="ghost" size="sm" aria-label={label} title={label} className={cx('w-8 px-0', className)} {...rest} />;
}

/* ------------------------------------------------------------------ */
/* Formularios                                                         */
/* ------------------------------------------------------------------ */

const fieldBase =
  'w-full rounded-ui border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(fieldBase, 'py-2 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(fieldBase, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  // Solo se usa <label> cuando envuelve un control simple: si envolviera un grupo de
  // botones (chips, selectores), un clic en el texto activaría el primer botón.
  const wrapsControl = isValidElement(children) && [Input, Select, Textarea].includes(children.type as never);
  const Tag = wrapsControl ? 'label' : 'div';
  return (
    <Tag className={cx('block space-y-1.5', className)}>
      {label && (
        <span className="block text-sm font-medium text-fg">
          {label}
          {required && <span aria-hidden className="ml-0.5 text-red-500">*</span>}
        </span>
      )}
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </Tag>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Etiqueta accesible cuando no hay texto visible. */
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-fg/20',
        )}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {(label || hint) && (
        <label htmlFor={id} className="cursor-pointer select-none">
          {label && <span className="block text-sm font-medium">{label}</span>}
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </label>
      )}
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded accent-[var(--gc-primary)]" />
      {label}
    </label>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: ReactNode }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-ui border border-border bg-surface p-1"
        />
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(e.target.value)) onChange(e.target.value);
          }}
          className="font-mono uppercase"
          maxLength={7}
        />
      </div>
    </Field>
  );
}

export function RangeInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format = (v) => String(v),
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: ReactNode;
  format?: (v: number) => string;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-[var(--gc-primary)]"
        />
        <span className="w-14 text-right text-sm tabular-nums text-muted">{format(value)}</span>
      </div>
    </Field>
  );
}

/** Selector de valores múltiples con "chips". */
export function ChipSelect<T extends string | number>({
  options,
  value,
  onChange,
  emptyLabel,
}: {
  options: { value: T; label: ReactNode; color?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  emptyLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(active ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition',
              active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-subtle',
            )}
          >
            {o.color && <span className="size-2.5 rounded-full" style={{ background: o.color }} />}
            {o.label}
          </button>
        );
      })}
      {options.length === 0 && emptyLabel && <span className="text-sm text-muted">{emptyLabel}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estructura                                                          */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('rounded-ui border border-border bg-surface shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', !color && 'bg-subtle text-fg', className)}
      style={color ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-ui border border-dashed border-border px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted [&_svg]:size-10">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="gc-scroll -mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition',
            value === t.value ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="gc-scroll overflow-x-auto">
      <table className={cx('w-full text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-muted [&_th]:uppercase [&_tbody_tr]:border-t [&_tbody_tr]:border-border [&_tbody_tr:hover]:bg-subtle', className)}>
        {children}
      </table>
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-ui border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        {icon && (
          <span className="rounded-ui p-2 [&_svg]:size-4" style={{ background: `color-mix(in srgb, ${tone ?? 'var(--gc-primary)'} 12%, transparent)`, color: tone ?? 'var(--gc-primary)' }}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[96vw]' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx('gc-fade-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface text-fg shadow-2xl outline-none sm:rounded-ui', widths[size])}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Cerrar" icon={<X className="size-4" />} onClick={onClose} />
        </header>
        <div className="gc-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Notificaciones y confirmaciones                                     */
/* ------------------------------------------------------------------ */

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
}

interface Feedback {
  toast(message: ReactNode, tone?: ToastTone): void;
  confirm(options: { title: ReactNode; message?: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<null | { title: ReactNode; message?: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }>(null);

  const toast = useCallback((message: ReactNode, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback<Feedback['confirm']>((options) => new Promise((resolve) => setDialog({ ...options, resolve })), []);

  const close = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cx(
                'gc-fade-in pointer-events-auto max-w-md rounded-ui px-4 py-3 text-sm font-medium shadow-lg',
                t.tone === 'success' && 'bg-emerald-600 text-white',
                t.tone === 'error' && 'bg-red-600 text-white',
                t.tone === 'info' && 'bg-slate-800 text-white',
              )}
            >
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
      <Modal
        open={Boolean(dialog)}
        onClose={() => close(false)}
        title={dialog?.title}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button variant={dialog?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {dialog?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        {dialog?.message && <p className="text-sm text-muted">{dialog.message}</p>}
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback debe usarse dentro de <FeedbackProvider>');
  return ctx;
}
