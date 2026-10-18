import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Banknote, Bike, Clock, CreditCard, Gift, Globe, Lock, MapPin, Plus, Store, Tag, X, Zap } from 'lucide-react'
import { lineTotal, useCart } from '../lib/cart'
import { useSettings } from '../lib/settings'
import { useCustomer } from '../lib/customer'
import { money } from '../lib/format'
import { isOpenNow } from '../lib/hours'
import { buildSlots, slotLabel } from '../lib/slots'
import { getQuote } from '../lib/delivery'
import type { Quote } from '../lib/delivery'
import { errorMessage, supabase } from '../lib/supabase'
import { getSessionId, getUtm, track } from '../lib/analytics'
import type { CustomerAddress, PaymentMethod } from '../lib/types'
import { PageLoader, cx } from '../components/ui'
import { AddressForm } from './AccountPage'
import { AddressPicker } from './AddressPicker'
import type { PickedAddress } from './AddressPicker'

type Preview = {
  ok: boolean
  error?: string
  subtotal: number
  discount: number
  promo_code: string | null
  reward_discount: number
  reward_label: string | null
  delivery_fee: number
  delivery_fee_before_free: number
  free_delivery_threshold: number | null
  min_order: number
  credit_balance: number
  credit_used: number
  total: number
  requires_confirmation: boolean
}

type Reward = { id: string; status: string; label: string | null; category: string | null }

export function CheckoutPage() {
  const { items, subtotal, clear } = useCart()
  const { settings, loading: settingsLoading } = useSettings()
  const { session, complete, loading: authLoading, profile } = useCustomer()
  const navigate = useNavigate()
  const o = settings.ordering
  const p = settings.payments

  const [type, setType] = useState<'delivery' | 'pickup'>('delivery')
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [addressId, setAddressId] = useState<string | null>(null)
  const [addingAddress, setAddingAddress] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [timing, setTiming] = useState<'asap' | 'scheduled'>('asap')
  const [slot, setSlot] = useState<string | null>(null)
  const [dayKey, setDayKey] = useState<string | null>(null)
  const methods = useMemo(() => {
    const m: PaymentMethod[] = []
    if (p.cmi && p.cmi_client_id) m.push('cmi')
    if (p.cash) m.push('cash')
    if (p.card_on_delivery) m.push('card_on_delivery')
    return m
  }, [p])
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState('')
  const [rewards, setRewards] = useState<Reward[]>([])
  const [rewardId, setRewardId] = useState<string | null>(null)
  const [useCredit, setUseCredit] = useState(false)
  const [notes, setNotes] = useState('')
  const [guest, setGuest] = useState(() => {
    try { return { name: '', phone: '', ...JSON.parse(localStorage.getItem('dsb_guest') || '{}') } } catch { return { name: '', phone: '' } }
  })
  const [guestAddress, setGuestAddress] = useState<PickedAddress | null>(null)
  const [guestDetails, setGuestDetails] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tracked = useRef(false)

  const open = isOpenNow(settings)
  const asapPossible = o.asap_enabled && open
  const slotDays = useMemo(() => buildSlots(settings, type), [settings, type])

  // valeurs par défaut
  useEffect(() => {
    if (settingsLoading) return
    setType(o.delivery_enabled ? 'delivery' : 'pickup')
  }, [settingsLoading, o.delivery_enabled])
  useEffect(() => {
    if (!method && methods.length) setMethod(methods.includes('cash') ? 'cash' : methods[0])
  }, [methods, method])
  useEffect(() => {
    if (!asapPossible && timing === 'asap') setTiming('scheduled')
  }, [asapPossible, timing])
  useEffect(() => {
    if (timing === 'scheduled' && slotDays.length && (!slot || !slotDays.some((d) => d.slots.some((s) => s.iso === slot)))) {
      setDayKey(slotDays[0].key)
      setSlot(slotDays[0].slots[0].iso)
    }
  }, [timing, slotDays, slot])

  useEffect(() => {
    if (!tracked.current && items.length) {
      track('begin_checkout', { value: subtotal, items: items.length })
      tracked.current = true
    }
  }, [items.length, subtotal])

  // adresses et fidélité du client
  const loadAddresses = useCallback(async () => {
    const { data } = await supabase.from('customer_addresses').select('*').order('is_default', { ascending: false }).order('created_at')
    const list = (data ?? []) as CustomerAddress[]
    setAddresses(list)
    setAddressId((cur) => cur ?? list[0]?.id ?? null)
    if (list.length === 0) setAddingAddress(true)
  }, [])
  useEffect(() => {
    if (!session) return
    void loadAddresses()
    supabase.rpc('my_loyalty').then(({ data }) => {
      const d = data as { rewards: Reward[] } | null
      setRewards((d?.rewards ?? []).filter((r) => r.status === 'available'))
    })
  }, [session, loadAddresses])

  // devis de livraison quand l'adresse change
  const saved = addresses.find((a) => a.id === addressId) ?? null
  const address = useMemo(() => session
    ? saved
    : guestAddress ? { id: 'guest', user_id: '', label: null, address: guestAddress.address, details: guestDetails, lat: guestAddress.lat, lng: guestAddress.lng, is_default: false } : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [session, saved, guestAddress])
  useEffect(() => {
    setQuote(null)
    setQuoteError(null)
    if (type !== 'delivery' || !address || address.lat == null || address.lng == null) return
    setQuoting(true)
    getQuote(address.lat, address.lng)
      .then((q) => setQuote(q))
      .catch((e) => setQuoteError(errorMessage(e)))
      .finally(() => setQuoting(false))
  }, [type, address])

  const payload = useMemo(() => ({
    type,
    payment_method: method,
    address: address ? address.address : '',
    address_details: session ? (address?.details ?? '') : guestDetails,
    customer: session ? undefined : { name: guest.name, phone: guest.phone },
    quote_id: quote?.quote_id ?? '',
    scheduled_for: timing === 'scheduled' ? slot : null,
    promo_code: promo,
    reward_id: rewardId ?? '',
    use_credit: useCredit,
    notes,
    items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, option_ids: i.options.map((op) => op.id), note: i.note })),
  }), [type, method, address, quote, timing, slot, promo, rewardId, useCredit, notes, items, session, guest, guestDetails])

  // aperçu des totaux calculé par le serveur
  useEffect(() => {
    if (!items.length || !method) return
    if (!session && (guest.name.trim().length < 2 || guest.phone.replace(/\D/g, '').length < 9)) return
    if (type === 'delivery' && !quote) return
    if (timing === 'scheduled' && !slot) return
    let cancelled = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('preview_order', { p: payload })
      if (cancelled) return
      const r = data as Preview
      setPreview(r)
      setPreviewing(false)
      if (!r.ok && promo && /code|promo|bienvenue|inscription|première/i.test(r.error ?? '')) {
        setError(r.error ?? null)
        setPromo('')
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [payload, session, guest, items.length, method, type, quote, timing, slot, promo])

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    if (!session) {
      try { localStorage.setItem('dsb_guest', JSON.stringify(guest)) } catch { /* ignore */ }
    }
    const { data, error: err } = await supabase.rpc('place_order', {
      p: { ...payload, session_id: getSessionId(), utm: getUtm(), source: document.referrer || null },
    })
    if (err) {
      setSubmitting(false)
      return setError(errorMessage(err))
    }
    const res = data as { token: string; total: number; payment_method: PaymentMethod }
    track('purchase', { value: Number(res.total), items: items.length })
    if (res.payment_method === 'cmi') {
      const { data: pay, error: payErr } = await supabase.functions.invoke('cmi-init', { body: { token: res.token, origin: window.location.origin } })
      if (payErr || !pay) {
        clear()
        return navigate(`/suivi/${res.token}?payment=error`)
      }
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
    }
    clear()
    navigate(`/suivi/${res.token}?new=1`)
  }

  if (authLoading || settingsLoading) return <PageLoader />
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="font-display text-3xl">Ton panier est vide</p>
        <Link to="/" className="mt-6 inline-block rounded-full bg-ball px-6 py-3 font-bold text-white">Retour au menu</Link>
      </div>
    )
  }
  if (o.require_account && !session) return <Navigate to="/connexion?next=/commande" replace />
  if (session && !complete) return <Navigate to="/compte/profil?next=/commande" replace />

  const freeLeft = type === 'delivery' && preview?.ok && preview.free_delivery_threshold
    ? preview.free_delivery_threshold - (preview.subtotal - preview.discount - preview.reward_discount) : 0
  const canSubmit = Boolean(preview?.ok) && !submitting && !previewing && (type === 'pickup' || Boolean(quote?.available))

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 hover:text-ink"><ArrowLeft className="size-4" /> Retour au menu</Link>
      <h1 className="font-display mt-4 text-4xl">Finaliser</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {!session && (
            <Block title="Tes coordonnées">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="mb-1.5 block text-sm font-medium">Prénom et nom</span>
                  <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} autoComplete="name"
                    className="w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-ball" /></label>
                <label className="block"><span className="mb-1.5 block text-sm font-medium">Téléphone</span>
                  <input type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} autoComplete="tel" placeholder="06 12 34 56 78"
                    className="w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-ball" /></label>
              </div>
              <p className="mt-3 text-sm text-stone-600">
                <Link to="/connexion?next=/commande" className="font-semibold text-ball">Crée ton compte</Link> pour gagner des tampons DUNK Card et profiter de -50 % sur ta 1ʳᵉ commande.
              </p>
            </Block>
          )}

          <Block title="Livraison ou à emporter ?">
            <div className="grid grid-cols-2 gap-3">
              {o.delivery_enabled && <Choice active={type === 'delivery'} onClick={() => setType('delivery')} icon={<Bike className="size-5" />} title="Livraison" subtitle={`≈ ${o.delivery_time_min} min`} />}
              {o.pickup_enabled && <Choice active={type === 'pickup'} onClick={() => setType('pickup')} icon={<Store className="size-5" />} title="À emporter" subtitle="Sans frais, sans minimum" />}
            </div>
            {type === 'pickup' && settings.restaurant.address && (
              <p className="mt-3 flex items-center gap-2 text-sm text-stone-600"><MapPin className="size-4 text-ball" /> {settings.restaurant.address}{settings.restaurant.city ? `, ${settings.restaurant.city}` : ''}</p>
            )}
          </Block>

          {type === 'delivery' && (
            <Block title="Adresse de livraison">
              {!session && (
                <div className="space-y-3">
                  <AddressPicker initial={guestAddress} onPick={setGuestAddress} />
                  <input value={guestDetails} onChange={(e) => setGuestDetails(e.target.value)} placeholder="Étage, appartement, interphone, repère…"
                    className="w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-ball" />
                </div>
              )}
              {session && addresses.length > 0 && !addingAddress && (
                <div className="space-y-2">
                  {addresses.map((a) => (
                    <button key={a.id} type="button" onClick={() => setAddressId(a.id)}
                      className={cx('flex w-full items-start gap-3 rounded-2xl border-2 p-3 text-left', addressId === a.id ? 'border-ball bg-ball/5' : 'border-stone-200')}>
                      <MapPin className={cx('mt-0.5 size-5 shrink-0', addressId === a.id ? 'text-ball' : 'text-stone-400')} />
                      <span className="min-w-0">
                        <span className="block font-semibold">{a.label || 'Adresse'}</span>
                        <span className="block text-sm text-stone-600">{a.address}</span>
                        {a.details && <span className="block text-xs text-stone-500">{a.details}</span>}
                      </span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setAddingAddress(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ball"><Plus className="size-4" /> Nouvelle adresse</button>
                </div>
              )}
              {session && addingAddress && (
                <AddressForm address={null} isFirst={addresses.length === 0} onDone={async (saved) => {
                  setAddingAddress(false)
                  await loadAddresses()
                  if (saved) setAddressId(saved.id)
                }} />
              )}
              {quoting && <p className="mt-3 text-sm text-stone-500">Calcul de la distance…</p>}
              {quoteError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-danger">{quoteError}</p>}
              {quote && (
                quote.available
                  ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">📍 {quote.distance_km.toString().replace('.', ',')} km par la route · livraison {money(quote.fee ?? 0)}{quote.duration_min ? ` · ≈ ${quote.duration_min} min de trajet` : ''}</p>
                  : <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-danger">Désolé, cette adresse est à {quote.distance_km.toString().replace('.', ',')} km : nous livrons jusqu’à {quote.max_km} km. Le retrait à emporter reste possible !</p>
              )}
            </Block>
          )}

          <Block title="Quand ?">
            <div className="grid grid-cols-2 gap-3">
              <Choice active={timing === 'asap'} disabled={!asapPossible} onClick={() => setTiming('asap')} icon={<Zap className="size-5" />}
                title="Dès que possible" subtitle={!open ? 'Fermé pour le moment' : !o.asap_enabled ? 'En pause' : type === 'delivery' ? `≈ ${o.delivery_time_min} min` : `Prêt en ≈ ${o.prep_time_min} min`} />
              {o.scheduling_enabled && <Choice active={timing === 'scheduled'} onClick={() => setTiming('scheduled')} icon={<Clock className="size-5" />} title="Programmer" subtitle="Choisis ton créneau" />}
            </div>
            {timing === 'scheduled' && (
              slotDays.length === 0 ? <p className="mt-3 text-sm text-stone-500">Aucun créneau disponible pour le moment.</p> : (
                <div className="mt-4 space-y-3">
                  <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1">
                    {slotDays.map((d) => (
                      <button key={d.key} type="button" onClick={() => { setDayKey(d.key); setSlot(d.slots[0].iso) }}
                        className={cx('rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap capitalize', dayKey === d.key ? 'bg-ink text-white' : 'bg-stone-100')}>{d.label}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {(slotDays.find((d) => d.key === dayKey)?.slots ?? []).map((s) => (
                      <button key={s.iso} type="button" onClick={() => setSlot(s.iso)}
                        className={cx('rounded-xl py-2 text-sm font-semibold', slot === s.iso ? 'bg-ball text-white' : 'bg-stone-100 hover:bg-stone-200')}>{s.label}</button>
                    ))}
                  </div>
                </div>
              )
            )}
          </Block>

          <Block title="Paiement">
            <div className="grid gap-3">
              {methods.includes('cmi') && <Choice active={method === 'cmi'} onClick={() => setMethod('cmi')} icon={<Globe className="size-5" />} title="Carte bancaire en ligne" subtitle="Paiement sécurisé" />}
              {methods.includes('cash') && <Choice active={method === 'cash'} onClick={() => setMethod('cash')} icon={<Banknote className="size-5" />} title={type === 'delivery' ? 'Espèces à la livraison' : 'Espèces au retrait'} subtitle="Prévois la monnaie si possible" />}
              {methods.includes('card_on_delivery') && <Choice active={method === 'card_on_delivery'} onClick={() => setMethod('card_on_delivery')} icon={<CreditCard className="size-5" />} title={type === 'delivery' ? 'Carte à la livraison' : 'Carte au retrait'} subtitle="Terminal de paiement" />}
            </div>
            {preview?.ok && preview.requires_confirmation && method === 'cash' && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Pour ta 1ʳᵉ commande en espèces, on te confirme la commande par WhatsApp ou téléphone avant de la préparer.</p>
            )}
          </Block>

          <Block title="Un mot pour la cuisine ou le livreur ?">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} rows={2} placeholder="Optionnel"
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:border-ball" />
          </Block>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-wine p-5 text-cream">
            <h2 className="font-display text-xl">Ta commande</h2>
            {session && <p className="mt-1 text-xs text-cream/60">{profile?.first_name} {profile?.last_name} · {profile?.phone} · <Link to="/compte/profil?next=/commande" className="underline">modifier</Link></p>}
            <ul className="mt-4 space-y-3">
              {items.map((i) => (
                <li key={i.key} className="flex justify-between gap-3 text-sm">
                  <div>
                    <span className="font-semibold">{i.quantity}× {i.name}</span>
                    {i.options.length > 0 && <p className="text-xs text-cream/50">{i.options.map((op) => op.name).join(' · ')}</p>}
                  </div>
                  <span className="whitespace-nowrap">{money(lineTotal(i))}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 space-y-2 border-t border-cream/10 pt-4">
              {rewards.length > 0 && !promo && (
                <div className="space-y-1.5">
                  {rewards.map((r) => (
                    <button key={r.id} type="button" onClick={() => setRewardId(rewardId === r.id ? null : r.id)}
                      className={cx('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm', rewardId === r.id ? 'bg-cream text-wine' : 'bg-cream/10')}>
                      <Gift className="size-4" /> {r.label} {rewardId === r.id && '✓'}
                    </button>
                  ))}
                </div>
              )}
              {!rewardId && (promo ? (
                <div className="flex items-center justify-between rounded-xl bg-ball/30 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 font-semibold"><Tag className="size-4" /> {promo}</span>
                  <button type="button" onClick={() => setPromo('')} aria-label="Retirer le code"><X className="size-4" /></button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="Code promo"
                    className="min-w-0 flex-1 rounded-xl bg-cream/10 px-3 py-2.5 text-sm uppercase outline-none placeholder:normal-case placeholder:text-cream/40" />
                  <button type="button" disabled={!promoInput.trim()} onClick={() => { setError(null); setPromo(promoInput.trim()); setPromoInput('') }}
                    className="rounded-xl bg-cream px-4 text-sm font-bold text-wine disabled:opacity-50">OK</button>
                </div>
              ))}
              {preview?.ok && preview.credit_balance > 0 && (
                <label className="flex items-center justify-between rounded-xl bg-cream/10 px-3 py-2 text-sm">
                  <span>Utiliser mon crédit ({money(preview.credit_balance)})</span>
                  <input type="checkbox" className="size-4 accent-[#B5121B]" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />
                </label>
              )}
            </div>

            {preview?.ok ? (
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="Sous-total" value={money(preview.subtotal)} />
                {preview.discount > 0 && <Row label={`Code ${preview.promo_code}`} value={`− ${money(preview.discount)}`} accent />}
                {preview.reward_discount > 0 && <Row label={preview.reward_label ?? 'Récompense'} value={`− ${money(preview.reward_discount)}`} accent />}
                {type === 'delivery' && <Row label="Livraison" value={preview.delivery_fee === 0 ? (preview.delivery_fee_before_free > 0 ? 'Offerte 🎉' : 'Offerte') : money(preview.delivery_fee)} />}
                {preview.credit_used > 0 && <Row label="Crédit DUNK" value={`− ${money(preview.credit_used)}`} accent />}
                <div className="flex justify-between border-t border-cream/10 pt-3 text-xl font-bold"><dt>Total</dt><dd>{money(preview.total)}</dd></div>
                {freeLeft > 0 && preview.delivery_fee > 0 && <p className="text-xs text-cream/60">Plus que {money(freeLeft)} pour la livraison offerte</p>}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-cream/60">{previewing ? 'Calcul…' : type === 'delivery' && !quote ? 'Choisis ton adresse pour voir le total' : ''}</p>
            )}
          </div>

          {preview && !preview.ok && preview.error && <p className="rounded-2xl bg-amber-100 p-3 text-sm text-amber-900">{preview.error}</p>}
          {error && <p className="rounded-2xl bg-red-100 p-3 text-sm font-medium text-danger">{error}</p>}

          <button type="button" onClick={submit} disabled={!canSubmit}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ball font-bold text-white transition hover:bg-ball-dark disabled:opacity-50">
            {method === 'cmi' && <Lock className="size-4" />}
            {submitting ? 'Envoi…' : preview?.ok ? `${method === 'cmi' ? 'Payer' : 'Valider'} · ${money(preview.total)}` : 'Valider'}
          </button>
          {timing === 'scheduled' && slot && <p className="text-center text-xs text-stone-500">{type === 'delivery' ? 'Livraison' : 'Retrait'} prévu {slotLabel(slot)}</p>}
        </aside>
      </div>
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

function Choice({ active, onClick, icon, title, subtitle, disabled }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; subtitle?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cx('flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition disabled:opacity-40', active ? 'border-ball bg-ball/5' : 'border-stone-200 hover:border-stone-300')}>
      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', active ? 'bg-ball text-white' : 'bg-stone-100')}>{icon}</span>
      <span>
        <span className="block font-bold">{title}</span>
        {subtitle && <span className="block text-xs text-stone-500">{subtitle}</span>}
      </span>
    </button>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-cream/60">{label}</dt>
      <dd className={accent ? 'font-semibold text-ball-light' : ''}>{value}</dd>
    </div>
  )
}
