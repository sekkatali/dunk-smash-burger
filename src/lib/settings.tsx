import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  restaurant: {
    name: 'Dunk Smash Burger', tagline: 'Smashé. Croustillant. Imbattable.', phone: '', whatsapp: '',
    email: '', address: '', city: '', instagram: '', tiktok: '', logo_url: '',
  },
  ordering: {
    accept_orders: true, delivery_enabled: true, pickup_enabled: true, min_order: 50, delivery_fee: 15,
    free_delivery_threshold: 200, prep_time_min: 20, delivery_time_min: 40,
    closed_message: "On recharge les plaques ! Reviens pendant nos horaires d'ouverture.",
  },
  hours: [],
  zones: [],
  payments: { cash: true, card_on_delivery: true, cmi: false, cmi_client_id: '', cmi_test_mode: true },
  marketing: {
    announcement_enabled: false, announcement_text: '', meta_pixel_id: '', ga4_id: '', tiktok_pixel_id: '',
    upsell_product_ids: [],
  },
  notifications: { sound: true },
}

/** Fusionne en profondeur les réglages enregistrés avec les valeurs par défaut. */
export function mergeSettings(data: Partial<Settings> | null | undefined): Settings {
  const d = data ?? {}
  return {
    restaurant: { ...DEFAULT_SETTINGS.restaurant, ...(d.restaurant ?? {}) },
    ordering: { ...DEFAULT_SETTINGS.ordering, ...(d.ordering ?? {}) },
    hours: d.hours ?? DEFAULT_SETTINGS.hours,
    zones: d.zones ?? DEFAULT_SETTINGS.zones,
    payments: { ...DEFAULT_SETTINGS.payments, ...(d.payments ?? {}) },
    marketing: { ...DEFAULT_SETTINGS.marketing, ...(d.marketing ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(d.notifications ?? {}) },
  }
}

type Ctx = {
  settings: Settings
  loading: boolean
  reload: () => Promise<void>
  save: (next: Settings) => Promise<void>
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const { data } = await supabase.from('settings').select('data').eq('id', 1).maybeSingle()
    setSettings(mergeSettings(data?.data as Partial<Settings> | undefined))
    setLoading(false)
  }, [])

  const save = useCallback(async (next: Settings) => {
    const { error } = await supabase.from('settings').update({ data: next }).eq('id', 1)
    if (error) throw error
    setSettings(next)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <SettingsContext.Provider value={{ settings, loading, reload, save }}>{children}</SettingsContext.Provider>
  )
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings hors SettingsProvider')
  return ctx
}
