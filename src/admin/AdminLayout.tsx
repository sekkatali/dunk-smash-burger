import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import {
  BarChart3, Bike, ClipboardList, CreditCard, ExternalLink, LogOut, Megaphone, Menu as MenuIcon,
  Settings as SettingsIcon, Utensils, Volume2, VolumeX, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { Logo } from '../components/Logo'
import { Button, PageLoader, cx } from '../components/ui'
import { AdminContext, getAudio, playChime } from './adminContext'

const NAV = [
  { to: 'commandes', label: 'Commandes', icon: ClipboardList },
  { to: 'produits', label: 'Produits', icon: Utensils },
  { to: 'livreurs', label: 'Livreurs', icon: Bike },
  { to: 'statistiques', label: 'Statistiques', icon: BarChart3 },
  { to: 'marketing', label: 'Marketing', icon: Megaphone },
  { to: 'paiement', label: 'Paiement', icon: CreditCard },
  { to: 'parametres', label: 'Paramètres', icon: SettingsIcon },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings } = useSettings()
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<'owner' | 'admin' | 'staff' | null>(null)
  const [checking, setChecking] = useState(true)
  const [noSession, setNoSession] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const [ordersVersion, setOrdersVersion] = useState(0)
  const [audioOk, setAudioOk] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('dsb_muted') === '1')
  const [mobileNav, setMobileNav] = useState(false)
  const knownNew = useRef<Set<string>>(new Set())

  // --- Authentification
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        if (!cancelled) { setNoSession(true); setChecking(false) }
        return
      }
      const { data: r } = await supabase.rpc('claim_staff')
      if (cancelled) return
      setUser(data.session.user)
      setRole((r as 'owner' | 'admin' | 'staff' | null) ?? null)
      setChecking(false)
    }
    void check()
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') navigate('/admin/login', { replace: true })
      if (event === 'PASSWORD_RECOVERY') {
        const pwd = window.prompt('Choisis un nouveau mot de passe (8 caractères minimum)')
        if (pwd && pwd.length >= 8) void supabase.auth.updateUser({ password: pwd })
      }
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [navigate])

  // --- Compteur des nouvelles commandes
  const refreshCounts = useCallback(async () => {
    const { data } = await supabase.from('orders').select('id').eq('status', 'new')
    const ids = (data ?? []).map((d) => d.id as string)
    const fresh = ids.filter((id) => !knownNew.current.has(id))
    if (fresh.length > 0 && knownNew.current.size + fresh.length > 0 && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification('Nouvelle commande 🍔', { body: `${fresh.length} nouvelle(s) commande(s) à accepter`, icon: '/favicon.svg' })
    }
    knownNew.current = new Set(ids)
    setNewCount(ids.length)
  }, [])

  // --- Temps réel
  useEffect(() => {
    if (!role) return
    void refreshCounts()
    const channel = supabase
      .channel('orders-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        setOrdersVersion((v) => v + 1)
        void refreshCounts()
      })
      .subscribe()
    // filet de sécurité si le temps réel décroche
    const poll = setInterval(() => {
      setOrdersVersion((v) => v + 1)
      void refreshCounts()
    }, 30000)
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    return () => {
      void supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [role, refreshCounts])

  // --- Sonnerie : sonne toutes les 5 s tant qu'il reste des commandes à accepter
  useEffect(() => {
    const ctx = getAudio()
    setAudioOk(ctx?.state === 'running')
  }, [])

  useEffect(() => {
    if (newCount === 0 || muted || !settings.notifications.sound) return
    playChime()
    const t = setInterval(playChime, 5000)
    return () => clearInterval(t)
  }, [newCount, muted, settings.notifications.sound, audioOk])

  useEffect(() => {
    document.title = newCount > 0 ? `(${newCount}) Nouvelle commande — Dunk` : 'Back-office — Dunk Smash Burger'
  }, [newCount])

  useEffect(() => setMobileNav(false), [location.pathname])

  const enableAudio = async () => {
    const ctx = getAudio()
    if (ctx) await ctx.resume()
    setAudioOk(ctx?.state === 'running')
    playChime()
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    localStorage.setItem('dsb_muted', next ? '1' : '0')
    if (!next) void enableAudio()
  }

  if (checking) return <div className="admin-shell min-h-dvh"><PageLoader /></div>
  if (noSession) return <Navigate to="/admin/login" replace />
  if (!user || !role) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink p-6 text-center text-white">
        <div>
          <p className="font-display text-3xl">Accès refusé</p>
          <p className="mt-2 text-white/60">Ce compte ({user?.email}) n'a pas accès au back-office. Demande au propriétaire de t'inviter.</p>
          <Button className="mt-6" onClick={() => supabase.auth.signOut()}>Se déconnecter</Button>
        </div>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="px-5 py-5"><Logo /></div>
      <ul className="flex-1 space-y-1 px-3">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              className={({ isActive }) => cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                isActive ? 'bg-ball text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
              )}
            >
              <n.icon className="size-5" />
              <span className="flex-1">{n.label}</span>
              {n.to === 'commandes' && newCount > 0 && (
                <span className="pulse-ring flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold text-ball">{newCount}</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="space-y-1 border-t border-white/10 p-3">
        <a href="/" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/60 hover:text-white">
          <ExternalLink className="size-4" /> Voir le site
        </a>
        <button type="button" onClick={toggleMute} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/60 hover:text-white">
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {muted ? 'Son coupé' : 'Son activé'}
        </button>
        <button type="button" onClick={() => supabase.auth.signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/60 hover:text-white">
          <LogOut className="size-4" /> Déconnexion
        </button>
        <p className="truncate px-3 pt-1 text-xs text-white/30">{user.email}</p>
      </div>
    </nav>
  )

  return (
    <AdminContext.Provider value={{ user, role, newCount, ordersVersion, refreshCounts }}>
      <div className="admin-shell min-h-dvh lg:pl-64">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-ink lg:block">{sidebar}</aside>

        {mobileNav && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNav(false)} />
            <aside className="relative h-full w-72 bg-ink">
              <button type="button" onClick={() => setMobileNav(false)} className="absolute top-5 right-4 text-white/60" aria-label="Fermer">
                <X className="size-6" />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-ink px-4 lg:hidden">
          <button type="button" onClick={() => setMobileNav(true)} className="text-white" aria-label="Menu">
            <MenuIcon className="size-6" />
          </button>
          <Logo />
          <NavLink to="commandes" className="relative text-white">
            <ClipboardList className="size-6" />
            {newCount > 0 && <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-ball text-[11px] font-bold">{newCount}</span>}
          </NavLink>
        </header>

        {!audioOk && !muted && settings.notifications.sound && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-ball px-4 py-2 text-sm font-semibold text-white">
            <span>🔔 Active le son pour être alerté à chaque nouvelle commande.</span>
            <button type="button" onClick={enableAudio} className="rounded-lg bg-white px-3 py-1 text-ball">Activer le son</button>
          </div>
        )}

        <main className="mx-auto max-w-7xl p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </AdminContext.Provider>
  )
}
