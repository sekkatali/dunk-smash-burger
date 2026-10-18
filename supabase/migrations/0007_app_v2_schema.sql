-- =====================================================================
-- DUNK v2 — schéma : restaurants, comptes clients, adresses, devis de
-- livraison, créneaux, fidélité, crédit, notes, journal d'audit
-- =====================================================================

-- ---------------------------------------------------------------- RESTAURANTS (multi-restaurant prêt)
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  address text,
  city text,
  lat double precision,
  lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.restaurants (slug, name, address, city)
select 'casablanca-ibn-hamdis', 'DUNK Casablanca', '21 rue Ibn Hamdis', 'Casablanca'
where not exists (select 1 from public.restaurants);

alter table public.restaurants enable row level security;
create policy "public read" on public.restaurants for select using (true);
create policy "admin update" on public.restaurants for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.restaurants to anon, authenticated;
grant update on public.restaurants to authenticated;

alter table public.categories add column if not exists restaurant_id uuid references public.restaurants(id);
alter table public.products add column if not exists restaurant_id uuid references public.restaurants(id);
alter table public.drivers add column if not exists restaurant_id uuid references public.restaurants(id);

-- ---------------------------------------------------------------- COMPTES CLIENTS
create table if not exists public.customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  phone_verified boolean not null default false,
  email text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_verified_phone_uniq on public.customers(phone) where phone_verified;
create index if not exists customers_phone_idx on public.customers(phone);

-- Le client ne peut pas se déclarer lui-même « téléphone vérifié » :
-- la valeur est recalculée à partir de l'authentification Supabase (OTP).
create or replace function public.customers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_phone text; v_confirmed timestamptz; v_email text;
begin
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g'), '');
  new.first_name := left(trim(coalesce(new.first_name, '')), 60);
  new.last_name := left(trim(coalesce(new.last_name, '')), 60);
  select phone, phone_confirmed_at, email into v_phone, v_confirmed, v_email from auth.users where id = new.user_id;
  new.email := coalesce(nullif(trim(new.email), ''), v_email);
  new.phone_verified := v_confirmed is not null and v_phone is not null and new.phone is not null
    and right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9) = right(regexp_replace(new.phone, '[^0-9]', '', 'g'), 9);
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  return new;
end $$;
create or replace trigger customers_guard before insert or update on public.customers
  for each row execute function public.customers_guard();

alter table public.customers enable row level security;
create policy "self read" on public.customers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "self insert" on public.customers for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "self update" on public.customers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.customers to authenticated;

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  address text not null,
  details text,
  lat double precision,
  lng double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id);
alter table public.customer_addresses enable row level security;
create policy "self all" on public.customer_addresses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.customer_addresses to authenticated;

-- ---------------------------------------------------------------- DEVIS DE LIVRAISON (distance routière)
create table if not exists public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id),
  lat double precision not null,
  lng double precision not null,
  distance_km numeric(6,2) not null,
  duration_min int,
  estimated boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 minutes'
);
alter table public.delivery_quotes enable row level security;
-- aucune politique : seuls le serveur (fonction) et place_order y accèdent

-- ---------------------------------------------------------------- COMMANDES : nouvelles colonnes
alter table public.orders add column if not exists restaurant_id uuid references public.restaurants(id);
alter table public.orders add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists scheduled_for timestamptz;
alter table public.orders add column if not exists pickup_code text;
alter table public.orders add column if not exists distance_km numeric(6,2);
alter table public.orders add column if not exists lat double precision;
alter table public.orders add column if not exists lng double precision;
alter table public.orders add column if not exists rating int check (rating between 1 and 5);
alter table public.orders add column if not exists rating_comment text;
alter table public.orders add column if not exists rated_at timestamptz;
alter table public.orders add column if not exists reward_id uuid;
alter table public.orders add column if not exists reward_discount numeric(10,2) not null default 0;
alter table public.orders add column if not exists credit_used numeric(10,2) not null default 0;
alter table public.orders add column if not exists requires_confirmation boolean not null default false;
alter table public.orders add column if not exists confirmed_at timestamptz;
alter table public.orders add column if not exists failed_reason text;
alter table public.orders add column if not exists cash_collected numeric(10,2);
alter table public.orders add column if not exists proof_url text;
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_scheduled_idx on public.orders(scheduled_for);
update public.orders set restaurant_id = (select id from public.restaurants order by created_at limit 1) where restaurant_id is null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in
  ('pending_payment','pending_confirmation','new','accepted','preparing','ready','delivering','delivered','failed','cancelled'));

-- Le client connecté voit ses propres commandes (lecture seule)
create policy "customer read own" on public.orders for select to authenticated
  using (customer_id = (select auth.uid()));
create policy "customer read own items" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())));

-- ---------------------------------------------------------------- JOURNAL D'AUDIT
create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text,
  payment_status text,
  driver_id uuid,
  actor uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id);
alter table public.order_events enable row level security;
create policy "staff read" on public.order_events for select to authenticated using ((select public.is_staff()));
grant select on public.order_events to authenticated;

create or replace function public.orders_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into order_events (order_id, status, payment_status, actor, note)
    values (new.id, new.status, new.payment_status, auth.uid(), 'Commande créée');
  elsif new.status is distinct from old.status or new.payment_status is distinct from old.payment_status
        or new.driver_id is distinct from old.driver_id then
    insert into order_events (order_id, status, payment_status, driver_id, actor, note)
    values (new.id,
            case when new.status is distinct from old.status then new.status end,
            case when new.payment_status is distinct from old.payment_status then new.payment_status end,
            case when new.driver_id is distinct from old.driver_id then new.driver_id end,
            auth.uid(),
            coalesce(case when new.status = 'cancelled' then new.cancel_reason end,
                     case when new.status = 'failed' then new.failed_reason end));
  end if;
  return new;
end $$;
create or replace trigger orders_audit after insert or update on public.orders
  for each row execute function public.orders_audit();

-- ---------------------------------------------------------------- PROMOS : nouvelles règles
alter table public.promo_codes add column if not exists valid_days_after_signup int;
alter table public.promo_codes add column if not exists requires_account boolean not null default false;
alter table public.promo_codes add column if not exists order_types text[];
alter table public.promo_codes add column if not exists payment_methods text[];
alter table public.promo_codes add column if not exists budget numeric(10,2);

-- Utilisations recalculées : une commande annulée / échouée libère le code
create or replace function public.promo_recount() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update promo_codes p set uses = (
    select count(*) from orders o where o.promo_code_id = p.id and o.status not in ('cancelled','failed','pending_payment'))
  where p.id in (new.promo_code_id, case when tg_op = 'UPDATE' then old.promo_code_id end);
  return new;
end $$;
create or replace trigger orders_promo_recount after insert or update of status, promo_code_id on public.orders
  for each row when (new.promo_code_id is not null) execute function public.promo_recount();

-- ---------------------------------------------------------------- FIDÉLITÉ : DUNK Card
create table if not exists public.loyalty_stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  consumed boolean not null default false,
  expired boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_stamps_user_idx on public.loyalty_stamps(user_id);

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'to_choose' check (status in ('to_choose','available','used','expired')),
  reward_type text check (reward_type in ('credit','category')),
  label text,
  amount numeric(10,2),
  category text,
  unlocked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  chosen_at timestamptz,
  used_order_id uuid references public.orders(id) on delete set null
);
create index if not exists loyalty_rewards_user_idx on public.loyalty_rewards(user_id);

create table if not exists public.customer_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('promo','refund')),
  amount numeric(10,2) not null,
  order_id uuid references public.orders(id) on delete set null,
  note text,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists customer_credits_user_idx on public.customer_credits(user_id);

alter table public.loyalty_stamps enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.customer_credits enable row level security;
create policy "self or staff read" on public.loyalty_stamps for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "self or staff read" on public.loyalty_rewards for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "self or staff read" on public.customer_credits for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "admin insert" on public.customer_credits for insert to authenticated
  with check ((select public.is_admin()));
grant select on public.loyalty_stamps, public.loyalty_rewards, public.customer_credits to authenticated;
grant insert on public.customer_credits to authenticated;

-- Tampon gagné quand la commande est livrée / retirée ; retiré si elle est annulée ensuite
create or replace function public.loyalty_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb;
  v_required int;
  v_min numeric;
  v_progress_days int;
  v_reward_days int;
  v_last timestamptz;
  v_count int;
begin
  if new.customer_id is null then return new; end if;
  select data->'loyalty' into cfg from settings where id = 1;
  if cfg is null or coalesce((cfg->>'enabled')::boolean, false) = false then return new; end if;
  v_required := coalesce((cfg->>'stamps_required')::int, 5);
  v_min := coalesce((cfg->>'min_order')::numeric, 75);
  v_progress_days := coalesce((cfg->>'progress_expiry_days')::int, 180);
  v_reward_days := coalesce((cfg->>'reward_expiry_days')::int, 30);

  -- commande annulée / échouée / remboursée après coup : on retire le tampon non consommé
  if new.status in ('cancelled','failed') or new.payment_status = 'refunded' then
    delete from loyalty_stamps where order_id = new.id and not consumed;
    return new;
  end if;

  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status is distinct from 'delivered')
     and new.subtotal >= v_min then
    -- progression expirée après inactivité
    select max(created_at) into v_last from loyalty_stamps
      where user_id = new.customer_id and not consumed and not expired;
    if v_last is not null and v_last < now() - make_interval(days => v_progress_days) then
      update loyalty_stamps set expired = true where user_id = new.customer_id and not consumed and not expired;
    end if;

    insert into loyalty_stamps (user_id, order_id) values (new.customer_id, new.id)
      on conflict (order_id) do nothing;

    select count(*) into v_count from loyalty_stamps
      where user_id = new.customer_id and not consumed and not expired;
    if v_count >= v_required then
      update loyalty_stamps set consumed = true
        where id in (select id from loyalty_stamps where user_id = new.customer_id and not consumed and not expired
                     order by created_at limit v_required);
      insert into loyalty_rewards (user_id, status, expires_at)
        values (new.customer_id, 'to_choose', now() + make_interval(days => v_reward_days));
    end if;
  end if;
  return new;
end $$;
create or replace trigger orders_loyalty after insert or update of status, payment_status on public.orders
  for each row execute function public.loyalty_on_order();

-- ---------------------------------------------------------------- RÔLES ÉTENDUS
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('owner','admin','manager','kitchen','marketing','support','staff'));
alter table public.staff_invites drop constraint if exists staff_invites_role_check;
alter table public.staff_invites add constraint staff_invites_role_check
  check (role in ('admin','manager','kitchen','marketing','support','staff'));

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid();
$$;
grant execute on function public.staff_role() to authenticated;

-- ---------------------------------------------------------------- PARAMÈTRES v2 (valeurs de lancement, modifiables)
update public.settings set data = data
  || jsonb_build_object('delivery', coalesce(data->'delivery', jsonb_build_object(
       'mode', 'distance',
       'max_km', 10,
       'min_order', 75,
       'free_threshold', 150,
       'tiers', jsonb_build_array(
         jsonb_build_object('up_to_km', 3, 'fee', 10),
         jsonb_build_object('up_to_km', 5, 'fee', 15),
         jsonb_build_object('up_to_km', 7, 'fee', 20),
         jsonb_build_object('up_to_km', 10, 'fee', 25)))))
  || jsonb_build_object('loyalty', coalesce(data->'loyalty', jsonb_build_object(
       'enabled', true,
       'stamps_required', 5,
       'min_order', 75,
       'progress_expiry_days', 180,
       'reward_expiry_days', 30,
       'rewards', jsonb_build_array(
         jsonb_build_object('type', 'credit', 'label', '35 DH de crédit DUNK', 'amount', 35),
         jsonb_build_object('type', 'category', 'label', 'Un accompagnement offert', 'category', 'Sides'),
         jsonb_build_object('type', 'category', 'label', 'Un dessert offert', 'category', 'Desserts')))))
  || jsonb_build_object('ordering', (data->'ordering') || jsonb_build_object(
       'asap_enabled', coalesce((data->'ordering'->>'asap_enabled')::boolean, true),
       'scheduling_enabled', coalesce((data->'ordering'->>'scheduling_enabled')::boolean, true),
       'slot_minutes', coalesce((data->'ordering'->>'slot_minutes')::int, 15),
       'schedule_days_ahead', coalesce((data->'ordering'->>'schedule_days_ahead')::int, 2),
       'disabled_slots', coalesce(data->'ordering'->'disabled_slots', '[]'::jsonb),
       'require_account', coalesce((data->'ordering'->>'require_account')::boolean, true),
       'first_cash_confirmation', coalesce((data->'ordering'->>'first_cash_confirmation')::boolean, true),
       'pickup_min_order', coalesce((data->'ordering'->>'pickup_min_order')::numeric, 0)))
where id = 1;

-- ---------------------------------------------------------------- OFFRE DE BIENVENUE
insert into public.promo_codes (code, description, type, value, min_order, max_discount, max_uses_per_customer,
                                first_order_only, valid_days_after_signup, requires_account, active)
values ('WELCOME50', 'Bienvenue : -50 % plafonné à 50 DH, 7 jours après inscription', 'percent', 50, 99, 50, 1,
        true, 7, true, true)
on conflict (code) do nothing;
