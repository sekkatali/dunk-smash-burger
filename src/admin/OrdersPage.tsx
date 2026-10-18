import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bike, ClipboardList, Download, Search, Store } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import {
  PAYMENT_SHORT, PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABEL, STATUS_COLOR, STATUS_LABEL, TZ,
  dateTime, downloadCsv, elapsed, minutesSince, money,
} from '../lib/format'
import type { Driver, Order, OrderStatus } from '../lib/types'
import { Badge, Button, Empty, Input, PageLoader, Select, Tabs, cx, useToast } from '../components/ui'
import { PageHeader } from './PageHeader'
import { useAdmin } from './adminContext'
import { OrderDetail, nextStep, updateOrderStatus } from './OrderDetail'

const ACTIVE: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'delivering']
const COLUMNS: { id: string; title: string; statuses: OrderStatus[]; accent: string }[] = [
  { id: 'new', title: 'Nouvelles', statuses: ['new'], accent: 'bg-ball' },
  { id: 'kitchen', title: 'En cuisine', statuses: ['accepted', 'preparing'], accent: 'bg-amber-500' },
  { id: 'ready', title: 'Prêtes', statuses: ['ready'], accent: 'bg-sky-500' },
  { id: 'delivering', title: 'En livraison', statuses: ['delivering'], accent: 'bg-violet-500' },
]

const SELECT = '*, order_items(*)'

function todayStartIso(): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
  const offset = new Date().getTime() - d.getTime()
  d.setHours(0, 0, 0, 0)
  return new Date(d.getTime() + offset).toISOString()
}

export default function OrdersPage() {
  const { ordersVersion, refreshCounts } = useAdmin()
  const toast = useToast()
  const [tab, setTab] = useState<'live' | 'history'>('live')
  const [active, setActive] = useState<Order[]>([])
  const [history, setHistory] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // filtres historique
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [todayStats, setTodayStats] = useState({ orders: 0, revenue: 0 })

  const loadActive = useCallback(async () => {
    const [o, d, t] = await Promise.all([
      supabase.from('orders').select(SELECT).in('status', ACTIVE).order('created_at', { ascending: true }),
      supabase.from('drivers').select('*').order('name'),
      supabase.from('orders').select('total').gte('created_at', todayStartIso()).not('status', 'in', '(cancelled,pending_payment)'),
    ])
    if (o.error) toast(errorMessage(o.error), 'error')
    setActive((o.data ?? []) as Order[])
    setDrivers((d.data ?? []) as Driver[])
    const rows = (t.data ?? []) as { total: number }[]
    setTodayStats({ orders: rows.length, revenue: rows.reduce((s, r) => s + Number(r.total), 0) })
    setLoading(false)
  }, [toast])

  const loadHistory = useCallback(async () => {
    let q = supabase.from('orders').select(SELECT)
      .gte('created_at', new Date(`${from}T00:00:00`).toISOString())
      .lte('created_at', new Date(`${to}T23:59:59`).toISOString())
      .order('created_at', { ascending: false })
      .limit(500)
    if (statusFilter) q = q.eq('status', statusFilter)
    const { data, error } = await q
    if (error) toast(errorMessage(error), 'error')
    setHistory((data ?? []) as Order[])
  }, [from, to, statusFilter, toast])

  useEffect(() => { void loadActive() }, [loadActive, ordersVersion])
  useEffect(() => { if (tab === 'history') void loadHistory() }, [tab, loadHistory, ordersVersion])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const refresh = () => {
    void loadActive()
    if (tab === 'history') void loadHistory()
    refreshCounts()
  }

  const selected = useMemo(
    () => [...active, ...history].find((o) => o.id === selectedId) ?? null,
    [active, history, selectedId],
  )

  const filteredHistory = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return history
    return history.filter((o) =>
      String(o.number).includes(s) || o.customer_name.toLowerCase().includes(s) || o.customer_phone.includes(s),
    )
  }, [history, search])

  const quick = async (o: Order) => {
    const n = nextStep(o)
    if (!n) return
    try {
      await updateOrderStatus(o, n.status)
      toast(`N°${o.number} : ${STATUS_LABEL[n.status]}`)
      refresh()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const exportCsv = () => {
    downloadCsv(`commandes-${from}-${to}.csv`, [
      ['N°', 'Date', 'Statut', 'Type', 'Client', 'Téléphone', 'Adresse', 'Zone', 'Paiement', 'Statut paiement', 'Sous-total', 'Livraison', 'Remise', 'Total', 'Code promo', 'Source'],
      ...filteredHistory.map((o) => [
        o.number, dateTime(o.created_at), STATUS_LABEL[o.status], o.type === 'delivery' ? 'Livraison' : 'À emporter',
        o.customer_name, o.customer_phone, o.address, o.zone, PAYMENT_SHORT[o.payment_method],
        PAYMENT_STATUS_LABEL[o.payment_status], o.subtotal, o.delivery_fee, o.discount, o.total, o.promo_code, o.utm_source,
      ]),
    ])
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <PageHeader
        title="Commandes"
        subtitle={`Aujourd'hui : ${todayStats.orders} commande${todayStats.orders > 1 ? 's' : ''} · ${money(todayStats.revenue)}`}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'live', label: `En cours (${active.length})` }, { id: 'history', label: 'Historique' }]} />}
      />

      {tab === 'live' ? (
        active.length === 0 ? (
          <Empty icon={<ClipboardList className="size-10" />} title="Aucune commande en cours">
            Les nouvelles commandes apparaissent ici en temps réel, avec une sonnerie.
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const list = active.filter((o) => col.statuses.includes(o.status))
              return (
                <div key={col.id} className="rounded-2xl bg-stone-200/60 p-3">
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <span className={cx('size-2.5 rounded-full', col.accent)} />
                    <h2 className="font-bold">{col.title}</h2>
                    <span className="ml-auto rounded-full bg-white px-2 text-sm font-semibold">{list.length}</span>
                  </div>
                  <div className="space-y-3">
                    {list.map((o) => (
                      <OrderCard key={o.id} order={o} drivers={drivers} onOpen={() => setSelectedId(o.id)} onNext={() => quick(o)} />
                    ))}
                    {list.length === 0 && <p className="px-1 py-6 text-center text-sm text-stone-400">—</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-3 border-b border-stone-100 p-4">
            <label className="text-sm"><span className="mb-1 block text-stone-500">Du</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-sm"><span className="mb-1 block text-stone-500">Au</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <label className="text-sm"><span className="mb-1 block text-stone-500">Statut</span>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Tous</option>
                {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
            </label>
            <div className="relative min-w-48 flex-1">
              <Search className="absolute top-3 left-3 size-4 text-stone-400" />
              <Input className="pl-9" placeholder="N°, nom, téléphone…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button variant="outline" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs tracking-wide text-stone-500 uppercase">
                <tr>
                  <th className="px-4 py-3">N°</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Type</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3">Paiement</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredHistory.map((o) => (
                  <tr key={o.id} onClick={() => setSelectedId(o.id)} className="cursor-pointer hover:bg-stone-50">
                    <td className="px-4 py-3 font-bold">{o.number}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-stone-600">{dateTime(o.created_at)}</td>
                    <td className="px-4 py-3"><p className="font-medium">{o.customer_name}</p><p className="text-xs text-stone-500">{o.customer_phone}</p></td>
                    <td className="px-4 py-3">{o.type === 'delivery' ? 'Livraison' : 'À emporter'}</td>
                    <td className="px-4 py-3"><Badge className={STATUS_COLOR[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                    <td className="px-4 py-3"><Badge className={PAYMENT_STATUS_COLOR[o.payment_status]}>{PAYMENT_SHORT[o.payment_method]} · {PAYMENT_STATUS_LABEL[o.payment_status]}</Badge></td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredHistory.length === 0 && <p className="p-8 text-center text-stone-500">Aucune commande sur cette période.</p>}
          </div>
        </div>
      )}

      {selected && (
        <OrderDetail order={selected} drivers={drivers} onClose={() => setSelectedId(null)} onChanged={refresh} />
      )}
    </div>
  )
}

function OrderCard({ order: o, drivers, onOpen, onNext }: { order: Order; drivers: Driver[]; onOpen: () => void; onNext: () => void }) {
  const next = nextStep(o)
  const mins = minutesSince(o.created_at)
  const late = o.status !== 'delivering' && mins >= 30
  const driver = drivers.find((d) => d.id === o.driver_id)
  const itemsCount = (o.order_items ?? []).reduce((s, i) => s + i.quantity, 0)
  return (
    <div className={cx('rounded-xl bg-white p-3 shadow-sm ring-1', o.status === 'new' ? 'ring-2 ring-ball' : 'ring-stone-200')}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold">#{o.number}</span>
          <span className={cx('text-xs font-semibold', late ? 'text-danger' : 'text-stone-500')}>{elapsed(o.created_at)}</span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
          {o.type === 'delivery' ? <Bike className="size-4 text-stone-400" /> : <Store className="size-4 text-stone-400" />}
          {o.customer_name}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-stone-500">
          {(o.order_items ?? []).map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-bold">{money(o.total)}</span>
          <Badge className={PAYMENT_STATUS_COLOR[o.payment_status]}>{PAYMENT_SHORT[o.payment_method]}</Badge>
          <span className="text-xs text-stone-400">{itemsCount} art.</span>
          {o.type === 'delivery' && (
            <span className={cx('text-xs', driver ? 'text-stone-600' : 'text-amber-600')}>{driver ? `🛵 ${driver.name}` : 'Sans livreur'}</span>
          )}
        </div>
      </button>
      {next && (
        <Button size="sm" variant={o.status === 'new' ? 'primary' : 'dark'} className="mt-3 w-full" onClick={onNext}>
          {next.label}
        </Button>
      )}
    </div>
  )
}
