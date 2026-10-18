import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Download, Plus, Share, X } from 'lucide-react'

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as unknown as { standalone?: boolean }).standalone)
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Bandeau « Installer l'app », fixé sous le header, visible tant que l'app n'est pas installée.
 * Android : installation en un clic. iPhone : guide visuel avec une flèche vers le bouton Partager.
 */
export function InstallBanner() {
  const { pathname } = useLocation()
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  const [ios] = useState(isIos)
  const [installed, setInstalled] = useState(isStandalone)
  const [guide, setGuide] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvt(e as BIPEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Android/Chrome ne propose l'installation que si l'app n'est pas déjà installée.
  if (installed || pathname.startsWith('/commande') || (!ios && !evt)) return null

  const install = async () => {
    if (evt) {
      await evt.prompt()
      const { outcome } = await evt.userChoice
      if (outcome === 'accepted') setInstalled(true)
      setEvt(null)
    } else {
      setGuide(true)
    }
  }

  return (
    <>
      <div className="bg-ink text-white md:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <p className="min-w-0 flex-1 text-sm leading-tight">
            <b>L’app DUNK</b> <span className="text-white/60">· commande en 2 clics</span>
          </p>
          <button type="button" onClick={install} className="flex shrink-0 items-center gap-1.5 rounded-full bg-ball px-4 py-1.5 text-sm font-bold">
            <Download className="size-4" /> Installer
          </button>
        </div>
      </div>

      {guide && createPortal(
        <div className="fixed inset-0 z-[70] bg-black/75" onClick={() => setGuide(false)}>
          <button type="button" onClick={() => setGuide(false)} className="absolute top-4 right-4 rounded-full bg-white/15 p-2 text-white" aria-label="Fermer"><X className="size-6" /></button>
          <div className="absolute inset-x-0 bottom-28 flex justify-center px-6" onClick={(e) => e.stopPropagation()}>
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
        </div>,
        document.body,
      )}
    </>
  )
}
