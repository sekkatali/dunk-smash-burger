// Comptes : inscription ouverte (sans e-mail de confirmation) et gestion de l'équipe.
//  - signup    : public. Crée un compte client e-mail + mot de passe, actif tout de suite.
//  - team_add  : propriétaire / admin. Crée (ou reprend) le compte d'un membre avec un mot de passe
//                provisoire et lui attribue un rôle. Si le compte existait, ses sessions sont coupées.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i
const ROLES = ['admin', 'manager', 'kitchen', 'marketing', 'support']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
  const db = createClient(URL_, SERVICE, { auth: { persistSession: false } })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Requête invalide' }, 400) }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!EMAIL_RE.test(email)) return json({ error: 'E-mail invalide' }, 400)
  if (password.length < 8 || password.length > 72) return json({ error: 'Mot de passe : 8 caractères minimum' }, 400)

  if (body.action === 'signup') {
    // Anti-abus : 5 inscriptions / heure / IP, 300 / heure au total
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const since = new Date(Date.now() - 3600_000).toISOString()
    const [{ count: perIp }, { count: all }] = await Promise.all([
      db.from('signup_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since),
      db.from('signup_attempts').select('id', { count: 'exact', head: true }).gte('created_at', since),
    ])
    if ((perIp ?? 0) >= 5 || (all ?? 0) >= 300) return json({ error: 'Trop de tentatives, réessaie dans quelques minutes' }, 429)
    await db.from('signup_attempts').insert({ ip })

    const { error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { self_signup: true },
    })
    if (error) {
      if (/already|registered|exists/i.test(error.message)) return json({ error: 'Un compte existe déjà avec cet e-mail : connecte-toi' }, 409)
      return json({ error: 'Inscription impossible pour le moment' }, 400)
    }
    return json({ ok: true })
  }

  if (body.action === 'team_add') {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: me } = await db.auth.getUser(jwt)
    if (!me?.user) return json({ error: 'Non connecté' }, 401)
    const { data: myStaff } = await db.from('staff').select('role').eq('user_id', me.user.id).maybeSingle()
    const myRole = myStaff?.role
    if (myRole !== 'owner' && myRole !== 'admin') return json({ error: 'Accès refusé' }, 403)

    const role = String(body.role ?? '')
    if (!ROLES.includes(role)) return json({ error: 'Rôle invalide' }, 400)
    if (role === 'admin' && myRole !== 'owner') return json({ error: 'Seul le propriétaire peut nommer un administrateur' }, 403)

    const { data: found } = await db.rpc('auth_user_by_email', { p_email: email })
    let userId: string | undefined = found?.[0]?.id
    let existed = false
    if (userId) {
      existed = true
      if (userId === me.user.id) return json({ error: 'Tu ne peux pas modifier ton propre compte ici' }, 400)
      const { data: target } = await db.from('staff').select('role').eq('user_id', userId).maybeSingle()
      if (target?.role === 'owner') return json({ error: 'Impossible de modifier le propriétaire' }, 403)
      if (target?.role === 'admin' && myRole !== 'owner') return json({ error: 'Seul le propriétaire peut modifier un administrateur' }, 403)
      const { error } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true })
      if (error) return json({ error: error.message }, 400)
      // Coupe toutes les sessions existantes : seul celui qui reçoit le mot de passe pourra entrer.
      const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
      const { error: e2 } = await anon.auth.signInWithPassword({ email, password })
      if (!e2) await anon.auth.signOut({ scope: 'global' })
    } else {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !data.user) return json({ error: error?.message ?? 'Création impossible' }, 400)
      userId = data.user.id
    }
    const { error } = await db.from('staff').upsert({ user_id: userId, email, role }, { onConflict: 'user_id' })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, existed })
  }

  return json({ error: 'Action inconnue' }, 400)
})
