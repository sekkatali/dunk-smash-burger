import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bike, Check, ChefHat, MessageCircle, Package, Phone, Store, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { PAYMENT_LABEL, money, timeOf, waLink } from '../lib/format'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '../lib/types'
import { PageLoader, cx } from '../components/ui'

type PublicOrder = {
  number: number
  status: OrderStatus
  type: 'delivery' | 'pickup'
  created_at: string
  customer_name: string
  address: string | null
  zone: string | null
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  subtotal: number
  delivery_fee: number
  discount: number
  total: number
  promo_code: string | null
  accepted_at: string | null
  ready_at: string | null
  delivering_at: string | null
  delivered_at: string | null
  cancel_reason: string | null
  driver: { name: string; phone: string | null } | null
  items: { name: string; quantity: number; options: { name: string }[]; total: number; note: string | null }[]
}

const STEP_INDEX: Record<OrderStatus, number> = {
  pending_payment: -1, new: 0, accepted: 1, preparing: 1, ready: 2, delivering: 3, delivered: 4, cancelled: -2,
}

export function OrderTrackingPage() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const { settings } = useSettings()
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_order', { p_token: token })
    setOrder((data as PublicOrder) ?? null)
    setLoading(false)
  }, [token])

  useEffect(() => {
    void load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  const retryPayment = async () => {
    setRetrying(true)
    const { data, error } = await supabase.functions.invoke('cmi-init', { body: { token, origin: window.location.origin } })
    if (error || !data) {
      setRetrying(false)
      alert("Le paiement en ligne n'est pas disponible. Contacte-nous pour finaliser ta commande.")
      return
    }
    const { url, fields } = data as { url: string; fields: Record<string, string> }
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = url
    Object.entries(fields).forEach(([k, v]) => {
      const i = document.createElement('input')
      i.type = 'hidden'
      i.name = k
      i.value = v
      form.appendChild(i)
    })
    document.body.appendChild(form)
    form.submit()
  }

  if (loading) return <PageLoader />
  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="font-display text-3xl">Commande introuvable</p>
        <Link to="/" className="mt-6 inline-block rounded-full bg-ball px-6 py-3 font-bold text-white">Retour au menu</Link>
      </div>
    )
  }

  const r = settings.restaurant
  const step = STEP_INDEX[order.status]
  const steps = order.type === 'delivery'
    ? [
        { label: 'Reçue', icon: Package, at: order.created_at },
        { label: 'En cuisine', icon: ChefHat, at: order.accepted_at },
        { label: 'Prête', icon: Check, at: order.ready_at },
        { label: 'En route', icon: Bike, at: order.delivering_at },
        { label: 'Livrée', icon: Check, at: order.delivered_at },
      ]
    : [
        { label: 'Reçue', icon: Package, at: order.created_at },
        { label: 'En cuisine', icon: ChefHat, at: order.accepted_at },
        { label: 'Prête à récupérer', icon: Store, at: order.ready_at },
      ]
  const done = order.type === 'pickup' ? step >= 2 || order.status === 'delivered' : order.status === 'delivered'

  const headline =
    order.status === 'cancelled' ? 'Commande annulée'
    : order.status === 'pending_payment' ? 'Paiement en attente'
    : order.status === 'new' ? 'Commande reçue !'
    : order.status === 'accepted' || order.status === 'preparing' ? 'On smashe ta commande 🔥'
    : order.status === 'ready' ? (order.type === 'pickup' ? 'Ta commande est prête !' : 'Prête, on cherche le livreur')
    : order.status === 'delivering' ? 'Ton livreur est en route 🛵'
    : order.type === 'pickup' ? 'Bon appétit !' : 'Livrée. Bon appétit !'

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {params.get('payment') === 'ok' && order.payment_status === 'paid' && (
        <p className="mb-4 rounded-2xl bg-emerald-100 p-4 text-sm font-semibold text-emerald-800">Paiement accepté, merci !</p>
      )}
      {(params.get('payment') === 'fail' || params.get('payment') === 'error') && order.payment_status !== 'paid' && (
        <p className="mb-4 rounded-2xl bg-red-100 p-4 text-sm font-semibold text-danger">Le paiement n'a pas abouti. Tu peux réessayer ou nous contacter.</p>
      )}

      <div className="rounded-3xl bg-wine p-6 text-cream">
        <p className="text-sm text-white/60">Commande n°{order.number} · {timeOf(order.created_at)}</p>
        <h1 className="font-display mt-2 text-3xl sm:text-4xl">{headline}</h1>
        {order.status === 'cancelled' && order.cancel_reason && <p className="mt-2 text-white/70">{order.cancel_reason}</p>}
        {order.status === 'new' && (
          <p className="mt-2 text-white/70">On la valide dans un instant. Cette page se met à jour toute seule.</p>
        )}

        {order.status === 'pending_payment' && (
          <button type="button" onClick={retryPayment} disabled={retrying}
            className="mt-5 rounded-full bg-ball px-6 py-3 font-bold disabled:opacity-60">
            {retrying ? 'Redirection…' : `Payer ${money(order.total)}`}
          </button>
        )}

        {step >= 0 && (
          <ol className="mt-8 flex items-start justify-between gap-1">
            {steps.map((s, i) => {
              const reached = done || i <= step
              const current = !done && i === step
              return (
                <li key={s.label} className="flex flex-1 flex-col items-center text-center">
                  <span className={cx('flex size-11 items-center justify-center rounded-full transition',
                    reached ? 'bg-ball text-white' : 'bg-white/10 text-white/40', current && 'pulse-ring')}>
                    <s.icon className="size-5" />
                  </span>
                  <span className={cx('mt-2 text-xs font-semibold', reached ? 'text-white' : 'text-white/40')}>{s.label}</span>
                  {reached && s.at && <span className="text-[11px] text-white/50">{timeOf(s.at)}</span>}
                </li>
              )
            })}
          </ol>
        )}
        {order.status === 'cancelled' && <XCircle className="mt-6 size-12 text-red-400" />}
      </div>

      {order.driver && (
        <div className="mt-4 flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm">
          <div>
            <p className="text-sm text-stone-500">Ton livreur</p>
            <p className="text-lg font-bold">{order.driver.name}</p>
          </div>
          {order.driver.phone && (
            <a href={`tel:${order.driver.phone}`} className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-white">
              <Phone className="size-4" /> Appeler
            </a>
          )}
        </div>
      )}

      <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="font-bold">Détail</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span>
                <span className="font-semibold">{i.quantity}× {i.name}</span>
                {i.options?.length > 0 && <span className="block text-xs text-stone-500">{i.options.map((o) => o.name).join(' · ')}</span>}
              </span>
              <span>{money(i.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-stone-500">Sous-total</dt><dd>{money(order.subtotal)}</dd></div>
          {order.type === 'delivery' && <div className="flex justify-between"><dt className="text-stone-500">Livraison</dt><dd>{order.delivery_fee ? money(order.delivery_fee) : 'Offerte'}</dd></div>}
          {order.discount > 0 && <div className="flex justify-between"><dt className="text-stone-500">Réduction {order.promo_code}</dt><dd>− {money(order.discount)}</dd></div>}
          <div className="flex justify-between pt-1 text-lg font-bold"><dt>Total</dt><dd>{money(order.total)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-stone-600">
          {PAYMENT_LABEL[order.payment_method]} · {order.payment_status === 'paid' ? 'payé' : 'à régler'}
        </p>
        {order.type === 'delivery' && order.address && <p className="mt-1 text-sm text-stone-600">📍 {order.address}{order.zone ? ` (${order.zone})` : ''}</p>}
      </div>

      {(r.phone || r.whatsapp) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {r.whatsapp && (
            <a href={waLink(r.whatsapp, `Bonjour, à propos de ma commande n°${order.number}`)} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-bold text-white">
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          {r.phone && (
            <a href={`tel:${r.phone}`} className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold shadow-sm">
              <Phone className="size-4" /> Nous appeler
            </a>
          )}
        </div>
      )}

      <Link to="/" className="mt-8 block text-center text-sm font-semibold text-stone-600 hover:text-ink">← Retour au menu</Link>
    </div>
  )
}
