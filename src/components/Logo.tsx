import { cx } from './ui'

export function Ball({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="18" fill="#FF5A1F" />
      <path
        d="M2 20h36M20 2v36M7.5 7.5c6.5 6.5 6.5 18.5 0 25M32.5 7.5c-6.5 6.5-6.5 18.5 0 25"
        stroke="#0E0E0E"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Logo({ className, light = true, logoUrl }: { className?: string; light?: boolean; logoUrl?: string }) {
  if (logoUrl) return <img src={logoUrl} alt="Dunk Smash Burger" className={cx('h-10 w-auto', className)} />
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <Ball className="size-9 -rotate-12" />
      <span className="leading-none">
        <span className={cx('font-display block text-2xl', light ? 'text-white' : 'text-ink')}>Dunk</span>
        <span className="font-display block text-[10px] tracking-[0.3em] text-ball">Smash Burger</span>
      </span>
    </span>
  )
}
