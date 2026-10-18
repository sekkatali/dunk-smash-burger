import type { Settings } from './types'
import { TZ } from './format'

/** Heure locale (Maroc) → instant réel, pour une date AAAA-MM-JJ et des minutes depuis minuit. */
function tzOffsetMs(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000
}

function localToDate(day: string, minutes: number): Date {
  const naive = new Date(`${day}T00:00:00Z`).getTime() + minutes * 60000
  return new Date(naive - tzOffsetMs(new Date(naive)))
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export type Slot = { iso: string; label: string }
export type SlotDay = { key: string; label: string; slots: Slot[] }

/** Créneaux disponibles (le serveur revérifie tout au moment de la commande). */
export function buildSlots(settings: Settings, type: 'delivery' | 'pickup'): SlotDay[] {
  const o = settings.ordering
  const step = Math.max(5, o.slot_minutes || 15)
  const lead = type === 'delivery' ? o.delivery_time_min : o.prep_time_min
  const earliest = Date.now() + (lead + 5) * 60000
  const disabled = new Set((o.disabled_slots ?? []).map((s) => new Date(s).getTime()))
  const days: SlotDay[] = []
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: TZ })

  for (let d = 0; d <= (o.schedule_days_ahead ?? 2); d++) {
    const base = new Date(`${todayKey}T12:00:00Z`)
    base.setUTCDate(base.getUTCDate() + d)
    const key = base.toISOString().slice(0, 10)
    const dow = base.getUTCDay()
    const h = settings.hours.find((x) => x.day === dow)
    if (!h || h.closed) continue
    const open = toMin(h.open)
    let close = toMin(h.close)
    if (close <= open) close += 24 * 60 // service qui passe minuit
    const slots: Slot[] = []
    for (let m = Math.ceil(open / step) * step; m < close; m += step) {
      const date = localToDate(key, m)
      const t = date.getTime()
      if (t < earliest || disabled.has(t)) continue
      slots.push({
        iso: date.toISOString(),
        label: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }),
      })
    }
    if (slots.length) {
      days.push({
        key,
        label: d === 0 ? "Aujourd'hui" : d === 1 ? 'Demain' : base.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
        slots,
      })
    }
  }
  return days
}

export function slotLabel(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-CA', { timeZone: TZ })
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  if (day === today) return `aujourd'hui à ${time}`
  if (day === tomorrow) return `demain à ${time}`
  return `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ })} à ${time}`
}
