import { supabase, isConfigured } from './supabase'
import type { Settings } from './types'

/**
 * Mesure d'audience maison (stockée dans Supabase) + envoi aux pixels
 * publicitaires (Meta, Google Analytics 4, TikTok) si leurs IDs sont
 * renseignés dans Marketing > Tracking.
 */

type Utm = { source?: string; medium?: string; campaign?: string }
type EventName = 'page_view' | 'view_product' | 'add_to_cart' | 'begin_checkout' | 'purchase'

const SID_KEY = 'dsb_sid'
const UTM_KEY = 'dsb_utm'
const VID_KEY = 'dsb_vid'
const SESSION_TTL = 30 * 60 * 1000

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    _fbq?: unknown
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
    ttq?: { load: (id: string) => void; page: () => void; track: (e: string, p?: unknown) => void } & Record<string, unknown>
  }
}

function rand(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

let firstEventSent = false

export function getSessionId(): string {
  try {
    const raw = localStorage.getItem(SID_KEY)
    const now = Date.now()
    if (raw) {
      const { id, ts } = JSON.parse(raw) as { id: string; ts: number }
      if (now - ts < SESSION_TTL) {
        localStorage.setItem(SID_KEY, JSON.stringify({ id, ts: now }))
        return id
      }
    }
    const id = rand()
    localStorage.setItem(SID_KEY, JSON.stringify({ id, ts: now }))
    sessionStorage.removeItem(UTM_KEY)
    firstEventSent = false
    return id
  } catch {
    return 'nostorage' + rand()
  }
}

/** Récupère les UTM (et gclid/fbclid/ttclid) à l'arrivée sur le site. */
export function captureUtm(): void {
  try {
    const q = new URLSearchParams(window.location.search)
    let utm: Utm = {
      source: q.get('utm_source') ?? undefined,
      medium: q.get('utm_medium') ?? undefined,
      campaign: q.get('utm_campaign') ?? undefined,
    }
    if (!utm.source) {
      if (q.get('fbclid')) utm = { source: 'facebook', medium: 'paid_social' }
      else if (q.get('gclid') || q.get('gbraid') || q.get('wbraid')) utm = { source: 'google', medium: 'cpc' }
      else if (q.get('ttclid')) utm = { source: 'tiktok', medium: 'paid_social' }
    }
    if (utm.source) sessionStorage.setItem(UTM_KEY, JSON.stringify(utm))
  } catch {
    /* ignore */
  }
}

export function getUtm(): Utm {
  try {
    return JSON.parse(sessionStorage.getItem(UTM_KEY) || '{}') as Utm
  } catch {
    return {}
  }
}

/** Identifiant visiteur persistant (pour distinguer nouveaux / anciens visiteurs). */
function getVisitorId(): string | null {
  try {
    let v = localStorage.getItem(VID_KEY)
    if (!v) {
      v = rand()
      localStorage.setItem(VID_KEY, v)
    }
    return v
  } catch {
    return null
  }
}

function device(): string {
  const ua = navigator.userAgent
  if (/iPad|Tablet/i.test(ua)) return 'tablette'
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile'
  return 'ordinateur'
}

function externalReferrer(): string | null {
  const r = document.referrer
  if (!r) return null
  try {
    return new URL(r).host === window.location.host ? null : r
  } catch {
    return null
  }
}

function isBackOffice(): boolean {
  return /^\/(admin|livreur)/.test(window.location.pathname)
}

export function track(event: EventName, extra: { product_id?: string; value?: number; name?: string; items?: number } = {}): void {
  if (!isConfigured || isBackOffice()) return
  const utm = getUtm()
  const sid = getSessionId()
  if (event !== 'purchase') {
    const row = {
      session_id: sid,
      visitor_id: getVisitorId(),
      event,
      path: window.location.pathname,
      referrer: firstEventSent ? null : externalReferrer(),
      utm_source: utm.source ?? null,
      utm_medium: utm.medium ?? null,
      utm_campaign: utm.campaign ?? null,
      device: device(),
      product_id: extra.product_id ?? null,
      value: extra.value ?? null,
    }
    firstEventSent = true
    void supabase.from('analytics_events').insert(row).then(() => undefined)
  }
  sendToPixels(event, extra)
}

function sendToPixels(event: EventName, extra: { product_id?: string; value?: number; name?: string; items?: number }): void {
  const currency = 'MAD'
  const map: Record<EventName, { meta: string; ga: string; tt: string }> = {
    page_view: { meta: 'PageView', ga: 'page_view', tt: 'Pageview' },
    view_product: { meta: 'ViewContent', ga: 'view_item', tt: 'ViewContent' },
    add_to_cart: { meta: 'AddToCart', ga: 'add_to_cart', tt: 'AddToCart' },
    begin_checkout: { meta: 'InitiateCheckout', ga: 'begin_checkout', tt: 'InitiateCheckout' },
    purchase: { meta: 'Purchase', ga: 'purchase', tt: 'CompletePayment' },
  }
  const m = map[event]
  const params = {
    value: extra.value, currency, content_ids: extra.product_id ? [extra.product_id] : undefined,
    content_name: extra.name, content_type: 'product', num_items: extra.items,
  }
  try {
    if (window.fbq) event === 'page_view' ? window.fbq('track', 'PageView') : window.fbq('track', m.meta, params)
    if (window.gtag) {
      window.gtag('event', m.ga, event === 'page_view'
        ? { page_location: window.location.href, page_path: window.location.pathname }
        : { value: extra.value, currency })
    }
    if (window.ttq) event === 'page_view' ? window.ttq.page() : window.ttq.track(m.tt, params)
  } catch {
    /* un pixel bloqué ne doit jamais casser le site */
  }
}

let pixelsLoaded = false

function inline(code: string): void {
  const s = document.createElement('script')
  s.text = code
  document.head.appendChild(s)
}

const safeId = (id: string) => (/^[A-Za-z0-9_-]{3,40}$/.test(id.trim()) ? id.trim() : '')

/** Charge les pixels publicitaires avec leurs codes officiels. */
export function loadPixels(settings: Settings): void {
  if (pixelsLoaded || isBackOffice()) return
  pixelsLoaded = true
  const meta = safeId(settings.marketing.meta_pixel_id || '')
  const ga = safeId(settings.marketing.ga4_id || '')
  const tt = safeId(settings.marketing.tiktok_pixel_id || '')

  if (meta) {
    inline(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');`)
  }

  if (ga) {
    const s = document.createElement('script')
    s.async = true
    s.src = `https://www.googletagmanager.com/gtag/js?id=${ga}`
    document.head.appendChild(s)
    inline(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga}',{send_page_view:false});`)
  }

  if (tt) {
    inline(`!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=d.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load('${tt}');}(window, document, 'ttq');`)
  }
}
