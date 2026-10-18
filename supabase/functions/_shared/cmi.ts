// Outils partagés pour le paiement CMI (3D Pay Hosting, hash « ver3 » SHA-512).
// Spécification : kit d'intégration CMI fourni par la banque (CIH Bank).

export const CMI_GATEWAY = {
  test: 'https://testpayment.cmi.co.ma/fim/est3Dgate',
  prod: 'https://payment.cmi.co.ma/fim/est3Dgate',
}

const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')

/** Hash ver3 : valeurs triées par nom de paramètre (insensible à la casse), séparées par |, + clé magasin. */
export async function cmiHash(params: Record<string, string>, storeKey: string): Promise<string> {
  const keys = Object.keys(params)
    .filter((k) => !['hash', 'encoding'].includes(k.toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const plain = keys.map((k) => escape(String(params[k] ?? '').trim())).join('|') + '|' + escape(storeKey)
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(plain))
  let bin = ''
  new Uint8Array(digest).forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
