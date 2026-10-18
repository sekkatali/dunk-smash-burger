import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Category, GroupWithOptions, OptionGroup, OptionItem, Product, ProductOptionGroup } from './types'

export type MenuData = {
  categories: Category[]
  products: Product[]
  groups: GroupWithOptions[]
  links: ProductOptionGroup[]
}

const EMPTY: MenuData = { categories: [], products: [], groups: [], links: [] }

export async function fetchMenu(): Promise<MenuData> {
  const [c, p, g, o, l] = await Promise.all([
    supabase.from('categories').select('*').order('position').order('name'),
    supabase.from('products').select('*').order('position').order('name'),
    supabase.from('option_groups').select('*').order('position').order('name'),
    supabase.from('options').select('*').order('position').order('name'),
    supabase.from('product_option_groups').select('*').order('position'),
  ])
  const err = c.error || p.error || g.error || o.error || l.error
  if (err) throw err
  const options = (o.data ?? []) as OptionItem[]
  const groups = ((g.data ?? []) as OptionGroup[]).map((grp) => ({
    ...grp,
    options: options.filter((x) => x.group_id === grp.id),
  }))
  return {
    categories: (c.data ?? []) as Category[],
    products: (p.data ?? []) as Product[],
    groups,
    links: (l.data ?? []) as ProductOptionGroup[],
  }
}

export function groupsForProduct(menu: MenuData, productId: string): GroupWithOptions[] {
  return menu.links
    .filter((l) => l.product_id === productId)
    .sort((a, b) => a.position - b.position)
    .map((l) => menu.groups.find((g) => g.id === l.group_id))
    .filter((g): g is GroupWithOptions => Boolean(g))
}

export function useMenu() {
  const [menu, setMenu] = useState<MenuData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setMenu(await fetchMenu())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger le menu')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { menu, setMenu, loading, error, reload }
}
