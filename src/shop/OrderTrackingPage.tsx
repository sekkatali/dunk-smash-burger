import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Bike, Check, ChefHat, Clock, MessageCircle, Package, Phone, RotateCcw, Star, Store, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { PAYMENT_LABEL, money, timeOf, waLink } from '../lib/format'
import { slotLabel } from '../lib/slots'
import type { OrderStatus, PaymentMethod, PaymentStatus } from '../lib/types'
import { PageLoader, cx, useToast } from '../components/ui'
import { useReorder } from './AccountPage'

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
  reward_discount: number
  credit_used: number
  total: number
  promo_code: string | null
  scheduled_for: string | null
  pickup_code: string | null
  distance_km: number | null
  requires_confirmation: boolean
  rating: number | null
  accepted_at: string | null
  ready_at: string | null
  delivering_at: string | null
  delivered_at: string | null
  cancel_reason: string | null
  failed_reason: string | null
  driver: { name: string; phone: string | null } | null
  items: { product_id: string | null; name: string; quantity: number; options: { id: string; name: string }[]; total: number; note: string | null }[]
}

const STEP_INDEX: Record<OrderStatus, number> = {
  pending_payment: -1, pending_confirmation: 0, new: 0, accepted: 1, preparing: 1, ready: 2, delivering: 3, delivered: 4, failed: -2, cancelled: -2,
}

export function OrderTrackingPage() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const { settings } = useSettings()
  const toast = useToast()
  const reorder = useReorder()
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [qr, setQr] = useState<string | null>(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [rated, setRated] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_order', { p_token: token })
    setOrder((data as PublicOrder) ?? null)
    setLoading(false)
  }, [token])

  useEffect(() => {
    void load()
    const t = setInterval(load, 12000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (order?.type === 'pickup' && order.pickup_code) {
      QRCode.toDataURL(`DUNK-${order.number}-${order.pickup_code}`, { margin: 1, width: 320, color: { dark: '#0e0e0e', light: '#ffffff' } })
        .then(setQr).catch(() => setQr(null))
    }
  }, [order?.type, order?.pickup_code, order?.number])

  const sendRating = async () => {
    const { data } = await supabase.rpc('rate_order', { p_token: token, p_rating: rating, p_comment: comment })
    if (data) {
      setRated(true)
      toast('Merci pour ton avis 🙏')
    }
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
        { label: 'Prête', icon: Store, at: order.ready_at },
        { label: 'Récupérée', icon: Check, at: order.delivered_at },
      ]
  const lastIdx = steps.length - 1
  const visualStep = order.type === 'pickup' && order.status === 'delivered' ? lastIdx : Math.min(step, lastIdx)
  const done = order.status === 'delivered'

  const headline =
    order.status === 'cancelled' ? 'Commande annulée'
    : order.status === 'failed' ? 'Livraison non aboutie'
    : order.status === 'pending_payment' ? 'Paiement en attente'
    : order.status === 'pending_confirmation' ? 'On confirme ta commande'
    : order.status === 'new' ? 'Commande reçue !'
    : order.status === 'accepted' || order.status === 'preparing' ? 'On smashe ta commande 🔥'
    : order.status === 'ready' ? (order.type === 'pickup' ? 'Ta commande est prête !' : 'Prête, ton livreur arrive')
    : order.status === 'delivering' ? 'Ton livreur est en route 🛵'
    : order.type === 'pickup' ? 'Bon appétit !' : 'Livrée. Bon appétit !'

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {params.get('payment') === 'ok' && order.payment_status === 'paid' && (
        <p className="mb-4 rounded-2xl bg-emerald-100 p-4 text-sm font-semibold text-emerald-800">Paiement accepté, merci !</p>
      )}
      {(params.get('payment') === 'fail' || params.get('payment') === 'error') && order.payment_status !== 'paid' && (
        <p className="mb-4 rounded-2xl bg-red-100 p-4 text-sm font-semibold text-danger">Le paiement n'a pas abouti. Contacte-nous pour finaliser ta commande.</p>
      )}

      <div className="court-lines rounded-3xl bg-wine p-6 text-cream">
        <p className="text-sm text-cream/60">Commande n°{order.number} · passée à {timeOf(order.created_at)}</p>
        <h1 className="font-display mt-2 text-3xl sm:text-4xl">{headline}</h1>
        {order.scheduled_for && !['delivered', 'cancelled', 'failed'].includes(order.status) && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-cream/10 px-3 py-1 text-sm"><Clock className="size-4" /> {order.type === 'delivery' ? 'Livraison prévue' : 'Retrait prévu'} {slotLabel(order.scheduled_for)}</p>
        )}
        {order.status === 'pending_confirmation' && <p className="mt-2 text-cream/75">Pour ta 1ʳᵉ commande, on te contacte par WhatsApp ou téléphone pour la confirmer, puis on lance la cuisine.</p>}
        {order.status === 'new' && <p className="mt-2 text-cream/70">On la valide dans un instant. Cette page se met à jour toute seule.</p>}
        {order.status === 'cancelled' && order.cancel_reason && <p className="mt-2 text-cream/75">{order.cancel_reason}</p>}
        {order.status === 'failed' && <p className="mt-2 text-cream/75">{order.failed_reason || 'Le livreur n’a pas pu te remettre la commande.'} Contacte-nous pour trouver une solution.</p>}

        {step >= 0 && (
          <ol className="mt-8 flex items-start justify-between gap-1">
            {steps.map((s, i) => {
              const reached = done || i <= visualStep
              const current = !done && i === visualStep
              return (
                <li key={s.label} className="flex flex-1 flex-col items-center text-center">
                  <span className={cx('flex size-11 items-center justify-center rounded-full transition', reached ? 'bg-cream text-wine' : 'bg-cream/10 text-cream/40', current && 'pulse-ring')}>
                    <s.icon className="size-5" />
                  </span>
                  <span className={cx('mt-2 text-xs font-semibold', reached ? 'text-cream' : 'text-cream/40')}>{s.label}</span>
                  {reached && s.at && <span className="text-[11px] text-cream/50">{timeOf(s.at)}</span>}
                </li>
              )
            })}
          </ol>
        )}
        {(order.status === 'cancelled' || order.status === 'failed') && <XCircle className="mt-6 size-12 text-red-300" />}
      </div>

      {order.type === 'pickup' && order.pickup_code && !['delivered', 'cancelled', 'failed'].includes(order.status) && (
        <div className="mt-4 flex items-center gap-5 rounded-3xl bg-white p-5 shadow-sm">
          {qr && <img src={qr} alt="QR code de retrait" className="size-28 rounded-xl" />}
          <div>
            <p className="text-sm text-stone-500">Code de retrait</p>
            <p className="font-display text-5xl tracking-widest">{order.pickup_code}</p>
            <p className="mt-1 text-xs text-stone-500">Montre ce code ou le QR au comptoir.</p>
          </div>
        </div>
      )}

      {order.driver && (
        <div className="mt-4 flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm">
          <div><p className="text-sm text-stone-500">Ton livreur</p><p className="text-lg font-bold">{order.driver.name}</p></div>
          {order.driver.phone && <a href={`tel:${order.driver.phone}`} className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-white"><Phone className="size-4" /> Appeler</a>}
        </div>
      )}

      {order.status === 'delivered' && !order.rating && !rated && (
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
          <p className="font-bold">Alors, c’était comment ?</p>
          <div className="mt-3 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} étoiles`}>
                <Star className={cx('size-9', n <= rating ? 'fill-cheddar text-cheddar' : 'text-stone-300')} />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <>
              <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 500))} rows={2} placeholder="Un commentaire ? (optionnel)"
                className="mt-3 w-full rounded-xl border border-stone-300 px-3 py-2 outline-none focus:border-ball" />
              <button type="button" onClick={sendRating} className="mt-2 rounded-full bg-ball px-5 py-2.5 text-sm font-bold text-white">Envoyer mon avis</button>
            </>
          )}
        </div>
      )}

      <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Détail</h2>
          <button type="button" onClick={() => reorder(order.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, options: i.options ?? [], note: i.note })))}
            className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-sm font-semibold"><RotateCcw className="size-4" /> Recommander</button>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span><span className="font-semibold">{i.quantity}× {i.name}</span>
                {i.options?.length > 0 && <span className="block text-xs text-stone-500">{i.options.map((o) => o.name).join(' · ')}</span>}</span>
              <span>{money(i.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-stone-500">Sous-total</dt><dd>{money(order.subtotal)}</dd></div>
          {order.discount > 0 && <div className="flex justify-between"><dt className="text-stone-500">Code {order.promo_code}</dt><dd>− {money(order.discount)}</dd></div>}
          {order.reward_discount > 0 && <div className="flex justify-between"><dt className="text-stone-500">Récompense DUNK Card</dt><dd>− {money(order.reward_discount)}</dd></div>}
          {order.type === 'delivery' && <div className="flex justify-between"><dt className="text-stone-500">Livraison{order.distance_km ? ` (${String(order.distance_km).replace('.', ',')} km)` : ''}</dt><dd>{order.delivery_fee ? money(order.delivery_fee) : 'Offerte'}</dd></div>}
          {order.credit_used > 0 && <div className="flex justify-between"><dt className="text-stone-500">Crédit DUNK</dt><dd>− {money(order.credit_used)}</dd></div>}
          <div className="flex justify-between pt-1 text-lg font-bold"><dt>Total</dt><dd>{money(order.total)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-stone-600">{PAYMENT_LABEL[order.payment_method]} · {order.payment_status === 'paid' ? 'payé' : 'à régler'}</p>
        {order.type === 'delivery' && order.address && <p className="mt-1 text-sm text-stone-600">📍 {order.address}</p>}
      </div>

      {(r.phone || r.whatsapp) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {r.whatsapp && <a href={waLink(r.whatsapp, `Bonjour, à propos de ma commande n°${order.number}`)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-bold text-white"><MessageCircle className="size-4" /> WhatsApp</a>}
          {r.phone && <a href={`tel:${r.phone}`} className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold shadow-sm"><Phone className="size-4" /> Nous appeler</a>}
        </div>
      )}
      <Link to="/" className="mt-8 block text-center text-sm font-semibold text-stone-600 hover:text-ink">← Retour au menu</Link>
    </div>
  )
}
