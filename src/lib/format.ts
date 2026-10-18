import type { OrderStatus, PaymentMethod, PaymentStatus } from './types'

export const TZ = 'Africa/Casablanca'

export function money(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  const s = Number.isInteger(v) ? v.toString() : v.toFixed(2).replace('.', ',')
  return `${s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} DH`
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
}

export function dateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
}

export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
}

export function elapsed(iso: string): string {
  const m = minutesSince(iso)
  if (m < 1) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
  return `il y a ${Math.floor(h / 24)} j`
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Paiement en attente',
  new: 'Nouvelle',
  accepted: 'Acceptée',
  preparing: 'En préparation',
  ready: 'Prête',
  delivering: 'En livraison',
  delivered: 'Livrée',
  cancelled: 'Annulée',
}

export const STATUS_COLOR: Record<OrderStatus, string> = {
  pending_payment: 'bg-stone-200 text-stone-700',
  new: 'bg-orange-100 text-orange-800',
  accepted: 'bg-amber-100 text-amber-800',
  preparing: 'bg-amber-100 text-amber-800',
  ready: 'bg-sky-100 text-sky-800',
  delivering: 'bg-violet-100 text-violet-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Espèces à la livraison',
  card_on_delivery: 'Carte à la livraison',
  cmi: 'Carte en ligne (CMI)',
}

export const PAYMENT_SHORT: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  card_on_delivery: 'TPE',
  cmi: 'En ligne',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'À encaisser',
  paid: 'Payé',
  failed: 'Échoué',
  refunded: 'Remboursé',
}

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-stone-200 text-stone-700',
}

export const DAY_LABEL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

export function normalizePhone(p: string): string {
  return p.replace(/[^0-9+]/g, '')
}

/** Numéro au format international pour WhatsApp (Maroc par défaut). */
export function waNumber(p: string): string {
  let n = normalizePhone(p).replace(/^\+/, '')
  if (n.startsWith('00')) n = n.slice(2)
  if (n.startsWith('0')) n = '212' + n.slice(1)
  return n
}

export function waLink(phone: string, text?: string): string {
  return `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const csv = rows
    .map((r) => r.map((c) => {
      const s = c === null || c === undefined ? '' : String(c)
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
