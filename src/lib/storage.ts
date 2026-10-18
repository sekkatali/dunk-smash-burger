import { supabase } from './supabase'

export async function uploadImage(file: File, folder = 'products'): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('menu').upload(path, file, { cacheControl: '31536000', upsert: false })
  if (error) throw error
  return supabase.storage.from('menu').getPublicUrl(path).data.publicUrl
}
