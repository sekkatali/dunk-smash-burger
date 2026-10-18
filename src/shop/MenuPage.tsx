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
  const hero = featured.find((p) => p.available && p.image_url) ?? null

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
      <section className="court-lines relative overflow-hidden bg-wine text-cream">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 pt-8 pb-12 md:grid-cols-[1.1fr_0.9fr] md:pt-14 md:pb-16">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 font-semibold', open ? 'bg-cream text-wine' : 'bg-cream/10 text-cream/80')}>
                <span className={cx('size-2 rounded-full', open ? 'bg-emerald-500' : 'bg-cream/50')} />
                {open ? 'Ouvert — on smashe !' : 'Fermé pour le moment'}
              </span>
              {todayHoursLabel(settings) && <span className="text-cream/60">{todayHoursLabel(settings)}</span>}
            </div>
            <p className="font-script mt-6 text-3xl text-ball-light sm:text-4xl">smash burgers</p>
            <h1 className="font-display text-[44px] leading-[0.95] sm:text-[72px]">
              À toi<br />de jouer&nbsp;!
            </h1>
            <p className="mt-5 max-w-md text-lg text-cream/75">{settings.restaurant.tagline}</p>
            <div className="mt-7 flex flex-wrap gap-2.5 text-sm">
              {o.delivery_enabled && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-cream/10 px-3 py-2">
                  <Bike className="size-4 text-cream" /> Livraison ~{o.delivery_time_min} min
                </span>
              )}
              {o.pickup_enabled && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-cream/10 px-3 py-2">
                  <Store className="size-4 text-cream" /> À emporter ~{o.prep_time_min} min
                </span>
              )}
              {o.free_delivery_threshold > 0 && o.delivery_enabled && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-cream/10 px-3 py-2">
                  Livraison offerte dès {money(o.free_delivery_threshold)}
                </span>
              )}
            </div>
            {hero && (
              <button type="button" onClick={() => setSelected(hero)}
                className="mt-8 inline-flex h-13 items-center gap-3 rounded-full bg-ball px-6 py-3.5 font-bold text-white shadow-lg shadow-black/30 transition hover:bg-ball-dark">
                Commander {hero.name} · {money(hero.price)}
              </button>
            )}
          </div>
          {hero?.image_url && (
            <button type="button" onClick={() => setSelected(hero)} className="group relative mx-auto w-full max-w-sm">
              <div className="absolute -inset-3 rotate-3 rounded-[2rem] bg-ball/40" />
              <img src={hero.image_url} alt={hero.name}
                className="relative aspect-[4/5] w-full rounded-[2rem] object-cover shadow-2xl transition duration-500 group-hover:-rotate-1 group-hover:scale-[1.02]" />
              {hero.compare_at_price && hero.compare_at_price > hero.price && (
                <span className="absolute top-4 left-4 rounded-full bg-cream px-3 py-1 text-sm font-bold text-wine">
                  -{Math.round((1 - hero.price / hero.compare_at_price) * 100)} %
                </span>
              )}
            </button>
          )}
        </div>
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
            <h2 className="font-display text-3xl sm:text-4xl">Les stars du terrain</h2>
            <div className="scrollbar-none -mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
              {featured.map((p) => (
                <button key={p.id} type="button" onClick={() => setSelected(p)}
                  className="group relative w-64 shrink-0 snap-start overflow-hidden rounded-3xl bg-wine text-left text-cream">
                  <FoodImage src={p.image_url} alt={p.name} className="aspect-[4/5] w-full transition duration-300 group-hover:scale-105" />
                  <div className="p-4">
                    {p.badge && <span className="mb-2 inline-block rounded-full bg-cheddar px-2 py-0.5 text-xs font-bold text-ink">{p.badge}</span>}
                    <h3 className="font-display text-xl">{p.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-cream/60">{p.description}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-lg font-bold">{money(p.price)}{p.compare_at_price && p.compare_at_price > p.price && <span className="ml-2 text-sm font-normal text-cream/40 line-through">{money(p.compare_at_price)}</span>}</span>
                      <span className="flex size-9 items-center justify-center rounded-full bg-ball text-white"><Plus className="size-5" /></span>
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
              <h2 className="font-display text-3xl sm:text-4xl">{c.name}</h2>
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
          <h3 className="font-display text-lg leading-tight">{p.name}</h3>
          {p.badge && <span className="rounded-full bg-cheddar px-2 py-0.5 text-[11px] font-bold">{p.badge}</span>}
        </div>
        {p.description && <p className="mt-1 line-clamp-2 text-sm text-stone-600">{p.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          <span className="font-bold">{money(p.price)}</span>
          {p.compare_at_price && p.compare_at_price > p.price && (
            <>
              <span className="text-sm text-stone-400 line-through">{money(p.compare_at_price)}</span>
              <span className="rounded-full bg-ball/10 px-1.5 py-0.5 text-[11px] font-bold text-ball">-{Math.round((1 - p.price / p.compare_at_price) * 100)} %</span>
            </>
          )}
          {soldOut && <span className="text-sm font-semibold text-danger">Épuisé</span>}
        </div>
      </div>
      <div className="relative h-32 w-28 shrink-0 overflow-hidden rounded-2xl">
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
