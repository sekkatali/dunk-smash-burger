-- =====================================================================
-- DUNK SMASH BURGER — schéma principal
-- Menu (catégories, produits, groupes d'options, options), commandes,
-- livreurs, codes promo, statistiques, paramètres, équipe.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- ÉQUIPE
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'admin' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now()
);

create table public.staff_invites (
  email text primary key,
  role text not null default 'admin' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff where user_id = auth.uid() and role = 'owner');
$$;

-- ---------------------------------------------------------------- MENU
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  compare_at_price numeric(10,2),
  image_url text,
  badge text,
  active boolean not null default true,      -- visible sur le site
  available boolean not null default true,   -- en stock (sinon « épuisé »)
  featured boolean not null default false,   -- mis en avant
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);

create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,                -- affiché au client (« Choisis ta sauce »)
  internal_name text,                -- nom interne (« Sauces burgers »)
  min_select int not null default 0 check (min_select >= 0),
  max_select int not null default 1 check (max_select >= 1),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (max_select >= min_select)
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  available boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index options_group_idx on public.options(group_id);

-- Association produit <-> groupe d'options (un groupe peut servir à plusieurs produits)
create table public.product_option_groups (
  product_id uuid not null references public.products(id) on delete cascade,
  group_id uuid not null references public.option_groups(id) on delete cascade,
  position int not null default 0,
  primary key (product_id, group_id)
);
create index pog_group_idx on public.product_option_groups(group_id);

-- ---------------------------------------------------------------- LIVREURS
create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  vehicle text,
  plate text,
  status text not null default 'offline' check (status in ('available','busy','offline')),
  active boolean not null default true,
  notes text,
  access_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- CODES PROMO
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  type text not null check (type in ('percent','fixed','free_delivery')),
  value numeric(10,2) not null default 0,
  min_order numeric(10,2) not null default 0,
  max_discount numeric(10,2),
  max_uses int,
  max_uses_per_customer int,
  uses int not null default 0,
  first_order_only boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- COMMANDES
create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number int not null default nextval('public.order_number_seq') unique,
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'new' check (status in
    ('pending_payment','new','accepted','preparing','ready','delivering','delivered','cancelled')),
  type text not null check (type in ('delivery','pickup')),
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  address text,
  address_details text,
  zone text,
  notes text,
  payment_method text not null check (payment_method in ('cash','card_on_delivery','cmi')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  payment_ref text,
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  promo_code text,
  promo_code_id uuid references public.promo_codes(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  cash_settled boolean not null default false,
  cancel_reason text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  session_id text,
  accepted_at timestamptz,
  ready_at timestamptz,
  delivering_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_created_idx on public.orders(created_at desc);
create index orders_status_idx on public.orders(status);
create index orders_phone_idx on public.orders(customer_phone);
create index orders_driver_idx on public.orders(driver_id);
create index orders_promo_idx on public.orders(promo_code_id);
create index orders_session_idx on public.orders(session_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(10,2) not null,
  quantity int not null check (quantity > 0),
  options jsonb not null default '[]'::jsonb,
  note text,
  total numeric(10,2) not null
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

-- ---------------------------------------------------------------- STATISTIQUES
create table public.analytics_events (
  id bigint generated always as identity primary key,
  session_id text not null,
  event text not null check (event in ('page_view','view_product','add_to_cart','begin_checkout','purchase')),
  path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device text,
  product_id uuid,
  value numeric(10,2),
  created_at timestamptz not null default now()
);
create index analytics_created_idx on public.analytics_events(created_at);
create index analytics_event_created_idx on public.analytics_events(event, created_at);
create index analytics_session_idx on public.analytics_events(session_id);

-- ---------------------------------------------------------------- PARAMÈTRES
create table public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings (id, data) values (1, '{
  "restaurant": {
    "name": "Dunk Smash Burger",
    "tagline": "Smashé. Croustillant. Imbattable.",
    "phone": "",
    "whatsapp": "",
    "email": "",
    "address": "",
    "city": "",
    "instagram": "",
    "tiktok": "",
    "logo_url": ""
  },
  "ordering": {
    "accept_orders": true,
    "delivery_enabled": true,
    "pickup_enabled": true,
    "min_order": 50,
    "delivery_fee": 15,
    "free_delivery_threshold": 200,
    "prep_time_min": 20,
    "delivery_time_min": 40,
    "closed_message": "On recharge les plaques ! Reviens pendant nos horaires d''ouverture."
  },
  "hours": [
    {"day": 1, "open": "12:00", "close": "23:59", "closed": false},
    {"day": 2, "open": "12:00", "close": "23:59", "closed": false},
    {"day": 3, "open": "12:00", "close": "23:59", "closed": false},
    {"day": 4, "open": "12:00", "close": "23:59", "closed": false},
    {"day": 5, "open": "12:00", "close": "23:59", "closed": false},
    {"day": 6, "open": "12:00", "close": "23:59", "closed": false},
    {"day": 0, "open": "12:00", "close": "23:59", "closed": false}
  ],
  "zones": [],
  "payments": {
    "cash": true,
    "card_on_delivery": true,
    "cmi": false,
    "cmi_client_id": "",
    "cmi_test_mode": true
  },
  "marketing": {
    "announcement_enabled": true,
    "announcement_text": "🏀 -15% sur ta 1ère commande avec le code DUNK15",
    "meta_pixel_id": "",
    "ga4_id": "",
    "tiktok_pixel_id": "",
    "upsell_product_ids": []
  },
  "notifications": {
    "sound": true
  }
}'::jsonb);

-- ---------------------------------------------------------------- TRIGGERS
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

create or replace function public.orders_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status in ('accepted','preparing','ready','delivering','delivered') and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.status in ('ready','delivering','delivered') and new.ready_at is null then new.ready_at := now(); end if;
    if new.status = 'delivering' and new.delivering_at is null then new.delivering_at := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
    if new.status = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  end if;
  return new;
end $$;

create trigger orders_before_update before update on public.orders
  for each row execute function public.orders_before_update();

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  -- Menu : lecture publique, écriture équipe
  foreach t in array array['categories','products','option_groups','options','product_option_groups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check ((select public.is_staff()))', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('create policy "staff delete" on public.%I for delete to authenticated using ((select public.is_staff()))', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- Données privées : équipe uniquement
  foreach t in array array['orders','order_items','drivers','promo_codes','staff_invites'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "staff all" on public.%I for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Paramètres : lecture publique, modification équipe
alter table public.settings enable row level security;
create policy "public read" on public.settings for select using (true);
create policy "staff update" on public.settings for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
grant select on public.settings to anon, authenticated;
grant update on public.settings to authenticated;

-- Statistiques : écriture publique (événements limités), lecture équipe
alter table public.analytics_events enable row level security;
create policy "public insert events" on public.analytics_events for insert to anon, authenticated
  with check (event in ('page_view','view_product','add_to_cart','begin_checkout') and length(session_id) between 8 and 100);
create policy "staff read events" on public.analytics_events for select to authenticated
  using ((select public.is_staff()));
grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_events to authenticated;

-- Équipe
alter table public.staff enable row level security;
create policy "staff read" on public.staff for select to authenticated using ((select public.is_staff()));
create policy "owner insert" on public.staff for insert to authenticated with check ((select public.is_owner()));
create policy "owner update" on public.staff for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "owner delete" on public.staff for delete to authenticated using ((select public.is_owner()) and user_id <> (select auth.uid()));
grant select, insert, update, delete on public.staff to authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- Temps réel sur les commandes (notifications)
alter publication supabase_realtime add table public.orders;

-- ---------------------------------------------------------------- STOCKAGE (photos du menu)
insert into storage.buckets (id, name, public) values ('menu', 'menu', true)
  on conflict (id) do nothing;

create policy "staff upload menu images" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu' and (select public.is_staff()));
create policy "staff update menu images" on storage.objects for update to authenticated
  using (bucket_id = 'menu' and (select public.is_staff()));
create policy "staff delete menu images" on storage.objects for delete to authenticated
  using (bucket_id = 'menu' and (select public.is_staff()));
