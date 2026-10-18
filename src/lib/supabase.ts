import { createClient } from '@supabase/supabase-js'

// Les clés « publishable » sont faites pour être publiques (la sécurité est
// assurée par les règles RLS de la base). Elles peuvent aussi être définies
// dans Vercel via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
const FALLBACK_URL = 'https://mjrnlrmefyxcuvzzwifl.supabase.co'
const FALLBACK_KEY = 'sb_publishable_WucVMecvFDdS3IJneXAWaQ_lwGrx--z'

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL
const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY

export const isConfigured = !SUPABASE_URL.startsWith('__')

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isConfigured ? SUPABASE_KEY : 'placeholder',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

export function errorMessage(e: unknown): string {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return 'Une erreur est survenue'
}
