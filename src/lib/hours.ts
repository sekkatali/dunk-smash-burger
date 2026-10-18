import type { DayHours, Settings } from './types'
import { DAY_LABEL, TZ } from './format'

function nowInTz(): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
  return { day, minutes: h * 60 + m }
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function isWithin(d: DayHours | undefined, minutes: number, previousDay = false): boolean {
  if (!d || d.closed) return false
  const o = toMin(d.open)
  const c = toMin(d.close)
  if (c > o) return !previousDay && minutes >= o && minutes < c
  // service qui passe minuit (ex : 18:00 → 02:00)
  return previousDay ? minutes < c : minutes >= o
}

export function isOpenNow(settings: Settings): boolean {
  if (!settings.ordering.accept_orders) return false
  const hours = settings.hours ?? []
  if (hours.length === 0) return true
  const { day, minutes } = nowInTz()
  const today = hours.find((h) => h.day === day)
  const yesterday = hours.find((h) => h.day === (day + 6) % 7)
  return isWithin(today, minutes) || isWithin(yesterday, minutes, true)
}

export function todayHoursLabel(settings: Settings): string {
  const { day } = nowInTz()
  const d = settings.hours?.find((h) => h.day === day)
  if (!d) return ''
  if (d.closed) return "Fermé aujourd'hui"
  return `Aujourd'hui ${d.open} – ${d.close}`
}

export function hoursSummary(settings: Settings): { label: string; value: string }[] {
  const order = [1, 2, 3, 4, 5, 6, 0]
  return order.map((day) => {
    const d = settings.hours?.find((h) => h.day === day)
    return { label: DAY_LABEL[day], value: !d || d.closed ? 'Fermé' : `${d.open} – ${d.close}` }
  })
}
