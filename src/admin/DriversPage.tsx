import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bike, Copy, MessageCircle, Pencil, Phone, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { TZ, elapsed, money, waLink } from '../lib/format'
import type { Driver, Order } from '../lib/types'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageLoader, Select, Textarea, Toggle, cx, useToast } from '../components/ui'
import { PageHeader } from './PageHeader'
import { useAdmin } from './adminContext'

const STATUS = {
  available: { label: 'Disponible', cls: 'bg-emerald-100 text-emerald-800' },
  busy: { label: 'En course', cls: 'bg-violet-100 text-violet-800' },
  offline: { label: 'Hors ligne', cls: 'bg-stone-200 text-stone-600' },
} as const

const isToday = (iso: string | null) => {
  if (!iso) return false
  const f = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: TZ })
  return f(new Date(iso)) === f(new Date())
}

export default function DriversPage() {
  const toast = useToast()
  const { ordersVersion } = useAdmin()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Driver | 'new' | null>(null)

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 86400000).toISOString()
    const [d, o, cash] = await Promise.all([
      supabase.from('drivers').select('*').order('active', { ascending: false }).order('name'),
      supabase.from('orders').select('*').eq('type', 'delivery').or(`status.in.(accepted,preparing,ready,delivering),created_at.gte.${since}`).order('created_at'),
      supabase.from('orders').select('*').eq('status', 'delivered').eq('payment_method', 'cash').eq('cash_settled', false).not('driver_id', 'is', null),
    ])
    if (d.error) toast(errorMessage(d.error), 'error')
    setDrivers((d.data ?? []) as Driver[])
    const map = new Map<string, Order>()
    ;[...((o.data ?? []) as Order[]), ...((cash.data ?? []) as Order[])].forEach((x) => map.set(x.id, x))
    setOrders([...map.values()])
    setLoading(false)
  }, [toast])

  useEffect(() => { void load() }, [load, ordersVersion])

  const unassigned = useMemo(
    () => orders.filter((o) => !o.driver_id && ['accepted', 'preparing', 'ready'].includes(o.status)),
    [orders],
  )

  const assign = async (order: Order, driverId: string) => {
    const { error } = await supabase.from('orders').update({ driver_id: driverId }).eq('id', order.id)
    if (error) return toast(errorMessage(error), 'error')
    toast(`Commande n°${order.number} assignée`)
    void load()
  }

  const settle = async (d: Driver, amount: number) => {
    if (!confirm(`Confirmer que ${d.name} t'a remis ${money(amount)} en espèces ?`)) return
    const { error } = await supabase.from('orders').update({ cash_settled: true })
      .eq('driver_id', d.id).eq('status', 'delivered').eq('payment_method', 'cash').eq('cash_settled', false)
    if (error) return toast(errorMessage(error), 'error')
    toast('Encaissement soldé')
    void load()
  }

  const setStatus = async (d: Driver, status: Driver['status']) => {
    await supabase.from('drivers').update({ status }).eq('id', d.id)
    void load()
  }

  const portalUrl = (d: Driver) => `${window.location.origin}/livreur/${d.access_token}`

  if (loading) return <PageLoader />

  return (
    <div>
      <PageHeader
        title="Livreurs"
        subtitle="Gère ta flotte, assigne les courses et suis l'argent encaissé par chaque livreur."
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> Ajouter un livreur</Button>}
      />

      {unassigned.length > 0 && (
        <Card className="mb-6 border-amber-300 bg-amber-50" title={`À assigner (${unassigned.length})`}>
          <ul className="divide-y divide-amber-200">
            {unassigned.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="font-bold">#{o.number}</span>
                <span className="text-sm">{o.customer_name} · {o.zone || o.address}</span>
                <span className="text-xs text-stone-500">{elapsed(o.created_at)}</span>
                <Select className="ml-auto w-56" value="" onChange={(e) => e.target.value && assign(o, e.target.value)}>
                  <option value="">Assigner à…</option>
                  {drivers.filter((d) => d.active).map((d) => (
                    <option key={d.id} value={d.id}>{d.name} — {STATUS[d.status].label}</option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {drivers.length === 0 ? (
        <Empty icon={<Bike className="size-10" />} title="Aucun livreur">
          Ajoute tes livreurs : chacun reçoit un lien personnel pour voir ses courses et les marquer livrées depuis son téléphone.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((d) => {
            const mine = orders.filter((o) => o.driver_id === d.id)
            const activeOrders = mine.filter((o) => ['accepted', 'preparing', 'ready', 'delivering'].includes(o.status))
            const deliveredToday = mine.filter((o) => o.status === 'delivered' && isToday(o.delivered_at))
            const cash = mine.filter((o) => o.status === 'delivered' && o.payment_method === 'cash' && !o.cash_settled)
            const cashAmount = cash.reduce((s, o) => s + Number(o.total), 0)
            return (
              <Card key={d.id} className={cx(!d.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-full bg-ink text-lg font-bold text-white">{d.name.charAt(0).toUpperCase()}</span>
                    <div>
                      <p className="font-bold">{d.name}</p>
                      <p className="text-sm text-stone-500">{[d.vehicle, d.plate].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                  </div>
                  {d.active ? <Badge className={STATUS[d.status].cls}>{STATUS[d.status].label}</Badge> : <Badge>Désactivé</Badge>}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-stone-50 p-2"><p className="text-xl font-bold">{activeOrders.length}</p><p className="text-[11px] text-stone-500">En cours</p></div>
                  <div className="rounded-xl bg-stone-50 p-2"><p className="text-xl font-bold">{deliveredToday.length}</p><p className="text-[11px] text-stone-500">Livrées auj.</p></div>
                  <div className={cx('rounded-xl p-2', cashAmount > 0 ? 'bg-amber-50' : 'bg-stone-50')}><p className="text-base font-bold">{money(cashAmount)}</p><p className="text-[11px] text-stone-500">Espèces à remettre</p></div>
                </div>

                {activeOrders.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {activeOrders.map((o) => (
                      <li key={o.id} className="flex justify-between rounded-lg bg-violet-50 px-2 py-1">
                        <span>#{o.number} · {o.zone || o.customer_name}</span>
                        <span className="text-xs text-stone-500">{o.status === 'delivering' ? 'en route' : 'en attente'}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {d.active && (
                  <div className="mt-3 flex gap-1">
                    {(['available', 'busy', 'offline'] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setStatus(d, s)}
                        className={cx('flex-1 rounded-lg py-1.5 text-xs font-semibold', d.status === s ? STATUS[s].cls : 'bg-white text-stone-400 ring-1 ring-stone-200')}>
                        {STATUS[s].label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {cashAmount > 0 && <Button size="sm" variant="dark" onClick={() => settle(d, cashAmount)}><Wallet className="size-4" /> Solder {money(cashAmount)}</Button>}
                  <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(portalUrl(d)); toast('Lien copié') }}>
                    <Copy className="size-4" /> Lien livreur
                  </Button>
                  {d.phone && (
                    <>
                      <a href={waLink(d.phone, `Salut ${d.name}, voici ton lien Dunk pour voir tes courses : ${portalUrl(d)}`)} target="_blank" rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#25D366] px-3 text-sm font-semibold text-white"><MessageCircle className="size-4" /> Envoyer</a>
                      <a href={`tel:${d.phone}`} className="inline-flex h-8 items-center rounded-xl px-2 text-stone-500 hover:text-ink"><Phone className="size-4" /></a>
                    </>
                  )}
                  <button type="button" onClick={() => setEditing(d)} className="ml-auto p-1.5 text-stone-400 hover:text-ink"><Pencil className="size-4" /></button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {editing && <DriverForm driver={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

function DriverForm({ driver, onClose, onSaved }: { driver: Driver | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({
    name: driver?.name ?? '', phone: driver?.phone ?? '', vehicle: driver?.vehicle ?? 'Scooter',
    plate: driver?.plate ?? '', notes: driver?.notes ?? '', active: driver?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    if (!f.name.trim()) return toast('Nom obligatoire', 'error')
    setSaving(true)
    const values = { name: f.name.trim(), phone: f.phone.trim() || null, vehicle: f.vehicle || null, plate: f.plate || null, notes: f.notes || null, active: f.active }
    const { error } = driver
      ? await supabase.from('drivers').update(values).eq('id', driver.id)
      : await supabase.from('drivers').insert(values)
    setSaving(false)
    if (error) return toast(errorMessage(error), 'error')
    toast('Livreur enregistré')
    onSaved()
  }

  const regenerate = async () => {
    if (!driver || !confirm("Générer un nouveau lien ? L'ancien lien ne fonctionnera plus.")) return
    const { error } = await supabase.from('drivers').update({ access_token: crypto.randomUUID() }).eq('id', driver.id)
    if (error) return toast(errorMessage(error), 'error')
    toast('Nouveau lien généré')
    onSaved()
  }

  const remove = async () => {
    if (!driver || !confirm(`Supprimer ${driver.name} ? (préfère « désactiver » pour garder l'historique)`)) return
    const { error } = await supabase.from('drivers').delete().eq('id', driver.id)
    if (error) return toast(errorMessage(error), 'error')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} size="sm" title={driver ? 'Modifier le livreur' : 'Nouveau livreur'}
      footer={
        <div className="flex items-center justify-between gap-2">
          {driver ? <button type="button" onClick={remove} className="text-sm text-danger"><Trash2 className="inline size-4" /> Supprimer</button> : <span />}
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button loading={saving} onClick={save}>Enregistrer</Button></div>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Nom *"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Téléphone"><Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="06…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Véhicule">
            <Select value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)}>
              <option>Scooter</option><option>Moto</option><option>Vélo</option><option>Voiture</option><option>À pied</option>
            </Select>
          </Field>
          <Field label="Immatriculation"><Input value={f.plate} onChange={(e) => set('plate', e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
        <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Actif" description="Un livreur désactivé ne peut plus recevoir de courses" />
        {driver && (
          <Button variant="soft" size="sm" onClick={regenerate}><RefreshCw className="size-4" /> Régénérer son lien personnel</Button>
        )}
      </div>
    </Modal>
  )
}
