import { useCallback, useEffect, useState } from 'react'
import { ImagePlus, Plus, Power, Trash2 } from 'lucide-react'
import { supabase, errorMessage } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { uploadImage } from '../lib/storage'
import { DAY_LABEL } from '../lib/format'
import type { DayHours, Settings, Zone } from '../lib/types'
import { Badge, Button, Card, Field, Input, NumberInput, PageLoader, Select, Tabs, Textarea, Toggle, cx, useToast } from '../components/ui'
import { PageHeader } from './PageHeader'
import { useAdmin } from './adminContext'

type Tab = 'general' | 'ordering' | 'hours' | 'zones' | 'team'

export default function SettingsPage() {
  const { settings, save, loading } = useSettings()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('general')
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(settings), [settings])

  const persist = async (next: Settings = draft) => {
    setSaving(true)
    try {
      await save(next)
      toast('Paramètres enregistrés')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleOrders = async () => {
    const next = { ...settings, ordering: { ...settings.ordering, accept_orders: !settings.ordering.accept_orders } }
    await persist(next)
  }

  if (loading) return <PageLoader />

  const r = draft.restaurant
  const o = draft.ordering
  const setR = (k: keyof Settings['restaurant'], v: string) => setDraft({ ...draft, restaurant: { ...r, [k]: v } })
  const setO = <K extends keyof Settings['ordering']>(k: K, v: Settings['ordering'][K]) => setDraft({ ...draft, ordering: { ...o, [k]: v } })

  const saveBar = tab !== 'team' && (
    <div className="sticky bottom-4 mt-6 flex justify-end">
      <Button size="lg" loading={saving} onClick={() => persist()} className="shadow-lg">Enregistrer les modifications</Button>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Paramètres"
        actions={<Tabs value={tab} onChange={setTab} tabs={[
          { id: 'general', label: 'Restaurant' }, { id: 'ordering', label: 'Commandes & livraison' },
          { id: 'hours', label: 'Horaires' }, { id: 'zones', label: 'Zones de livraison' }, { id: 'team', label: 'Équipe' },
        ]} />}
      />

      {/* Interrupteur principal */}
      <div className={cx('mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5', settings.ordering.accept_orders ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-red-50 ring-1 ring-red-200')}>
        <div>
          <p className="text-lg font-bold">{settings.ordering.accept_orders ? 'Les commandes en ligne sont ouvertes' : 'Les commandes en ligne sont suspendues'}</p>
          <p className="text-sm text-stone-600">Coupe instantanément les commandes en cas de rush, de rupture ou de fermeture exceptionnelle.</p>
        </div>
        <Button variant={settings.ordering.accept_orders ? 'danger' : 'primary'} onClick={toggleOrders} loading={saving}>
          <Power className="size-4" /> {settings.ordering.accept_orders ? 'Suspendre les commandes' : 'Rouvrir les commandes'}
        </Button>
      </div>

      {tab === 'general' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Identité">
            <div className="space-y-4">
              <Field label="Nom du restaurant"><Input value={r.name} onChange={(e) => setR('name', e.target.value)} /></Field>
              <Field label="Slogan"><Input value={r.tagline} onChange={(e) => setR('tagline', e.target.value)} /></Field>
              <LogoField value={r.logo_url} onChange={(v) => setR('logo_url', v)} />
            </div>
          </Card>
          <Card title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Téléphone"><Input value={r.phone} onChange={(e) => setR('phone', e.target.value)} placeholder="05 22 …" /></Field>
              <Field label="WhatsApp"><Input value={r.whatsapp} onChange={(e) => setR('whatsapp', e.target.value)} placeholder="06 …" /></Field>
              <Field label="E-mail" className="sm:col-span-2"><Input value={r.email} onChange={(e) => setR('email', e.target.value)} /></Field>
              <Field label="Adresse" className="sm:col-span-2"><Input value={r.address} onChange={(e) => setR('address', e.target.value)} /></Field>
              <Field label="Ville"><Input value={r.city} onChange={(e) => setR('city', e.target.value)} placeholder="Casablanca" /></Field>
              <Field label="Instagram"><Input value={r.instagram} onChange={(e) => setR('instagram', e.target.value)} placeholder="@dunksmashburger" /></Field>
              <Field label="TikTok"><Input value={r.tiktok} onChange={(e) => setR('tiktok', e.target.value)} placeholder="@dunksmashburger" /></Field>
            </div>
          </Card>
          <Card title="Notifications">
            <Toggle checked={draft.notifications.sound} onChange={(v) => setDraft({ ...draft, notifications: { ...draft.notifications, sound: v } })}
              label="Sonnerie à chaque nouvelle commande" description="Sonne toutes les 5 s tant qu'une commande n'est pas acceptée (laisse le back-office ouvert sur une tablette en cuisine)." />
          </Card>
        </div>
      )}

      {tab === 'ordering' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Modes de commande">
            <div className="space-y-4">
              <Toggle checked={o.delivery_enabled} onChange={(v) => setO('delivery_enabled', v)} label="Livraison" />
              <Toggle checked={o.pickup_enabled} onChange={(v) => setO('pickup_enabled', v)} label="À emporter (click & collect)" />
              <div className="grid grid-cols-2 gap-3 pt-2">
                <Field label="Préparation (min)"><NumberInput value={o.prep_time_min} onChange={(v) => setO('prep_time_min', v ?? 0)} min={0} /></Field>
                <Field label="Livraison (min)"><NumberInput value={o.delivery_time_min} onChange={(v) => setO('delivery_time_min', v ?? 0)} min={0} /></Field>
              </div>
            </div>
          </Card>
          <Card title="Tarifs de livraison">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Frais de livraison (DH)" hint="Utilisé si aucune zone n'est définie"><NumberInput value={o.delivery_fee} onChange={(v) => setO('delivery_fee', v ?? 0)} min={0} /></Field>
              <Field label="Minimum de commande (DH)"><NumberInput value={o.min_order} onChange={(v) => setO('min_order', v ?? 0)} min={0} /></Field>
              <Field label="Livraison offerte dès (DH)" hint="0 = jamais" className="sm:col-span-2"><NumberInput value={o.free_delivery_threshold} onChange={(v) => setO('free_delivery_threshold', v ?? 0)} min={0} /></Field>
            </div>
          </Card>
          <Card title="Message quand c'est fermé" className="lg:col-span-2">
            <Textarea value={o.closed_message} onChange={(e) => setO('closed_message', e.target.value)} />
          </Card>
        </div>
      )}

      {tab === 'hours' && <HoursEditor hours={draft.hours} onChange={(hours) => setDraft({ ...draft, hours })} />}
      {tab === 'zones' && <ZonesEditor zones={draft.zones} defaultFee={o.delivery_fee} onChange={(zones) => setDraft({ ...draft, zones })} />}
      {tab === 'team' && <TeamTab />}

      {saveBar}
    </div>
  )
}

function LogoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-stone-700">Logo (optionnel)</p>
      <div className="flex items-center gap-4">
        <label className="flex h-16 w-40 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-stone-300 bg-ink">
          {value ? <img src={value} alt="" className="max-h-14 max-w-36 object-contain" /> : <ImagePlus className="size-6 text-white/50" />}
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setBusy(true)
            try { onChange(await uploadImage(f, 'brand')) } catch (err) { toast(errorMessage(err), 'error') } finally { setBusy(false) }
          }} />
        </label>
        <div className="text-xs text-stone-500">
          {busy ? 'Envoi…' : 'PNG transparent conseillé. Sans logo, le logo « Dunk » par défaut est utilisé.'}
          {value && <button type="button" className="mt-1 block text-danger" onClick={() => onChange('')}>Retirer</button>}
        </div>
      </div>
    </div>
  )
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function HoursEditor({ hours, onChange }: { hours: DayHours[]; onChange: (h: DayHours[]) => void }) {
  const full = DAY_ORDER.map((day) => hours.find((h) => h.day === day) ?? { day, open: '12:00', close: '23:59', closed: false })
  const set = (day: number, v: Partial<DayHours>) => onChange(full.map((h) => (h.day === day ? { ...h, ...v } : h)))
  const copyAll = () => {
    const ref = full[0]
    onChange(full.map((h) => ({ ...h, open: ref.open, close: ref.close, closed: ref.closed })))
  }
  return (
    <Card title="Horaires d'ouverture" action={<Button size="sm" variant="soft" onClick={copyAll}>Appliquer le lundi à tous les jours</Button>}>
      <p className="mb-4 text-sm text-stone-500">Le site n'accepte les commandes que pendant ces horaires (heure du Maroc). Pour un service après minuit, mets par exemple 18:00 → 02:00.</p>
      <ul className="divide-y divide-stone-100">
        {full.map((h) => (
          <li key={h.day} className="flex flex-wrap items-center gap-3 py-3">
            <span className="w-28 font-semibold">{DAY_LABEL[h.day]}</span>
            <Toggle checked={!h.closed} onChange={(v) => set(h.day, { closed: !v })} label={<span className="text-sm">{h.closed ? 'Fermé' : 'Ouvert'}</span>} />
            {!h.closed && (
              <div className="flex items-center gap-2">
                <Input type="time" value={h.open} onChange={(e) => set(h.day, { open: e.target.value })} className="w-32" />
                <span className="text-stone-400">→</span>
                <Input type="time" value={h.close} onChange={(e) => set(h.day, { close: e.target.value })} className="w-32" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ZonesEditor({ zones, defaultFee, onChange }: { zones: Zone[]; defaultFee: number; onChange: (z: Zone[]) => void }) {
  const set = (i: number, v: Partial<Zone>) => onChange(zones.map((z, idx) => (idx === i ? { ...z, ...v } : z)))
  return (
    <Card title="Zones de livraison" action={<Button size="sm" onClick={() => onChange([...zones, { name: '', fee: defaultFee, min_order: null, active: true }])}><Plus className="size-4" /> Ajouter une zone</Button>}>
      <p className="mb-4 text-sm text-stone-500">
        Optionnel. Si tu définis des zones (quartiers), le client doit choisir la sienne et paie les frais correspondants.
        Sans zone, les frais de livraison uniques s'appliquent partout.
      </p>
      {zones.length === 0 && <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-500">Aucune zone : frais uniques de {defaultFee} DH.</p>}
      <ul className="space-y-2">
        {zones.map((z, i) => (
          <li key={i} className="flex flex-wrap items-end gap-3 rounded-xl bg-stone-50 p-3">
            <Field label="Quartier / zone" className="min-w-48 flex-1"><Input value={z.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Maârif, Gauthier, Anfa…" /></Field>
            <Field label="Frais (DH)" className="w-28"><NumberInput value={z.fee} onChange={(v) => set(i, { fee: v })} min={0} /></Field>
            <Field label="Minimum (DH)" className="w-32"><NumberInput value={z.min_order} onChange={(v) => set(i, { min_order: v })} min={0} placeholder="par défaut" /></Field>
            <div className="pb-2"><Toggle checked={z.active !== false} onChange={(v) => set(i, { active: v })} label={<span className="text-xs">Active</span>} /></div>
            <button type="button" onClick={() => onChange(zones.filter((_, idx) => idx !== i))} className="pb-3 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

type StaffRow = { user_id: string; email: string | null; role: string; created_at: string }
type InviteRow = { email: string; role: string; created_at: string }

function TeamTab() {
  const { role, user } = useAdmin()
  const toast = useToast()
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState('admin')
  const isOwner = role === 'owner'

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([
      supabase.from('staff').select('user_id, email, role, created_at').order('created_at'),
      supabase.from('staff_invites').select('*').order('created_at'),
    ])
    setStaff((s.data ?? []) as StaffRow[])
    setInvites((i.data ?? []) as InviteRow[])
  }, [])
  useEffect(() => { void load() }, [load])

  const invite = async () => {
    if (!email.includes('@')) return toast('E-mail invalide', 'error')
    const { error } = await supabase.from('staff_invites').upsert({ email: email.trim().toLowerCase(), role: newRole })
    if (error) return toast(errorMessage(error), 'error')
    toast('Invitation enregistrée')
    setEmail('')
    void load()
  }

  const removeStaff = async (s: StaffRow) => {
    if (!confirm(`Retirer l'accès de ${s.email} ?`)) return
    const { error } = await supabase.from('staff').delete().eq('user_id', s.user_id)
    if (error) return toast(errorMessage(error), 'error')
    void load()
  }

  const removeInvite = async (i: InviteRow) => {
    await supabase.from('staff_invites').delete().eq('email', i.email)
    void load()
  }

  const ROLE: Record<string, string> = { owner: 'Propriétaire', admin: 'Administrateur', staff: 'Équipe' }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Membres">
        <ul className="divide-y divide-stone-100">
          {staff.map((s) => (
            <li key={s.user_id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{s.email} {s.user_id === user.id && <span className="text-xs text-stone-400">(toi)</span>}</p>
                <Badge className={s.role === 'owner' ? 'bg-ball/15 text-ball-dark' : undefined}>{ROLE[s.role] ?? s.role}</Badge>
              </div>
              {isOwner && s.user_id !== user.id && (
                <button type="button" onClick={() => removeStaff(s)} className="p-1.5 text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Inviter quelqu'un">
        <p className="mb-4 text-sm text-stone-500">
          Ajoute son e-mail ici, puis envoie-lui le lien <b>{window.location.origin}/admin/login</b> : il crée son compte avec ce même e-mail et accède directement au back-office.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-52 flex-1" type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select className="w-40" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="admin">Administrateur</option>
            <option value="staff">Équipe</option>
          </Select>
          <Button onClick={invite}>Inviter</Button>
        </div>
        {invites.length > 0 && (
          <ul className="mt-4 divide-y divide-stone-100">
            {invites.map((i) => (
              <li key={i.email} className="flex items-center justify-between py-2 text-sm">
                <span>{i.email} <span className="text-stone-400">· en attente · {ROLE[i.role]}</span></span>
                <button type="button" onClick={() => removeInvite(i)} className="text-stone-400 hover:text-danger"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
