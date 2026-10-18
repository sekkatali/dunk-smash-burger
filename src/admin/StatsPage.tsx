import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowDownRight, ArrowUpRight, Info, Lightbulb, MessageCircle } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { PAYMENT_SHORT, TZ, money, waLink } from '../lib/format'
import type { PaymentMethod } from '../lib/types'
import { Card, Input, PageLoader, Tabs, cx, useToast } from '../components/ui'
import { PageHeader } from './PageHeader'

/* =====================================================================
   Types renvoyés par les fonctions SQL
   ===================================================================== */
type Perf = {
  orders: number; revenue: number; aov: number; cancelled: number; discounts: number; delivery_fees: number
  visitors: number; avg_prep_min: number; avg_delivery_min: number
  daily: { date: string; revenue: number; orders: number; visitors: number }[]
  weekdays: { day: number; orders: number; revenue: number }[]
  payment_methods: { method: PaymentMethod; orders: number; revenue: number }[]
  types: { type: 'delivery' | 'pickup'; orders: number; revenue: number }[]
  zones: { zone: string; orders: number; revenue: number }[]
  promos: { code: string; uses: number; discount: number; revenue: number }[]
}

type Traffic = {
  sessions: number; visitors: number; new_visitors: number; returning_visitors: number; page_views: number
  pages_per_session: number; bounce_rate: number; avg_duration_sec: number; product_view_rate: number
  cart_rate: number; checkout_rate: number; conversion_rate: number; abandoned_carts: number
  abandoned_checkouts: number; revenue_per_session: number
  funnel: { visit: number; product: number; cart: number; checkout: number; purchase: number }
  daily: { date: string; sessions: number; visitors: number; purchases: number }[]
  hours: { hour: number; sessions: number; purchases: number }[]
  sources: { name: string; sessions: number; visitors: number; orders: number; revenue: number; cart_rate: number }[]
  mediums: { name: string; sessions: number; orders: number; revenue: number }[]
  campaigns: { name: string; sessions: number; orders: number; revenue: number }[]
  landings: { name: string; sessions: number; orders: number; bounce_rate: number }[]
  devices: { name: string; sessions: number; orders: number; revenue: number }[]
}

type CustomerStats = {
  customers: number; new_customers: number; returning_customers: number
  orders_new: number; orders_returning: number; revenue_new: number; revenue_returning: number
  aov_new: number; aov_returning: number; first_orders: number; repeat_orders: number
  repeat_in_period: number; orders_per_customer: number; revenue_per_customer: number; median_days_to_second: number
  daily: { date: string; new: number; returning: number }[]
  new_by_source: { name: string; customers: number; ltv: number }[]
  order_rank: { rank: number; orders: number; revenue: number }[]
  top_customers: { name: string; phone: string; orders: number; revenue: number; orders_all: number; spent_all: number; first_at: string; last_at: string }[]
  at_risk: { name: string; phone: string; orders_all: number; spent_all: number; days_since: number }[]
  at_risk_count: number
}

type ProductStats = {
  items_per_order: number
  basket_sizes: { size: number; orders: number }[]
  products: { name: string; category: string; qty: number; revenue: number; orders: number; share: number; attach: number }[]
  categories: { name: string; qty: number; revenue: number; attach: number; share: number }[]
  options: { name: string; group: string; qty: number; revenue: number }[]
  pairs: { a: string; b: string; orders: number }[]
  unsold: string[]
  heatmap: { dow: number; hour: number; orders: number }[]
  cancel_reasons: { reason: string; orders: number; lost: number }[]
}

type Analysis = {
  customers: number; orders: number; revenue: number; ltv: number; ltv_median: number; ltv_repeaters: number
  ltv_30: number; ltv_90: number; aov: number; frequency: number; repeat_rate: number; avg_days_between: number
  avg_lifespan_days: number; top10_share: number; top20_share: number
  segments: { name: string; customers: number; revenue: number; avg_spent: number; avg_recency: number; avg_orders: number }[]
  cohorts: { cohort: string; size: number; months: { m: number; active: number; revenue: number }[] }[]
  monthly: { month: string; orders: number; revenue: number; customers: number; new_customers: number; aov: number }[]
  promo_impact: { with_count: number; with_aov: number; without_aov: number; discount_total: number; promo_new_share: number; promo_repeat_rate: number; nopromo_repeat_rate: number }
  type_compare: { type: 'delivery' | 'pickup'; orders: number; aov: number; revenue: number }[]
  first_product: { name: string; customers: number; repeat_rate: number }[]
  category_attach: { name: string; attach: number; revenue: number }[]
}

/* =====================================================================
   Périodes (heure du Maroc)
   ===================================================================== */
type Period = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastmonth' | '90d' | 'custom'
type Range = { from: Date; to: Date; prevFrom: Date; prevTo: Date; key: string }

const RED = '#B5121B'
const WINE = '#5a0410'
const SAND = '#d8ccb0'
const WEEKDAYS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function tzOffsetMs(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}
const dayStart = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - tzOffsetMs(new Date(`${d}T12:00:00Z`)))
const todayStr = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

function computeRange(p: Period, cf: string, ct: string): Range {
  const t = todayStr()
  let from: Date
  let to: Date
  switch (p) {
    case 'today': from = dayStart(t); to = dayStart(addDays(t, 1)); break
    case 'yesterday': from = dayStart(addDays(t, -1)); to = dayStart(t); break
    case '7d': from = dayStart(addDays(t, -6)); to = dayStart(addDays(t, 1)); break
    case '30d': from = dayStart(addDays(t, -29)); to = dayStart(addDays(t, 1)); break
    case '90d': from = dayStart(addDays(t, -89)); to = dayStart(addDays(t, 1)); break
    case 'month': from = dayStart(`${t.slice(0, 8)}01`); to = dayStart(addDays(t, 1)); break
    case 'lastmonth': {
      const first = `${t.slice(0, 8)}01`
      const prevLast = addDays(first, -1)
      from = dayStart(`${prevLast.slice(0, 8)}01`)
      to = dayStart(first)
      break
    }
    default: from = dayStart(cf); to = dayStart(addDays(ct, 1))
  }
  const span = to.getTime() - from.getTime()
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, key: `${from.toISOString()}|${to.toISOString()}` }
}

/** Charge une fonction de stats pour la période et la période précédente. */
function useRpc<T>(fn: string, range: Range | null, withPrev = true) {
  const toast = useToast()
  const [cur, setCur] = useState<T | null>(null)
  const [prev, setPrev] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    if (!range) {
      const { data, error } = await supabase.rpc(fn)
      if (error) toast(errorMessage(error), 'error')
      setCur(data as T)
      setLoading(false)
      return
    }
    const calls = [supabase.rpc(fn, { p_from: range.from.toISOString(), p_to: range.to.toISOString() })]
    if (withPrev) calls.push(supabase.rpc(fn, { p_from: range.prevFrom.toISOString(), p_to: range.prevTo.toISOString() }))
    const [a, b] = await Promise.all(calls)
    if (a.error) toast(errorMessage(a.error), 'error')
    setCur(a.data as T)
    setPrev((b?.data as T) ?? null)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, range?.key, withPrev, toast])

  useEffect(() => { void load() }, [load])
  return { cur, prev, loading }
}

/* =====================================================================
   Page
   ===================================================================== */
type Tab = 'perf' | 'traffic' | 'customers' | 'products' | 'analysis'

export default function StatsPage() {
  const [tab, setTab] = useState<Tab>('perf')
  const [period, setPeriod] = useState<Period>('30d')
  const [cf, setCf] = useState(todayStr(-13))
  const [ct, setCt] = useState(todayStr())
  const range = useMemo(() => computeRange(period, cf, ct), [period, cf, ct])

  return (
    <div>
      <PageHeader
        title="Statistiques"
        subtitle={tab === 'analysis' ? "Analyse sur tout l'historique : LTV, cohortes, segments clients." : 'Comparaison automatique avec la période précédente de même durée.'}
      />
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'perf', label: '📈 Performance' },
          { id: 'traffic', label: '🌐 Trafic' },
          { id: 'customers', label: '👥 Clients' },
          { id: 'products', label: '🍔 Produits & panier' },
          { id: 'analysis', label: '🧠 Analyse avancée' },
        ]} />
      </div>
      {tab !== 'analysis' && (
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-3">
          <div className="flex flex-wrap gap-1">
            {([
              ['today', "Aujourd'hui"], ['yesterday', 'Hier'], ['7d', '7 j'], ['30d', '30 j'], ['90d', '90 j'],
              ['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['custom', 'Personnalisé'],
            ] as [Period, string][]).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPeriod(id)}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', period === id ? 'bg-ink text-white' : 'text-stone-600 hover:bg-stone-100')}>
                {label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex gap-2">
              <Input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="w-auto py-1.5" />
              <Input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="w-auto py-1.5" />
            </div>
          )}
        </div>
      )}

      {tab === 'perf' && <PerfTab range={range} />}
      {tab === 'traffic' && <TrafficTab range={range} />}
      {tab === 'customers' && <CustomersTab range={range} />}
      {tab === 'products' && <ProductsTab range={range} />}
      {tab === 'analysis' && <AnalysisTab />}
    </div>
  )
}

/* =====================================================================
   PERFORMANCE
   ===================================================================== */
function PerfTab({ range }: { range: Range }) {
  const { cur: s, prev: p, loading } = useRpc<Perf>('admin_stats', range)
  const { cur: ps } = useRpc<ProductStats>('admin_product_stats', range, false)
  const daily = useDaily(s?.daily)
  if (loading || !s) return <PageLoader />

  const cancelRate = (x: Perf | null) => (x && x.orders + x.cancelled > 0 ? (x.cancelled / (x.orders + x.cancelled)) * 100 : 0)
  const net = (x: Perf | null) => (x ? x.revenue - x.delivery_fees : 0)

  return (
    <div className="space-y-6">
      <KpiGrid>
        <Kpi label="Chiffre d'affaires" value={money(s.revenue)} cur={s.revenue} prev={p?.revenue} />
        <Kpi label="Commandes" value={fmt(s.orders)} cur={s.orders} prev={p?.orders} />
        <Kpi label="Panier moyen" value={money(s.aov)} cur={s.aov} prev={p?.aov} />
        <Kpi label="CA produits (hors livraison)" value={money(net(s))} cur={net(s)} prev={net(p)} />
        <Kpi label="Articles / commande" value={fmt(ps?.items_per_order ?? 0, 2)} hint="Taille moyenne du panier" />
        <Kpi label="Remises accordées" value={money(s.discounts)} cur={s.discounts} prev={p?.discounts} invert hint={s.revenue ? `${pct((s.discounts / (s.revenue + s.discounts)) * 100)} du CA brut` : undefined} />
        <Kpi label="Taux d'annulation" value={pct(cancelRate(s))} cur={cancelRate(s)} prev={cancelRate(p)} invert hint={`${s.cancelled} annulées`} />
        <Kpi label="Temps de préparation" value={s.avg_prep_min ? `${s.avg_prep_min} min` : '—'} cur={s.avg_prep_min} prev={p?.avg_prep_min} invert hint={s.avg_delivery_min ? `Livraison : ${s.avg_delivery_min} min` : undefined} />
      </KpiGrid>

      {daily.length > 1 && (
        <Card title="Chiffre d'affaires et commandes par jour">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={daily} margin={{ left: -8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v, n) => (n === 'CA' ? money(Number(v)) : v)} />
              <Legend />
              <Bar yAxisId="l" dataKey="revenue" name="CA" fill={RED} radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="orders" name="Commandes" stroke={WINE} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {ps && (
        <Card title="Carte de chaleur des commandes (jour × heure)" action={<Hint>Pour caler tes équipes et tes pubs sur les pics</Hint>}>
          <Heatmap data={ps.heatmap} />
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Jours de la semaine">
          <Table head={['Jour', 'Cmd', 'CA', 'Panier']} rows={s.weekdays.map((w) => [WEEKDAYS[w.day], w.orders, money(w.revenue), money(w.orders ? w.revenue / w.orders : 0)])} bars={s.weekdays.map((w) => w.revenue)} />
        </Card>
        <Card title="Livraison vs à emporter">
          <Table head={['Mode', 'Cmd', 'CA', 'Panier']} rows={s.types.map((t) => [t.type === 'delivery' ? 'Livraison' : 'À emporter', t.orders, money(t.revenue), money(t.orders ? t.revenue / t.orders : 0)])} bars={s.types.map((t) => t.orders)} />
          <p className="mt-3 text-xs text-stone-500">Frais de livraison encaissés : {money(s.delivery_fees)}</p>
        </Card>
        <Card title="Moyens de paiement">
          <Table head={['Paiement', 'Cmd', 'CA', 'Part']} rows={s.payment_methods.map((m) => [PAYMENT_SHORT[m.method], m.orders, money(m.revenue), pct(s.revenue ? (m.revenue / s.revenue) * 100 : 0)])} bars={s.payment_methods.map((m) => m.orders)} />
        </Card>
        <Card title="Zones de livraison">
          <Table head={['Zone', 'Cmd', 'CA']} rows={s.zones.map((z) => [z.zone, z.orders, money(z.revenue)])} bars={s.zones.map((z) => z.orders)} />
        </Card>
        <Card title="Codes promo">
          <Table head={['Code', 'Util.', 'Remise', 'CA']} rows={s.promos.map((x) => [x.code, x.uses, money(x.discount), money(x.revenue)])} />
        </Card>
        <Card title="Motifs d'annulation">
          <Table head={['Motif', 'Cmd', 'CA perdu']} rows={(ps?.cancel_reasons ?? []).map((c) => [c.reason, c.orders, money(c.lost)])} />
        </Card>
      </div>
    </div>
  )
}

/* =====================================================================
   TRAFIC
   ===================================================================== */
function TrafficTab({ range }: { range: Range }) {
  const { cur: t, prev: p, loading } = useRpc<Traffic>('admin_traffic', range)
  const [spend, setSpend] = useSpend(`spend:${range.key}`)
  const daily = useDaily(t?.daily)
  if (loading || !t) return <PageLoader />

  const newShare = t.visitors ? (t.new_visitors / t.visitors) * 100 : 0
  const revenue = t.sources.reduce((s, x) => s + Number(x.revenue), 0)
  const orders = t.sources.reduce((s, x) => s + x.orders, 0)

  return (
    <div className="space-y-6">
      <KpiGrid>
        <Kpi label="Visiteurs uniques" value={fmt(t.visitors)} cur={t.visitors} prev={p?.visitors} hint={`${pct(newShare)} nouveaux`} />
        <Kpi label="Sessions" value={fmt(t.sessions)} cur={t.sessions} prev={p?.sessions} hint={`${fmt(t.page_views)} pages vues`} />
        <Kpi label="Taux de conversion" value={pct(t.conversion_rate, 2)} cur={t.conversion_rate} prev={p?.conversion_rate} hint="Sessions avec commande" />
        <Kpi label="CA par session" value={money(t.revenue_per_session)} cur={t.revenue_per_session} prev={p?.revenue_per_session} />
        <Kpi label="Taux de rebond" value={pct(t.bounce_rate)} cur={t.bounce_rate} prev={p?.bounce_rate} invert hint="Partis sans interaction" />
        <Kpi label="Durée moyenne" value={duration(t.avg_duration_sec)} cur={t.avg_duration_sec} prev={p?.avg_duration_sec} hint={`${fmt(t.pages_per_session, 1)} pages / session`} />
        <Kpi label="Taux d'ajout au panier" value={pct(t.cart_rate)} cur={t.cart_rate} prev={p?.cart_rate} hint={`Fiche produit vue : ${pct(t.product_view_rate)}`} />
        <Kpi label="Paniers abandonnés" value={fmt(t.abandoned_carts)} cur={t.abandoned_carts} prev={p?.abandoned_carts} invert hint={`${t.abandoned_checkouts} au paiement`} />
      </KpiGrid>

      <Card title="Rentabilité publicitaire de la période" action={<Hint>Saisis ton budget pub (Meta, TikTok, Google…) pour la période</Hint>}>
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Dépenses pub (DH)</span>
            <Input type="number" min={0} value={spend ?? ''} onChange={(e) => setSpend(e.target.value === '' ? null : Number(e.target.value))} placeholder="ex : 3000" />
          </label>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Mini label="ROAS" value={spend ? `${(revenue / spend).toFixed(2).replace('.', ',')}×` : '—'} hint="CA / dépenses" />
            <Mini label="Coût par commande" value={spend && orders ? money(Math.round(spend / orders)) : '—'} hint="CPA" />
            <Mini label="Coût par visite" value={spend && t.sessions ? money(Math.round((spend / t.sessions) * 100) / 100) : '—'} hint="CPC moyen" />
            <Mini label="CA généré" value={money(revenue)} hint={`${orders} commandes attribuées`} />
          </div>
        </div>
      </Card>

      {daily.length > 1 && (
        <Card title="Visiteurs, sessions et commandes par jour">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={daily} margin={{ left: -8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="sessions" name="Sessions" fill={SAND} stroke={SAND} fillOpacity={0.6} />
              <Line type="monotone" dataKey="visitors" name="Visiteurs" stroke={WINE} strokeWidth={2} dot={false} />
              <Bar dataKey="purchases" name="Commandes" fill={RED} barSize={14} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Tunnel de conversion">
          <Funnel steps={[
            { label: 'Visites', v: t.funnel.visit },
            { label: 'Fiche produit', v: t.funnel.product },
            { label: 'Ajout au panier', v: t.funnel.cart },
            { label: 'Page paiement', v: t.funnel.checkout },
            { label: 'Commande', v: t.funnel.purchase },
          ]} />
        </Card>
        <Card title="Trafic et commandes par heure" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={t.hours.filter((h) => h.hour >= 9 || h.sessions > 0)} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#eee" />
              <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(h) => `${h}h – ${Number(h) + 1}h`} />
              <Legend />
              <Bar dataKey="sessions" name="Sessions" fill={SAND} radius={[4, 4, 0, 0]} />
              <Bar dataKey="purchases" name="Commandes" fill={RED} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Sources de trafic" action={<Hint>Liens UTM : Marketing → Pixels & liens</Hint>}>
        <Table
          head={['Source', 'Sessions', 'Visiteurs', 'Ajout panier', 'Cmd', 'Conv.', 'CA', 'CA / session']}
          rows={t.sources.map((s) => [sourceLabel(s.name), s.sessions, s.visitors, pct(s.cart_rate), s.orders, pct(s.sessions ? (s.orders / s.sessions) * 100 : 0, 1), money(s.revenue), money(s.sessions ? Number(s.revenue) / s.sessions : 0)])}
          bars={t.sources.map((s) => s.sessions)}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Campagnes (utm_campaign)">
          <Table head={['Campagne', 'Sessions', 'Cmd', 'CA']} rows={t.campaigns.map((c) => [c.name, c.sessions, c.orders, money(c.revenue)])} bars={t.campaigns.map((c) => c.sessions)} empty="Aucune campagne taguée sur la période" />
        </Card>
        <Card title="Supports (utm_medium)">
          <Table head={['Support', 'Sessions', 'Cmd', 'CA']} rows={t.mediums.map((m) => [m.name, m.sessions, m.orders, money(m.revenue)])} bars={t.mediums.map((m) => m.sessions)} />
        </Card>
        <Card title="Pages d'entrée">
          <Table head={['Page', 'Sessions', 'Cmd', 'Rebond']} rows={t.landings.map((l) => [l.name, l.sessions, l.orders, pct(l.bounce_rate)])} bars={t.landings.map((l) => l.sessions)} />
        </Card>
        <Card title="Appareils">
          <Table head={['Appareil', 'Sessions', 'Cmd', 'Conv.', 'CA']} rows={t.devices.map((d) => [d.name, d.sessions, d.orders, pct(d.sessions ? (d.orders / d.sessions) * 100 : 0, 1), money(d.revenue)])} bars={t.devices.map((d) => d.sessions)} />
          <p className="mt-3 text-xs text-stone-500">Visiteurs : {fmt(t.new_visitors)} nouveaux · {fmt(t.returning_visitors)} déjà venus</p>
        </Card>
      </div>
    </div>
  )
}

/* =====================================================================
   CLIENTS
   ===================================================================== */
function CustomersTab({ range }: { range: Range }) {
  const { cur: c, prev: p, loading } = useRpc<CustomerStats>('admin_customer_stats', range)
  const daily = useDaily(c?.daily)
  if (loading || !c) return <PageLoader />

  const retShare = (x: CustomerStats | null) => {
    if (!x) return 0
    const tot = Number(x.revenue_new) + Number(x.revenue_returning)
    return tot ? (Number(x.revenue_returning) / tot) * 100 : 0
  }
  const rankLabel = (r: number) => (r === 1 ? '1ʳᵉ commande' : r >= 5 ? '5ᵉ et +' : `${r}ᵉ commande`)

  return (
    <div className="space-y-6">
      <KpiGrid>
        <Kpi label="Clients actifs" value={fmt(c.customers)} cur={c.customers} prev={p?.customers} />
        <Kpi label="Nouveaux clients" value={fmt(c.new_customers)} cur={c.new_customers} prev={p?.new_customers} hint="1ʳᵉ commande sur la période" />
        <Kpi label="Clients récurrents" value={fmt(c.returning_customers)} cur={c.returning_customers} prev={p?.returning_customers} hint="Déjà clients avant" />
        <Kpi label="Part du CA récurrent" value={pct(retShare(c))} cur={retShare(c)} prev={retShare(p)} />
        <Kpi label="Panier nouveaux" value={money(c.aov_new)} cur={c.aov_new} prev={p?.aov_new} />
        <Kpi label="Panier récurrents" value={money(c.aov_returning)} cur={c.aov_returning} prev={p?.aov_returning} />
        <Kpi label="Commandes / client" value={fmt(c.orders_per_customer, 2)} cur={c.orders_per_customer} prev={p?.orders_per_customer} hint={`Réachat sur la période : ${pct(c.repeat_in_period)}`} />
        <Kpi label="Délai avant 2ᵉ commande" value={c.median_days_to_second ? `${fmt(c.median_days_to_second, 1)} j` : '—'} hint="Médiane, tout l'historique" />
      </KpiGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Nouveaux vs récurrents par jour" className="lg:col-span-2">
          {daily.length > 1 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={daily} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="new" name="Nouveaux" stackId="a" fill={RED} />
                <Bar dataKey="returning" name="Récurrents" stackId="a" fill={WINE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-sm text-stone-400">Choisis une période de plusieurs jours</p>}
        </Card>
        <Card title="Répartition du CA">
          <SplitBar items={[
            { label: 'Nouveaux', value: Number(c.revenue_new), color: RED },
            { label: 'Récurrents', value: Number(c.revenue_returning), color: WINE },
          ]} format={money} />
          <div className="mt-5 space-y-2 text-sm">
            <Row label="Commandes de nouveaux" value={fmt(c.orders_new)} />
            <Row label="Commandes de récurrents" value={fmt(c.orders_returning)} />
            <Row label="CA moyen par client" value={money(c.revenue_per_customer)} />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Acquisition : d'où viennent les nouveaux clients ?">
          <Table head={['Source', 'Nouveaux', 'LTV actuelle']} rows={c.new_by_source.map((s) => [sourceLabel(s.name), s.customers, money(s.ltv)])} bars={c.new_by_source.map((s) => s.customers)} />
          <p className="mt-3 text-xs text-stone-500">La LTV indique combien chaque client acquis par ce canal a dépensé au total jusqu'ici.</p>
        </Card>
        <Card title="Commandes par rang">
          <Table head={['Rang', 'Commandes', 'CA']} rows={c.order_rank.map((r) => [rankLabel(r.rank), r.orders, money(r.revenue)])} bars={c.order_rank.map((r) => r.orders)} />
        </Card>
      </div>

      <Card title="Meilleurs clients de la période">
        <Table
          head={['Client', 'Cmd (période)', 'CA (période)', 'Cmd (total)', 'Dépensé (total)', 'Client depuis']}
          rows={c.top_customers.map((x) => [<span key="n"><b>{x.name}</b><br /><span className="text-xs text-stone-500">{x.phone}</span></span>, x.orders, money(x.revenue), x.orders_all, money(x.spent_all), new Date(x.first_at).toLocaleDateString('fr-FR')])}
        />
      </Card>

      <Card title={`Clients fidèles à relancer (${c.at_risk_count})`} action={<Hint>2 commandes ou plus, rien depuis 21 jours</Hint>}>
        <Table
          head={['Client', 'Commandes', 'Dépensé', 'Dernière', '']}
          rows={c.at_risk.map((x) => [
            <span key="n"><b>{x.name}</b><br /><span className="text-xs text-stone-500">{x.phone}</span></span>,
            x.orders_all, money(x.spent_all), `il y a ${x.days_since} j`,
            <a key="w" href={waLink(x.phone, `Salut ${x.name.split(' ')[0]} ! Ça fait un moment 🍔 On t'offre un petit cadeau sur ta prochaine commande chez Dunk.`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-[#25D366] px-2 py-1 text-xs font-semibold text-white"><MessageCircle className="size-3.5" /> Relancer</a>,
          ])}
          empty="Aucun client fidèle inactif 👌"
        />
      </Card>
    </div>
  )
}

/* =====================================================================
   PRODUITS & PANIER
   ===================================================================== */
function ProductsTab({ range }: { range: Range }) {
  const { cur: s, loading } = useRpc<ProductStats>('admin_product_stats', range, false)
  if (loading || !s) return <PageLoader />
  const totalRev = s.products.reduce((a, p) => a + Number(p.revenue), 0)
  const top = s.products[0]
  const optionRevenue = s.options.reduce((a, o) => a + Number(o.revenue), 0)

  return (
    <div className="space-y-6">
      <KpiGrid>
        <Kpi label="Articles / commande" value={fmt(s.items_per_order, 2)} />
        <Kpi label="Produits vendus" value={fmt(s.products.reduce((a, p) => a + p.qty, 0))} hint={`${s.products.length} références`} />
        <Kpi label="Produit n°1" value={top ? top.name : '—'} hint={top ? `${pct(top.share)} du CA produits` : undefined} />
        <Kpi label="CA des suppléments" value={money(optionRevenue)} hint={totalRev ? `${pct((optionRevenue / totalRev) * 100)} du CA produits` : undefined} />
      </KpiGrid>

      <Card title="Classement des produits">
        <Table
          head={['Produit', 'Catégorie', 'Qté', 'CA', 'Part du CA', 'Présent dans']}
          rows={s.products.map((p) => [p.name, p.category, p.qty, money(p.revenue), pct(p.share), `${pct(p.attach)} des cmd`])}
          bars={s.products.map((p) => Number(p.revenue))}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Catégories : taux de présence dans les commandes" action={<Hint>Mesure tes ventes additionnelles</Hint>}>
          <Table head={['Catégorie', 'Présence', 'Qté', 'CA', 'Part']} rows={s.categories.map((c) => [c.name, pct(c.attach), c.qty, money(c.revenue), pct(c.share)])} bars={s.categories.map((c) => Number(c.attach))} />
        </Card>
        <Card title="Produits achetés ensemble" action={<Hint>Idées de formules / menus</Hint>}>
          <Table head={['Combinaison', 'Commandes']} rows={s.pairs.map((x) => [`${x.a} + ${x.b}`, x.orders])} bars={s.pairs.map((x) => x.orders)} empty="Pas encore assez de commandes" />
        </Card>
        <Card title="Options et suppléments">
          <Table head={['Option', 'Groupe', 'Qté', 'CA']} rows={s.options.map((o) => [o.name, o.group, o.qty, money(o.revenue)])} bars={s.options.map((o) => o.qty)} />
        </Card>
        <Card title="Taille des paniers">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={s.basket_sizes.map((b) => ({ ...b, label: b.size >= 5 ? '5+' : String(b.size) }))} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} label={{ value: 'articles', position: 'insideBottomRight', offset: -2, fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="orders" name="Commandes" fill={RED} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {s.unsold.length > 0 && (
        <Card title={`Produits sans vente sur la période (${s.unsold.length})`}>
          <div className="flex flex-wrap gap-2">
            {s.unsold.map((n) => <span key={n} className="rounded-full bg-stone-100 px-3 py-1 text-sm">{n}</span>)}
          </div>
          <p className="mt-3 text-xs text-stone-500">À mettre en avant, retravailler (photo, prix, description) ou retirer du menu.</p>
        </Card>
      )}
    </div>
  )
}

/* =====================================================================
   ANALYSE AVANCÉE
   ===================================================================== */
const SEGMENT_INFO: Record<string, { color: string; action: string }> = {
  Champions: { color: 'bg-emerald-100 text-emerald-800', action: 'Récompense-les : avant-premières, cadeau surprise, demande d’avis.' },
  'Fidèles': { color: 'bg-emerald-50 text-emerald-700', action: 'Programme de fidélité, nouveautés en avant-première.' },
  Prometteurs: { color: 'bg-sky-100 text-sky-800', action: 'Pousse la 3ᵉ commande : offre limitée dans le temps.' },
  Nouveaux: { color: 'bg-violet-100 text-violet-800', action: 'Message de bienvenue + code pour la 2ᵉ commande.' },
  Occasionnels: { color: 'bg-stone-100 text-stone-700', action: 'Relance douce avec une nouveauté ou un menu.' },
  'À relancer': { color: 'bg-amber-100 text-amber-800', action: 'WhatsApp perso + code de retour (ex : -15 %).' },
  'En danger': { color: 'bg-orange-100 text-orange-800', action: 'Priorité : ils ont beaucoup commandé. Offre forte, message perso.' },
  Perdus: { color: 'bg-red-100 text-red-700', action: 'Campagne de réactivation ciblée (audience Meta).' },
}

function AnalysisTab() {
  const { cur: a, loading } = useRpc<Analysis>('admin_analysis', null, false)
  const [monthlySpend, setMonthlySpend] = useSpend('spend:monthly')
  if (loading || !a) return <PageLoader />

  const lastMonths = a.monthly.slice(-3)
  const avgNewPerMonth = lastMonths.length ? lastMonths.reduce((s, m) => s + m.new_customers, 0) / lastMonths.length : 0
  const cac = monthlySpend && avgNewPerMonth ? monthlySpend / avgNewPerMonth : null
  const ltvCac = cac ? a.ltv / cac : null
  const firstOrderValue = a.aov
  const payback = cac && firstOrderValue ? cac / firstOrderValue : null
  const monthly = a.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))
  const insights = buildInsights(a)

  return (
    <div className="space-y-6">
      <KpiGrid>
        <Kpi label="LTV moyenne" value={money(a.ltv)} hint={`Médiane : ${money(a.ltv_median)}`} info="Lifetime value : ce qu'un client dépense en moyenne chez toi depuis sa 1ʳᵉ commande." />
        <Kpi label="LTV à 30 jours" value={money(a.ltv_30)} hint="Dépensé dans le 1ᵉʳ mois" info="Montant moyen dépensé par un client dans les 30 jours suivant sa 1ʳᵉ commande." />
        <Kpi label="LTV à 90 jours" value={money(a.ltv_90)} hint="Dépensé dans les 3 premiers mois" />
        <Kpi label="LTV clients fidèles" value={money(a.ltv_repeaters)} hint="Clients avec 2 commandes et +" />
        <Kpi label="Taux de réachat" value={pct(a.repeat_rate)} hint={`${fmt(a.frequency, 2)} commandes / client`} info="Part des clients qui ont commandé au moins 2 fois." />
        <Kpi label="Délai entre 2 commandes" value={a.avg_days_between ? `${fmt(a.avg_days_between, 1)} j` : '—'} hint="Moyenne" />
        <Kpi label="Durée de vie client" value={a.avg_lifespan_days ? `${fmt(a.avg_lifespan_days, 0)} j` : '—'} hint="Entre 1ʳᵉ et dernière commande" />
        <Kpi label="Concentration du CA" value={pct(a.top20_share)} hint={`fait par 20 % des clients (top 10 % : ${pct(a.top10_share)})`} info="Loi de Pareto : plus ce chiffre est élevé, plus ton CA dépend d'un petit noyau de clients." />
      </KpiGrid>

      {insights.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><Lightbulb className="size-5 text-ball" /> Ce que disent tes chiffres</span>}>
          <ul className="space-y-2 text-sm text-stone-700">
            {insights.map((i, idx) => <li key={idx} className="flex gap-2"><span className="text-ball">●</span><span>{i}</span></li>)}
          </ul>
        </Card>
      )}

      <Card title="Coût d'acquisition et rentabilité client (CAC, LTV/CAC)">
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Budget marketing mensuel (DH)</span>
            <Input type="number" min={0} value={monthlySpend ?? ''} onChange={(e) => setMonthlySpend(e.target.value === '' ? null : Number(e.target.value))} placeholder="ex : 5000" />
            <span className="mt-1 block text-xs text-stone-500">Pubs, influenceurs, flyers… Basé sur la moyenne de nouveaux clients des 3 derniers mois ({fmt(avgNewPerMonth, 1)}/mois).</span>
          </label>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Mini label="CAC" value={cac ? money(Math.round(cac)) : '—'} hint="Coût pour acquérir 1 client" />
            <Mini label="LTV / CAC" value={ltvCac ? `${ltvCac.toFixed(1).replace('.', ',')}×` : '—'} hint={ltvCac ? (ltvCac >= 3 ? '✅ Très sain (≥ 3)' : ltvCac >= 1 ? '⚠️ Rentable mais serré' : '❌ Tu perds de l’argent par client') : 'Objectif : 3× ou plus'} tone={ltvCac ? (ltvCac >= 3 ? 'good' : ltvCac >= 1 ? 'warn' : 'bad') : undefined} />
            <Mini label="Retour sur CAC" value={payback ? `${fmt(payback, 1)} cmd` : '—'} hint="Commandes pour rembourser le CAC (en CA)" />
            <Mini label="CAC max conseillé" value={money(Math.round(a.ltv / 3))} hint="LTV ÷ 3" />
          </div>
        </div>
      </Card>

      {monthly.length > 0 && (
        <Card title="Évolution sur 12 mois">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={monthly} margin={{ left: -8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="r" orientation="right" allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v, n) => (n === 'CA' ? money(Number(v)) : v)} />
              <Legend />
              <Bar yAxisId="l" dataKey="revenue" name="CA" fill={RED} radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="customers" name="Clients" stroke={WINE} strokeWidth={2.5} />
              <Line yAxisId="r" type="monotone" dataKey="new_customers" name="Nouveaux clients" stroke="#c9a227" strokeWidth={2} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="Cohortes : rétention des clients par mois d'arrivée" action={<Hint>% des clients d'un mois qui recommandent les mois suivants</Hint>}>
        <Cohorts cohorts={a.cohorts} />
      </Card>

      <Card title="Segmentation RFM (Récence · Fréquence · Montant)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr><th className="pb-2">Segment</th><th className="pb-2 text-right">Clients</th><th className="pb-2 text-right">CA total</th><th className="pb-2 text-right">Panier cumulé</th><th className="pb-2 text-right">Cmd moy.</th><th className="pb-2 text-right">Dernière cmd</th><th className="pb-2 pl-4">Action conseillée</th></tr>
            </thead>
            <tbody>
              {a.segments.map((s) => (
                <tr key={s.name} className="border-t border-stone-100 align-top">
                  <td className="py-2.5"><span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', SEGMENT_INFO[s.name]?.color)}>{s.name}</span></td>
                  <td className="py-2.5 text-right font-semibold">{s.customers}</td>
                  <td className="py-2.5 text-right">{money(s.revenue)}</td>
                  <td className="py-2.5 text-right">{money(s.avg_spent)}</td>
                  <td className="py-2.5 text-right">{s.avg_orders}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">{s.avg_recency} j</td>
                  <td className="py-2.5 pl-4 text-xs text-stone-600">{SEGMENT_INFO[s.name]?.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.segments.length === 0 && <p className="py-6 text-center text-sm text-stone-400">Pas encore de clients</p>}
        </div>
        <p className="mt-3 text-xs text-stone-500">Exporte chaque segment depuis Marketing → Clients pour créer des audiences Meta ou des relances WhatsApp.</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Impact des codes promo">
          <div className="grid grid-cols-2 gap-3">
            <Mini label="Panier avec code" value={money(a.promo_impact.with_aov)} hint={`${a.promo_impact.with_count} commandes`} />
            <Mini label="Panier sans code" value={money(a.promo_impact.without_aov)} />
            <Mini label="Réachat (1ʳᵉ cmd avec code)" value={pct(a.promo_impact.promo_repeat_rate)} hint="Les clients acquis par promo reviennent-ils ?" />
            <Mini label="Réachat (1ʳᵉ cmd sans code)" value={pct(a.promo_impact.nopromo_repeat_rate)} />
          </div>
          <p className="mt-3 text-xs text-stone-500">Remises totales : {money(a.promo_impact.discount_total)} · {pct(a.promo_impact.promo_new_share)} des codes utilisés sur une 1ʳᵉ commande.</p>
        </Card>
        <Card title="Le produit de la 1ʳᵉ commande influence-t-il le retour ?">
          <Table head={['Produit (1ʳᵉ cmd)', 'Clients', 'Reviennent']} rows={a.first_product.map((f) => [f.name, f.customers, pct(f.repeat_rate)])} bars={a.first_product.map((f) => Number(f.repeat_rate))} />
        </Card>
        <Card title="Présence des catégories dans les commandes">
          <Table head={['Catégorie', 'Présence', 'CA']} rows={a.category_attach.map((c) => [c.name, pct(c.attach), money(c.revenue)])} bars={a.category_attach.map((c) => Number(c.attach))} />
        </Card>
        <Card title="Livraison vs à emporter (historique)">
          <Table head={['Mode', 'Cmd', 'Panier', 'CA']} rows={a.type_compare.map((t) => [t.type === 'delivery' ? 'Livraison' : 'À emporter', t.orders, money(t.aov), money(t.revenue)])} bars={a.type_compare.map((t) => t.orders)} />
          <p className="mt-3 text-xs text-stone-500">Historique : {fmt(a.orders)} commandes · {fmt(a.customers)} clients · {money(a.revenue)}</p>
        </Card>
      </div>
    </div>
  )
}

function buildInsights(a: Analysis): string[] {
  const out: string[] = []
  if (a.customers < 5) return ['Les analyses deviennent vraiment parlantes à partir de quelques dizaines de clients. Reviens dans quelques semaines !']
  if (a.repeat_rate < 25) out.push(`Seulement ${pct(a.repeat_rate)} de tes clients recommandent. Le plus gros levier : un code « 2ᵉ commande » envoyé juste après la 1ʳᵉ.`)
  else out.push(`${pct(a.repeat_rate)} de tes clients recommandent : c'est une bonne base, travaille la fréquence.`)
  if (a.ltv_repeaters && a.ltv) out.push(`Un client qui revient vaut ${fmt(a.ltv_repeaters / Math.max(1, a.aov), 1)} paniers moyens, contre ${fmt(a.ltv / Math.max(1, a.aov), 1)} en moyenne.`)
  if (a.top20_share >= 50) out.push(`Tes 20 % meilleurs clients font ${pct(a.top20_share)} du CA : choie-les (programme fidélité, avant-premières).`)
  if (a.avg_days_between) out.push(`Un client recommande en moyenne tous les ${fmt(a.avg_days_between, 0)} jours : relance ceux qui dépassent ce délai.`)
  const danger = a.segments.find((s) => s.name === 'En danger')
  if (danger && danger.customers > 0) out.push(`${danger.customers} anciens très bons clients sont « En danger » (${money(danger.revenue)} de CA cumulé) : à relancer en priorité.`)
  if (a.promo_impact.with_count > 5 && a.promo_impact.promo_repeat_rate < a.promo_impact.nopromo_repeat_rate - 5) {
    out.push('Les clients acquis avec un code promo reviennent moins que les autres : attention aux chasseurs de promo.')
  }
  const delivery = a.type_compare.find((t) => t.type === 'delivery')
  const pickup = a.type_compare.find((t) => t.type === 'pickup')
  if (delivery && pickup && pickup.aov > delivery.aov * 1.1) out.push('Le panier à emporter est plus élevé que celui en livraison : pousse le click & collect.')
  return out
}

/* =====================================================================
   Composants
   ===================================================================== */
function useDaily<T extends { date: string }>(rows: T[] | undefined) {
  return useMemo(() => (rows ?? []).map((d) => ({
    ...d,
    label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
  })), [rows])
}

function useSpend(key: string): [number | null, (v: number | null) => void] {
  const read = () => {
    try {
      const v = localStorage.getItem(`dsb_${key}`)
      return v ? Number(v) : null
    } catch {
      return null
    }
  }
  const [v, setV] = useState<number | null>(read)
  useEffect(() => { setV(read()) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const set = (n: number | null) => {
    setV(n)
    try {
      if (n === null) localStorage.removeItem(`dsb_${key}`)
      else localStorage.setItem(`dsb_${key}`, String(n))
    } catch { /* ignore */ }
  }
  return [v, set]
}

const fmt = (n: number, d = 0) => Number(n ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 })
const pct = (n: number, d = 1) => `${fmt(Number(n ?? 0), d)} %`
function duration(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m ? `${m} min ${s.toString().padStart(2, '0')}` : `${s} s`
}
function monthLabel(m: string) {
  return new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}
function sourceLabel(s: string): string {
  const map: Record<string, string> = {
    direct: 'Direct / inconnu', facebook: 'Facebook', instagram: 'Instagram', google: 'Google', tiktok: 'TikTok',
    'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'google.com': 'Google', 'google.co.ma': 'Google',
    'tiktok.com': 'TikTok', 'wa.me': 'WhatsApp', 'web.whatsapp.com': 'WhatsApp',
  }
  return map[s] ?? s
}

function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

function Kpi({ label, value, cur, prev, hint, invert, info }: {
  label: string; value: string; cur?: number; prev?: number | null; hint?: string; invert?: boolean; info?: string
}) {
  const has = cur !== undefined && prev !== undefined && prev !== null && Number(prev) > 0
  const delta = has ? ((Number(cur) - Number(prev)) / Number(prev)) * 100 : 0
  const good = invert ? delta < 0 : delta > 0
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
        {label}
        {info && <span title={info} className="cursor-help text-stone-400"><Info className="size-3.5" /></span>}
      </p>
      <p className="mt-1 truncate text-2xl font-bold" title={value}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {cur !== undefined && (has && Math.abs(delta) >= 0.5 ? (
          <span className={cx('inline-flex items-center font-semibold', good ? 'text-emerald-600' : 'text-danger')}>
            {delta > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta).toFixed(0)} %
          </span>
        ) : <span className="text-stone-400">{has ? 'stable' : '—'}</span>)}
        {hint && <span className="truncate text-stone-500" title={hint}>{hint}</span>}
      </div>
    </div>
  )
}

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const toneCls = tone === 'good' ? 'bg-emerald-50' : tone === 'warn' ? 'bg-amber-50' : tone === 'bad' ? 'bg-red-50' : 'bg-stone-50'
  return (
    <div className={cx('rounded-xl p-3', toneCls)}>
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
      {hint && <p className="text-[11px] text-stone-500">{hint}</p>}
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="hidden text-xs text-stone-400 sm:inline">{children}</span>
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-stone-500">{label}</span><span className="font-semibold">{value}</span></div>
}

function SplitBar({ items, format }: { items: { label: string; value: number; color: string }[]; format: (n: number) => string }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-stone-100">
        {items.map((i) => <div key={i.label} style={{ width: `${total ? (i.value / total) * 100 : 0}%`, background: i.color }} />)}
      </div>
      <div className="mt-3 space-y-1.5">
        {items.map((i) => (
          <div key={i.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: i.color }} />{i.label}</span>
            <span className="font-semibold">{format(i.value)} <span className="font-normal text-stone-400">({pct(total ? (i.value / total) * 100 : 0, 0)})</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Funnel({ steps }: { steps: { label: string; v: number }[] }) {
  const max = Math.max(1, steps[0]?.v ?? 1)
  return (
    <ul className="space-y-3">
      {steps.map((s, i) => {
        const prev = steps[i - 1]?.v
        const drop = i > 0 && prev ? 100 - (s.v / prev) * 100 : 0
        return (
          <li key={s.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="font-semibold">
                {fmt(s.v)}
                {i > 0 && prev > 0 && <span className={cx('ml-1 text-xs', drop > 60 ? 'text-danger' : 'text-stone-400')}>({pct((s.v / prev) * 100, 0)})</span>}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-ball" style={{ width: `${(s.v / max) * 100}%`, opacity: 1 - i * 0.12 }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Heatmap({ data }: { data: { dow: number; hour: number; orders: number }[] }) {
  const hours = Array.from({ length: 14 }, (_, i) => i + 11).map((h) => h % 24) // 11h → 0h
  const max = Math.max(1, ...data.map((d) => d.orders))
  const get = (d: number, h: number) => data.find((x) => x.dow === d && x.hour === h)?.orders ?? 0
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr><th />{hours.map((h) => <th key={h} className="px-0.5 pb-1 font-medium text-stone-400">{h}h</th>)}</tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <tr key={d}>
              <td className="pr-2 font-medium text-stone-500">{WEEKDAYS[d]}</td>
              {hours.map((h) => {
                const v = get(d, h)
                return (
                  <td key={h} className="p-0.5">
                    <div title={`${WEEKDAYS[d]} ${h}h : ${v} commande(s)`} className="flex size-8 items-center justify-center rounded-md text-[10px] font-semibold sm:size-9"
                      style={{ background: v ? `rgba(181,18,27,${0.12 + (v / max) * 0.88})` : '#f5f5f4', color: v / max > 0.5 ? '#fff' : '#57534e' }}>
                      {v || ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cohorts({ cohorts }: { cohorts: Analysis['cohorts'] }) {
  if (cohorts.length === 0) return <p className="py-6 text-center text-sm text-stone-400">Pas encore de données</p>
  const maxM = Math.max(...cohorts.map((c) => c.months.length))
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr className="text-stone-500">
            <th className="pr-3 pb-2 text-left font-medium">Arrivée</th>
            <th className="pr-3 pb-2 text-right font-medium">Clients</th>
            {Array.from({ length: maxM }, (_, m) => <th key={m} className="px-0.5 pb-2 font-medium">{m === 0 ? 'M0' : `M+${m}`}</th>)}
            <th className="pb-2 pl-3 text-right font-medium">LTV cohorte</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => {
            const last = c.months[c.months.length - 1]
            return (
              <tr key={c.cohort}>
                <td className="pr-3 font-medium whitespace-nowrap">{monthLabel(c.cohort)}</td>
                <td className="pr-3 text-right">{c.size}</td>
                {Array.from({ length: maxM }, (_, m) => {
                  const cell = c.months.find((x) => x.m === m)
                  if (!cell) return <td key={m} className="p-0.5"><div className="size-10" /></td>
                  const rate = c.size ? (cell.active / c.size) * 100 : 0
                  return (
                    <td key={m} className="p-0.5">
                      <div title={`${cell.active} client(s) actifs`} className="flex size-10 items-center justify-center rounded-md font-semibold"
                        style={{ background: m === 0 ? '#3a0208' : `rgba(181,18,27,${0.08 + (rate / 100) * 0.92})`, color: m === 0 || rate > 45 ? '#fff' : '#44403c' }}>
                        {m === 0 ? '100' : Math.round(rate)}%
                      </div>
                    </td>
                  )
                })}
                <td className="pl-3 text-right font-semibold whitespace-nowrap">{money(c.size ? Number(last?.revenue ?? 0) / c.size : 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Table({ head, rows, bars, empty }: { head: string[]; rows: ReactNode[][]; bars?: number[]; empty?: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-stone-400">{empty ?? 'Pas encore de données'}</p>
  const max = Math.max(1, ...(bars ?? [1]).map(Number))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-stone-500">
            {head.map((h, i) => <th key={`${h}${i}`} className={cx('pb-2 font-medium whitespace-nowrap', i > 0 && 'pl-3 text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-t border-stone-100">
              {r.map((c, i) => (
                <td key={i} className={cx('py-2', i > 0 && 'pl-3 text-right whitespace-nowrap')}>
                  {i === 0 && bars ? (
                    <div className="relative min-w-28">
                      <div className="absolute inset-y-0 left-0 rounded bg-ball/10" style={{ width: `${(Number(bars[idx]) / max) * 100}%` }} />
                      <span className="relative px-1 font-medium">{c}</span>
                    </div>
                  ) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
