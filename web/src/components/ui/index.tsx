/** Patzer UI primitives v1. No screen or server dependencies. */
import {
  forwardRef, useEffect, useId, useRef, useState, cloneElement, isValidElement,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes,
  type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { X } from 'lucide-react';

const cx = (...classes: Array<string | null | false | undefined>) => classes.filter(Boolean).join(' ');
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'default' | 'sm' | 'icon';
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary', size = 'default', loading = false,
  disabled, className, children, type = 'button', ...props
}, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cx('ui-button', 'ui-button--' + variant, size === 'sm' && 'ui-button--small',
      size === 'icon' && 'ui-button--icon', className)}>
    {loading && <span aria-hidden="true" className="ui-spinner" />}
    {children}
  </button>;
});
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> { invalid?: boolean }
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...props }, ref) {
  return <input {...props} ref={ref} className={cx('ui-input', className)}
    aria-invalid={invalid || props['aria-invalid'] || undefined} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ children, className, ...props }, ref) {
    return <select {...props} ref={ref} className={cx('ui-select', className)}>{children}</select>;
  },
);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea {...props} ref={ref} className={cx('ui-textarea', className)} />;
  },
);
export function Field({ id, label, hint, error, children, className }: {
  id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode;
  children: ReactNode; className?: string;
}) {
  return <div className={cx('ui-field', className)}>
    <label className="ui-field-label" htmlFor={id}>{label}</label>
    {children}
    {error ? <p className="ui-field-error" role="alert">{error}</p>
      : hint ? <p className="ui-field-help">{hint}</p> : null}
  </div>;
}
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { interactive?: boolean }>(
  function Card({ interactive, className, ...props }, ref) {
    return <div {...props} ref={ref} className={cx('ui-card', interactive && 'ui-card--interactive', className)} />;
  },
);
export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return <span {...props} className={cx('ui-badge', tone !== 'neutral' && 'ui-badge--' + tone, className)} />;
}
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return <span role="status" aria-label={label} className={cx('ui-spinner', className)} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('ui-skeleton', className)} />;
}

/** Native dialog handles focus trapping, top-layer stacking and Escape. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: string; description?: string; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [open]);
  return <dialog ref={dialogRef} aria-labelledby={titleId}
    aria-describedby={description ? descId : undefined}
    onClose={() => onOpenChange(false)}
    className={cx('ui-dialog', className)}>
    <div className="flex items-start justify-between gap-4">
      <div><h2 id={titleId} className="ui-dialog-heading">{title}</h2>
        {description && <p id={descId} className="ui-dialog-description">{description}</p>}
      </div>
      <Button variant="ghost" size="icon" aria-label="Close dialog"
        onClick={() => onOpenChange(false)}><X size={18} aria-hidden="true" /></Button>
    </div>
    <div className="ui-dialog-body">{children}</div>
    {footer && <div className="ui-dialog-footer">{footer}</div>}
  </dialog>;
}
export interface TabItem { value: string; label: ReactNode; content: ReactNode; disabled?: boolean }
export function Tabs({ items, value, onValueChange, label = 'Sections', className }: {
  items: readonly TabItem[]; value: string;
  onValueChange: (value: string) => void; label?: string; className?: string;
}) {
  const baseId = useId();
  const active = items.find(item => item.value === value && !item.disabled) ?? items.find(item => !item.disabled);
  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = items.map((item, i) => item.disabled ? -1 : i).filter(i => i !== -1);
    if (!enabled.length) return;
    const current = Math.max(0, enabled.indexOf(index));
    const target = event.key === 'Home' ? enabled[0] :
      event.key === 'End' ? enabled[enabled.length - 1] :
      enabled[(current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    onValueChange(items[target]!.value);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[target]?.focus();
  }
  return <div className={className}>
    <div role="tablist" aria-label={label} className="ui-tablist">
      {items.map((item, index) =>
        <button type="button" role="tab" key={item.value} className="ui-tab"
          id={baseId + '-tab-' + index} aria-controls={baseId + '-panel-' + index}
          aria-selected={active?.value === item.value}
          disabled={item.disabled} tabIndex={active?.value === item.value ? 0 : -1}
          onClick={() => onValueChange(item.value)}
          onKeyDown={event => onKeyDown(event, index)}>{item.label}</button>)}
    </div>
    {items.map((item, index) => <div key={item.value}
      id={baseId + '-panel-' + index} aria-labelledby={baseId + '-tab-' + index}
      role="tabpanel" tabIndex={active?.value === item.value ? 0 : -1}
      hidden={active?.value !== item.value} className="ui-tabpanel">{item.content}</div>)}
  </div>;
}
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const described = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
    }) : children;
  return <span className="ui-tooltip-host">{described}
    <span role="tooltip" id={id} className="ui-tooltip">{label}</span>
  </span>;
}

export function Popover({ trigger, children, label = 'More options' }: {
  trigger: ReactNode; children: ReactNode; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function key(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div ref={root} className="ui-popover-host">
    <button ref={button} type="button" className="ui-button ui-button--ghost" aria-label={label}
      aria-controls={panelId} aria-expanded={open} aria-haspopup="true"
      onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && <div id={panelId} className="ui-popover-panel">{children}</div>}
  </div>;
}
export interface MenuItem { id: string; label: string; disabled?: boolean; onSelect: () => void }
export function Menu({ trigger, items, label = 'Menu' }: {
  trigger: ReactNode; items: readonly MenuItem[]; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const buttons = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)') ?? []);
    buttons()[0]?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function key(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const active = buttons();
      if (!active.length) return;
      const index = Math.max(0, active.indexOf(document.activeElement as HTMLButtonElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? active.length-1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + active.length) % active.length;
      active[next]?.focus();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="ui-popover-host" ref={root}>
    <button type="button" ref={triggerRef} className="ui-button ui-button--ghost"
      aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} aria-label={label}
      onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && <div id={menuId} role="menu" aria-label={label} className="ui-popover-panel ui-menu">
      {items.map(item => <button type="button" role="menuitem" key={item.id}
        disabled={item.disabled} className="ui-menu-item"
        onClick={() => { item.onSelect(); setOpen(false); triggerRef.current?.focus(); }}>
        {item.label}
      </button>)}
    </div>}
  </div>;
}
