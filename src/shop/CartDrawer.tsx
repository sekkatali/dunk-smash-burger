import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import { lineTotal, useCart } from '../lib/cart'
import { useSettings } from '../lib/settings'
import { money } from '../lib/format'
import { groupsForProduct } from '../lib/menu'
import { isOpenNow } from '../lib/hours'
import { track } from '../lib/analytics'
import type { Product } from '../lib/types'
import { FoodImage, cx, useToast } from '../components/ui'
import { useShopMenu } from './menuContext'
import { ProductModal } from './ProductModal'

export function CartDrawer() {
  const { items, isOpen, setOpen, setQuantity, remove, subtotal, count, add } = useCart()
  const { settings } = useSettings()
  const { menu } = useShopMenu()
  const navigate = useNavigate()
  const toast = useToast()
  const [upsellProduct, setUpsellProduct] = useState<Product | null>(null)
  const open = isOpenNow(settings)
  const o = settings.ordering

  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  const upsells = useMemo(() => {
    const ids = settings.marketing.upsell_product_ids ?? []
    return ids
      .map((id) => menu.products.find((p) => p.id === id))
      .filter((p): p is Product => Boolean(p && p.active && p.available))
      .filter((p) => !items.some((i) => i.product_id === p.id))
      .slice(0, 4)
  }, [settings.marketing.upsell_product_ids, menu.products, items])

  const addUpsell = (p: Product) => {
    const needsChoice = groupsForProduct(menu, p.id).some((g) => g.min_select > 0)
    if (needsChoice) {
      setUpsellProduct(p)
      return
    }
    add({ product_id: p.id, name: p.name, image_url: p.image_url, base_price: Number(p.price), options: [], note: '', quantity: 1 })
    track('add_to_cart', { product_id: p.id, value: Number(p.price), name: p.name, items: 1 })
    toast(`${p.name} ajouté 🏀`)
  }

  const freeLeft = o.free_delivery_threshold > 0 ? o.free_delivery_threshold - subtotal : 0

  if (!isOpen) return upsellProduct ? <ProductModal product={upsellProduct} onClose={() => setUpsellProduct(null)} /> : null

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
        <aside className="slide-up relative flex h-full w-full max-w-md flex-col bg-cream shadow-2xl">
          <div className="flex items-center justify-between bg-ink px-5 py-4 text-white">
            <h2 className="font-display text-2xl">Ton panier {count > 0 && <span className="text-ball">({count})</span>}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-white/10">
              <X className="size-6" />
            </button>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <ShoppingBag className="size-12 text-stone-300" />
              <p className="font-display mt-4 text-2xl">Panier vide</p>
              <p className="mt-1 text-sm text-stone-500">Ajoute un smash, tu ne le regretteras pas.</p>
              <button type="button" onClick={() => setOpen(false)} className="mt-6 rounded-full bg-ball px-6 py-3 font-bold text-white">
                Voir le menu
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4">
                {o.delivery_enabled && o.free_delivery_threshold > 0 && (
                  <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold">
                      {freeLeft > 0 ? <>Plus que <span className="text-ball">{money(freeLeft)}</span> pour la livraison offerte 🏀</> : 'Livraison offerte débloquée ! 🎉'}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div className="h-full rounded-full bg-ball transition-all" style={{ width: `${Math.min(100, (subtotal / o.free_delivery_threshold) * 100)}%` }} />
                    </div>
                  </div>
                )}

                <ul className="space-y-3">
                  {items.map((i) => (
                    <li key={i.key} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm">
                      <FoodImage src={i.image_url} alt={i.name} className="size-16 shrink-0 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-bold leading-tight">{i.name}</p>
                          <button type="button" onClick={() => remove(i.key)} className="text-stone-400 hover:text-danger" aria-label="Retirer">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        {i.options.length > 0 && (
                          <p className="mt-0.5 text-xs text-stone-500">{i.options.map((op) => op.name).join(' · ')}</p>
                        )}
                        {i.note && <p className="mt-0.5 text-xs italic text-stone-500">« {i.note} »</p>}
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center rounded-full bg-stone-100">
                            <button type="button" onClick={() => setQuantity(i.key, i.quantity - 1)} className="flex size-8 items-center justify-center" aria-label="Moins">
                              <Minus className="size-3.5" />
                            </button>
                            <span className="w-5 text-center text-sm font-bold">{i.quantity}</span>
                            <button type="button" onClick={() => setQuantity(i.key, i.quantity + 1)} className="flex size-8 items-center justify-center" aria-label="Plus">
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                          <span className="font-bold">{money(lineTotal(i))}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                {upsells.length > 0 && (
                  <div className="mt-6">
                    <h3 className="font-display text-xl">Un petit plus ?</h3>
                    <div className="scrollbar-none -mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
                      {upsells.map((p) => (
                        <button key={p.id} type="button" onClick={() => addUpsell(p)}
                          className="w-32 shrink-0 overflow-hidden rounded-2xl bg-white text-left shadow-sm">
                          <FoodImage src={p.image_url} alt={p.name} className="h-20 w-full" />
                          <div className="p-2">
                            <p className="line-clamp-1 text-sm font-semibold">{p.name}</p>
                            <p className="flex items-center justify-between text-sm">
                              {money(p.price)} <Plus className="size-4 text-ball" />
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-black/5 bg-white p-4">
                <div className="mb-3 flex justify-between text-lg font-bold">
                  <span>Sous-total</span>
                  <span>{money(subtotal)}</span>
                </div>
                <button
                  type="button"
                  disabled={!open}
                  onClick={() => { setOpen(false); navigate('/commande') }}
                  className={cx('h-14 w-full rounded-full font-bold text-white transition', open ? 'bg-ball hover:bg-ball-dark' : 'bg-stone-400')}
                >
                  {open ? 'Commander' : 'Fermé pour le moment'}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
      {upsellProduct && <ProductModal product={upsellProduct} onClose={() => setUpsellProduct(null)} />}
    </>
  )
}
