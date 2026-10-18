import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Bike, MapPin, MessageCircle, Phone, Printer, Store } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import {
  PAYMENT_LABEL, PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABEL, STATUS_COLOR, STATUS_LABEL,
  dateTime, mapsLink, money, timeOf, waLink,
} from '../lib/format'
import type { Driver, Order, OrderStatus } from '../lib/types'
import { Badge, Button, Modal, Select, Textarea, useToast } from '../components/ui'

export const NEXT_STEP: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  new: { status: 'preparing', label: 'Accepter' },
  accepted: { status: 'preparing', label: 'En préparation' },
  preparing: { status: 'ready', label: 'Prête' },
}

export function nextStep(o: Order): { status: OrderStatus; label: string } | null {
  if (o.status === 'ready') return o.type === 'delivery' ? { status: 'delivering', label: 'Partie en livraison' } : { status: 'delivered', label: 'Récupérée' }
  if (o.status === 'delivering') return { status: 'delivered', label: 'Livrée' }
  return NEXT_STEP[o.status] ?? null
}

export async function updateOrderStatus(o: Order, status: OrderStatus, extra: Partial<Order> = {}) {
  const patch: Partial<Order> = { status, ...extra }
  // paiement à la livraison : encaissé quand la commande est remise
  if (status === 'delivered' && o.payment_method !== 'cmi' && o.payment_status === 'pending') patch.payment_status = 'paid'
  const { error } = await supabase.from('orders').update(patch).eq('id', o.id)
  if (error) throw error
  if (status === 'delivering' && o.driver_id) await supabase.from('drivers').update({ status: 'busy' }).eq('id', o.driver_id)
}

export function OrderDetail({ order, drivers, onClose, onChanged }: {
  order: Order
  drivers: Driver[]
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const { settings } = useSettings()
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [printing, setPrinting] = useState(false)
  const next = nextStep(order)
  const items = order.order_items ?? []

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast(ok)
      onChanged()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const assign = (driverId: string) =>
    run(async () => {
      const { error } = await supabase.from('orders').update({ driver_id: driverId || null }).eq('id', order.id)
      if (error) throw error
    }, driverId ? 'Livreur assigné' : 'Livreur retiré')

  const print = () => {
    setPrinting(true)
    setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 50)
  }

  const driver = drivers.find((d) => d.id === order.driver_id)
  const waText = `Bonjour ${order.customer_name}, c'est ${settings.restaurant.name} à propos de votre commande n°${order.number}.`

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Commande n°{order.number}
            <Badge className={STATUS_COLOR[order.status]}>{STATUS_LABEL[order.status]}</Badge>
          </span>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={print}><Printer className="size-4" /> Ticket</Button>
              {!['delivered', 'cancelled'].includes(order.status) && (
                <Button variant="ghost" size="sm" className="text-danger" onClick={() => setCancelOpen(true)}>Annuler</Button>
              )}
            </div>
            <div className="flex gap-2">
              {order.status === 'cancelled' && (
                <Button variant="outline" size="sm" loading={busy} onClick={() => run(() => updateOrderStatus(order, 'new', { cancel_reason: null, cancelled_at: null }), 'Commande rétablie')}>
                  Rétablir
                </Button>
              )}
              {next && (
                <Button loading={busy} onClick={() => run(() => updateOrderStatus(order, next.status), `Commande n°${order.number} : ${STATUS_LABEL[next.status]}`)}>
                  {next.label}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-stone-500">
                {order.type === 'delivery' ? <><Bike className="size-4" /> Livraison</> : <><Store className="size-4" /> À emporter</>}
                <span className="ml-auto font-normal">{dateTime(order.created_at)}</span>
              </p>
              <p className="mt-2 text-lg font-bold">{order.customer_name}</p>
              <p className="text-stone-700">{order.customer_phone}</p>
              {order.customer_email && <p className="text-sm text-stone-500">{order.customer_email}</p>}
              {order.type === 'delivery' && order.address && (
                <div className="mt-3">
                  <p className="font-medium">{order.address}</p>
                  {order.address_details && <p className="text-sm text-stone-600">{order.address_details}</p>}
                  {order.zone && <p className="text-sm text-stone-500">Zone : {order.zone}</p>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`tel:${order.customer_phone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-stone-200">
                  <Phone className="size-4" /> Appeler
                </a>
                <a href={waLink(order.customer_phone, waText)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-sm font-semibold text-white">
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
                {order.address && (
                  <a href={mapsLink(`${order.address} ${settings.restaurant.city}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-stone-200">
                    <MapPin className="size-4" /> Maps
                  </a>
                )}
              </div>
            </div>

            {order.notes && (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm">
                <p className="font-semibold text-amber-900">Note du client</p>
                <p className="mt-1 text-amber-900">{order.notes}</p>
              </div>
            )}

            {order.type === 'delivery' && order.status !== 'cancelled' && (
              <div>
                <p className="mb-1.5 text-sm font-semibold">Livreur</p>
                <Select value={order.driver_id ?? ''} onChange={(e) => assign(e.target.value)} disabled={busy}>
                  <option value="">— Aucun —</option>
                  {drivers.filter((d) => d.active).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.status === 'available' ? '· dispo' : d.status === 'busy' ? '· en course' : '· hors ligne'}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="rounded-2xl border border-stone-200 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{PAYMENT_LABEL[order.payment_method]}</span>
                <Badge className={PAYMENT_STATUS_COLOR[order.payment_status]}>{PAYMENT_STATUS_LABEL[order.payment_status]}</Badge>
              </div>
              {order.payment_ref && <p className="mt-1 text-xs text-stone-500">Réf. {order.payment_ref}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {order.payment_status !== 'paid' && (
                  <Button size="sm" variant="soft" loading={busy} onClick={() => run(async () => {
                    const { error } = await supabase.from('orders').update({ payment_status: 'paid' }).eq('id', order.id)
                    if (error) throw error
                  }, 'Marquée comme payée')}>Marquer payée</Button>
                )}
                {order.payment_status === 'paid' && (
                  <Button size="sm" variant="soft" loading={busy} onClick={() => run(async () => {
                    const { error } = await supabase.from('orders').update({ payment_status: 'refunded' }).eq('id', order.id)
                    if (error) throw error
                  }, 'Marquée comme remboursée')}>Marquer remboursée</Button>
                )}
              </div>
            </div>

            {(order.utm_source || order.promo_code) && (
              <p className="text-xs text-stone-500">
                {order.utm_source && <>Source : <b>{order.utm_source}</b>{order.utm_campaign ? ` / ${order.utm_campaign}` : ''} · </>}
                {order.promo_code && <>Code : <b>{order.promo_code}</b></>}
              </p>
            )}
          </div>

          <div>
            <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
              {items.map((i) => (
                <li key={i.id} className="p-3">
                  <div className="flex justify-between gap-2">
                    <span className="font-bold"><span className="text-ball">{i.quantity}×</span> {i.product_name}</span>
                    <span className="whitespace-nowrap">{money(i.total)}</span>
                  </div>
                  {i.options.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-sm text-stone-600">
                      {i.options.map((op) => (
                        <li key={op.id}>· {op.name}{op.price > 0 ? ` (+${money(op.price)})` : ''}</li>
                      ))}
                    </ul>
                  )}
                  {i.note && <p className="mt-1 text-sm font-medium text-amber-700">⚠ {i.note}</p>}
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 px-1 text-sm">
              <div className="flex justify-between"><dt className="text-stone-500">Sous-total</dt><dd>{money(order.subtotal)}</dd></div>
              {order.type === 'delivery' && <div className="flex justify-between"><dt className="text-stone-500">Livraison</dt><dd>{money(order.delivery_fee)}</dd></div>}
              {order.discount > 0 && <div className="flex justify-between"><dt className="text-stone-500">Réduction</dt><dd>− {money(order.discount)}</dd></div>}
              <div className="flex justify-between border-t border-stone-100 pt-2 text-lg font-bold"><dt>Total</dt><dd>{money(order.total)}</dd></div>
            </dl>
            <div className="mt-4 space-y-1 text-xs text-stone-500">
              <p>Reçue : {timeOf(order.created_at)}</p>
              {order.accepted_at && <p>Acceptée : {timeOf(order.accepted_at)}</p>}
              {order.ready_at && <p>Prête : {timeOf(order.ready_at)}</p>}
              {order.delivering_at && <p>Partie : {timeOf(order.delivering_at)}{driver ? ` avec ${driver.name}` : ''}</p>}
              {order.delivered_at && <p>Livrée : {timeOf(order.delivered_at)}</p>}
              {order.cancelled_at && <p>Annulée : {timeOf(order.cancelled_at)}{order.cancel_reason ? ` — ${order.cancel_reason}` : ''}</p>}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Annuler la commande" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Retour</Button>
            <Button variant="danger" loading={busy} onClick={() => run(async () => {
              await updateOrderStatus(order, 'cancelled', { cancel_reason: reason.trim() || null })
              setCancelOpen(false)
            }, 'Commande annulée')}>Annuler la commande</Button>
          </div>
        }>
        <p className="mb-3 text-sm text-stone-600">Le client verra ce motif sur sa page de suivi.</p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex : produit en rupture, adresse hors zone…" />
        <div className="mt-2 flex flex-wrap gap-2">
          {['Rupture de stock', 'Adresse hors zone', 'Client injoignable', 'Commande en double'].map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium hover:bg-stone-200">{r}</button>
          ))}
        </div>
      </Modal>

      {printing && createPortal(<Ticket order={order} restaurant={settings.restaurant.name} />, document.body)}
    </>
  )
}

function Ticket({ order, restaurant }: { order: Order; restaurant: string }) {
  return (
    <div id="print-root">
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{restaurant.toUpperCase()}</div>
      <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, margin: '4px 0' }}>N° {order.number}</div>
      <div style={{ textAlign: 'center' }}>{order.type === 'delivery' ? 'LIVRAISON' : 'À EMPORTER'} — {dateTime(order.created_at)}</div>
      <hr />
      {(order.order_items ?? []).map((i) => (
        <div key={i.id} style={{ margin: '4px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>{i.quantity}x {i.product_name}</span><span>{money(i.total)}</span>
          </div>
          {i.options.map((op) => <div key={op.id} style={{ paddingLeft: 8 }}>- {op.name}</div>)}
          {i.note && <div style={{ paddingLeft: 8 }}>!! {i.note}</div>}
        </div>
      ))}
      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Sous-total</span><span>{money(order.subtotal)}</span></div>
      {order.delivery_fee > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Livraison</span><span>{money(order.delivery_fee)}</span></div>}
      {order.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Remise</span><span>-{money(order.discount)}</span></div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}><span>TOTAL</span><span>{money(order.total)}</span></div>
      <div>{PAYMENT_LABEL[order.payment_method]} — {PAYMENT_STATUS_LABEL[order.payment_status]}</div>
      <hr />
      <div style={{ fontWeight: 700 }}>{order.customer_name}</div>
      <div>{order.customer_phone}</div>
      {order.address && <div>{order.address}</div>}
      {order.address_details && <div>{order.address_details}</div>}
      {order.zone && <div>Zone : {order.zone}</div>}
      {order.notes && <div style={{ marginTop: 4 }}>Note : {order.notes}</div>}
    </div>
  )
}
