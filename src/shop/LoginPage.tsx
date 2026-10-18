import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { toE164, useCustomer } from '../lib/customer'
import { cx } from '../components/ui'

type Mode = 'choice' | 'phone' | 'code' | 'email' | 'email_sent' | 'signup_sent'

function friendly(e: unknown): string {
  const m = errorMessage(e)
  if (/phone provider|sms provider|Unsupported phone/i.test(m)) return 'La connexion par SMS arrive très bientôt. Utilise Google, Apple ou ton e-mail en attendant.'
  if (/provider is not enabled|Unsupported provider/i.test(m)) return 'Ce mode de connexion n’est pas encore activé. Choisis-en un autre.'
  if (/Token has expired|invalid/i.test(m)) return 'Code invalide ou expiré'
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives, réessaie dans quelques minutes'
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect'
  if (/already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail : connecte-toi'
  if (/Email not confirmed/i.test(m)) return 'Confirme d’abord ton e-mail avec le lien reçu'
  if (/Password should be/i.test(m)) return 'Mot de passe trop court (8 caractères minimum)'
  return m
}

export function LoginPage() {
  const [params] = useSearchParams()
  const next = params.get('next') || '/compte'
  const navigate = useNavigate()
  const { session, complete, loading } = useCustomer()
  const [mode, setMode] = useState<Mode>('choice')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && session) navigate(complete ? next : `/compte/profil?next=${encodeURIComponent(next)}`, { replace: true })
  }, [loading, session, complete, next, navigate])

  const redirectTo = `${window.location.origin}/connexion?next=${encodeURIComponent(next)}`

  const oauth = async (provider: 'google' | 'apple') => {
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    if (err) setError(friendly(err))
  }

  const sendSms = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({ phone: toE164(phone) })
    setBusy(false)
    if (err) return setError(friendly(err))
    setMode('code')
  }

  const verifySms = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.verifyOtp({ phone: toE164(phone), token: code.trim(), type: 'sms' })
    setBusy(false)
    if (err) setError(friendly(err))
  }

  const passwordAuth = async () => {
    setBusy(true)
    setError(null)
    if (signup) {
      const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } })
      setBusy(false)
      if (err) return setError(friendly(err))
      if (!data.session) setMode('signup_sent')
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setBusy(false)
      if (err) setError(friendly(err))
    }
  }

  const sendEmail = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } })
    setBusy(false)
    if (err) return setError(friendly(err))
    setMode('email_sent')
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600"><ArrowLeft className="size-4" /> Retour au menu</Link>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
        <p className="font-script text-2xl text-ball">bienvenue chez dunk</p>
        <h1 className="font-display text-3xl">Connexion</h1>
        <p className="mt-2 text-sm text-stone-600">Crée ton compte en 30 secondes pour commander, suivre tes commandes et cumuler tes tampons DUNK Card.</p>

        {mode === 'choice' && (
          <div className="mt-6 space-y-3">
            <button type="button" onClick={() => setMode('phone')} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink font-bold text-white">
              <Phone className="size-4" /> Continuer avec mon téléphone
            </button>
            <button type="button" onClick={() => oauth('google')} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-stone-300 bg-white font-bold">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" /></svg>
              Continuer avec Google
            </button>
            <button type="button" onClick={() => oauth('apple')} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-stone-300 bg-white font-bold">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z" /></svg>
              Continuer avec Apple
            </button>
            <button type="button" onClick={() => setMode('email')} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-stone-300 bg-white font-bold">
              <Mail className="size-4" /> Continuer avec mon e-mail
            </button>
          </div>
        )}

        {mode === 'phone' && (
          <div className="mt-6 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Ton numéro de téléphone</span>
              <input type="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78"
                className="w-full rounded-xl border border-stone-300 px-3 py-3 text-lg outline-none focus:border-ball" />
            </label>
            <button type="button" disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={sendSms}
              className="h-12 w-full rounded-full bg-ball font-bold text-white disabled:opacity-50">{busy ? 'Envoi…' : 'Recevoir le code par SMS'}</button>
          </div>
        )}

        {mode === 'code' && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-stone-600">Code envoyé au <b>{toE164(phone)}</b></p>
            <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••" className="w-full rounded-xl border border-stone-300 px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-ball" />
            <button type="button" disabled={busy || code.length < 6} onClick={verifySms}
              className="h-12 w-full rounded-full bg-ball font-bold text-white disabled:opacity-50">{busy ? 'Vérification…' : 'Valider'}</button>
            <button type="button" onClick={sendSms} className="w-full text-sm font-semibold text-stone-500">Renvoyer le code</button>
          </div>
        )}

        {mode === 'email' && (
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); void passwordAuth() }}>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-stone-100 p-1 text-sm font-semibold">
              <button type="button" onClick={() => setSignup(false)} className={cx('rounded-full py-2', !signup && 'bg-white shadow-sm')}>J’ai un compte</button>
              <button type="button" onClick={() => setSignup(true)} className={cx('rounded-full py-2', signup && 'bg-white shadow-sm')}>Créer un compte</button>
            </div>
            <input type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ton@email.com"
              className="w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-ball" />
            <input type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={signup ? 'Choisis un mot de passe (8 caractères min.)' : 'Mot de passe'} minLength={signup ? 8 : undefined}
              className="w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-ball" />
            <button type="submit" disabled={busy || !email.includes('@') || password.length < (signup ? 8 : 1)}
              className="h-12 w-full rounded-full bg-ball font-bold text-white disabled:opacity-50">{busy ? '…' : signup ? 'Créer mon compte' : 'Se connecter'}</button>
            <button type="button" disabled={busy || !email.includes('@')} onClick={sendEmail} className="w-full text-sm font-semibold text-stone-500 disabled:opacity-40">
              Mot de passe oublié ? Recevoir un lien de connexion
            </button>
          </form>
        )}

        {mode === 'signup_sent' && (
          <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
            Compte créé ! Clique sur le lien reçu à <b>{email}</b> pour l’activer, et c’est parti.
          </p>
        )}

        {mode === 'email_sent' && (
          <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
            C’est envoyé ! Ouvre le lien reçu à <b>{email}</b> sur ce téléphone pour te connecter.
          </p>
        )}

        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-danger">{error}</p>}
        {mode !== 'choice' && (
          <button type="button" onClick={() => { setMode('choice'); setError(null) }} className={cx('mt-4 text-sm font-semibold text-stone-500')}>← Autres options</button>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-stone-500">En continuant, tu acceptes que DUNK utilise tes coordonnées pour traiter tes commandes.</p>
    </div>
  )
}
