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
    asap_enabled: true, scheduling_enabled: true, slot_minutes: 15, schedule_days_ahead: 2, disabled_slots: [],
    require_account: true, first_cash_confirmation: true, pickup_min_order: 0,
  },
  delivery: {
    mode: 'distance', max_km: 10, min_order: 75, free_threshold: 150,
    tiers: [{ up_to_km: 3, fee: 10 }, { up_to_km: 5, fee: 15 }, { up_to_km: 7, fee: 20 }, { up_to_km: 10, fee: 25 }],
  },
  loyalty: {
    enabled: true, stamps_required: 5, min_order: 75, progress_expiry_days: 180, reward_expiry_days: 30,
    rewards: [
      { type: 'credit', label: '35 DH de crédit DUNK', amount: 35 },
      { type: 'category', label: 'Un accompagnement offert', category: 'Sides' },
      { type: 'category', label: 'Un dessert offert', category: 'Desserts' },
    ],
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
    delivery: { ...DEFAULT_SETTINGS.delivery, ...(d.delivery ?? {}) },
    loyalty: { ...DEFAULT_SETTINGS.loyalty, ...(d.loyalty ?? {}) },
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
