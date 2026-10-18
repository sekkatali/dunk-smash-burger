import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { DEFAULT_LOGO } from '../components/Logo'

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const KEY = 'dsb_install_dismissed'

/** Invite à installer l'app DUNK sur l'écran d'accueil (Android : bouton ; iPhone : mode d'emploi). */
export function InstallBanner() {
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone
    let dismissed = false
    try { dismissed = Date.now() - Number(localStorage.getItem(KEY) || 0) < 7 * 86400000 } catch { /* ignore */ }
    if (standalone || dismissed || /^\/(admin|livreur)/.test(location.pathname)) return
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvt(e as BIPEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    let t: number | undefined
    if (isIos) t = window.setTimeout(() => { setIos(true); setVisible(true) }, 4000)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.clearTimeout(t)
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    try { localStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  }

  if (!visible) return null
  return (
    <div className="slide-up fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md rounded-2xl bg-ink p-4 text-white shadow-2xl sm:bottom-4">
      <button type="button" onClick={dismiss} className="absolute top-2 right-2 p-1 text-white/60" aria-label="Fermer"><X className="size-4" /></button>
      <div className="flex items-center gap-3">
        <img src={DEFAULT_LOGO} alt="" className="h-10 w-auto rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">Installe l’app DUNK</p>
          {ios
            ? <p className="text-xs text-white/70">Touche <Share className="inline size-3.5" /> puis « Sur l’écran d’accueil »</p>
            : <p className="text-xs text-white/70">Commande en 2 clics, directement depuis ton écran d’accueil</p>}
        </div>
        {evt && (
          <button type="button" onClick={async () => { await evt.prompt(); dismiss() }}
            className="flex items-center gap-1.5 rounded-full bg-ball px-3 py-2 text-sm font-bold"><Download className="size-4" /> Installer</button>
        )}
      </div>
    </div>
  )
}
