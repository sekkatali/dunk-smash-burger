import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, MessageCircle, Phone, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { PAYMENT_SHORT, elapsed, mapsLink, money, waLink } from '../lib/format'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '../lib/types'
import { Logo } from '../components/Logo'
import { PageLoader, cx } from '../components/ui'

type PortalOrder = {
  id: string
  number: number
  status: OrderStatus
  customer_name: string
  customer_phone: string
  address: string | null
  address_details: string | null
  zone: string | null
  notes: string | null
  total: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  created_at: string
  items: { name: string; quantity: number }[] | null
}

type Portal = {
  driver: { id: string; name: string; status: 'available' | 'busy' | 'offline' }
  orders: PortalOrder[]
  today: { delivered: number; cash_to_settle: number }
}

export default function DriverPortal() {
  const { token } = useParams()
  const { settings } = useSettings()
  const [data, setData] = useState<Portal | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc('driver_portal', { p_token: token })
    setData((d as Portal) ?? null)
    setLoading(false)
  }, [token])

  useEffect(() => {
    document.title = 'Livreur — Dunk'
    void load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  const setStatus = async (status: Portal['driver']['status']) => {
    await supabase.rpc('driver_set_status', { p_token: token, p_status: status })
    void load()
  }

  const update = async (o: PortalOrder, status: 'delivering' | 'delivered') => {
    if (status === 'delivered' && !confirm(`Confirmer la livraison de la commande n°${o.number}${o.payment_status !== 'paid' ? ` et l'encaissement de ${money(o.total)}` : ''} ?`)) return
    setBusy(o.id)
    await supabase.rpc('driver_update_order', { p_token: token, p_order: o.id, p_status: status })
    setBusy(null)
    void load()
  }

  if (loading) return <div className="min-h-dvh bg-ink"><PageLoader /></div>
  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink p-6 text-center text-white">
        <div><Logo /><p className="mt-6 text-white/70">Lien invalide ou désactivé. Demande un nouveau lien au restaurant.</p></div>
      </div>
    )
  }

  const statuses = [
    { id: 'available' as const, label: 'Dispo', cls: 'bg-emerald-500' },
    { id: 'busy' as const, label: 'En course', cls: 'bg-violet-500' },
    { id: 'offline' as const, label: 'Hors ligne', cls: 'bg-stone-500' },
  ]

  return (
    <div className="min-h-dvh bg-stone-100 pb-10">
      <header className="bg-ink px-4 pt-4 pb-5 text-white">
        <div className="flex items-center justify-between">
          <Logo />
          <button type="button" onClick={() => void load()} className="rounded-full p-2 text-white/60" aria-label="Actualiser"><RefreshCw className="size-5" /></button>
        </div>
        <p className="mt-4 text-sm text-white/60">Salut</p>
        <p className="font-display text-3xl">{data.driver.name}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {statuses.map((s) => (
            <button key={s.id} type="button" onClick={() => setStatus(s.id)}
              className={cx('rounded-xl py-2.5 text-sm font-bold', data.driver.status === s.id ? `${s.cls} text-white` : 'bg-white/10 text-white/60')}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-white/10 p-3"><p className="text-2xl font-bold">{data.today.delivered}</p><p className="text-xs text-white/60">Livrées aujourd'hui</p></div>
          <div className="rounded-xl bg-white/10 p-3"><p className="text-2xl font-bold">{money(data.today.cash_to_settle)}</p><p className="text-xs text-white/60">Espèces à remettre</p></div>
        </div>
      </header>

      <main className="space-y-4 p-4">
        <h2 className="text-lg font-bold">Mes courses ({data.orders.length})</h2>
        {data.orders.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-stone-500">Aucune course assignée pour l'instant. La page se met à jour toute seule.</p>}
        {data.orders.map((o) => {
          const toCollect = o.payment_status !== 'paid'
          return (
            <div key={o.id} className={cx('rounded-2xl bg-white p-4 shadow-sm', o.status === 'delivering' && 'ring-2 ring-violet-400')}>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold">#{o.number}</span>
                <span className="text-xs text-stone-500">{elapsed(o.created_at)}</span>
              </div>
              <p className="mt-1 font-semibold">{o.customer_name}</p>
              <p className="mt-1">{o.address}</p>
              {o.address_details && <p className="text-sm text-stone-600">{o.address_details}</p>}
              {o.zone && <p className="text-sm text-stone-500">{o.zone}</p>}
              {o.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">📝 {o.notes}</p>}
              <p className="mt-2 text-sm text-stone-500">{(o.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
              <div className={cx('mt-3 rounded-xl p-3 text-center font-bold', toCollect ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800')}>
                {toCollect ? `À encaisser : ${money(o.total)} (${PAYMENT_SHORT[o.payment_method]})` : `Déjà payé · ${money(o.total)}`}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <a href={`tel:${o.customer_phone}`} className="flex flex-col items-center gap-1 rounded-xl bg-stone-100 py-2 text-xs font-semibold"><Phone className="size-5" /> Appeler</a>
                <a href={waLink(o.customer_phone, `Bonjour, c'est votre livreur ${settings.restaurant.name}, j'arrive avec votre commande n°${o.number}.`)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl bg-stone-100 py-2 text-xs font-semibold"><MessageCircle className="size-5" /> WhatsApp</a>
                {o.address && <a href={mapsLink(`${o.address} ${settings.restaurant.city}`)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl bg-stone-100 py-2 text-xs font-semibold"><MapPin className="size-5" /> Itinéraire</a>}
              </div>
              {o.status === 'delivering' ? (
                <button type="button" disabled={busy === o.id} onClick={() => update(o, 'delivered')} className="mt-3 h-14 w-full rounded-xl bg-emerald-600 text-lg font-bold text-white disabled:opacity-50">
                  ✓ Livrée
                </button>
              ) : (
                <button type="button" disabled={busy === o.id || o.status !== 'ready'} onClick={() => update(o, 'delivering')} className="mt-3 h-14 w-full rounded-xl bg-ball text-lg font-bold text-white disabled:opacity-40">
                  {o.status === 'ready' ? 'Je pars en livraison' : 'En préparation…'}
                </button>
              )}
            </div>
          )
        })}
      </main>
    </div>
  )
}
