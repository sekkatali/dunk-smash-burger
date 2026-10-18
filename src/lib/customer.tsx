import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Customer } from './types'

type Ctx = {
  session: Session | null
  profile: Customer | null
  loading: boolean
  /** profil complet = prénom, nom et téléphone renseignés */
  complete: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const CustomerContext = createContext<Ctx | null>(null)

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('customers').select('*').eq('user_id', s.user.id).maybeSingle()
    if (data) {
      setProfile(data as Customer)
      return
    }
    // premier passage : on pré-remplit avec ce que donne Google / Apple / le téléphone
    const meta = (s.user.user_metadata ?? {}) as Record<string, string>
    const full = (meta.full_name || meta.name || '').trim()
    const [first, ...rest] = full.split(' ')
    const { data: created } = await supabase.from('customers').insert({
      user_id: s.user.id,
      first_name: meta.given_name || first || null,
      last_name: meta.family_name || rest.join(' ') || null,
      phone: s.user.phone ? `+${s.user.phone.replace(/^\+/, '')}` : null,
      email: s.user.email ?? null,
    }).select('*').maybeSingle()
    setProfile((created as Customer) ?? null)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      void loadProfile(s)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
    await loadProfile(data.session)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }, [])

  const complete = Boolean(profile?.first_name && profile?.last_name && profile?.phone)

  return (
    <CustomerContext.Provider value={{ session, profile, loading, complete, refresh, signOut }}>
      {children}
    </CustomerContext.Provider>
  )
}

export function useCustomer(): Ctx {
  const ctx = useContext(CustomerContext)
  if (!ctx) throw new Error('useCustomer hors CustomerProvider')
  return ctx
}

/** Normalise un numéro marocain au format international (+212…). */
export function toE164(phone: string): string {
  let p = phone.replace(/[^0-9+]/g, '')
  if (p.startsWith('00')) p = '+' + p.slice(2)
  if (p.startsWith('0')) p = '+212' + p.slice(1)
  if (!p.startsWith('+')) p = '+' + p
  return p
}
