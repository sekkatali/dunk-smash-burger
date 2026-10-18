import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Check, Gift, LogOut, MapPin, Pencil, Plus, RotateCcw, ShieldCheck, Star, Trash2 } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { toE164, useCustomer } from '../lib/customer'
import { useCart } from '../lib/cart'
import { STATUS_COLOR, STATUS_LABEL, dateLong, dateTime, money } from '../lib/format'
import type { CustomerAddress, LoyaltyOption, Order } from '../lib/types'
import { Badge, PageLoader, cx, useToast } from '../components/ui'
import { useShopMenu } from './menuContext'
import { AddressPicker } from './AddressPicker'
import type { PickedAddress } from './AddressPicker'

type Tab = 'commandes' | 'fidelite' | 'adresses' | 'profil'

export function AccountPage() {
  const { tab = 'commandes' } = useParams()
  const { session, loading, complete, profile, signOut } = useCustomer()
  const navigate = useNavigate()

  if (loading) return <PageLoader />
  if (!session) return <Navigate to={`/connexion?next=/compte/${tab}`} replace />
  if (!complete && tab !== 'profil') return <Navigate to={`/compte/profil?next=/compte/${tab}`} replace />

  const tabs: { id: Tab; label: string }[] = [
    { id: 'commandes', label: 'Commandes' },
    { id: 'fidelite', label: 'DUNK Card' },
    { id: 'adresses', label: 'Adresses' },
    { id: 'profil', label: 'Profil' },
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-script text-2xl text-ball">salut {profile?.first_name || ''}</p>
          <h1 className="font-display text-3xl">Mon compte</h1>
        </div>
        <button type="button" onClick={async () => { await signOut(); navigate('/') }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500">
          <LogOut className="size-4" /> Déconnexion
        </button>
      </div>
      <div className="scrollbar-none -mx-4 mt-5 flex gap-2 overflow-x-auto px-4">
        {tabs.map((t) => (
          <Link key={t.id} to={`/compte/${t.id}`}
            className={cx('rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap', tab === t.id ? 'bg-ink text-white' : 'bg-white ring-1 ring-black/5')}>
            {t.label}
          </Link>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'commandes' && <OrdersTab />}
        {tab === 'fidelite' && <LoyaltyTab />}
        {tab === 'adresses' && <AddressesTab />}
        {tab === 'profil' && <ProfileTab />}
      </div>
    </div>
  )
}

/* ===================================================================== PROFIL */
function ProfileTab() {
  const { profile, session, refresh } = useCustomer()
  const [params] = useSearchParams()
  const next = params.get('next')
  const navigate = useNavigate()
  const toast = useToast()
  const [f, setF] = useState({
    first_name: profile?.first_name ?? '', last_name: profile?.last_name ?? '', phone: profile?.phone ?? '',
    email: profile?.email ?? session?.user.email ?? '', marketing_opt_in: profile?.marketing_opt_in ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (profile) setF((x) => ({ ...x, first_name: profile.first_name ?? x.first_name, last_name: profile.last_name ?? x.last_name, phone: profile.phone ?? x.phone, email: profile.email ?? x.email }))
  }, [profile])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.first_name.trim() || !f.last_name.trim()) return toast('Prénom et nom obligatoires', 'error')
    if (f.phone.replace(/\D/g, '').length < 9) return toast('Numéro de téléphone invalide', 'error')
    if (!f.email.includes('@')) return toast('E-mail obligatoire', 'error')
    setSaving(true)
    const { error } = await supabase.from('customers').upsert({
      user_id: session!.user.id, first_name: f.first_name, last_name: f.last_name, phone: toE164(f.phone),
      email: f.email.trim(), marketing_opt_in: f.marketing_opt_in,
    })
    setSaving(false)
    if (error) return toast(errorMessage(error), 'error')
    await refresh()
    toast('Profil enregistré')
    if (next) navigate(next, { replace: true })
  }

  const sendCode = async () => {
    const { error } = await supabase.auth.updateUser({ phone: toE164(f.phone) })
    if (error) {
      return toast(/provider/i.test(error.message) ? 'La vérification par SMS arrive bientôt.' : errorMessage(error), 'error')
    }
    setOtpSent(true)
  }

  const verify = async () => {
    const { error } = await supabase.auth.verifyOtp({ phone: toE164(f.phone), token: code, type: 'phone_change' })
    if (error) return toast('Code invalide', 'error')
    await supabase.from('customers').update({ phone: toE164(f.phone) }).eq('user_id', session!.user.id)
    await refresh()
    setOtpSent(false)
    toast('Numéro vérifié ✅')
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      {next && <p className="rounded-xl bg-cream p-3 text-sm">Complète ton profil pour continuer ta commande.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <In label="Prénom" value={f.first_name} onChange={(v) => setF({ ...f, first_name: v })} autoComplete="given-name" />
        <In label="Nom" value={f.last_name} onChange={(v) => setF({ ...f, last_name: v })} autoComplete="family-name" />
      </div>
      <div>
        <In label="Téléphone" type="tel" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} autoComplete="tel" placeholder="06 12 34 56 78" />
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          {profile?.phone_verified && profile.phone === toE164(f.phone)
            ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><ShieldCheck className="size-3.5" /> Numéro vérifié</span>
            : f.phone && <button type="button" onClick={sendCode} className="font-semibold text-ball">Vérifier mon numéro par SMS</button>}
        </div>
        {otpSent && (
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Code reçu" inputMode="numeric"
              className="w-36 rounded-xl border border-stone-300 px-3 py-2 tracking-widest" />
            <button type="button" onClick={verify} className="rounded-xl bg-ink px-4 text-sm font-bold text-white">Valider</button>
          </div>
        )}
      </div>
      <In label="E-mail" type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoComplete="email" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-[#B5121B]" checked={f.marketing_opt_in} onChange={(e) => setF({ ...f, marketing_opt_in: e.target.checked })} />
        Je veux recevoir les offres et nouveautés DUNK (désinscription à tout moment)
      </label>
      <button type="submit" disabled={saving} className="h-12 w-full rounded-full bg-ball font-bold text-white disabled:opacity-50">
        {saving ? 'Enregistrement…' : next ? 'Continuer' : 'Enregistrer'}
      </button>
    </form>
  )
}

function In({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input {...rest} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:border-ball focus:ring-2 focus:ring-ball/20" />
    </label>
  )
}

/* ===================================================================== COMMANDES */
function OrdersTab() {
  const { session } = useCustomer()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const reorder = useReorder()

  useEffect(() => {
    supabase.from('orders').select('*, order_items(*)').eq('customer_id', session!.user.id)
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setOrders((data ?? []) as Order[]))
  }, [session])

  if (!orders) return <PageLoader />
  if (orders.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <p className="font-display text-2xl">Pas encore de commande</p>
        <Link to="/" className="mt-4 inline-block rounded-full bg-ball px-6 py-3 font-bold text-white">Voir le menu</Link>
      </div>
    )
  }
  return (
    <ul className="space-y-3">
      {orders.map((o) => (
        <li key={o.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold">Commande n°{o.number}</p>
              <p className="text-xs text-stone-500">{dateTime(o.created_at)} · {o.type === 'delivery' ? 'Livraison' : 'À emporter'}</p>
            </div>
            <Badge className={STATUS_COLOR[o.status]}>{STATUS_LABEL[o.status]}</Badge>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-stone-600">{(o.order_items ?? []).map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold">{money(o.total)}</span>
            <div className="flex gap-2">
              <Link to={`/suivi/${o.token}`} className="rounded-full bg-stone-100 px-4 py-2 text-sm font-semibold">Détail</Link>
              <button type="button" onClick={() => reorder(o.order_items ?? [])} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white">
                <RotateCcw className="size-4" /> Recommander
              </button>
            </div>
          </div>
          {o.status === 'delivered' && !o.rating && (
            <Link to={`/suivi/${o.token}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ball"><Star className="size-3.5" /> Noter cette commande</Link>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Remet les articles d'une commande dans le panier (prix et disponibilités actuels, revérifiés par le serveur). */
export function useReorder() {
  const { menu } = useShopMenu()
  const { add, setOpen } = useCart()
  const toast = useToast()
  return useCallback((items: { product_id: string | null; quantity: number; options: { id: string }[]; note?: string | null }[]) => {
    let added = 0
    let skipped = 0
    for (const it of items) {
      const p = menu.products.find((x) => x.id === it.product_id && x.active && x.available)
      if (!p) { skipped++; continue }
      const opts = (it.options ?? [])
        .map((o) => {
          const g = menu.groups.find((gr) => gr.options.some((x) => x.id === o.id))
          const opt = g?.options.find((x) => x.id === o.id && x.available)
          return g && opt && menu.links.some((l) => l.product_id === p.id && l.group_id === g.id)
            ? { id: opt.id, group: g.name, name: opt.name, price: Number(opt.price) } : null
        })
        .filter((x): x is { id: string; group: string; name: string; price: number } => Boolean(x))
      add({ product_id: p.id, name: p.name, image_url: p.image_url, base_price: Number(p.price), options: opts, note: it.note ?? '', quantity: it.quantity })
      added++
    }
    if (added) {
      toast(skipped ? `${added} article(s) ajouté(s), ${skipped} plus disponible(s)` : 'Commande remise dans ton panier 🍔')
      setOpen(true)
    } else toast('Ces articles ne sont plus disponibles', 'error')
  }, [menu, add, setOpen, toast])
}

/* ===================================================================== FIDÉLITÉ */
type Loyalty = {
  enabled: boolean; required: number; min_order: number; options: LoyaltyOption[]; stamps: number
  last_stamp_at: string | null; progress_expiry_days: number; credit: number
  rewards: { id: string; status: 'to_choose' | 'available'; label: string | null; reward_type: string | null; category: string | null; amount: number | null; expires_at: string }[]
}

function LoyaltyTab() {
  const toast = useToast()
  const [l, setL] = useState<Loyalty | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_loyalty')
    setL(data as Loyalty)
  }, [])
  useEffect(() => { void load() }, [load])

  const choose = async (rewardId: string, idx: number) => {
    const { data, error } = await supabase.rpc('choose_reward', { p_reward: rewardId, p_option: idx })
    if (error || !data) return toast('Impossible de choisir cette récompense', 'error')
    toast('Récompense débloquée 🎉')
    void load()
  }

  if (!l) return <PageLoader />
  if (!l.enabled) return <p className="rounded-3xl bg-white p-6 text-center text-stone-600">Le programme de fidélité arrive bientôt.</p>

  return (
    <div className="space-y-4">
      <div className="court-lines relative overflow-hidden rounded-3xl bg-wine p-6 text-cream">
        <p className="font-script text-2xl text-ball-light">dunk card</p>
        <p className="font-display text-2xl">{l.stamps} / {l.required} tampons</p>
        <div className="mt-5 flex gap-2.5">
          {Array.from({ length: l.required }, (_, i) => (
            <div key={i} className={cx('flex size-12 items-center justify-center rounded-full border-2 text-xl', i < l.stamps ? 'border-cream bg-cream text-wine' : 'border-cream/30 text-cream/30')}>
              {i < l.stamps ? '🍔' : i + 1}
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-cream/70">
          1 tampon par commande livrée ou retirée d’au moins {money(l.min_order)} de produits. Au bout de {l.required} : tu choisis ta récompense.
        </p>
        {l.last_stamp_at && <p className="mt-1 text-xs text-cream/50">Tes tampons expirent après {Math.round(l.progress_expiry_days / 30)} mois sans commande.</p>}
      </div>

      {l.credit > 0 && (
        <div className="flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm">
          <div>
            <p className="text-sm text-stone-500">Crédit DUNK disponible</p>
            <p className="text-2xl font-bold">{money(l.credit)}</p>
          </div>
          <p className="text-xs text-stone-500">Utilisable au moment de payer</p>
        </div>
      )}

      {l.rewards.map((r) => (
        <div key={r.id} className="rounded-3xl bg-white p-5 shadow-sm ring-2 ring-ball/30">
          <p className="flex items-center gap-2 font-bold"><Gift className="size-5 text-ball" />
            {r.status === 'to_choose' ? 'Choisis ta récompense !' : r.label}
          </p>
          <p className="text-xs text-stone-500">À utiliser avant le {dateLong(r.expires_at)}</p>
          {r.status === 'to_choose' ? (
            <div className="mt-3 grid gap-2">
              {l.options.map((o, idx) => (
                <button key={idx} type="button" onClick={() => choose(r.id, idx)} className="flex items-center justify-between rounded-2xl border border-stone-200 px-4 py-3 text-left font-semibold hover:border-ball">
                  {o.label} <Check className="size-4 text-ball" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-600">Ajoute un article « {r.category} » à ton panier et sélectionne cette récompense au moment de payer.</p>
          )}
        </div>
      ))}
    </div>
  )
}

/* ===================================================================== ADRESSES */
function AddressesTab() {
  const { session } = useCustomer()
  const toast = useToast()
  const [list, setList] = useState<CustomerAddress[] | null>(null)
  const [editing, setEditing] = useState<'new' | CustomerAddress | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('customer_addresses').select('*').order('is_default', { ascending: false }).order('created_at')
    setList((data ?? []) as CustomerAddress[])
  }, [])
  useEffect(() => { void load() }, [load])

  const remove = async (a: CustomerAddress) => {
    if (!confirm('Supprimer cette adresse ?')) return
    await supabase.from('customer_addresses').delete().eq('id', a.id)
    void load()
  }
  const makeDefault = async (a: CustomerAddress) => {
    await supabase.from('customer_addresses').update({ is_default: false }).eq('user_id', session!.user.id)
    await supabase.from('customer_addresses').update({ is_default: true }).eq('id', a.id)
    toast('Adresse par défaut mise à jour')
    void load()
  }

  if (!list) return <PageLoader />
  return (
    <div className="space-y-3">
      {list.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <MapPin className="mt-0.5 size-5 shrink-0 text-ball" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{a.label || 'Adresse'} {a.is_default && <Badge className="ml-1 bg-ink text-white">Par défaut</Badge>}</p>
            <p className="text-sm text-stone-600">{a.address}</p>
            {a.details && <p className="text-xs text-stone-500">{a.details}</p>}
            {!a.is_default && <button type="button" onClick={() => makeDefault(a)} className="mt-1 text-xs font-semibold text-ball">Définir par défaut</button>}
          </div>
          <button type="button" onClick={() => setEditing(a)} className="p-1.5 text-stone-400"><Pencil className="size-4" /></button>
          <button type="button" onClick={() => remove(a)} className="p-1.5 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
        </div>
      ))}
      {editing ? (
        <AddressForm address={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void load() }} isFirst={list.length === 0} />
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="flex w-full items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-stone-300 py-4 font-semibold text-stone-600">
          <Plus className="size-4" /> Ajouter une adresse
        </button>
      )}
    </div>
  )
}

export function AddressForm({ address, onDone, isFirst }: { address: CustomerAddress | null; onDone: (saved?: CustomerAddress) => void; isFirst?: boolean }) {
  const { session } = useCustomer()
  const toast = useToast()
  const [label, setLabel] = useState(address?.label ?? 'Maison')
  const [details, setDetails] = useState(address?.details ?? '')
  const [picked, setPicked] = useState<PickedAddress | null>(address && address.lat != null && address.lng != null ? { address: address.address, lat: address.lat, lng: address.lng } : null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!picked) return toast('Place ton adresse sur la carte', 'error')
    setSaving(true)
    const row = { user_id: session!.user.id, label: label.trim() || null, address: picked.address, details: details.trim() || null, lat: picked.lat, lng: picked.lng, ...(isFirst ? { is_default: true } : {}) }
    const { data, error } = address
      ? await supabase.from('customer_addresses').update(row).eq('id', address.id).select('*').single()
      : await supabase.from('customer_addresses').insert(row).select('*').single()
    setSaving(false)
    if (error) return toast(errorMessage(error), 'error')
    onDone(data as CustomerAddress)
  }

  return (
    <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex gap-2">
        {['Maison', 'Travail', 'Autre'].map((l) => (
          <button key={l} type="button" onClick={() => setLabel(l)} className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', label === l ? 'bg-ink text-white' : 'bg-stone-100')}>{l}</button>
        ))}
      </div>
      <AddressPicker initial={picked} onPick={setPicked} />
      <input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Étage, appartement, interphone, repère…"
        className="w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-ball" />
      <div className="flex gap-2">
        <button type="button" onClick={() => onDone()} className="h-11 flex-1 rounded-full bg-stone-100 font-semibold">Annuler</button>
        <button type="button" onClick={save} disabled={saving} className="h-11 flex-1 rounded-full bg-ball font-bold text-white disabled:opacity-50">
          {saving ? '…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
