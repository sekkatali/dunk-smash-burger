// Callback serveur à serveur appelé par CMI après chaque paiement.
// URL à communiquer à CMI : https://<projet>.supabase.co/functions/v1/cmi-callback
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cmiHash } from '../_shared/cmi.ts'

const text = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/plain' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('FAILURE')
  try {
    const form = await req.formData()
    const params: Record<string, string> = {}
    form.forEach((v, k) => { params[k] = String(v) })

    const storeKey = Deno.env.get('CMI_STORE_KEY')
    if (!storeKey) return text('FAILURE')

    const received = params.HASH ?? params.hash ?? ''
    const expected = await cmiHash(params, storeKey)
    if (!received || received !== expected) {
      console.warn('CMI : hash invalide pour oid', params.oid)
      return text('FAILURE')
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const number = Number(params.oid)
    const { data: order } = await db.from('orders').select('*').eq('number', number).maybeSingle()
    if (!order) return text('FAILURE')

    const approved = params.ProcReturnCode === '00' && (params.Response ?? '').toLowerCase() === 'approved'
    const amountOk = Math.abs(Number(params.amount) - Number(order.total)) < 0.01

    if (approved && amountOk) {
      if (order.payment_status !== 'paid') {
        await db.from('orders').update({
          payment_status: 'paid',
          payment_ref: params.TransId || params.AuthCode || null,
          status: order.status === 'pending_payment' ? 'new' : order.status,
        }).eq('id', order.id)
      }
      return text('ACTION=POSTAUTH')
    }

    if (order.payment_status !== 'paid') {
      await db.from('orders').update({ payment_status: 'failed', payment_ref: params.TransId || null }).eq('id', order.id)
    }
    return text('APPROVED')
  } catch (e) {
    console.error(e)
    return text('FAILURE')
  }
})
