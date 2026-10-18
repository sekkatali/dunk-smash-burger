import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorMessage, supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { Button, Field, Input } from '../components/ui'

export default function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [hasOwner, setHasOwner] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate('/admin', { replace: true })
    })
    supabase.rpc('has_owner').then(({ data }) => {
      setHasOwner(Boolean(data))
      if (data === false) setMode('signup')
    })
  }, [navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        navigate('/admin', { replace: true })
      } else if (mode === 'signup' && hasOwner === false) {
        const { data, error: err } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: `${window.location.origin}/admin` },
        })
        if (err) throw err
        if (data.session) navigate('/admin', { replace: true })
        else setInfo('Compte créé. Clique sur le lien reçu par e-mail pour l’activer, puis connecte-toi.')
      } else if (mode === 'reset') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/admin` })
        if (err) throw err
        setInfo('E-mail envoyé. Suis le lien pour te reconnecter.')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="court-lines flex min-h-dvh items-center justify-center bg-ink p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
          <div>
            <h1 className="text-xl font-bold">
              {mode === 'login' ? 'Back-office' : mode === 'signup' ? 'Créer un compte' : 'Mot de passe oublié'}
            </h1>
            {mode === 'signup' && hasOwner === false && (
              <p className="mt-1 text-sm text-stone-500">Premier compte : il deviendra <b>propriétaire</b> du back-office.</p>
            )}

          </div>
          <Field label="E-mail">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          {mode !== 'reset' && (
            <Field label="Mot de passe" hint={mode === 'signup' ? '8 caractères minimum' : undefined}>
              <Input type="password" required minLength={mode === 'signup' ? 8 : undefined} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            </Field>
          )}
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-danger">{error}</p>}
          {info && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{info}</p>}
          <Button type="submit" loading={loading} className="w-full" size="lg">
            {mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer le compte' : 'Envoyer le lien'}
          </Button>
          <div className="flex justify-between text-sm">
            {mode === 'login' ? (
              <>
                <p className="text-stone-500">Pas de compte ou mot de passe oublié ? Demande au propriétaire (Paramètres → Équipe).</p>
              </>
            ) : (
              <button type="button" className="font-semibold text-ball" onClick={() => setMode('login')}>← J'ai déjà un compte</button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
