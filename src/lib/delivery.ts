import { supabase } from './supabase'

export type GeoResult = { label: string; full: string; lat: number; lng: number }
export type Quote = {
  quote_id: string
  expires_at: string
  distance_km: number
  duration_min: number | null
  estimated: boolean
  available: boolean
  fee: number | null
  max_km: number
  min_order: number
  free_threshold: number | null
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('delivery', { body })
  if (error) throw new Error('Service de livraison indisponible, réessaie dans un instant')
  if (data && typeof data === 'object' && 'error' in data) throw new Error(String((data as { error: string }).error))
  return data as T
}

export const geocode = (q: string) => call<{ results: GeoResult[] }>({ action: 'geocode', q }).then((r) => r.results)
export const reverseGeocode = (lat: number, lng: number) => call<{ label: string }>({ action: 'reverse', lat, lng }).then((r) => r.label)
export const getQuote = (lat: number, lng: number) => call<Quote>({ action: 'quote', lat, lng })
export const getRestaurantPosition = () => call<{ lat: number; lng: number; name: string }>({ action: 'restaurant' })
