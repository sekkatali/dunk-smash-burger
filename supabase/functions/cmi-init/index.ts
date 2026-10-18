// Prépare le formulaire de paiement CMI pour une commande (appelé par le site).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CMI_GATEWAY, cmiHash, corsHeaders } from '../_shared/cmi.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const { token, origin } = await req.json()
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'Commande invalide' }, 400)
    const site = typeof origin === 'string' && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : null
    if (!site) return json({ error: 'Origine invalide' }, 400)

    const storeKey = Deno.env.get('CMI_STORE_KEY')
    if (!storeKey) return json({ error: "Le paiement en ligne n'est pas encore configuré" }, 503)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const [{ data: order }, { data: settingsRow }] = await Promise.all([
      db.from('orders').select('*').eq('token', token).maybeSingle(),
      db.from('settings').select('data').eq('id', 1).single(),
    ])
    if (!order) return json({ error: 'Commande introuvable' }, 404)
    if (order.payment_method !== 'cmi' || order.payment_status === 'paid' || order.status !== 'pending_payment') {
      return json({ error: 'Cette commande ne peut pas être payée en ligne' }, 409)
    }
    const payments = settingsRow?.data?.payments ?? {}
    if (!payments.cmi || !payments.cmi_client_id) return json({ error: 'Paiement en ligne désactivé' }, 503)

    const fields: Record<string, string> = {
      clientid: String(payments.cmi_client_id),
      amount: Number(order.total).toFixed(2),
      okUrl: `${site}/suivi/${token}?payment=ok`,
      failUrl: `${site}/suivi/${token}?payment=fail`,
      TranType: 'PreAuth',
      callbackUrl: `${supabaseUrl}/functions/v1/cmi-callback`,
      shopurl: site,
      currency: '504',
      rnd: crypto.randomUUID().replace(/-/g, '').slice(0, 20),
      storetype: '3D_PAY_HOSTING',
      hashAlgorithm: 'ver3',
      lang: 'fr',
      refreshtime: '5',
      BillToName: String(order.customer_name).slice(0, 60),
      email: order.customer_email || 'client@dunk.ma',
      tel: String(order.customer_phone),
      oid: String(order.number),
      encoding: 'UTF-8',
      AutoRedirect: 'true',
    }
    fields.HASH = await cmiHash(fields, storeKey)

    return json({ url: payments.cmi_test_mode ? CMI_GATEWAY.test : CMI_GATEWAY.prod, fields })
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur interne' }, 500)
  }
})
