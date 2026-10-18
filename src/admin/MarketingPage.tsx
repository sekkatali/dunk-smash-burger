import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Download, Gift, MessageCircle, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { useMenu } from '../lib/menu'
import { dateLong, downloadCsv, money, slugify, waLink } from '../lib/format'
import type { PromoCode, Settings } from '../lib/types'
import {
  Badge, Button, Card, Empty, Field, Input, Modal, NumberInput, PageLoader, Select, Tabs, Textarea, Toggle, cx, useToast,
} from '../components/ui'
import { PageHeader } from './PageHeader'

type Tab = 'promos' | 'site' | 'customers' | 'tracking'

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('promos')
  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="Codes promo, mise en avant, fichier clients, pixels publicitaires et liens de campagne."
        actions={
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'promos', label: 'Codes promo' },
            { id: 'site', label: 'Bannière & mise en avant' },
            { id: 'customers', label: 'Clients' },
            { id: 'tracking', label: 'Pixels & liens' },
          ]} />
        }
      />
      {tab === 'promos' && <PromosTab />}
      {tab === 'site' && <SiteTab />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'tracking' && <TrackingTab />}
    </div>
  )
}

/* ===================================================================== CODES PROMO */
function promoLabel(p: PromoCode) {
  if (p.type === 'percent') return `-${p.value} %${p.max_discount ? ` (max ${money(p.max_discount)})` : ''}`
  if (p.type === 'fixed') return `-${money(p.value)}`
  return 'Livraison offerte'
}

function promoState(p: PromoCode): { label: string; cls: string } {
  const now = Date.now()
  if (!p.active) return { label: 'Désactivé', cls: 'bg-stone-200 text-stone-600' }
  if (p.ends_at && new Date(p.ends_at).getTime() < now) return { label: 'Expiré', cls: 'bg-stone-200 text-stone-600' }
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return { label: 'Programmé', cls: 'bg-sky-100 text-sky-800' }
  if (p.max_uses && p.uses >= p.max_uses) return { label: 'Épuisé', cls: 'bg-stone-200 text-stone-600' }
  return { label: 'Actif', cls: 'bg-emerald-100 text-emerald-800' }
}

function PromosTab() {
  const toast = useToast()
  const [promos, setPromos] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PromoCode | 'new' | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('promo_codes').select('*').order('created_at', { ascending: false })
    if (error) toast(errorMessage(error), 'error')
    setPromos((data ?? []) as PromoCode[])
    setLoading(false)
  }, [toast])
  useEffect(() => { void load() }, [load])

  const toggle = async (p: PromoCode, active: boolean) => {
    await supabase.from('promo_codes').update({ active }).eq('id', p.id)
    void load()
  }
  const remove = async (p: PromoCode) => {
    if (!confirm(`Supprimer le code ${p.code} ?`)) return
    const { error } = await supabase.from('promo_codes').delete().eq('id', p.id)
    if (error) return toast(errorMessage(error), 'error')
    void load()
  }

  if (loading) return <PageLoader />
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')}><Plus className="size-4" /> Nouveau code</Button></div>
      {promos.length === 0 ? (
        <Empty icon={<Gift className="size-10" />} title="Aucun code promo">Crée un code de bienvenue, une offre week-end ou un code influenceur.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs tracking-wide text-stone-500 uppercase">
              <tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Réduction</th><th className="px-4 py-3">Conditions</th><th className="px-4 py-3">Utilisations</th><th className="px-4 py-3">État</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {promos.map((p) => {
                const st = promoState(p)
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3"><p className="font-mono font-bold">{p.code}</p>{p.description && <p className="text-xs text-stone-500">{p.description}</p>}</td>
                    <td className="px-4 py-3 font-semibold">{promoLabel(p)}</td>
                    <td className="px-4 py-3 text-xs text-stone-600">
                      {[
                        p.min_order > 0 && `Min. ${money(p.min_order)}`,
                        p.first_order_only && '1ère commande',
                        p.max_uses_per_customer && `${p.max_uses_per_customer}×/client`,
                        p.ends_at && `Jusqu'au ${dateLong(p.ends_at)}`,
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3">{p.uses}{p.max_uses ? ` / ${p.max_uses}` : ''}</td>
                    <td className="px-4 py-3"><Badge className={st.cls}>{st.label}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Toggle checked={p.active} onChange={(v) => toggle(p, v)} />
                        <button type="button" onClick={() => setEditing(p)} className="p-1.5 text-stone-400 hover:text-ink"><Pencil className="size-4" /></button>
                        <button type="button" onClick={() => remove(p)} className="p-1.5 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <PromoForm promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

function PromoForm({ promo, onClose, onSaved }: { promo: PromoCode | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({
    code: promo?.code ?? '',
    description: promo?.description ?? '',
    type: promo?.type ?? 'percent' as PromoCode['type'],
    value: promo?.value ?? 10 as number | null,
    min_order: promo?.min_order ?? 0 as number | null,
    max_discount: promo?.max_discount ?? null as number | null,
    max_uses: promo?.max_uses ?? null as number | null,
    max_uses_per_customer: promo?.max_uses_per_customer ?? null as number | null,
    first_order_only: promo?.first_order_only ?? false,
    starts_at: toLocalInput(promo?.starts_at ?? null),
    ends_at: toLocalInput(promo?.ends_at ?? null),
    active: promo?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    const code = f.code.trim().toUpperCase().replace(/\s+/g, '')
    if (!code) return toast('Code obligatoire', 'error')
    setSaving(true)
    const values = {
      code,
      description: f.description.trim() || null,
      type: f.type,
      value: f.type === 'free_delivery' ? 0 : f.value ?? 0,
      min_order: f.min_order ?? 0,
      max_discount: f.type === 'percent' ? f.max_discount : null,
      max_uses: f.max_uses || null,
      max_uses_per_customer: f.max_uses_per_customer || null,
      first_order_only: f.first_order_only,
      starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
      ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
      active: f.active,
    }
    const { error } = promo
      ? await supabase.from('promo_codes').update(values).eq('id', promo.id)
      : await supabase.from('promo_codes').insert(values)
    setSaving(false)
    if (error) return toast(error.code === '23505' ? 'Ce code existe déjà' : errorMessage(error), 'error')
    toast('Code enregistré')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={promo ? `Modifier ${promo.code}` : 'Nouveau code promo'}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button loading={saving} onClick={save}>Enregistrer</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code *" hint="Ex : DUNK15, WEEKEND, NAWAL10">
          <Input value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono uppercase" />
        </Field>
        <Field label="Description interne"><Input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Influenceuse, flyer…" /></Field>
        <Field label="Type de réduction">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as PromoCode['type'])}>
            <option value="percent">Pourcentage</option>
            <option value="fixed">Montant fixe (DH)</option>
            <option value="free_delivery">Livraison offerte</option>
          </Select>
        </Field>
        {f.type !== 'free_delivery' && (
          <Field label={f.type === 'percent' ? 'Pourcentage (%)' : 'Montant (DH)'}><NumberInput value={f.value} onChange={(v) => set('value', v)} min={0} /></Field>
        )}
        {f.type === 'percent' && (
          <Field label="Réduction max (DH)" hint="Optionnel"><NumberInput value={f.max_discount} onChange={(v) => set('max_discount', v)} min={0} /></Field>
        )}
        <Field label="Minimum de commande (DH)"><NumberInput value={f.min_order} onChange={(v) => set('min_order', v)} min={0} /></Field>
        <Field label="Utilisations max au total" hint="Vide = illimité"><NumberInput value={f.max_uses} onChange={(v) => set('max_uses', v)} min={1} /></Field>
        <Field label="Utilisations max par client" hint="Repéré par numéro de téléphone"><NumberInput value={f.max_uses_per_customer} onChange={(v) => set('max_uses_per_customer', v)} min={1} /></Field>
        <Field label="Début (optionnel)"><Input type="datetime-local" value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></Field>
        <Field label="Fin (optionnel)"><Input type="datetime-local" value={f.ends_at} onChange={(e) => set('ends_at', e.target.value)} /></Field>
        <div className="space-y-3 sm:col-span-2">
          <Toggle checked={f.first_order_only} onChange={(v) => set('first_order_only', v)} label="Réservé à la première commande" description="Idéal pour un code de bienvenue" />
          <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Actif" />
        </div>
      </div>
    </Modal>
  )
}

/* ===================================================================== SITE */
function SiteTab() {
  const { settings, save } = useSettings()
  const { menu, loading, reload } = useMenu()
  const toast = useToast()
  const [m, setM] = useState(settings.marketing)
  const [saving, setSaving] = useState(false)

  useEffect(() => setM(settings.marketing), [settings.marketing])

  const persist = async (next: Settings['marketing']) => {
    setSaving(true)
    try {
      await save({ ...settings, marketing: next })
      toast('Enregistré')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleFeatured = async (id: string, featured: boolean) => {
    await supabase.from('products').update({ featured }).eq('id', id)
    await reload()
  }

  const toggleUpsell = (id: string) => {
    const ids = m.upsell_product_ids ?? []
    setM({ ...m, upsell_product_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] })
  }

  if (loading) return <PageLoader />
  const products = menu.products.filter((p) => p.active)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Bannière d'annonce" className="lg:col-span-2">
        <div className="space-y-4">
          <Toggle checked={m.announcement_enabled} onChange={(v) => setM({ ...m, announcement_enabled: v })} label="Afficher la bannière en haut du site" />
          <Field label="Texte"><Input value={m.announcement_text} onChange={(e) => setM({ ...m, announcement_text: e.target.value })} placeholder="🏀 -15% sur ta 1ère commande avec le code DUNK15" /></Field>
          {m.announcement_enabled && m.announcement_text && (
            <div className="rounded-xl bg-ball px-4 py-2 text-center text-sm font-semibold text-white">{m.announcement_text}</div>
          )}
          <Button loading={saving} onClick={() => persist(m)}>Enregistrer la bannière</Button>
        </div>
      </Card>

      <Card title="« Les stars du terrain »">
        <p className="mb-3 text-sm text-stone-500">Produits mis en avant en haut du menu.</p>
        <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span className="text-sm font-medium">{p.name}</span>
              <button type="button" onClick={() => toggleFeatured(p.id, !p.featured)} className={cx('p-1', p.featured ? 'text-cheddar' : 'text-stone-300')}>
                <Star className="size-5" fill={p.featured ? 'currentColor' : 'none'} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Ventes additionnelles dans le panier">
        <p className="mb-3 text-sm text-stone-500">Proposés dans le panier (« Un petit plus ? ») : boissons, desserts, sides. Augmente le panier moyen.</p>
        <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto">
          {products.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center justify-between py-2">
                <span className="text-sm font-medium">{p.name} <span className="text-stone-400">· {money(p.price)}</span></span>
                <input type="checkbox" className="size-4 accent-[#B5121B]" checked={(m.upsell_product_ids ?? []).includes(p.id)} onChange={() => toggleUpsell(p.id)} />
              </label>
            </li>
          ))}
        </ul>
        <Button className="mt-4" loading={saving} onClick={() => persist(m)}>Enregistrer</Button>
      </Card>
    </div>
  )
}

/* ===================================================================== CLIENTS */
type Customer = { phone: string; name: string; email: string | null; orders: number; total_spent: number; first_order: string; last_order: string; last_address: string | null }
type Segment = 'all' | 'loyal' | 'inactive' | 'new' | 'once'

function CustomersTab() {
  const toast = useToast()
  const { settings } = useSettings()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [segment, setSegment] = useState<Segment>('all')
  const [broadcast, setBroadcast] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    supabase.rpc('admin_customers').then(({ data, error }) => {
      if (error) toast(errorMessage(error), 'error')
      setCustomers((data ?? []) as Customer[])
      setLoading(false)
    })
  }, [toast])

  const filtered = useMemo(() => {
    const now = Date.now()
    const day = 86400000
    return customers
      .filter((c) => {
        if (segment === 'loyal') return c.orders >= 3
        if (segment === 'inactive') return now - new Date(c.last_order).getTime() > 30 * day
        if (segment === 'new') return now - new Date(c.first_order).getTime() < 7 * day
        if (segment === 'once') return c.orders === 1
        return true
      })
      .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q))
  }, [customers, segment, q])

  const ltv = customers.length ? customers.reduce((s, c) => s + Number(c.total_spent), 0) / customers.length : 0
  const repeatRate = customers.length ? (customers.filter((c) => c.orders > 1).length / customers.length) * 100 : 0

  const exportCsv = (forMeta = false) => {
    if (forMeta) {
      // format attendu par Meta pour une audience personnalisée
      downloadCsv('audience-meta.csv', [
        ['phone', 'email', 'fn', 'country', 'value'],
        ...filtered.map((c) => [c.phone.replace(/^0/, '+212'), c.email ?? '', c.name.split(' ')[0], 'MA', c.total_spent]),
      ])
    } else {
      downloadCsv('clients.csv', [
        ['Nom', 'Téléphone', 'E-mail', 'Commandes', 'Total dépensé', 'Première commande', 'Dernière commande', 'Adresse'],
        ...filtered.map((c) => [c.name, c.phone, c.email, c.orders, c.total_spent, dateLong(c.first_order), dateLong(c.last_order), c.last_address]),
      ])
    }
  }

  if (loading) return <PageLoader />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clients" value={String(customers.length)} />
        <Stat label="Clients fidèles (3+)" value={String(customers.filter((c) => c.orders >= 3).length)} />
        <Stat label="Taux de réachat" value={`${repeatRate.toFixed(0)} %`} />
        <Stat label="Valeur client moyenne" value={money(Math.round(ltv))} />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Tabs value={segment} onChange={setSegment} tabs={[
            { id: 'all', label: 'Tous' }, { id: 'loyal', label: 'Fidèles' }, { id: 'once', label: '1 seule commande' },
            { id: 'inactive', label: 'Inactifs +30 j' }, { id: 'new', label: 'Nouveaux (7 j)' },
          ]} />
          <div className="relative ml-auto min-w-52">
            <Search className="absolute top-3 left-3 size-4 text-stone-400" />
            <Input className="pl-9" placeholder="Nom ou téléphone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCsv(false)}><Download className="size-4" /> Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => exportCsv(true)}><Download className="size-4" /> Export audience Meta</Button>
          <Button variant="dark" size="sm" onClick={() => setBroadcast(true)} disabled={!filtered.length}><MessageCircle className="size-4" /> Campagne WhatsApp ({filtered.length})</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs tracking-wide text-stone-500 uppercase">
              <tr><th className="py-2">Client</th><th className="py-2 text-right">Cmd</th><th className="py-2 text-right">Dépensé</th><th className="py-2 text-right">Dernière</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.slice(0, 300).map((c) => (
                <tr key={c.phone}>
                  <td className="py-2.5"><p className="font-medium">{c.name}</p><p className="text-xs text-stone-500">{c.phone}{c.email ? ` · ${c.email}` : ''}</p></td>
                  <td className="py-2.5 text-right font-semibold">{c.orders}</td>
                  <td className="py-2.5 text-right">{money(c.total_spent)}</td>
                  <td className="py-2.5 text-right text-stone-500">{dateLong(c.last_order)}</td>
                  <td className="py-2.5 text-right">
                    <a href={waLink(c.phone, `Salut ${c.name.split(' ')[0]} ! C'est ${settings.restaurant.name} 🏀`)} target="_blank" rel="noreferrer" className="inline-flex p-1.5 text-[#25D366]">
                      <MessageCircle className="size-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="py-8 text-center text-stone-500">Aucun client dans ce segment.</p>}
        </div>
      </Card>

      <Modal open={broadcast} onClose={() => setBroadcast(false)} size="lg" title={`Campagne WhatsApp — ${filtered.length} clients`}>
        <p className="mb-3 text-sm text-stone-600">
          Écris ton message ({'{prenom}'} sera remplacé), puis clique sur chaque client pour ouvrir WhatsApp avec le message pré-rempli.
          Pour des envois en masse automatisés, il faudra brancher l'API WhatsApp Business.
        </p>
        <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Salut {prenom} ! Ça fait longtemps 🏀 -20% ce week-end avec le code COMEBACK" />
        <ul className="mt-4 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
          {filtered.map((c) => (
            <li key={c.phone}>
              <a href={waLink(c.phone, message.replaceAll('{prenom}', c.name.split(' ')[0]))} target="_blank" rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2 text-sm hover:border-[#25D366]">
                <span>{c.name}</span><MessageCircle className="size-4 text-[#25D366]" />
              </a>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}

/* ===================================================================== PIXELS & LIENS */
function TrackingTab() {
  const { settings, save } = useSettings()
  const toast = useToast()
  const [m, setM] = useState(settings.marketing)
  const [saving, setSaving] = useState(false)
  const [utm, setUtm] = useState({ source: 'instagram', medium: 'social', campaign: 'bio', content: '' })

  useEffect(() => setM(settings.marketing), [settings.marketing])

  const persist = async () => {
    setSaving(true)
    try {
      await save({ ...settings, marketing: m })
      toast('Pixels enregistrés — actifs dès le prochain chargement du site')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const link = useMemo(() => {
    const u = new URL(window.location.origin)
    if (utm.source) u.searchParams.set('utm_source', slugify(utm.source))
    if (utm.medium) u.searchParams.set('utm_medium', slugify(utm.medium))
    if (utm.campaign) u.searchParams.set('utm_campaign', slugify(utm.campaign))
    if (utm.content) u.searchParams.set('utm_content', slugify(utm.content))
    return u.toString()
  }, [utm])

  const presets = [
    { label: 'Bio Instagram', v: { source: 'instagram', medium: 'social', campaign: 'bio', content: '' } },
    { label: 'Story Instagram', v: { source: 'instagram', medium: 'social', campaign: 'story', content: '' } },
    { label: 'Pub Meta', v: { source: 'facebook', medium: 'paid_social', campaign: 'lancement', content: '' } },
    { label: 'TikTok', v: { source: 'tiktok', medium: 'social', campaign: 'bio', content: '' } },
    { label: 'Google Maps', v: { source: 'google', medium: 'maps', campaign: 'fiche', content: '' } },
    { label: 'QR code flyer', v: { source: 'flyer', medium: 'print', campaign: 'qr', content: '' } },
    { label: 'Influenceur', v: { source: 'influence', medium: 'social', campaign: 'nom-influenceur', content: '' } },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Pixels publicitaires">
        <p className="mb-4 text-sm text-stone-500">
          Les événements PageView, ViewContent, AddToCart, InitiateCheckout et Purchase sont envoyés automatiquement, avec la valeur en MAD.
        </p>
        <div className="space-y-4">
          <Field label="Meta Pixel ID (Facebook / Instagram)" hint="Gestionnaire d'événements Meta → Sources de données">
            <Input value={m.meta_pixel_id} onChange={(e) => setM({ ...m, meta_pixel_id: e.target.value.trim() })} placeholder="123456789012345" />
          </Field>
          <Field label="Google Analytics 4 — ID de mesure" hint="Format G-XXXXXXXXXX">
            <Input value={m.ga4_id} onChange={(e) => setM({ ...m, ga4_id: e.target.value.trim() })} placeholder="G-XXXXXXXXXX" />
          </Field>
          <Field label="TikTok Pixel ID">
            <Input value={m.tiktok_pixel_id} onChange={(e) => setM({ ...m, tiktok_pixel_id: e.target.value.trim() })} placeholder="CXXXXXXXXXXXXXXXXX" />
          </Field>
          <Button loading={saving} onClick={persist}>Enregistrer</Button>
        </div>
      </Card>

      <Card title="Générateur de liens de campagne (UTM)">
        <p className="mb-3 text-sm text-stone-500">Chaque lien est suivi dans Statistiques → Sources de trafic (visites, commandes, CA).</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={() => setUtm(p.v)} className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold hover:bg-stone-200">{p.label}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source"><Input value={utm.source} onChange={(e) => setUtm({ ...utm, source: e.target.value })} /></Field>
          <Field label="Support"><Input value={utm.medium} onChange={(e) => setUtm({ ...utm, medium: e.target.value })} /></Field>
          <Field label="Campagne"><Input value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} /></Field>
          <Field label="Contenu (optionnel)"><Input value={utm.content} onChange={(e) => setUtm({ ...utm, content: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-stone-50 p-3">
          <code className="flex-1 truncate text-xs">{link}</code>
          <Button size="sm" variant="dark" onClick={() => { void navigator.clipboard.writeText(link); toast('Lien copié') }}><Copy className="size-4" /> Copier</Button>
        </div>
        <a className="mt-2 inline-block text-xs font-semibold text-ball" target="_blank" rel="noreferrer"
          href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(link)}`}>
          Télécharger le QR code de ce lien →
        </a>
      </Card>
    </div>
  )
}
