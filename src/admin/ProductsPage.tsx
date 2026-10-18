import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Layers, Pencil, Plus, Star, Trash2, Utensils } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { useMenu } from '../lib/menu'
import type { MenuData } from '../lib/menu'
import { money } from '../lib/format'
import type { Category, GroupWithOptions, OptionItem, Product } from '../lib/types'
import {
  Badge, Button, Card, Empty, Field, FoodImage, Input, Modal, NumberInput, PageLoader, Select, Tabs, Textarea, Toggle, cx, useToast,
} from '../components/ui'
import { PageHeader } from './PageHeader'
import { uploadImage } from '../lib/storage'

type Tab = 'products' | 'categories' | 'options'

export default function ProductsPage() {
  const { menu, loading, reload } = useMenu()
  const [tab, setTab] = useState<Tab>('products')

  if (loading) return <PageLoader />
  return (
    <div>
      <PageHeader
        title="Produits & menu"
        subtitle={`${menu.products.length} produits · ${menu.categories.length} catégories · ${menu.groups.length} groupes d'options`}
        actions={
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'products', label: 'Produits' },
            { id: 'categories', label: 'Catégories' },
            { id: 'options', label: "Options" },
          ]} />
        }
      />
      {tab === 'products' && <ProductsTab menu={menu} reload={reload} />}
      {tab === 'categories' && <CategoriesTab menu={menu} reload={reload} />}
      {tab === 'options' && <OptionsTab menu={menu} reload={reload} />}
    </div>
  )
}

/* ===================================================================== utilitaires */
async function swapPositions(table: 'products' | 'categories' | 'option_groups' | 'options', a: { id: string; position: number }, b: { id: string; position: number }) {
  const pa = a.position === b.position ? b.position + 1 : b.position
  await Promise.all([
    supabase.from(table).update({ position: pa }).eq('id', a.id),
    supabase.from(table).update({ position: a.position }).eq('id', b.id),
  ])
}

async function normalize(table: 'products' | 'categories' | 'option_groups' | 'options', rows: { id: string }[]) {
  await Promise.all(rows.map((r, i) => supabase.from(table).update({ position: i + 1 }).eq('id', r.id)))
}

/* ===================================================================== PRODUITS */
function ProductsTab({ menu, reload }: { menu: MenuData; reload: () => Promise<void> }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [filter, setFilter] = useState('')

  const sections = useMemo(() => {
    const list = [...menu.categories.map((c) => ({ id: c.id, name: c.name })), { id: '__none', name: 'Sans catégorie' }]
    return list
      .map((c) => ({
        ...c,
        products: menu.products
          .filter((p) => (c.id === '__none' ? !p.category_id || !menu.categories.some((x) => x.id === p.category_id) : p.category_id === c.id))
          .filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())),
      }))
      .filter((s) => s.products.length > 0)
  }, [menu, filter])

  const patch = async (p: Product, values: Partial<Product>) => {
    const { error } = await supabase.from('products').update(values).eq('id', p.id)
    if (error) return toast(errorMessage(error), 'error')
    await reload()
  }

  const remove = async (p: Product) => {
    if (!confirm(`Supprimer « ${p.name} » ? (les anciennes commandes restent intactes)`)) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) return toast(errorMessage(error), 'error')
    toast('Produit supprimé')
    await reload()
  }

  const move = async (list: Product[], idx: number, dir: -1 | 1) => {
    const target = list[idx + dir]
    if (!target) return
    if (new Set(list.map((p) => p.position)).size !== list.length) {
      const reordered = [...list]
      ;[reordered[idx], reordered[idx + dir]] = [reordered[idx + dir], reordered[idx]]
      await normalize('products', reordered)
    } else {
      await swapPositions('products', list[idx], target)
    }
    await reload()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder="Rechercher un produit…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Nouveau produit</Button>
      </div>

      {sections.length === 0 && (
        <Empty icon={<Utensils className="size-10" />} title="Aucun produit">Crée d'abord une catégorie, puis ajoute tes produits.</Empty>
      )}

      <div className="space-y-6">
        {sections.map((s) => (
          <Card key={s.id} title={s.name}>
            <ul className="divide-y divide-stone-100">
              {s.products.map((p, idx) => {
                const groupCount = menu.links.filter((l) => l.product_id === p.id).length
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="flex flex-col">
                      <button type="button" disabled={idx === 0} onClick={() => move(s.products, idx, -1)} className="text-stone-400 hover:text-ink disabled:opacity-20" aria-label="Monter"><ArrowUp className="size-4" /></button>
                      <button type="button" disabled={idx === s.products.length - 1} onClick={() => move(s.products, idx, 1)} className="text-stone-400 hover:text-ink disabled:opacity-20" aria-label="Descendre"><ArrowDown className="size-4" /></button>
                    </div>
                    <FoodImage src={p.image_url} alt={p.name} className="size-14 rounded-xl" />
                    <div className="min-w-40 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {p.name}
                        {p.badge && <Badge className="bg-cheddar/40 text-ink">{p.badge}</Badge>}
                        {!p.active && <Badge>Masqué</Badge>}
                        {!p.available && <Badge className="bg-red-100 text-danger">Épuisé</Badge>}
                      </p>
                      <p className="text-sm text-stone-500">{money(p.price)} · {groupCount} groupe{groupCount > 1 ? 's' : ''} d'options</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Toggle checked={p.available} onChange={(v) => patch(p, { available: v })} label={<span className="text-xs">En stock</span>} />
                      <Toggle checked={p.active} onChange={(v) => patch(p, { active: v })} label={<span className="text-xs">Visible</span>} />
                      <button type="button" onClick={() => patch(p, { featured: !p.featured })} title="Mettre en avant"
                        className={cx('rounded-lg p-2', p.featured ? 'text-cheddar' : 'text-stone-300 hover:text-stone-500')}>
                        <Star className="size-5" fill={p.featured ? 'currentColor' : 'none'} />
                      </button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="size-4" /> Modifier</Button>
                      <button type="button" onClick={() => remove(p)} className="rounded-lg p-2 text-stone-400 hover:text-danger" aria-label="Supprimer"><Trash2 className="size-4" /></button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        ))}
      </div>

      {editing && (
        <ProductForm
          menu={menu}
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }}
        />
      )}
    </div>
  )
}

function ProductForm({ menu, product, onClose, onSaved }: {
  menu: MenuData; product: Product | null; onClose: () => void; onSaved: () => Promise<void>
}) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: product?.name ?? '',
    description: product?.description ?? '',
    category_id: product?.category_id ?? menu.categories[0]?.id ?? '',
    price: product?.price ?? null as number | null,
    compare_at_price: product?.compare_at_price ?? null as number | null,
    badge: product?.badge ?? '',
    image_url: product?.image_url ?? '',
    active: product?.active ?? true,
    available: product?.available ?? true,
    featured: product?.featured ?? false,
  })
  const [groupIds, setGroupIds] = useState<string[]>(() =>
    product ? menu.links.filter((l) => l.product_id === product.id).sort((a, b) => a.position - b.position).map((l) => l.group_id) : [],
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const onFile = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      set('image_url', await uploadImage(file))
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!form.name.trim() || form.price === null) return toast('Nom et prix obligatoires', 'error')
    setSaving(true)
    try {
      const values = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        price: form.price,
        compare_at_price: form.compare_at_price || null,
        badge: form.badge.trim() || null,
        image_url: form.image_url || null,
        active: form.active,
        available: form.available,
        featured: form.featured,
      }
      let id = product?.id
      if (id) {
        const { error } = await supabase.from('products').update(values).eq('id', id)
        if (error) throw error
      } else {
        const maxPos = Math.max(0, ...menu.products.filter((p) => p.category_id === values.category_id).map((p) => p.position))
        const { data, error } = await supabase.from('products').insert({ ...values, position: maxPos + 1 }).select('id').single()
        if (error) throw error
        id = data.id as string
      }
      // associations aux groupes d'options
      const { error: delErr } = await supabase.from('product_option_groups').delete().eq('product_id', id)
      if (delErr) throw delErr
      if (groupIds.length) {
        const { error: insErr } = await supabase.from('product_option_groups')
          .insert(groupIds.map((g, i) => ({ product_id: id, group_id: g, position: i + 1 })))
        if (insErr) throw insErr
      }
      toast(product ? 'Produit mis à jour' : 'Produit créé')
      await onSaved()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const moveGroup = (idx: number, dir: -1 | 1) => {
    setGroupIds((ids) => {
      const next = [...ids]
      const t = idx + dir
      if (t < 0 || t >= next.length) return ids
      ;[next[idx], next[t]] = [next[t], next[idx]]
      return next
    })
  }

  return (
    <Modal open onClose={onClose} size="lg" title={product ? `Modifier « ${product.name} »` : 'Nouveau produit'}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button loading={saving} onClick={save}>Enregistrer</Button></div>}>
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div>
          <label className="block cursor-pointer">
            <div className="relative aspect-square overflow-hidden rounded-2xl border-2 border-dashed border-stone-300">
              {form.image_url
                ? <img src={form.image_url} alt="" className="size-full object-cover" />
                : <div className="flex size-full flex-col items-center justify-center text-stone-400"><ImagePlus className="size-8" /><span className="mt-1 text-xs">Ajouter une photo</span></div>}
              {uploading && <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-semibold">Envoi…</div>}
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {form.image_url && <button type="button" onClick={() => set('image_url', '')} className="mt-2 text-xs text-danger">Retirer la photo</button>}
          <p className="mt-2 text-xs text-stone-500">Format carré conseillé, fond uni, 1000×1000 px.</p>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom *" className="sm:col-span-2"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="The Dunk" /></Field>
            <Field label="Catégorie">
              <Select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                <option value="">Sans catégorie</option>
                {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Badge" hint="Ex : Best-seller, Nouveau, Épicé"><Input value={form.badge} onChange={(e) => set('badge', e.target.value)} /></Field>
            <Field label="Prix (DH) *"><NumberInput value={form.price} onChange={(v) => set('price', v)} min={0} /></Field>
            <Field label="Prix barré (DH)" hint="Optionnel, pour afficher une promo"><NumberInput value={form.compare_at_price} onChange={(v) => set('compare_at_price', v)} min={0} /></Field>
          </div>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ingrédients, ce qui le rend unique…" /></Field>
          <div className="flex flex-wrap gap-6">
            <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Visible sur le site" />
            <Toggle checked={form.available} onChange={(v) => set('available', v)} label="En stock" />
            <Toggle checked={form.featured} onChange={(v) => set('featured', v)} label="Mis en avant" />
          </div>

          <div>
            <p className="mb-1 font-semibold">Options proposées pour ce produit</p>
            <p className="mb-3 text-xs text-stone-500">Coche les groupes à associer. L'ordre ici = l'ordre affiché au client. Les groupes se créent dans l'onglet « Options ».</p>
            {menu.groups.length === 0 && <p className="text-sm text-stone-500">Aucun groupe d'options pour l'instant.</p>}
            {groupIds.length > 0 && (
              <ol className="mb-3 space-y-1.5">
                {groupIds.map((gid, idx) => {
                  const g = menu.groups.find((x) => x.id === gid)
                  if (!g) return null
                  return (
                    <li key={gid} className="flex items-center gap-2 rounded-xl bg-ball/5 px-3 py-2 ring-1 ring-ball/30">
                      <span className="w-5 text-sm font-bold text-ball">{idx + 1}</span>
                      <span className="flex-1 text-sm font-semibold">{g.internal_name || g.name}</span>
                      <span className="text-xs text-stone-500">{ruleLabel(g)}</span>
                      <button type="button" onClick={() => moveGroup(idx, -1)} className="text-stone-400 hover:text-ink"><ArrowUp className="size-4" /></button>
                      <button type="button" onClick={() => moveGroup(idx, 1)} className="text-stone-400 hover:text-ink"><ArrowDown className="size-4" /></button>
                      <button type="button" onClick={() => setGroupIds((ids) => ids.filter((x) => x !== gid))} className="text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
                    </li>
                  )
                })}
              </ol>
            )}
            <div className="flex flex-wrap gap-2">
              {menu.groups.filter((g) => !groupIds.includes(g.id)).map((g) => (
                <button key={g.id} type="button" onClick={() => setGroupIds((ids) => [...ids, g.id])}
                  className="inline-flex items-center gap-1 rounded-full border border-stone-300 px-3 py-1.5 text-sm hover:border-ball hover:text-ball">
                  <Plus className="size-3.5" /> {g.internal_name || g.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ruleLabel(g: { min_select: number; max_select: number }) {
  if (g.min_select > 0) return g.max_select === 1 ? 'Obligatoire, 1 choix' : `Obligatoire, ${g.min_select} à ${g.max_select}`
  return g.max_select === 1 ? 'Optionnel, 1 choix' : `Optionnel, jusqu'à ${g.max_select}`
}

/* ===================================================================== CATÉGORIES */
function CategoriesTab({ menu, reload }: { menu: MenuData; reload: () => Promise<void> }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const open = (c: Category | 'new') => {
    setEditing(c)
    setName(c === 'new' ? '' : c.name)
    setDescription(c === 'new' ? '' : c.description ?? '')
  }

  const save = async () => {
    if (!name.trim()) return
    const values = { name: name.trim(), description: description.trim() || null }
    const { error } = editing && editing !== 'new'
      ? await supabase.from('categories').update(values).eq('id', editing.id)
      : await supabase.from('categories').insert({ ...values, position: Math.max(0, ...menu.categories.map((c) => c.position)) + 1 })
    if (error) return toast(errorMessage(error), 'error')
    setEditing(null)
    await reload()
  }

  const remove = async (c: Category) => {
    const n = menu.products.filter((p) => p.category_id === c.id).length
    if (!confirm(`Supprimer la catégorie « ${c.name} » ?${n ? ` Ses ${n} produits passeront « sans catégorie ».` : ''}`)) return
    const { error } = await supabase.from('categories').delete().eq('id', c.id)
    if (error) return toast(errorMessage(error), 'error')
    await reload()
  }

  const move = async (idx: number, dir: -1 | 1) => {
    const list = [...menu.categories]
    const t = idx + dir
    if (t < 0 || t >= list.length) return
    ;[list[idx], list[t]] = [list[t], list[idx]]
    await normalize('categories', list)
    await reload()
  }

  const toggle = async (c: Category, active: boolean) => {
    await supabase.from('categories').update({ active }).eq('id', c.id)
    await reload()
  }

  return (
    <Card title="Catégories du menu" action={<Button size="sm" onClick={() => open('new')}><Plus className="size-4" /> Catégorie</Button>}>
      <p className="mb-4 text-sm text-stone-500">L'ordre ici est l'ordre d'affichage sur le site.</p>
      <ul className="divide-y divide-stone-100">
        {menu.categories.map((c, idx) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex flex-col">
              <button type="button" disabled={idx === 0} onClick={() => move(idx, -1)} className="text-stone-400 hover:text-ink disabled:opacity-20"><ArrowUp className="size-4" /></button>
              <button type="button" disabled={idx === menu.categories.length - 1} onClick={() => move(idx, 1)} className="text-stone-400 hover:text-ink disabled:opacity-20"><ArrowDown className="size-4" /></button>
            </div>
            <div className="min-w-40 flex-1">
              <p className="font-semibold">{c.name}</p>
              <p className="text-sm text-stone-500">{menu.products.filter((p) => p.category_id === c.id).length} produits{c.description ? ` · ${c.description}` : ''}</p>
            </div>
            <Toggle checked={c.active} onChange={(v) => toggle(c, v)} label={<span className="text-xs">Visible</span>} />
            <Button size="sm" variant="outline" onClick={() => open(c)}><Pencil className="size-4" /></Button>
            <button type="button" onClick={() => remove(c)} className="p-2 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
      {menu.categories.length === 0 && <p className="py-6 text-center text-stone-500">Aucune catégorie.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} size="sm" title={editing === 'new' ? 'Nouvelle catégorie' : 'Modifier la catégorie'}
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Annuler</Button><Button onClick={save}>Enregistrer</Button></div>}>
        <div className="space-y-4">
          <Field label="Nom"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Smash Burgers" /></Field>
          <Field label="Description (optionnel)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  )
}

/* ===================================================================== OPTIONS */
function OptionsTab({ menu, reload }: { menu: MenuData; reload: () => Promise<void> }) {
  const toast = useToast()
  const [editing, setEditing] = useState<GroupWithOptions | 'new' | null>(null)

  const remove = async (g: GroupWithOptions) => {
    const n = menu.links.filter((l) => l.group_id === g.id).length
    if (!confirm(`Supprimer le groupe « ${g.internal_name || g.name} »${n ? ` (utilisé par ${n} produits)` : ''} ?`)) return
    const { error } = await supabase.from('option_groups').delete().eq('id', g.id)
    if (error) return toast(errorMessage(error), 'error')
    await reload()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-stone-600">
          Un <b>groupe d'options</b> (ex : « Sauces », « Suppléments », « Formule menu ») contient des choix, avec ou sans supplément de prix.
          Tu l'associes ensuite aux produits de ton choix : un même groupe peut servir à plusieurs produits, et pas à d'autres.
        </p>
        <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Nouveau groupe</Button>
      </div>
      {menu.groups.length === 0 && <Empty icon={<Layers className="size-10" />} title="Aucun groupe d'options" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {menu.groups.map((g) => {
          const products = menu.links.filter((l) => l.group_id === g.id).map((l) => menu.products.find((p) => p.id === l.product_id)).filter(Boolean) as Product[]
          return (
            <Card key={g.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{g.internal_name || g.name}</p>
                  {g.internal_name && <p className="text-xs text-stone-500">Affiché au client : « {g.name} »</p>}
                  <p className="mt-1 text-xs font-semibold text-ball">{ruleLabel(g)}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(g)}><Pencil className="size-4" /> Modifier</Button>
                  <button type="button" onClick={() => remove(g)} className="p-2 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
                </div>
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {g.options.map((o) => (
                  <li key={o.id} className={cx('rounded-full px-2.5 py-1 text-xs font-medium', o.available ? 'bg-stone-100' : 'bg-red-50 text-danger line-through')}>
                    {o.name}{o.price > 0 ? ` +${money(o.price)}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                <b>Produits :</b> {products.length ? products.map((p) => p.name).join(', ') : 'aucun (groupe non utilisé)'}
              </p>
            </Card>
          )
        })}
      </div>

      {editing && (
        <GroupForm menu={menu} group={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }} />
      )}
    </div>
  )
}

type DraftOption = { id?: string; name: string; price: number | null; available: boolean }

function GroupForm({ menu, group, onClose, onSaved }: { menu: MenuData; group: GroupWithOptions | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [name, setName] = useState(group?.name ?? '')
  const [internal, setInternal] = useState(group?.internal_name ?? '')
  const [required, setRequired] = useState((group?.min_select ?? 0) > 0)
  const [min, setMin] = useState<number | null>(group?.min_select || 1)
  const [max, setMax] = useState<number | null>(group?.max_select ?? 1)
  const [options, setOptions] = useState<DraftOption[]>(
    group?.options.map((o) => ({ id: o.id, name: o.name, price: Number(o.price), available: o.available })) ?? [{ name: '', price: 0, available: true }],
  )
  const [productIds, setProductIds] = useState<string[]>(group ? menu.links.filter((l) => l.group_id === group.id).map((l) => l.product_id) : [])
  const [saving, setSaving] = useState(false)

  const setOpt = (i: number, v: Partial<DraftOption>) => setOptions((os) => os.map((o, idx) => (idx === i ? { ...o, ...v } : o)))
  const moveOpt = (i: number, dir: -1 | 1) => setOptions((os) => {
    const t = i + dir
    if (t < 0 || t >= os.length) return os
    const n = [...os]
    ;[n[i], n[t]] = [n[t], n[i]]
    return n
  })

  const save = async () => {
    const clean = options.filter((o) => o.name.trim())
    if (!name.trim()) return toast('Donne un nom au groupe', 'error')
    if (clean.length === 0) return toast('Ajoute au moins une option', 'error')
    const minSel = required ? Math.max(1, min ?? 1) : 0
    const maxSel = Math.max(minSel, max ?? 1, 1)
    setSaving(true)
    try {
      const values = { name: name.trim(), internal_name: internal.trim() || null, min_select: minSel, max_select: maxSel }
      let gid = group?.id
      if (gid) {
        const { error } = await supabase.from('option_groups').update(values).eq('id', gid)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('option_groups')
          .insert({ ...values, position: Math.max(0, ...menu.groups.map((g) => g.position)) + 1 }).select('id').single()
        if (error) throw error
        gid = data.id as string
      }
      // options : suppression des retirées, mise à jour / création des autres
      const keepIds = clean.filter((o) => o.id).map((o) => o.id as string)
      const removed = (group?.options ?? []).filter((o: OptionItem) => !keepIds.includes(o.id)).map((o) => o.id)
      if (removed.length) {
        const { error } = await supabase.from('options').delete().in('id', removed)
        if (error) throw error
      }
      for (const [i, o] of clean.entries()) {
        const row = { group_id: gid, name: o.name.trim(), price: o.price ?? 0, available: o.available, position: i + 1 }
        const { error } = o.id
          ? await supabase.from('options').update(row).eq('id', o.id)
          : await supabase.from('options').insert(row)
        if (error) throw error
      }
      // associations produits
      const before = menu.links.filter((l) => l.group_id === gid).map((l) => l.product_id)
      const toRemove = before.filter((p) => !productIds.includes(p))
      const toAdd = productIds.filter((p) => !before.includes(p))
      if (toRemove.length) {
        const { error } = await supabase.from('product_option_groups').delete().eq('group_id', gid).in('product_id', toRemove)
        if (error) throw error
      }
      if (toAdd.length) {
        const rows = toAdd.map((pid) => ({
          product_id: pid, group_id: gid,
          position: menu.links.filter((l) => l.product_id === pid).length + 1,
        }))
        const { error } = await supabase.from('product_option_groups').insert(rows)
        if (error) throw error
      }
      toast('Groupe enregistré')
      await onSaved()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const byCategory = [...menu.categories.map((c) => ({ id: c.id, name: c.name })), { id: null as string | null, name: 'Sans catégorie' }]
    .map((c) => ({ ...c, products: menu.products.filter((p) => (c.id ? p.category_id === c.id : !p.category_id)) }))
    .filter((c) => c.products.length)

  return (
    <Modal open onClose={onClose} size="xl" title={group ? 'Modifier le groupe d’options' : 'Nouveau groupe d’options'}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button loading={saving} onClick={save}>Enregistrer</Button></div>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Titre affiché au client *" hint="Ex : « Choisis ta sauce »"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Nom interne (optionnel)" hint="Pour t'y retrouver, ex : « Sauces burgers »"><Input value={internal} onChange={(e) => setInternal(e.target.value)} /></Field>
          <div className="rounded-2xl bg-stone-50 p-4">
            <Toggle checked={required} onChange={setRequired} label="Choix obligatoire" description="Le client doit choisir avant d'ajouter au panier" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {required && <Field label="Minimum"><NumberInput value={min} onChange={setMin} min={1} /></Field>}
              <Field label="Maximum de choix" hint="1 = choix unique"><NumberInput value={max} onChange={setMax} min={1} /></Field>
            </div>
          </div>

          <div>
            <p className="mb-2 font-semibold">Choix</p>
            <ul className="space-y-2">
              {options.map((o, i) => (
                <li key={o.id ?? `new-${i}`} className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveOpt(i, -1)} className="text-stone-400 hover:text-ink"><ArrowUp className="size-3.5" /></button>
                    <button type="button" onClick={() => moveOpt(i, 1)} className="text-stone-400 hover:text-ink"><ArrowDown className="size-3.5" /></button>
                  </div>
                  <Input className="flex-1" placeholder="Nom (ex : Cheddar)" value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} />
                  <div className="relative w-28">
                    <NumberInput value={o.price} onChange={(v) => setOpt(i, { price: v })} min={0} className="pr-9" />
                    <span className="absolute top-3 right-3 text-xs text-stone-400">DH</span>
                  </div>
                  <button type="button" title={o.available ? 'Disponible' : 'Épuisé'} onClick={() => setOpt(i, { available: !o.available })}
                    className={cx('rounded-lg px-2 py-2 text-xs font-semibold', o.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-danger')}>
                    {o.available ? 'Dispo' : 'Épuisé'}
                  </button>
                  <button type="button" onClick={() => setOptions((os) => os.filter((_, idx) => idx !== i))} className="p-1 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="soft" className="mt-3" onClick={() => setOptions((os) => [...os, { name: '', price: 0, available: true }])}>
              <Plus className="size-4" /> Ajouter un choix
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-1 font-semibold">Associer aux produits</p>
          <p className="mb-3 text-xs text-stone-500">Coche les produits qui proposent ce groupe. Les autres ne l'auront pas.</p>
          <div className="max-h-[50vh] space-y-4 overflow-y-auto rounded-2xl border border-stone-200 p-4">
            {byCategory.map((c) => {
              const allOn = c.products.every((p) => productIds.includes(p.id))
              return (
                <div key={c.id ?? 'none'}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold">{c.name}</p>
                    <button type="button" className="text-xs font-semibold text-ball"
                      onClick={() => setProductIds((ids) => allOn ? ids.filter((x) => !c.products.some((p) => p.id === x)) : [...new Set([...ids, ...c.products.map((p) => p.id)])])}>
                      {allOn ? 'Tout décocher' : 'Tout cocher'}
                    </button>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {c.products.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-50">
                        <input type="checkbox" className="size-4 accent-[#B5121B]" checked={productIds.includes(p.id)}
                          onChange={(e) => setProductIds((ids) => e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
                        <span className="text-sm">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
            {byCategory.length === 0 && <p className="text-sm text-stone-500">Aucun produit pour l'instant.</p>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
