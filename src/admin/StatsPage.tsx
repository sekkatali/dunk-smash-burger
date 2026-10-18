import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { PAYMENT_SHORT, TZ, money } from '../lib/format'
import type { PaymentMethod } from '../lib/types'
import { Card, Input, PageLoader, Tabs, cx, useToast } from '../components/ui'
import { PageHeader } from './PageHeader'

type Stats = {
  orders: number
  revenue: number
  aov: number
  cancelled: number
  discounts: number
  delivery_fees: number
  visitors: number
  page_views: number
  avg_prep_min: number
  avg_delivery_min: number
  funnel: { visit: number; product: number; cart: number; checkout: number; purchase: number }
  daily: { date: string; revenue: number; orders: number; visitors: number }[]
  top_products: { name: string; qty: number; revenue: number }[]
  top_options: { name: string; group: string; qty: number }[]
  hours: { hour: number; orders: number }[]
  weekdays: { day: number; orders: number; revenue: number }[]
  sources: { source: string; visitors: number; orders: number; revenue: number }[]
  devices: { device: string; visitors: number }[]
  payment_methods: { method: PaymentMethod; orders: number; revenue: number }[]
  types: { type: 'delivery' | 'pickup'; orders: number; revenue: number }[]
  zones: { zone: string; orders: number; revenue: number }[]
  customers: { total: number; new: number; returning: number }
  promos: { code: string; uses: number; discount: number; revenue: number }[]
}

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'
const ORANGE = '#FF5A1F'
const INK = '#2b2927'
const WEEKDAYS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** Minuit (heure du Maroc) du jour donné, en ISO UTC. */
function tzOffsetMs(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

function dayStart(dateStr: string): Date {
  const midnightUtc = new Date(`${dateStr}T00:00:00Z`)
  return new Date(midnightUtc.getTime() - tzOffsetMs(new Date(`${dateStr}T12:00:00Z`)))
}

function todayStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

function rangeFor(p: Period, customFrom: string, customTo: string): { from: Date; to: Date } {
  const t = todayStr()
  switch (p) {
    case 'today': return { from: dayStart(t), to: dayStart(todayStr(1)) }
    case 'yesterday': return { from: dayStart(todayStr(-1)), to: dayStart(t) }
    case '7d': return { from: dayStart(todayStr(-6)), to: dayStart(todayStr(1)) }
    case '30d': return { from: dayStart(todayStr(-29)), to: dayStart(todayStr(1)) }
    case 'month': return { from: dayStart(`${t.slice(0, 8)}01`), to: dayStart(todayStr(1)) }
    default: {
      const end = new Date(`${customTo}T00:00:00Z`)
      end.setUTCDate(end.getUTCDate() + 1)
      return { from: dayStart(customFrom), to: dayStart(end.toISOString().slice(0, 10)) }
    }
  }
}

export default function StatsPage() {
  const toast = useToast()
  const [period, setPeriod] = useState<Period>('7d')
  const [customFrom, setCustomFrom] = useState(todayStr(-13))
  const [customTo, setCustomTo] = useState(todayStr())
  const [stats, setStats] = useState<Stats | null>(null)
  const [prev, setPrev] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to } = rangeFor(period, customFrom, customTo)
    const span = to.getTime() - from.getTime()
    const [cur, before] = await Promise.all([
      supabase.rpc('admin_stats', { p_from: from.toISOString(), p_to: to.toISOString() }),
      supabase.rpc('admin_stats', { p_from: new Date(from.getTime() - span).toISOString(), p_to: from.toISOString() }),
    ])
    if (cur.error) toast(errorMessage(cur.error), 'error')
    setStats(cur.data as Stats)
    setPrev(before.data as Stats)
    setLoading(false)
  }, [period, customFrom, customTo, toast])

  useEffect(() => { void load() }, [load])

  const conv = (s: Stats | null) => (s && s.visitors > 0 ? (s.orders / s.visitors) * 100 : 0)

  const daily = useMemo(() => (stats?.daily ?? []).map((d) => ({
    ...d,
    label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
  })), [stats])

  return (
    <div>
      <PageHeader
        title="Statistiques"
        subtitle="Ventes, trafic, conversion et sources. Comparaison avec la période précédente."
        actions={
          <Tabs value={period} onChange={setPeriod} tabs={[
            { id: 'today', label: "Aujourd'hui" }, { id: 'yesterday', label: 'Hier' }, { id: '7d', label: '7 jours' },
            { id: '30d', label: '30 jours' }, { id: 'month', label: 'Ce mois' }, { id: 'custom', label: 'Personnalisé' },
          ]} />
        }
      />
      {period === 'custom' && (
        <div className="mb-6 flex flex-wrap gap-3">
          <label className="text-sm"><span className="mb-1 block text-stone-500">Du</span><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
          <label className="text-sm"><span className="mb-1 block text-stone-500">Au</span><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
        </div>
      )}

      {loading || !stats ? <PageLoader /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Chiffre d'affaires" value={money(stats.revenue)} cur={stats.revenue} prev={prev?.revenue} />
            <Kpi label="Commandes" value={String(stats.orders)} cur={stats.orders} prev={prev?.orders} />
            <Kpi label="Panier moyen" value={money(stats.aov)} cur={stats.aov} prev={prev?.aov} />
            <Kpi label="Visiteurs" value={String(stats.visitors)} cur={stats.visitors} prev={prev?.visitors} />
            <Kpi label="Taux de conversion" value={`${conv(stats).toFixed(1).replace('.', ',')} %`} cur={conv(stats)} prev={conv(prev)} />
            <Kpi label="Nouveaux clients" value={String(stats.customers.new)} cur={stats.customers.new} prev={prev?.customers.new} hint={`${stats.customers.returning} clients fidèles`} />
            <Kpi label="Temps de préparation" value={`${stats.avg_prep_min || '—'} min`} cur={stats.avg_prep_min} prev={prev?.avg_prep_min} invert />
            <Kpi label="Annulations" value={String(stats.cancelled)} cur={stats.cancelled} prev={prev?.cancelled} invert hint={`Remises : ${money(stats.discounts)}`} />
          </div>

          {daily.length > 1 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Chiffre d'affaires par jour">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={daily} margin={{ left: -10, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v) => money(Number(v))} labelStyle={{ fontWeight: 700 }} />
                    <Area type="monotone" dataKey="revenue" name="CA" stroke={ORANGE} strokeWidth={2.5} fill="url(#rev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
              <Card title="Commandes et visiteurs par jour">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={daily} margin={{ left: -10, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="visitors" name="Visiteurs" fill="#d6d3d1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="orders" name="Commandes" fill={ORANGE} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Tunnel de conversion" className="lg:col-span-1">
              <Funnel f={stats.funnel} />
            </Card>
            <Card title="Commandes par heure" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.hours.filter((h) => h.hour >= 10 || h.orders > 0)} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="#eee" />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={(h) => `${h}h – ${Number(h) + 1}h`} />
                  <Bar dataKey="orders" name="Commandes" fill={INK} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Produits les plus vendus">
              <SimpleTable
                head={['Produit', 'Qté', 'CA']}
                rows={stats.top_products.map((p) => [p.name, p.qty, money(p.revenue)])}
                bars={stats.top_products.map((p) => p.qty)}
              />
            </Card>
            <Card title="Sources de trafic">
              <SimpleTable
                head={['Source', 'Visiteurs', 'Cmd', 'Conv.', 'CA']}
                rows={stats.sources.map((s) => [sourceLabel(s.source), s.visitors, s.orders, `${s.visitors ? ((s.orders / s.visitors) * 100).toFixed(1) : '0'} %`, money(s.revenue)])}
                bars={stats.sources.map((s) => s.visitors)}
              />
              <p className="mt-3 text-xs text-stone-500">Utilise des liens avec UTM (Marketing → Liens de campagne) pour distinguer Instagram, pubs Meta, Google, etc.</p>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <Card title="Jours de la semaine">
              <SimpleTable head={['Jour', 'Cmd', 'CA']} rows={stats.weekdays.map((w) => [WEEKDAYS[w.day], w.orders, money(w.revenue)])} bars={stats.weekdays.map((w) => w.orders)} />
            </Card>
            <Card title="Livraison / à emporter">
              <SimpleTable head={['Mode', 'Cmd', 'CA']} rows={stats.types.map((t) => [t.type === 'delivery' ? 'Livraison' : 'À emporter', t.orders, money(t.revenue)])} bars={stats.types.map((t) => t.orders)} />
              <p className="mt-3 text-xs text-stone-500">Temps moyen de livraison : {stats.avg_delivery_min || '—'} min · Frais encaissés : {money(stats.delivery_fees)}</p>
            </Card>
            <Card title="Moyens de paiement">
              <SimpleTable head={['Paiement', 'Cmd', 'CA']} rows={stats.payment_methods.map((m) => [PAYMENT_SHORT[m.method], m.orders, money(m.revenue)])} bars={stats.payment_methods.map((m) => m.orders)} />
            </Card>
            <Card title="Appareils">
              <SimpleTable head={['Appareil', 'Visiteurs']} rows={stats.devices.map((d) => [d.device, d.visitors])} bars={stats.devices.map((d) => d.visitors)} />
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Card title="Options les plus choisies">
              <SimpleTable head={['Option', 'Qté']} rows={stats.top_options.map((o) => [`${o.name}`, o.qty])} bars={stats.top_options.map((o) => o.qty)} />
            </Card>
            <Card title="Zones de livraison">
              <SimpleTable head={['Zone', 'Cmd', 'CA']} rows={stats.zones.map((z) => [z.zone, z.orders, money(z.revenue)])} bars={stats.zones.map((z) => z.orders)} />
            </Card>
            <Card title="Codes promo">
              <SimpleTable head={['Code', 'Util.', 'Remise', 'CA']} rows={stats.promos.map((p) => [p.code, p.uses, money(p.discount), money(p.revenue)])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function sourceLabel(s: string): string {
  const map: Record<string, string> = {
    direct: 'Direct / inconnu', facebook: 'Facebook', instagram: 'Instagram', google: 'Google', tiktok: 'TikTok',
    'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'google.com': 'Google', 'tiktok.com': 'TikTok', 'google.co.ma': 'Google',
  }
  return map[s] ?? s
}

function Kpi({ label, value, cur, prev, hint, invert }: { label: string; value: string; cur: number; prev?: number; hint?: string; invert?: boolean }) {
  const has = prev !== undefined && prev !== null && prev > 0
  const delta = has ? ((cur - prev) / prev) * 100 : 0
  const good = invert ? delta < 0 : delta > 0
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {has && Math.abs(delta) >= 0.5 ? (
          <span className={cx('inline-flex items-center font-semibold', good ? 'text-emerald-600' : 'text-danger')}>
            {delta > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta).toFixed(0)} %
          </span>
        ) : <span className="text-stone-400">{has ? 'stable' : '—'}</span>}
        {hint && <span className="truncate text-stone-500">{hint}</span>}
      </div>
    </div>
  )
}

function Funnel({ f }: { f: Stats['funnel'] }) {
  const steps = [
    { label: 'Visites', v: f.visit },
    { label: 'Produit consulté', v: f.product },
    { label: 'Ajout au panier', v: f.cart },
    { label: 'Paiement commencé', v: f.checkout },
    { label: 'Commande', v: f.purchase },
  ]
  const max = Math.max(1, f.visit)
  return (
    <ul className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{s.label}</span>
            <span className="font-semibold">{s.v}{i > 0 && steps[i - 1].v > 0 && <span className="ml-1 text-xs text-stone-400">({Math.round((s.v / steps[i - 1].v) * 100)} %)</span>}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-ball" style={{ width: `${(s.v / max) * 100}%`, opacity: 1 - i * 0.12 }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function SimpleTable({ head, rows, bars }: { head: string[]; rows: ReactNode[][]; bars?: number[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-stone-400">Pas encore de données</p>
  const max = Math.max(1, ...(bars ?? [1]))
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-stone-500">
          {head.map((h, i) => <th key={h} className={cx('pb-2 font-medium', i > 0 && 'text-right')}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={idx} className="border-t border-stone-100">
            {r.map((c, i) => (
              <td key={i} className={cx('py-2', i > 0 && 'text-right whitespace-nowrap')}>
                {i === 0 && bars ? (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 rounded bg-ball/10" style={{ width: `${(bars[idx] / max) * 100}%` }} />
                    <span className="relative px-1 font-medium">{c}</span>
                  </div>
                ) : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
