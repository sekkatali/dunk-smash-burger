import { useEffect, useMemo, useState } from 'react'
import { Check, Minus, Plus, X } from 'lucide-react'
import { useShopMenu } from './menuContext'
import { groupsForProduct } from '../lib/menu'
import { useCart } from '../lib/cart'
import { money } from '../lib/format'
import { track } from '../lib/analytics'
import type { Product } from '../lib/types'
import { FoodImage, cx, useToast } from '../components/ui'

export function ProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { menu } = useShopMenu()
  const { add } = useCart()
  const toast = useToast()
  const groups = useMemo(
    () => groupsForProduct(menu, product.id).map((g) => ({ ...g, options: g.options.filter((o) => o.available) })),
    [menu, product.id],
  )
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    track('view_product', { product_id: product.id, value: product.price, name: product.name })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const toggle = (groupId: string, optionId: string, max: number) => {
    setPicked((prev) => {
      const cur = prev[groupId] ?? []
      if (cur.includes(optionId)) return { ...prev, [groupId]: cur.filter((x) => x !== optionId) }
      if (max === 1) return { ...prev, [groupId]: [optionId] }
      if (cur.length >= max) return prev
      return { ...prev, [groupId]: [...cur, optionId] }
    })
  }

  const selectedOptions = groups.flatMap((g) =>
    g.options.filter((o) => (picked[g.id] ?? []).includes(o.id)).map((o) => ({ id: o.id, group: g.name, name: o.name, price: Number(o.price) })),
  )
  const unit = Number(product.price) + selectedOptions.reduce((s, o) => s + o.price, 0)
  const missing = groups.filter((g) => (picked[g.id] ?? []).length < g.min_select)

  const submit = () => {
    setTried(true)
    if (missing.length > 0) {
      document.getElementById(`grp-${missing[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    add({
      product_id: product.id,
      name: product.name,
      image_url: product.image_url,
      base_price: Number(product.price),
      options: selectedOptions,
      note: note.trim(),
      quantity: qty,
    })
    track('add_to_cart', { product_id: product.id, value: unit * qty, name: product.name, items: qty })
    toast(`${product.name} ajouté au panier 🏀`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="slide-up relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white sm:max-w-lg sm:rounded-3xl">
        <button type="button" onClick={onClose} aria-label="Fermer"
          className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 shadow">
          <X className="size-5" />
        </button>
        <div className="overflow-y-auto">
          <FoodImage src={product.image_url} alt={product.name} className="h-72 w-full sm:h-80" />
          <div className="p-5">
            <h2 className="font-display text-2xl">{product.name}</h2>
            {product.description && <p className="mt-2 text-stone-600">{product.description}</p>}
            <p className="mt-3 text-lg font-bold">{money(product.price)}</p>

            {groups.map((g) => {
              const sel = picked[g.id] ?? []
              const isMissing = tried && sel.length < g.min_select
              const rule = g.min_select > 0
                ? g.max_select === 1 ? 'Obligatoire' : `Obligatoire · ${g.min_select} à ${g.max_select}`
                : g.max_select === 1 ? 'Optionnel' : `Jusqu'à ${g.max_select}`
              return (
                <div key={g.id} id={`grp-${g.id}`} className="mt-6">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="font-bold">{g.name}</h3>
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold',
                      isMissing ? 'bg-red-100 text-danger' : g.min_select > 0 ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600')}>
                      {rule}
                    </span>
                  </div>
                  <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
                    {g.options.map((o) => {
                      const on = sel.includes(o.id)
                      const disabled = !on && g.max_select > 1 && sel.length >= g.max_select
                      return (
                        <button key={o.id} type="button" disabled={disabled} onClick={() => toggle(g.id, o.id, g.max_select)}
                          className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition', disabled ? 'opacity-40' : 'hover:bg-stone-50')}>
                          <span className={cx('flex size-5 shrink-0 items-center justify-center border-2 transition',
                            g.max_select === 1 ? 'rounded-full' : 'rounded-md',
                            on ? 'border-ball bg-ball text-white' : 'border-stone-300')}>
                            {on && <Check className="size-3.5" strokeWidth={3} />}
                          </span>
                          <span className="flex-1">{o.name}</span>
                          {Number(o.price) > 0 && <span className="text-sm font-semibold text-stone-600">+{money(o.price)}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            <div className="mt-6">
              <h3 className="mb-2 font-bold">Une précision ?</h3>
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} rows={2}
                placeholder="Ex : bien cuit, sauce à part…"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 outline-none focus:border-ball" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-stone-100 bg-white p-4">
          <div className="flex items-center rounded-full bg-stone-100">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex size-11 items-center justify-center" aria-label="Moins">
              <Minus className="size-4" />
            </button>
            <span className="w-6 text-center font-bold">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(50, q + 1))} className="flex size-11 items-center justify-center" aria-label="Plus">
              <Plus className="size-4" />
            </button>
          </div>
          <button type="button" onClick={submit} disabled={!product.available}
            className="flex h-12 flex-1 items-center justify-between rounded-full bg-ball px-5 font-bold text-white transition hover:bg-ball-dark disabled:opacity-50">
            <span>{product.available ? 'Ajouter' : 'Épuisé'}</span>
            <span>{money(unit * qty)}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
