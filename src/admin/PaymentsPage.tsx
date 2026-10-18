import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, CreditCard, Globe, ShieldCheck } from 'lucide-react'
import { SUPABASE_URL, supabase, errorMessage } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import {
  PAYMENT_SHORT, PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABEL, STATUS_LABEL, TZ, dateTime, money,
} from '../lib/format'
import type { Driver, Order, PaymentMethod, PaymentStatus } from '../lib/types'
import { Badge, Button, Card, Field, Input, PageLoader, Select, Toggle, useToast } from '../components/ui'
import { PageHeader } from './PageHeader'
import { useAdmin } from './adminContext'
import { OrderDetail } from './OrderDetail'

export default function PaymentsPage() {
  const { settings, save } = useSettings()
  const { ordersVersion } = useAdmin()
  const toast = useToast()
  const [p, setP] = useState(settings.payments)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: TZ }))
  const [methodFilter, setMethodFilter] = useState<'' | PaymentMethod>('')
  const [statusFilter, setStatusFilter] = useState<'' | PaymentStatus>('')
  const [orders, setOrders] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => setP(settings.payments), [settings.payments])

  const load = useCallback(async () => {
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(start.getTime() + 86400000)
    const [o, d] = await Promise.all([
      supabase.from('orders').select('*, order_items(*)').gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).order('created_at', { ascending: false }),
      supabase.from('drivers').select('*'),
    ])
    if (o.error) toast(errorMessage(o.error), 'error')
    setOrders((o.data ?? []) as Order[])
    setDrivers((d.data ?? []) as Driver[])
    setLoading(false)
  }, [date, toast])

  useEffect(() => { void load() }, [load, ordersVersion])

  const persist = async () => {
    if (p.cmi && !p.cmi_client_id.trim()) return toast("Renseigne d'abord le Client ID CMI", 'error')
    if (!p.cash && !p.card_on_delivery && !p.cmi) return toast('Garde au moins un moyen de paiement actif', 'error')
    setSaving(true)
    try {
      await save({ ...settings, payments: { ...p, cmi_client_id: p.cmi_client_id.trim() } })
      toast('Paramètres de paiement enregistrés')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const valid = orders.filter((o) => !['cancelled', 'pending_payment'].includes(o.status))
  const sum = (list: Order[]) => list.reduce((s, o) => s + Number(o.total), 0)
  const box = {
    cash: valid.filter((o) => o.payment_method === 'cash'),
    tpe: valid.filter((o) => o.payment_method === 'card_on_delivery'),
    online: valid.filter((o) => o.payment_method === 'cmi'),
  }
  const toCollect = valid.filter((o) => o.payment_status === 'pending')

  const filtered = useMemo(() => orders.filter((o) =>
    (!methodFilter || o.payment_method === methodFilter) && (!statusFilter || o.payment_status === statusFilter),
  ), [orders, methodFilter, statusFilter])

  const callbackUrl = `${SUPABASE_URL}/functions/v1/cmi-callback`
  const sel = orders.find((o) => o.id === selected)

  return (
    <div>
      <PageHeader title="Paiement" subtitle="Moyens de paiement, configuration CMI et caisse du jour." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Moyens de paiement proposés">
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <Banknote className="mt-0.5 size-5 text-stone-400" />
              <Toggle checked={p.cash} onChange={(v) => setP({ ...p, cash: v })} label="Espèces à la livraison / au retrait" />
            </div>
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 size-5 text-stone-400" />
              <Toggle checked={p.card_on_delivery} onChange={(v) => setP({ ...p, card_on_delivery: v })} label="Carte bancaire à la livraison (TPE mobile)" />
            </div>
            <div className="flex items-start gap-3">
              <Globe className="mt-0.5 size-5 text-stone-400" />
              <Toggle checked={p.cmi} onChange={(v) => setP({ ...p, cmi: v })} label="Paiement en ligne par carte (CMI)"
                description={p.cmi_client_id ? 'Les commandes payées en ligne arrivent en cuisine une fois le paiement validé.' : 'Disponible une fois le Client ID CMI renseigné ci-contre.'}
                disabled={!p.cmi_client_id.trim()} />
            </div>
            <Button loading={saving} onClick={persist}>Enregistrer</Button>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-ball" /> Terminal de paiement en ligne CMI (CIH Bank)</span>}>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-stone-600">
            <li>Demande à CIH Bank l'activation du <b>paiement en ligne CMI</b> (offre e-commerce, mode « 3D Pay Hosting »).</li>
            <li>CMI te fournit un <b>Client ID</b> (numéro de marchand) et une <b>clé de magasin (Store Key)</b>.</li>
            <li>Colle le Client ID ici. La Store Key est secrète : elle se renseigne côté serveur (on le fait ensemble).</li>
            <li>Donne à CMI l'URL de callback ci-dessous, fais un paiement test, puis désactive le mode test.</li>
          </ol>
          <div className="space-y-4">
            <Field label="Client ID CMI"><Input value={p.cmi_client_id} onChange={(e) => setP({ ...p, cmi_client_id: e.target.value })} placeholder="600000000" /></Field>
            <Toggle checked={p.cmi_test_mode} onChange={(v) => setP({ ...p, cmi_test_mode: v })} label="Mode test (plateforme de recette CMI)" description="À désactiver une fois les tests validés par CMI" />
            <Field label="URL de callback à communiquer à CMI">
              <div className="flex gap-2">
                <Input readOnly value={callbackUrl} className="font-mono text-xs" />
                <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(callbackUrl); toast('URL copiée') }}>Copier</Button>
              </div>
            </Field>
            <Button loading={saving} onClick={persist}>Enregistrer</Button>
          </div>
        </Card>
      </div>

      <div className="mt-8 mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-bold">Caisse du jour</h2>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </div>

      {loading ? <PageLoader /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Total encaissable" value={money(sum(valid))} sub={`${valid.length} commandes`} />
            <Tile label="Espèces" value={money(sum(box.cash))} sub={`${box.cash.length} cmd · ${money(sum(box.cash.filter((o) => o.payment_status === 'paid' && !o.cash_settled && o.driver_id)))} chez les livreurs`} />
            <Tile label="Carte (TPE)" value={money(sum(box.tpe))} sub={`${box.tpe.length} cmd`} />
            <Tile label="En ligne (CMI)" value={money(sum(box.online.filter((o) => o.payment_status === 'paid')))} sub={`${box.online.length} cmd`} />
          </div>
          {toCollect.length > 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              {toCollect.length} commande(s) pas encore encaissée(s) pour {money(sum(toCollect))}.
            </p>
          )}

          <Card className="mt-4">
            <div className="mb-3 flex flex-wrap gap-3">
              <Select className="w-auto" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as '' | PaymentMethod)}>
                <option value="">Tous les moyens</option>
                <option value="cash">Espèces</option><option value="card_on_delivery">TPE</option><option value="cmi">En ligne</option>
              </Select>
              <Select className="w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | PaymentStatus)}>
                <option value="">Tous les statuts</option>
                {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>)}
              </Select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs tracking-wide text-stone-500 uppercase">
                  <tr><th className="py-2">N°</th><th className="py-2">Heure</th><th className="py-2">Client</th><th className="py-2">Commande</th><th className="py-2">Paiement</th><th className="py-2">Réf.</th><th className="py-2 text-right">Montant</th></tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((o) => (
                    <tr key={o.id} onClick={() => setSelected(o.id)} className="cursor-pointer hover:bg-stone-50">
                      <td className="py-2.5 font-bold">{o.number}</td>
                      <td className="py-2.5 text-stone-500">{dateTime(o.created_at)}</td>
                      <td className="py-2.5">{o.customer_name}</td>
                      <td className="py-2.5 text-stone-500">{STATUS_LABEL[o.status]}</td>
                      <td className="py-2.5"><Badge className={PAYMENT_STATUS_COLOR[o.payment_status]}>{PAYMENT_SHORT[o.payment_method]} · {PAYMENT_STATUS_LABEL[o.payment_status]}</Badge></td>
                      <td className="py-2.5 font-mono text-xs text-stone-500">{o.payment_ref ?? '—'}</td>
                      <td className="py-2.5 text-right font-semibold">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="py-8 text-center text-stone-500">Aucun paiement ce jour-là.</p>}
            </div>
          </Card>
        </>
      )}

      {sel && <OrderDetail order={sel} drivers={drivers} onClose={() => setSelected(null)} onChanged={() => void load()} />}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
    </div>
  )
}
