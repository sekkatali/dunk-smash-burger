import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'

export type AdminCtx = {
  user: User
  role: 'owner' | 'admin' | 'staff'
  newCount: number
  ordersVersion: number
  refreshCounts: () => void
}

export const AdminContext = createContext<AdminCtx | null>(null)

export function useAdmin(): AdminCtx {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin hors AdminLayout')
  return ctx
}

/* Petite sonnerie générée (pas de fichier audio à héberger). */
let audioCtx: AudioContext | null = null

export function getAudio(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    return audioCtx
  } catch {
    return null
  }
}

export function playChime(): void {
  const ctx = getAudio()
  if (!ctx || ctx.state !== 'running') return
  const notes = [880, 1174.66, 1567.98]
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const t = ctx.currentTime + i * 0.16
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.5)
  })
}
