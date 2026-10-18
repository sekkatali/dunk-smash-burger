import { useEffect, useState } from 'react'
import { Download, Plus, Share, X } from 'lucide-react'
import { DEFAULT_LOGO } from '../components/Logo'

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const KEY = 'dsb_install_dismissed'

/**
 * Bandeau « Installer l'app ».
 * Android : installation en un clic (bouton natif).
 * iPhone : Apple n'autorise pas l'installation automatique, on affiche un guide visuel
 * avec une flèche qui pointe sur le bouton Partager de Safari.
 */
export function InstallBanner() {
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [visible, setVisible] = useState(false)
  const [guide, setGuide] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone
    let dismissed = false
    try { dismissed = Date.now() - Number(localStorage.getItem(KEY) || 0) < 3 * 86400000 } catch { /* ignore */ }
    if (standalone || dismissed || /^\/(admin|livreur)/.test(location.pathname)) return
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvt(e as BIPEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    let t: number | undefined
    if (isIos) t = window.setTimeout(() => { setIos(true); setVisible(true) }, 2500)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.clearTimeout(t)
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    setGuide(false)
    try { localStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  }

  const install = async () => {
    if (evt) {
      await evt.prompt()
      dismiss()
    } else if (ios) {
      setGuide(true)
    }
  }

  if (!visible) return null

  if (guide) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/75" onClick={dismiss}>
        <button type="button" onClick={dismiss} className="absolute top-4 right-4 rounded-full bg-white/15 p-2 text-white" aria-label="Fermer"><X className="size-6" /></button>
        <div className="absolute inset-x-0 bottom-28 flex flex-col items-center gap-4 px-6 text-white" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-ink shadow-2xl">
            <span className="flex size-11 items-center justify-center rounded-xl bg-stone-100"><Share className="size-6 text-[#007AFF]" /></span>
            <span className="text-2xl font-bold">→</span>
            <span className="flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-2.5 font-semibold">
              <Plus className="size-5 rounded border-2 border-ink p-0.5" /> Sur l’écran d’accueil
            </span>
          </div>
        </div>
        <svg className="install-arrow absolute bottom-3 left-1/2 -translate-x-1/2" width="56" height="80" viewBox="0 0 56 80" fill="none" aria-hidden>
          <path d="M28 4v64M8 50l20 22 20-22" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }

  return (
    <div className="slide-up fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md rounded-2xl bg-ink p-3 text-white shadow-2xl sm:bottom-4">
      <button type="button" onClick={dismiss} className="absolute -top-2 -right-2 rounded-full bg-ink p-1.5 text-white/70 ring-2 ring-cream" aria-label="Fermer"><X className="size-3.5" /></button>
      <div className="flex items-center gap-3">
        <img src={DEFAULT_LOGO} alt="" className="h-10 w-auto rounded-lg" />
        <p className="min-w-0 flex-1 font-bold leading-tight">L’app DUNK<br /><span className="text-xs font-normal text-white/60">sur ton écran d’accueil</span></p>
        <button type="button" onClick={install} className="flex items-center gap-1.5 rounded-full bg-ball px-4 py-2.5 text-sm font-bold">
          <Download className="size-4" /> Installer
        </button>
      </div>
    </div>
  )
}
