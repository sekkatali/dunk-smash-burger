import { useEffect, useMemo, useRef, useState } from 'react'
import { Bike, Clock, Plus, ShoppingBag, Store } from 'lucide-react'
import { useShopMenu } from './menuContext'
import { useSettings } from '../lib/settings'
import { useCart } from '../lib/cart'
import { isOpenNow, todayHoursLabel } from '../lib/hours'
import { money } from '../lib/format'
import { isConfigured } from '../lib/supabase'
import type { Product } from '../lib/types'
import { FoodImage, PageLoader, cx } from '../components/ui'
import { Ball } from '../components/Logo'
import { ProductModal } from './ProductModal'

export function MenuPage() {
  const { menu, loading, error } = useShopMenu()
  const { settings } = useSettings()
  const { count, subtotal, setOpen } = useCart()
  const [selected, setSelected] = useState<Product | null>(null)
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const navRef = useRef<HTMLDivElement>(null)

  const open = isOpenNow(settings)
  const o = settings.ordering

  const categories = useMemo(
    () => menu.categories.filter((c) => c.active && menu.products.some((p) => p.active && p.category_id === c.id)),
    [menu],
  )
  const featured = useMemo(() => menu.products.filter((p) => p.active && p.featured), [menu])

  // catégorie active au scroll
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveCat(visible[0].target.getAttribute('data-cat'))
      },
      { rootMargin: '-140px 0px -60% 0px' },
    )
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el))
    return () => obs.disconnect()
  }, [categories])

  useEffect(() => {
    if (!activeCat || !navRef.current) return
    const btn = navRef.current.querySelector<HTMLElement>(`[data-nav="${activeCat}"]`)
    btn?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeCat])

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id]
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 130, behavior: 'smooth' })
  }

  return (
    <>
      {/* HÉROS */}
      <section className="court-lines relative overflow-hidden bg-ink text-white">
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:pb-20 sm:pt-16">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 font-semibold', open ? 'bg-court text-white' : 'bg-white/10 text-white/80')}>
              <span className={cx('size-2 rounded-full', open ? 'bg-emerald-300 pulse-ring' : 'bg-white/50')} />
              {open ? 'Ouvert — on smashe !' : 'Fermé pour le moment'}
            </span>
            {todayHoursLabel(settings) && <span className="text-white/60">{todayHoursLabel(settings)}</span>}
          </div>
          <h1 className="font-display mt-6 max-w-3xl text-[56px] leading-[0.92] sm:text-[96px]">
            Smash.<br />
            <span className="text-ball">Dunk.</span> Repeat.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-white/70">{settings.restaurant.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            {o.delivery_enabled && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <Bike className="size-4 text-ball" /> Livraison ~{o.delivery_time_min} min
              </span>
            )}
            {o.pickup_enabled && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <Store className="size-4 text-ball" /> À emporter ~{o.prep_time_min} min
              </span>
            )}
            {o.free_delivery_threshold > 0 && o.delivery_enabled && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                🏀 Livraison offerte dès {money(o.free_delivery_threshold)}
              </span>
            )}
          </div>
        </div>
        <Ball className="pointer-events-none absolute -right-16 -bottom-20 size-72 rotate-12 opacity-90 sm:-right-10 sm:size-[420px]" />
      </section>

      {!open && (
        <div className="mx-auto mt-6 max-w-6xl px-4">
          <div className="flex items-start gap-3 rounded-2xl border border-ball/30 bg-white p-4">
            <Clock className="mt-0.5 size-5 shrink-0 text-ball" />
            <p className="text-sm text-stone-700">{o.closed_message}</p>
          </div>
        </div>
      )}

      {!isConfigured && (
        <div className="mx-auto mt-6 max-w-6xl px-4">
          <div className="rounded-2xl bg-amber-100 p-4 text-sm text-amber-900">
            Base de données non connectée : renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.
          </div>
        </div>
      )}

      {/* NAV CATÉGORIES */}
      <div className="sticky top-16 z-20 border-b border-black/5 bg-cream/95 backdrop-blur">
        <div ref={navRef} className="scrollbar-none mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3">
          {featured.length > 0 && (
            <button type="button" data-nav="featured" onClick={() => scrollTo('featured')}
              className={cx('rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition', activeCat === 'featured' ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-cream-2')}>
              🔥 Stars
            </button>
          )}
          {categories.map((c) => (
            <button key={c.id} type="button" data-nav={c.id} onClick={() => scrollTo(c.id)}
              className={cx('rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition', activeCat === c.id ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-cream-2')}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-28">
        {loading && <PageLoader />}
        {error && <p className="py-10 text-center text-danger">{error}</p>}

        {featured.length > 0 && (
          <section data-cat="featured" ref={(el) => { sectionRefs.current.featured = el }} className="pt-10">
            <h2 className="font-display text-4xl">Les stars du terrain</h2>
            <div className="scrollbar-none -mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
              {featured.map((p) => (
                <button key={p.id} type="button" onClick={() => setSelected(p)}
                  className="group relative w-72 shrink-0 snap-start overflow-hidden rounded-3xl bg-ink text-left text-white">
                  <FoodImage src={p.image_url} alt={p.name} className="h-48 w-full transition duration-300 group-hover:scale-105" />
                  <div className="p-4">
                    {p.badge && <span className="mb-2 inline-block rounded-full bg-cheddar px-2 py-0.5 text-xs font-bold text-ink">{p.badge}</span>}
                    <h3 className="font-display text-2xl">{p.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-white/60">{p.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-lg font-bold">{money(p.price)}</span>
                      <span className="flex size-9 items-center justify-center rounded-full bg-ball"><Plus className="size-5" /></span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {categories.map((c) => {
          const products = menu.products.filter((p) => p.active && p.category_id === c.id)
          return (
            <section key={c.id} data-cat={c.id} ref={(el) => { sectionRefs.current[c.id] = el }} className="pt-12">
              <h2 className="font-display text-4xl">{c.name}</h2>
              {c.description && <p className="mt-1 text-stone-600">{c.description}</p>}
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} onClick={() => setSelected(p)} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3 sm:hidden">
          <button type="button" onClick={() => setOpen(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-ball px-5 py-4 font-bold text-white shadow-xl">
            <span className="flex items-center gap-2"><ShoppingBag className="size-5" /> Voir le panier ({count})</span>
            <span>{money(subtotal)}</span>
          </button>
        </div>
      )}

      {selected && <ProductModal product={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function ProductCard({ product: p, onClick }: { product: Product; onClick: () => void }) {
  const soldOut = !p.available
  return (
    <button type="button" onClick={onClick} disabled={soldOut}
      className={cx('group flex gap-4 overflow-hidden rounded-3xl bg-white p-3 text-left shadow-sm ring-1 ring-black/5 transition hover:shadow-md', soldOut && 'opacity-60')}>
      <div className="min-w-0 flex-1 py-1 pl-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl leading-tight">{p.name}</h3>
          {p.badge && <span className="rounded-full bg-cheddar px-2 py-0.5 text-[11px] font-bold">{p.badge}</span>}
        </div>
        {p.description && <p className="mt-1 line-clamp-2 text-sm text-stone-600">{p.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          <span className="font-bold">{money(p.price)}</span>
          {p.compare_at_price && p.compare_at_price > p.price && (
            <span className="text-sm text-stone-400 line-through">{money(p.compare_at_price)}</span>
          )}
          {soldOut && <span className="text-sm font-semibold text-danger">Épuisé</span>}
        </div>
      </div>
      <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl">
        <FoodImage src={p.image_url} alt={p.name} className="size-full transition duration-300 group-hover:scale-105" />
        {!soldOut && (
          <span className="absolute right-1.5 bottom-1.5 flex size-8 items-center justify-center rounded-full bg-ink text-white shadow">
            <Plus className="size-4" />
          </span>
        )}
      </div>
    </button>
  )
}
