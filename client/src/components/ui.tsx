import { forwardRef, createContext, useContext, useState, useCallback, useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Loader2, X, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { humanize } from '../lib/format';

export const cx = clsx;

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'navy';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: 'sm' | 'md' }>(
  ({ variant = 'primary', loading, size = 'md', className, children, disabled, ...p }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={cx(
      'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-[15px]',
      variant === 'primary' && 'bg-court-600 text-white hover:bg-court-700',
      variant === 'navy' && 'bg-navy-900 text-white hover:bg-navy-800',
      variant === 'secondary' && 'border border-navy-100 bg-white text-navy-900 hover:border-navy-300',
      variant === 'ghost' && 'text-navy-700 hover:bg-navy-100/60',
      variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
      className)} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  ));

const fieldCls = 'w-full rounded-md border border-navy-100 bg-white px-3 text-[15px] text-ink placeholder:text-navy-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:bg-paper';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx(fieldCls, 'h-10', className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => <select ref={ref} className={cx(fieldCls, 'h-10 pr-8', className)} {...p}>{children}</select>);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cx(fieldCls, 'min-h-[88px] py-2', className)} {...p} />);

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-semibold text-navy-800">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-red-700">{error}</span> : hint ? <span className="mt-1 block text-sm text-navy-600">{hint}</span> : null}
    </label>
  );
}

export function Card({ children, className, title, action, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-navy-100 bg-white', className)}>
      {title && <header className="flex items-center justify-between gap-3 border-b border-navy-100 px-5 py-3"><h2 className="text-lg font-semibold text-navy-900">{title}</h2>{action}</header>}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

const tone: Record<string, string> = {
  green: 'bg-court-100 text-court-700', cyan: 'bg-cyan-100 text-[#0B6F80]', gold: 'bg-gold-100 text-[#7A5A08]', red: 'bg-red-50 text-red-700', gray: 'bg-navy-100 text-navy-700', navy: 'bg-navy-900 text-white',
};
const statusTone: Record<string, string> = {
  CONFIRMED: 'green', CHECKED_IN: 'cyan', COMPLETED: 'gray', PENDING: 'gold', CANCELLED: 'red', NO_SHOW: 'red',
  PAID: 'green', UNPAID: 'gold', REFUNDED: 'gray', FAILED: 'red', ACTIVE: 'green', INACTIVE: 'gray', SUSPENDED: 'red', EXPIRED: 'gray',
  SCHEDULED: 'cyan', IN_PROGRESS: 'gold', OPEN: 'green', DRAFT: 'gray', CLOSED: 'red',
};
export function Badge({ children, color = 'gray', className }: { children: ReactNode; color?: keyof typeof tone; className?: string }) {
  return <span className={cx('inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold', tone[color], className)}>{children}</span>;
}
export const Status = ({ value }: { value: string }) => <Badge color={(statusTone[value] ?? 'gray') as any}>{humanize(value)}</Badge>;

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-3xl font-bold text-navy-900 sm:text-4xl">{title}</h1>{sub && <p className="mt-1 text-navy-600">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const Loading = ({ label = 'Loading' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-navy-600" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label}…</div>
);
export const ErrorBox = ({ error, retry }: { error: unknown; retry?: () => void }) => (
  <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
    <div className="flex-1"><p>{(error as Error)?.message ?? 'Something went wrong.'}</p>{retry && <button className="mt-2 text-sm font-semibold underline" onClick={retry}>Try again</button>}</div>
  </div>
);
export const Empty = ({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-navy-100 px-6 py-12 text-center">
    <p className="font-display text-xl font-semibold text-navy-900">{title}</p>
    {children && <p className="mx-auto mt-1 max-w-md text-navy-600">{children}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal aria-label={title} className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center justify-between border-b border-navy-100 bg-white px-5 py-3"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-navy-100"><X className="h-5 w-5" /></button></header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-navy-100 px-4 py-3 text-sm text-navy-700">
      <span className="num">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

/** Responsive table: horizontal scroll inside its own container. */
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead><tr className="border-b border-navy-100 text-xs font-semibold uppercase tracking-wide text-navy-600">{head.map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-navy-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-middle', className)}>{children}</td>;

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-navy-100 bg-white p-0.5" role="tablist">
      {items.map((i) => <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)} className={cx('rounded px-3 py-1.5 text-sm font-semibold', value === i.value ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-100/60')}>{i.label}</button>)}
    </div>
  );
}

/* toasts */
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg', t.kind === 'ok' ? 'bg-navy-900 text-white' : 'bg-red-700 text-white')}>
            {t.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-400" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function StatCard({ label, value, note, accent }: { label: string; value: ReactNode; note?: ReactNode; accent?: 'gold' | 'cyan' | 'green' | 'red' }) {
  return (
    <div className="rounded-lg border border-navy-100 bg-white px-4 py-3.5">
      <p className="text-sm text-navy-600">{label}</p>
      <p className={cx('num mt-0.5 font-display text-3xl font-bold', accent === 'gold' ? 'text-gold-500' : accent === 'red' ? 'text-red-700' : accent === 'cyan' ? 'text-cyan-500' : 'text-navy-900')}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-navy-600">{note}</p>}
    </div>
  );
}

export function Confirm({ open, title, children, onConfirm, onClose, confirmLabel, danger, loading }: { open: boolean; title: string; children: ReactNode; onConfirm: () => void; onClose: () => void; confirmLabel: string; danger?: boolean; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-navy-700">{children}</div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></div>
    </Modal>
  );
}
