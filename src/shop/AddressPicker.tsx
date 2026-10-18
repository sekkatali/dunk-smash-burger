import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react'
import { geocode, getRestaurantPosition, reverseGeocode } from '../lib/delivery'
import type { GeoResult } from '../lib/delivery'
import { cx } from '../components/ui'

export type PickedAddress = { address: string; lat: number; lng: number }

const pin = L.divIcon({
  className: '',
  html: `<svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg"><path d="M18 45s15-15.4 15-27A15 15 0 0 0 3 18c0 11.6 15 27 15 27z" fill="#B5121B" stroke="#fff" stroke-width="2.5"/><circle cx="18" cy="18" r="6" fill="#fff"/></svg>`,
  iconSize: [36, 46],
  iconAnchor: [18, 45],
})

const CASA: [number, number] = [33.5731, -7.5898]

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 16), { animate: true })
  }, [center, map])
  return null
}

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMove(e.latlng.lat, e.latlng.lng) })
  return null
}

/**
 * Choix de l'adresse : recherche, position GPS ou clic sur la carte.
 * Le repère se déplace au doigt pour préciser l'entrée exacte.
 */
export function AddressPicker({ initial, onPick }: { initial?: PickedAddress | null; onPick: (a: PickedAddress) => void }) {
  const [query, setQuery] = useState(initial?.address ?? '')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState<[number, number] | null>(initial ? [initial.lat, initial.lng] : null)
  const [center, setCenter] = useState<[number, number]>(initial ? [initial.lat, initial.lng] : CASA)
  const debounce = useRef<number | undefined>(undefined)
  const skipSearch = useRef(false)

  useEffect(() => {
    if (initial) return
    getRestaurantPosition().then((r) => r.lat && setCenter([r.lat, r.lng])).catch(() => undefined)
  }, [initial])

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false
      return
    }
    window.clearTimeout(debounce.current)
    if (query.trim().length < 3) {
      setResults([])
      return
    }
    debounce.current = window.setTimeout(async () => {
      setSearching(true)
      try {
        setResults(await geocode(query))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 450)
    return () => window.clearTimeout(debounce.current)
  }, [query])

  const choose = (lat: number, lng: number, label: string) => {
    setPos([lat, lng])
    setCenter([lat, lng])
    skipSearch.current = true
    setQuery(label)
    setResults([])
    onPick({ address: label, lat, lng })
  }

  const moveTo = async (lat: number, lng: number) => {
    setPos([lat, lng])
    let label = query
    try {
      label = (await reverseGeocode(lat, lng)) || query || 'Position sur la carte'
    } catch { /* on garde le texte saisi */ }
    skipSearch.current = true
    setQuery(label)
    onPick({ address: label, lat, lng })
  }

  const locate = () => {
    if (!navigator.geolocation) return setError('La géolocalisation n’est pas disponible sur cet appareil')
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        setLocating(false)
        setCenter([p.coords.latitude, p.coords.longitude])
        await moveTo(p.coords.latitude, p.coords.longitude)
      },
      () => {
        setLocating(false)
        setError('Position refusée : cherche ton adresse ou touche la carte')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute top-3.5 left-3 size-4 text-stone-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rue, résidence, quartier…"
          className="w-full rounded-xl border border-stone-300 bg-white py-3 pr-10 pl-9 outline-none focus:border-ball focus:ring-2 focus:ring-ball/20" />
        {searching && <Loader2 className="absolute top-3.5 right-3 size-4 animate-spin text-stone-400" />}
        {results.length > 0 && (
          <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl">
            {results.map((r, i) => (
              <li key={i}>
                <button type="button" onClick={() => choose(r.lat, r.lng, r.label)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-stone-50">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-ball" /> {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" onClick={locate} className="inline-flex items-center gap-2 text-sm font-semibold text-ball">
        {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />} Utiliser ma position actuelle
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className={cx('relative overflow-hidden rounded-2xl border border-stone-200', 'h-56')}>
        <MapContainer center={center} zoom={pos ? 16 : 13} scrollWheelZoom={false} className="size-full" attributionControl>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <Recenter center={center} />
          <ClickToMove onMove={moveTo} />
          {pos && (
            <Marker position={pos} icon={pin} draggable eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng()
                void moveTo(ll.lat, ll.lng)
              },
            }} />
          )}
        </MapContainer>
        {!pos && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-[500] mx-auto w-fit rounded-full bg-ink/80 px-3 py-1 text-xs font-medium text-white">
            Touche la carte à l’endroit de livraison
          </div>
        )}
      </div>
      {pos && <p className="text-xs text-stone-500">Déplace le repère pour indiquer l’entrée exacte.</p>}
    </div>
  )
}
