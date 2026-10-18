import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { MapPin, MessageCircle, Phone, ShoppingBag } from 'lucide-react'
import { Logo } from '../components/Logo'
import { useCart } from '../lib/cart'
import { useSettings } from '../lib/settings'
import { captureUtm, loadPixels, track } from '../lib/analytics'
import { hoursSummary } from '../lib/hours'
import { waLink } from '../lib/format'
import { CartDrawer } from './CartDrawer'

export function ShopLayout() {
  const { settings, loading } = useSettings()
  const { count, setOpen } = useCart()
  const location = useLocation()
  const r = settings.restaurant

  useEffect(() => {
    captureUtm()
  }, [])

  useEffect(() => {
    if (!loading) loadPixels(settings)
  }, [loading, settings])

  useEffect(() => {
    if (!loading) track('page_view')
    window.scrollTo(0, 0)
  }, [location.pathname, loading])

  return (
    <div className="min-h-dvh bg-cream">
      {settings.marketing.announcement_enabled && settings.marketing.announcement_text && (
        <div className="bg-ball px-4 py-2 text-center text-sm font-semibold text-white">
          {settings.marketing.announcement_text}
        </div>
      )}

      <header className="sticky top-0 z-30 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="Accueil">
            <Logo logoUrl={r.logo_url || undefined} />
          </Link>
          <div className="flex items-center gap-2">
            {r.phone && (
              <a href={`tel:${r.phone}`} className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-white/80 hover:text-white sm:flex">
                <Phone className="size-4" /> {r.phone}
              </a>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="relative flex items-center gap-2 rounded-full bg-ball px-4 py-2 text-sm font-bold text-white hover:bg-ball-dark"
            >
              <ShoppingBag className="size-4" />
              <span className="hidden sm:inline">Panier</span>
              {count > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-white text-xs text-ink">{count}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="mt-16 bg-ink text-white/80">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-3">
          <div>
            <Logo logoUrl={r.logo_url || undefined} />
            <p className="mt-4 max-w-xs text-sm text-white/60">{r.tagline}</p>
          </div>
          <div>
            <h4 className="font-display mb-3 text-lg text-white">Horaires</h4>
            <ul className="space-y-1 text-sm">
              {hoursSummary(settings).map((h) => (
                <li key={h.label} className="flex justify-between gap-4 max-w-60">
                  <span className="text-white/50">{h.label}</span>
                  <span>{h.value}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-display mb-3 text-lg text-white">Contact</h4>
            <ul className="space-y-2 text-sm">
              {r.address && (
                <li className="flex gap-2"><MapPin className="size-4 shrink-0 text-ball" /> {r.address}{r.city ? `, ${r.city}` : ''}</li>
              )}
              {r.phone && (
                <li><a className="flex gap-2 hover:text-white" href={`tel:${r.phone}`}><Phone className="size-4 text-ball" /> {r.phone}</a></li>
              )}
              {r.whatsapp && (
                <li><a className="flex gap-2 hover:text-white" href={waLink(r.whatsapp)} target="_blank" rel="noreferrer"><MessageCircle className="size-4 text-ball" /> WhatsApp</a></li>
              )}
              {r.instagram && (
                <li><a className="hover:text-white" href={`https://instagram.com/${r.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer">Instagram · @{r.instagram.replace(/^@/, '')}</a></li>
              )}
              {r.tiktok && (
                <li><a className="hover:text-white" href={`https://tiktok.com/@${r.tiktok.replace(/^@/, '')}`} target="_blank" rel="noreferrer">TikTok · @{r.tiktok.replace(/^@/, '')}</a></li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-xs text-white/40">
          © {new Date().getFullYear()} {r.name}
        </div>
      </footer>

      <CartDrawer />
    </div>
  )
}
