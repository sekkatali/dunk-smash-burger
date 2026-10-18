import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Banknote, Bike, CreditCard, Globe, Lock, Store, Tag, X } from 'lucide-react'
import { lineTotal, useCart } from '../lib/cart'
import { useSettings } from '../lib/settings'
import { money, normalizePhone } from '../lib/format'
import { isOpenNow } from '../lib/hours'
import { errorMessage, supabase } from '../lib/supabase'
import { getSessionId, getUtm, track } from '../lib/analytics'
import type { PaymentMethod } from '../lib/types'
import { cx } from '../components/ui'

type Promo = { code: string; discount: number; free_delivery: boolean }
const CUSTOMER_KEY = 'dsb_customer'

type Customer = { name: string; phone: string; email: string; address: string; address_details: string; zone: string }

function loadCustomer(): Customer {
  try {
    return { name: '', phone: '', email: '', address: '', address_details: '', zone: '', ...JSON.parse(localStorage.getItem(CUSTOMER_KEY) || '{}') }
  } catch {
    return { name: '', phone: '', email: '', address: '', address_details: '', zone: '' }
  }
}

export function CheckoutPage() {
  const { items, subtotal, clear } = useCart()
  const { settings, loading } = useSettings()
  const navigate = useNavigate()
  const o = settings.ordering
  const p = settings.payments
  const zones = (settings.zones ?? []).filter((z) => z.active !== false)

  const [type, setType] = useState<'delivery' | 'pickup'>(o.delivery_enabled ? 'delivery' : 'pickup')
  const [c, setC] = useState<Customer>(loadCustomer)
  const [notes, setNotes] = useState('')
  const methods = useMemo(() => {
    const m: PaymentMethod[] = []
    if (p.cmi && p.cmi_client_id) m.push('cmi')
    if (p.cash) m.push('cash')
    if (p.card_on_delivery) m.push('card_on_delivery')
    return m
  }, [p])
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState<Promo | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoLoading, setPromoLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading) {
      setType(o.delivery_enabled ? 'delivery' : 'pickup')
    }
  }, [loading, o.delivery_enabled])

  useEffect(() => {
    if (!method && methods.length) setMethod(methods[0])
  }, [methods, method])

  useEffect(() => {
    if (items.length) track('begin_checkout', { value: subtotal, items: items.length })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const zone = zones.find((z) => z.name === c.zone)
  const baseFee = type === 'delivery' ? (zone?.fee ?? o.delivery_fee ?? 0) : 0
  const minOrder = type === 'delivery' ? (zone?.min_order ?? o.min_order ?? 0) : 0
  const fee = type === 'delivery' && o.free_delivery_threshold > 0 && subtotal >= o.free_delivery_threshold ? 0 : baseFee
  const discount = promo ? (promo.free_delivery ? fee : Math.min(promo.discount, subtotal)) : 0
  const total = Math.max(0, subtotal + fee - discount)
  const belowMin = type === 'delivery' && subtotal < minOrder

  // si le panier change, on revalide le code
  useEffect(() => {
    setPromo(null)
  }, [subtotal, type])

  const set = (k: keyof Customer, v: string) => setC((prev) => ({ ...prev, [k]: v }))

  const applyPromo = async () => {
    if (!promoInput.trim()) return
    setPromoLoading(true)
    setPromoError(null)
    const { data, error: err } = await supabase.rpc('validate_promo', {
      p_code: promoInput.trim(), p_subtotal: subtotal, p_delivery_fee: fee, p_phone: normalizePhone(c.phone),
    })
    setPromoLoading(false)
    if (err) return setPromoError(errorMessage(err))
    const r = data as { valid: boolean; error?: string; code: string; discount: number; free_delivery: boolean }
    if (!r.valid) return setPromoError(r.error ?? 'Code invalide')
    setPromo({ code: r.code, discount: Number(r.discount), free_delivery: r.free_delivery })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!method) return setError('Choisis un moyen de paiement')
    if (normalizePhone(c.phone).length < 9) return setError('Numéro de téléphone invalide')
    if (type === 'delivery' && zones.length > 0 && !zone) return setError('Choisis ta zone de livraison')
    setSubmitting(true)
    try {
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(c))
    } catch { /* ignore */ }

    const payload = {
      type,
      customer: { name: c.name, phone: c.phone, email: c.email },
      address: c.address,
      address_details: c.address_details,
      zone: c.zone,
      notes,
      payment_method: method,
      promo_code: promo?.code ?? '',
      items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, option_ids: i.options.map((op) => op.id), note: i.note })),
      session_id: getSessionId(),
      utm: getUtm(),
      source: document.referrer || null,
    }
    const { data, error: err } = await supabase.rpc('place_order', { p: payload })
    if (err) {
      setSubmitting(false)
      return setError(errorMessage(err))
    }
    const res = data as { id: string; number: number; token: string; total: number; payment_method: PaymentMethod }
    track('purchase', { value: Number(res.total), items: items.length })

    if (res.payment_method === 'cmi') {
      try {
        const { data: pay, error: payErr } = await supabase.functions.invoke('cmi-init', {
          body: { token: res.token, origin: window.location.origin },
        })
        if (payErr) throw payErr
        const { url, fields } = pay as { url: string; fields: Record<string, string> }
        clear()
        const form = document.createElement('form')
        form.method = 'POST'
        form.action = url
        Object.entries(fields).forEach(([k, v]) => {
          const input = document.createElement('input')
          input.type = 'hidden'
          input.name = k
          input.value = v
          form.appendChild(input)
        })
        document.body.appendChild(form)
        form.submit()
        return
      } catch (e2) {
        setSubmitting(false)
        navigate(`/suivi/${res.token}?payment=error`)
        console.error(e2)
        return
      }
    }
    clear()
    navigate(`/suivi/${res.token}?new=1`)
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="font-display text-3xl">Ton panier est vide</p>
        <Link to="/" className="mt-6 inline-block rounded-full bg-ball px-6 py-3 font-bold text-white">Retour au menu</Link>
      </div>
    )
  }

  const open = isOpenNow(settings)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 hover:text-ink">
        <ArrowLeft className="size-4" /> Retour au menu
      </Link>
      <h1 className="font-display mt-4 text-5xl">Finaliser</h1>

      <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* Mode */}
          <Block title="1. Livraison ou à emporter ?">
            <div className="grid grid-cols-2 gap-3">
              {o.delivery_enabled && (
                <Choice active={type === 'delivery'} onClick={() => setType('delivery')} icon={<Bike className="size-5" />}
                  title="Livraison" subtitle={`~${o.delivery_time_min} min`} />
              )}
              {o.pickup_enabled && (
                <Choice active={type === 'pickup'} onClick={() => setType('pickup')} icon={<Store className="size-5" />}
                  title="À emporter" subtitle={`Prêt en ~${o.prep_time_min} min`} />
              )}
            </div>
            {type === 'pickup' && settings.restaurant.address && (
              <p className="mt-3 text-sm text-stone-600">📍 À récupérer : {settings.restaurant.address}{settings.restaurant.city ? `, ${settings.restaurant.city}` : ''}</p>
            )}
          </Block>

          {/* Coordonnées */}
          <Block title="2. Tes coordonnées">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Prénom et nom" value={c.name} onChange={(v) => set('name', v)} required autoComplete="name" />
              <TextField label="Téléphone" value={c.phone} onChange={(v) => set('phone', v)} required type="tel" placeholder="06 12 34 56 78" autoComplete="tel" />
              <TextField className="sm:col-span-2" label="E-mail (optionnel)" value={c.email} onChange={(v) => set('email', v)} type="email" autoComplete="email" />
            </div>
          </Block>

          {type === 'delivery' && (
            <Block title="3. Adresse de livraison">
              <div className="grid gap-3">
                {zones.length > 0 && (
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Quartier / zone</span>
                    <select required value={c.zone} onChange={(e) => set('zone', e.target.value)}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:border-ball">
                      <option value="">Choisis ta zone…</option>
                      {zones.map((z) => (
                        <option key={z.name} value={z.name}>
                          {z.name} — livraison {z.fee ? money(z.fee) : 'offerte'}{z.min_order ? ` · min. ${money(z.min_order)}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <TextField label="Adresse" value={c.address} onChange={(v) => set('address', v)} required placeholder="Rue, numéro, résidence" autoComplete="street-address" />
                <TextField label="Étage, appartement, repère (optionnel)" value={c.address_details} onChange={(v) => set('address_details', v)} placeholder="Ex : 3e étage, interphone 12, à côté de la pharmacie" />
              </div>
            </Block>
          )}

          <Block title={type === 'delivery' ? '4. Paiement' : '3. Paiement'}>
            {methods.length === 0 && <p className="text-sm text-danger">Aucun moyen de paiement n'est activé.</p>}
            <div className="grid gap-3">
              {methods.includes('cmi') && (
                <Choice active={method === 'cmi'} onClick={() => setMethod('cmi')} icon={<Globe className="size-5" />}
                  title="Carte bancaire en ligne" subtitle="Paiement sécurisé CMI" />
              )}
              {methods.includes('cash') && (
                <Choice active={method === 'cash'} onClick={() => setMethod('cash')} icon={<Banknote className="size-5" />}
                  title={type === 'delivery' ? 'Espèces à la livraison' : 'Espèces au retrait'} subtitle="Prévois la monnaie si possible" />
              )}
              {methods.includes('card_on_delivery') && (
                <Choice active={method === 'card_on_delivery'} onClick={() => setMethod('card_on_delivery')} icon={<CreditCard className="size-5" />}
                  title={type === 'delivery' ? 'Carte à la livraison' : 'Carte au retrait'} subtitle="Le livreur a un terminal de paiement" />
              )}
            </div>
          </Block>

          <Block title="Un mot pour la cuisine ou le livreur ?">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} rows={2}
              placeholder="Optionnel"
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:border-ball" />
          </Block>
        </div>

        {/* Récap */}
        <aside className="h-fit space-y-4 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-ink p-5 text-white">
            <h2 className="font-display text-2xl">Ta commande</h2>
            <ul className="mt-4 space-y-3">
              {items.map((i) => (
                <li key={i.key} className="flex justify-between gap-3 text-sm">
                  <div>
                    <span className="font-semibold">{i.quantity}× {i.name}</span>
                    {i.options.length > 0 && <p className="text-xs text-white/50">{i.options.map((op) => op.name).join(' · ')}</p>}
                  </div>
                  <span className="whitespace-nowrap">{money(lineTotal(i))}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 border-t border-white/10 pt-4">
              {promo ? (
                <div className="flex items-center justify-between rounded-xl bg-ball/20 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 font-semibold"><Tag className="size-4 text-ball" /> {promo.code}</span>
                  <button type="button" onClick={() => setPromo(null)} aria-label="Retirer le code"><X className="size-4" /></button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="Code promo"
                    className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm uppercase outline-none placeholder:normal-case placeholder:text-white/40 focus:bg-white/15" />
                  <button type="button" onClick={applyPromo} disabled={promoLoading || !promoInput.trim()}
                    className="rounded-xl bg-white px-4 text-sm font-bold text-ink disabled:opacity-50">
                    {promoLoading ? '…' : 'OK'}
                  </button>
                </div>
              )}
              {promoError && <p className="mt-2 text-xs text-red-300">{promoError}</p>}
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Sous-total" value={money(subtotal)} />
              {type === 'delivery' && <Row label="Livraison" value={fee === 0 ? 'Offerte' : money(fee)} />}
              {discount > 0 && <Row label="Réduction" value={`− ${money(discount)}`} accent />}
              <div className="flex justify-between border-t border-white/10 pt-3 text-xl font-bold">
                <dt>Total</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>
          </div>

          {belowMin && (
            <p className="rounded-2xl bg-amber-100 p-3 text-sm text-amber-900">
              Minimum de commande en livraison : {money(minOrder)}. Il te manque {money(minOrder - subtotal)}.
            </p>
          )}
          {error && <p className="rounded-2xl bg-red-100 p-3 text-sm font-medium text-danger">{error}</p>}

          <button type="submit" disabled={submitting || belowMin || !open || !method}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ball font-bold text-white transition hover:bg-ball-dark disabled:opacity-50">
            {method === 'cmi' && <Lock className="size-4" />}
            {submitting ? 'Envoi…' : !open ? 'Fermé pour le moment' : method === 'cmi' ? `Payer ${money(total)}` : `Valider · ${money(total)}`}
          </button>
          <p className="text-center text-xs text-stone-500">En validant, tu acceptes d'être contacté par téléphone au sujet de ta commande.</p>
        </aside>
      </form>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Choice({ active, onClick, icon, title, subtitle }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition', active ? 'border-ball bg-ball/5' : 'border-stone-200 hover:border-stone-300')}>
      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', active ? 'bg-ball text-white' : 'bg-stone-100')}>{icon}</span>
      <span>
        <span className="block font-bold">{title}</span>
        {subtitle && <span className="block text-xs text-stone-500">{subtitle}</span>}
      </span>
    </button>
  )
}

function TextField({ label, value, onChange, className, ...rest }: {
  label: string; value: string; onChange: (v: string) => void; className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input {...rest} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:border-ball focus:ring-2 focus:ring-ball/20" />
    </label>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-white/60">{label}</dt>
      <dd className={accent ? 'font-semibold text-ball' : ''}>{value}</dd>
    </div>
  )
}
