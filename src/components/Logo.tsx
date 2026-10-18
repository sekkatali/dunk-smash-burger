import { cx } from './ui'

export const DEFAULT_LOGO =
  'https://mjrnlrmefyxcuvzzwifl.supabase.co/storage/v1/object/public/menu/dunk/opt/logo-1789984604193.png'

/**
 * Logo Dunk (fond crème intégré à l'image : sur fond sombre il apparaît
 * comme un badge crème, ce qui respecte l'identité du logo).
 */
export function Logo({ className, logoUrl }: { className?: string; light?: boolean; logoUrl?: string }) {
  return (
    <img
      src={logoUrl || DEFAULT_LOGO}
      alt="Dunk - Smash Burgers"
      className={cx('h-11 w-auto rounded-lg', className)}
    />
  )
}
