import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type CartOption = { id: string; group: string; name: string; price: number }

export type CartItem = {
  key: string
  product_id: string
  name: string
  image_url: string | null
  base_price: number
  options: CartOption[]
  note: string
  quantity: number
}

export const unitPrice = (i: CartItem) => i.base_price + i.options.reduce((s, o) => s + Number(o.price), 0)
export const lineTotal = (i: CartItem) => unitPrice(i) * i.quantity

type Ctx = {
  items: CartItem[]
  count: number
  subtotal: number
  isOpen: boolean
  setOpen: (v: boolean) => void
  add: (item: Omit<CartItem, 'key'>) => void
  setQuantity: (key: string, qty: number) => void
  remove: (key: string) => void
  clear: () => void
}

const KEY = 'dsb_cart_v1'
const CartContext = createContext<Ctx | null>(null)

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as CartItem[]) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load)
  const [isOpen, setOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items))
    } catch {
      /* stockage indisponible */
    }
  }, [items])

  const add = useCallback((item: Omit<CartItem, 'key'>) => {
    const key = [item.product_id, ...item.options.map((o) => o.id).sort(), item.note.trim()].join('|')
    setItems((prev) => {
      const existing = prev.find((p) => p.key === key)
      if (existing) {
        return prev.map((p) => (p.key === key ? { ...p, quantity: Math.min(50, p.quantity + item.quantity) } : p))
      }
      return [...prev, { ...item, key }]
    })
  }, [])

  const setQuantity = useCallback((key: string, qty: number) => {
    setItems((prev) =>
      qty <= 0 ? prev.filter((p) => p.key !== key) : prev.map((p) => (p.key === key ? { ...p, quantity: Math.min(50, qty) } : p)),
    )
  }, [])

  const remove = useCallback((key: string) => setItems((prev) => prev.filter((p) => p.key !== key)), [])
  const clear = useCallback(() => setItems([]), [])

  const value = useMemo<Ctx>(() => ({
    items,
    count: items.reduce((s, i) => s + i.quantity, 0),
    subtotal: items.reduce((s, i) => s + lineTotal(i), 0),
    isOpen,
    setOpen,
    add,
    setQuantity,
    remove,
    clear,
  }), [items, isOpen, add, setQuantity, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): Ctx {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart hors CartProvider')
  return ctx
}
