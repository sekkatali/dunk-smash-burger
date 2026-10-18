// Livraison : recherche d'adresse, adresse depuis une position GPS,
// et devis de livraison basé sur la distance ROUTIÈRE (OSRM).
// Le devis est enregistré côté serveur : la commande ne peut pas tricher sur la distance.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UA = 'DunkSmashBurger/1.0 (commande en ligne; contact: mbafoodsarl@gmail.com)'
const OSRM = Deno.env.get('OSRM_URL') ?? 'https://router.project-osrm.org'

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string> }

async function photon(path: string): Promise<PhotonFeature[]> {
  const r = await fetch(`https://photon.komoot.io/${path}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error('geocoding ' + r.status)
  const j = await r.json()
  return (j.features ?? []) as PhotonFeature[]
}

const labelOf = (p: Record<string, string>) => {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const first = p.name && p.name !== p.street ? (street ? `${p.name}, ${street}` : p.name) : street
  return [first, p.district || p.locality, p.city].filter(Boolean).join(', ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const body = await req.json()
    const { data: resto } = await db.from('restaurants').select('*').eq('active', true).order('created_at').limit(1).single()
    if (!resto) return json({ error: 'Restaurant introuvable' }, 500)

    // coordonnées du restaurant : géocodées une fois si absentes
    if (resto.lat == null || resto.lng == null) {
      try {
        const res = await photon(`api?limit=1&lang=fr&q=${encodeURIComponent(`${resto.address}, ${resto.city}, Maroc`)}`)
        if (res[0]) {
          resto.lng = res[0].geometry.coordinates[0]
          resto.lat = res[0].geometry.coordinates[1]
          await db.from('restaurants').update({ lat: resto.lat, lng: resto.lng }).eq('id', resto.id)
        }
      } catch (e) { console.error(e) }
    }

    if (body.action === 'restaurant') {
      return json({ lat: resto.lat, lng: resto.lng, name: resto.name, address: resto.address })
    }

    if (body.action === 'geocode') {
      const q = String(body.q ?? '').trim().slice(0, 200)
      if (q.length < 3) return json({ results: [] })
      const bias = resto.lat ? `&lat=${resto.lat}&lon=${resto.lng}` : ''
      const city = resto.city && !q.toLowerCase().includes(resto.city.toLowerCase()) ? `, ${resto.city}` : ''
      const res = await photon(`api?limit=8&lang=fr${bias}&q=${encodeURIComponent(q + city)}`)
      return json({
        results: res
          .filter((f) => !f.properties.countrycode || f.properties.countrycode === 'MA')
          .slice(0, 6)
          .map((f) => ({ label: labelOf(f.properties), full: labelOf(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] })),
      })
    }

    if (body.action === 'reverse') {
      const lat = Number(body.lat), lng = Number(body.lng)
      if (!isFinite(lat) || !isFinite(lng)) return json({ error: 'Position invalide' }, 400)
      const res = await photon(`reverse?lang=fr&lat=${lat}&lon=${lng}`)
      const label = res[0] ? labelOf(res[0].properties) : ''
      return json({ label, full: label })
    }

    if (body.action === 'quote') {
      const lat = Number(body.lat), lng = Number(body.lng)
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json({ error: 'Position invalide' }, 400)
      if (resto.lat == null) return json({ error: 'Position du restaurant non configurée' }, 500)

      let km: number
      let minutes: number | null = null
      let estimated = false
      try {
        const r = await fetch(`${OSRM}/route/v1/driving/${resto.lng},${resto.lat};${lng},${lat}?overview=false`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(6000),
        })
        const j = await r.json()
        if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error('osrm')
        km = j.routes[0].distance / 1000
        minutes = Math.round(j.routes[0].duration / 60)
      } catch {
        // secours : distance à vol d'oiseau × 1,35 (marquée « estimée »)
        km = haversineKm([resto.lat, resto.lng], [lat, lng]) * 1.35
        estimated = true
      }
      km = Math.round(km * 100) / 100

      const { data: s } = await db.from('settings').select('data').eq('id', 1).single()
      const cfg = s?.data?.delivery ?? {}
      const tiers = [...(cfg.tiers ?? [])].sort((a: { up_to_km: number }, b: { up_to_km: number }) => a.up_to_km - b.up_to_km)
      const maxKm = Number(cfg.max_km ?? 10)
      const tier = km <= maxKm ? tiers.find((t: { up_to_km: number }) => km <= Number(t.up_to_km)) : null

      const { data: q, error } = await db.from('delivery_quotes')
        .insert({ restaurant_id: resto.id, lat, lng, distance_km: km, duration_min: minutes, estimated })
        .select('id, expires_at').single()
      if (error) throw error

      return json({
        quote_id: q.id, expires_at: q.expires_at, distance_km: km, duration_min: minutes, estimated,
        available: Boolean(tier), fee: tier ? Number(tier.fee) : null, max_km: maxKm,
        min_order: Number(cfg.min_order ?? 0), free_threshold: cfg.free_threshold != null ? Number(cfg.free_threshold) : null,
      })
    }

    return json({ error: 'Action inconnue' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Service de livraison momentanément indisponible' }, 502)
  }
})
