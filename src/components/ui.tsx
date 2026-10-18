import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Loader2, X } from 'lucide-react'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

/* ----------------------------------------------------------------- Bouton */
type Variant = 'primary' | 'dark' | 'ghost' | 'outline' | 'danger' | 'soft'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ball text-white hover:bg-ball-dark',
  dark: 'bg-ink text-white hover:bg-ink-3',
  ghost: 'bg-transparent hover:bg-black/5',
  outline: 'border border-stone-300 bg-white hover:bg-stone-50',
  danger: 'bg-danger text-white hover:bg-red-700',
  soft: 'bg-stone-100 hover:bg-stone-200 text-stone-800',
}

export function Button({
  variant = 'primary', size = 'md', loading, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        VARIANTS[variant], sizes[size], className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------- Champs */
export function Field({ label, hint, children, className }: { label?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1.5 block text-sm font-medium text-stone-700">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-[15px] outline-none transition focus:border-ball focus:ring-2 focus:ring-ball/20 disabled:bg-stone-100'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, 'resize-y', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', props.className)} />
}

export function NumberInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null | undefined
  onChange: (v: number | null) => void
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      {...rest}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  )
}

export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cx('flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-ball' : 'bg-stone-300')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium">{label}</span>}
          {description && <span className="block text-xs text-stone-500">{description}</span>}
        </span>
      )}
    </label>
  )
}

/* ----------------------------------------------------------------- Divers */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', className ?? 'bg-stone-100 text-stone-700')}>
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-ball', className ?? 'size-6')} />
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-8" />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-stone-400">{icon}</div>}
      <p className="font-semibold text-stone-800">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-stone-500">{children}</div>}
    </div>
  )
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-stone-200 bg-white p-5 shadow-sm', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-base font-bold text-stone-900">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cx(
            'rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition',
            value === t.id ? 'bg-ink text-white' : 'bg-white text-stone-600 hover:bg-stone-50 border border-stone-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- Modale */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={cx('slide-up relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white text-stone-900 shadow-2xl sm:rounded-3xl', widths[size])}>
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-stone-100" aria-label="Fermer">
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-stone-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Toasts */
type Toast = { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx('slide-up pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg', t.kind === 'error' ? 'bg-danger' : 'bg-ink')}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/* ----------------------------------------------------------------- Image placeholder */
export function FoodImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  if (src) return <img src={src} alt={alt} loading="lazy" className={cx('object-cover', className)} />
  return (
    <div className={cx('flex items-center justify-center bg-gradient-to-br from-cheddar via-ball to-ball-dark', className)}>
      <span className="text-4xl drop-shadow" aria-hidden>🍔</span>
    </div>
  )
}
