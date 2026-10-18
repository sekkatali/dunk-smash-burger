-- =====================================================================
-- DUNK SMASH BURGER — fonctions (commande sécurisée, promo, suivi,
-- portail livreur, statistiques, clients, équipe)
-- =====================================================================

-- ---------------------------------------------------------------- ÉQUIPE
-- Le tout premier compte qui se connecte devient propriétaire.
-- Ensuite, seuls les e-mails invités (Paramètres > Équipe) deviennent membres.
create or replace function public.claim_staff() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_role text;
begin
  if v_uid is null then return null; end if;
  select role into v_role from staff where user_id = v_uid;
  if v_role is not null then return v_role; end if;

  select email into v_email from auth.users where id = v_uid;
  lock table staff in share row exclusive mode;

  if not exists (select 1 from staff) then
    insert into staff(user_id, email, role) values (v_uid, v_email, 'owner');
    return 'owner';
  end if;

  select role into v_role from staff_invites where lower(email) = lower(v_email);
  if v_role is not null then
    insert into staff(user_id, email, role) values (v_uid, v_email, v_role);
    delete from staff_invites where lower(email) = lower(v_email);
    return v_role;
  end if;
  return null;
end $$;

create or replace function public.has_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff);
$$;

-- ---------------------------------------------------------------- CODES PROMO
create or replace function public._promo_discount(p_code text, p_subtotal numeric, p_delivery_fee numeric, p_phone text)
returns table(promo_id uuid, discount numeric, free_delivery boolean, error text)
language plpgsql stable security definer set search_path = public as $$
declare
  p promo_codes;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_count int;
  d numeric := 0;
begin
  select * into p from promo_codes where code = upper(trim(coalesce(p_code, '')));
  if not found or not p.active then
    return query select null::uuid, 0::numeric, false, 'Code promo invalide'; return;
  end if;
  if p.starts_at is not null and now() < p.starts_at then
    return query select null::uuid, 0::numeric, false, 'Ce code n''est pas encore actif'; return;
  end if;
  if p.ends_at is not null and now() > p.ends_at then
    return query select null::uuid, 0::numeric, false, 'Ce code a expiré'; return;
  end if;
  if p.max_uses is not null and p.uses >= p.max_uses then
    return query select null::uuid, 0::numeric, false, 'Ce code n''est plus disponible'; return;
  end if;
  if p_subtotal < p.min_order then
    return query select null::uuid, 0::numeric, false, format('Minimum de commande pour ce code : %s DH', p.min_order); return;
  end if;
  if length(v_phone) >= 9 then
    if p.first_order_only and exists (
      select 1 from orders where customer_phone = v_phone and status not in ('cancelled','pending_payment')
    ) then
      return query select null::uuid, 0::numeric, false, 'Ce code est réservé à la première commande'; return;
    end if;
    if p.max_uses_per_customer is not null then
      select count(*) into v_count from orders
        where promo_code_id = p.id and customer_phone = v_phone and status not in ('cancelled','pending_payment');
      if v_count >= p.max_uses_per_customer then
        return query select null::uuid, 0::numeric, false, 'Tu as déjà utilisé ce code'; return;
      end if;
    end if;
  end if;

  if p.type = 'percent' then
    d := round(p_subtotal * p.value / 100, 2);
    if p.max_discount is not null then d := least(d, p.max_discount); end if;
    return query select p.id, d, false, null::text;
  elsif p.type = 'fixed' then
    return query select p.id, least(p.value, p_subtotal), false, null::text;
  else
    return query select p.id, coalesce(p_delivery_fee, 0), true, null::text;
  end if;
end $$;
revoke execute on function public._promo_discount(text, numeric, numeric, text) from public, anon, authenticated;

create or replace function public.validate_promo(p_code text, p_subtotal numeric, p_delivery_fee numeric, p_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; v_type text;
begin
  select * into r from _promo_discount(p_code, p_subtotal, p_delivery_fee, p_phone);
  if r.error is not null then
    return jsonb_build_object('valid', false, 'error', r.error);
  end if;
  select type into v_type from promo_codes where id = r.promo_id;
  return jsonb_build_object('valid', true, 'code', upper(trim(p_code)), 'discount', r.discount,
                            'free_delivery', r.free_delivery, 'type', v_type);
end $$;
grant execute on function public.validate_promo(text, numeric, numeric, text) to anon, authenticated;

-- ---------------------------------------------------------------- PASSER COMMANDE
-- Tous les prix sont recalculés côté serveur : le client ne peut pas tricher.
create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  v_type text := p->>'type';
  v_pay text := p->>'payment_method';
  v_name text := trim(coalesce(p->'customer'->>'name', ''));
  v_phone text := regexp_replace(coalesce(p->'customer'->>'phone', ''), '[^0-9+]', '', 'g');
  v_item jsonb;
  v_prod products;
  v_group record;
  v_qty int;
  v_unit numeric;
  v_opts jsonb;
  v_opt_ids uuid[];
  v_cnt int;
  v_subtotal numeric := 0;
  v_fee numeric := 0;
  v_min numeric := 0;
  v_free_threshold numeric;
  v_zone jsonb;
  v_discount numeric := 0;
  v_promo_id uuid;
  v_promo_code text;
  v_free boolean;
  v_err text;
  v_items jsonb := '[]'::jsonb;
  v_order orders;
begin
  select data into s from settings where id = 1;

  if coalesce((s->'ordering'->>'accept_orders')::boolean, true) = false then
    raise exception 'Les commandes sont fermées pour le moment';
  end if;
  if v_name = '' or length(v_phone) < 9 then
    raise exception 'Merci d''indiquer ton nom et un numéro de téléphone valide';
  end if;
  if v_type is null or v_type not in ('delivery','pickup') then
    raise exception 'Type de commande invalide';
  end if;
  if v_type = 'delivery' and coalesce((s->'ordering'->>'delivery_enabled')::boolean, true) = false then
    raise exception 'La livraison n''est pas disponible pour le moment';
  end if;
  if v_type = 'pickup' and coalesce((s->'ordering'->>'pickup_enabled')::boolean, true) = false then
    raise exception 'Le retrait sur place n''est pas disponible pour le moment';
  end if;
  if v_type = 'delivery' and coalesce(trim(p->>'address'), '') = '' then
    raise exception 'Merci d''indiquer ton adresse de livraison';
  end if;
  if v_pay is null or v_pay not in ('cash','card_on_delivery','cmi') then
    raise exception 'Moyen de paiement invalide';
  end if;
  if coalesce((s->'payments'->>v_pay)::boolean, false) = false then
    raise exception 'Ce moyen de paiement n''est pas disponible';
  end if;
  if coalesce(jsonb_typeof(p->'items'), '') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Ton panier est vide';
  end if;
  if jsonb_array_length(p->'items') > 50 then
    raise exception 'Trop d''articles dans le panier';
  end if;

  for v_item in select value from jsonb_array_elements(p->'items') loop
    v_qty := greatest(1, least(50, coalesce((v_item->>'quantity')::int, 1)));

    select * into v_prod from products
      where id = (v_item->>'product_id')::uuid and active and available;
    if not found then
      raise exception 'Un produit de ton panier n''est plus disponible';
    end if;

    select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_opt_ids
      from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) x;

    -- chaque option doit appartenir à un groupe associé à CE produit
    select count(*) into v_cnt
      from options o
      join product_option_groups pog on pog.group_id = o.group_id and pog.product_id = v_prod.id
      where o.id = any(v_opt_ids) and o.available;
    if v_cnt <> coalesce(array_length(v_opt_ids, 1), 0) then
      raise exception 'Une option choisie n''est plus disponible pour %', v_prod.name;
    end if;

    -- respect du minimum / maximum de chaque groupe
    for v_group in
      select g.name, g.min_select, g.max_select,
             (select count(*) from options o where o.group_id = g.id and o.id = any(v_opt_ids)) as n
      from option_groups g
      join product_option_groups pog on pog.group_id = g.id
      where pog.product_id = v_prod.id
    loop
      if v_group.n < v_group.min_select then
        raise exception 'Choix obligatoire « % » pour %', v_group.name, v_prod.name;
      end if;
      if v_group.n > v_group.max_select then
        raise exception 'Trop de choix pour « % » (%)', v_group.name, v_prod.name;
      end if;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group', g.name, 'name', o.name, 'price', o.price)
                              order by pog.position, g.position, o.position), '[]'::jsonb),
           coalesce(sum(o.price), 0)
      into v_opts, v_unit
      from options o
      join option_groups g on g.id = o.group_id
      join product_option_groups pog on pog.group_id = g.id and pog.product_id = v_prod.id
      where o.id = any(v_opt_ids);

    v_unit := v_prod.price + v_unit;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'unit_price', v_unit, 'quantity', v_qty,
      'options', v_opts, 'note', left(nullif(trim(v_item->>'note'), ''), 200), 'total', v_unit * v_qty));
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;

  -- frais de livraison et minimum
  if v_type = 'delivery' then
    v_min := coalesce((s->'ordering'->>'min_order')::numeric, 0);
    v_fee := coalesce((s->'ordering'->>'delivery_fee')::numeric, 0);
    if jsonb_typeof(s->'zones') = 'array' and jsonb_array_length(s->'zones') > 0 then
      select z.value into v_zone from jsonb_array_elements(s->'zones') z
        where z.value->>'name' = p->>'zone' and coalesce((z.value->>'active')::boolean, true)
        limit 1;
      if v_zone is null then
        raise exception 'Merci de choisir ta zone de livraison';
      end if;
      v_fee := coalesce(nullif(v_zone->>'fee', '')::numeric, v_fee);
      v_min := coalesce(nullif(v_zone->>'min_order', '')::numeric, v_min);
    end if;
    if v_subtotal < v_min then
      raise exception 'Minimum de commande en livraison : % DH', v_min;
    end if;
    v_free_threshold := nullif(s->'ordering'->>'free_delivery_threshold', '')::numeric;
    if v_free_threshold is not null and v_free_threshold > 0 and v_subtotal >= v_free_threshold then
      v_fee := 0;
    end if;
  end if;

  -- code promo
  if coalesce(trim(p->>'promo_code'), '') <> '' then
    select r.promo_id, r.discount, r.free_delivery, r.error
      into v_promo_id, v_discount, v_free, v_err
      from _promo_discount(p->>'promo_code', v_subtotal, v_fee, v_phone) r;
    if v_err is not null then raise exception '%', v_err; end if;
    v_promo_code := upper(trim(p->>'promo_code'));
    update promo_codes set uses = uses + 1 where id = v_promo_id;
  end if;

  insert into orders (
    status, type, customer_name, customer_phone, customer_email, address, address_details, zone, notes,
    payment_method, subtotal, delivery_fee, discount, total, promo_code, promo_code_id,
    source, utm_source, utm_medium, utm_campaign, session_id
  ) values (
    case when v_pay = 'cmi' then 'pending_payment' else 'new' end,
    v_type, left(v_name, 100), v_phone, left(nullif(trim(p->'customer'->>'email'), ''), 200),
    case when v_type = 'delivery' then left(trim(p->>'address'), 300) end,
    case when v_type = 'delivery' then left(nullif(trim(p->>'address_details'), ''), 300) end,
    case when v_type = 'delivery' then left(p->>'zone', 100) end,
    left(nullif(trim(p->>'notes'), ''), 500),
    v_pay, v_subtotal, v_fee, v_discount, greatest(v_subtotal + v_fee - v_discount, 0),
    v_promo_code, v_promo_id,
    left(p->>'source', 200), left(p->'utm'->>'source', 100), left(p->'utm'->>'medium', 100),
    left(p->'utm'->>'campaign', 150), left(p->>'session_id', 100)
  ) returning * into v_order;

  insert into order_items (order_id, product_id, product_name, unit_price, quantity, options, note, total)
  select v_order.id, (i->>'product_id')::uuid, i->>'name', (i->>'unit_price')::numeric,
         (i->>'quantity')::int, i->'options', i->>'note', (i->>'total')::numeric
  from jsonb_array_elements(v_items) i;

  if coalesce(p->>'session_id', '') <> '' then
    insert into analytics_events (session_id, event, value, utm_source, utm_medium, utm_campaign)
    values (left(p->>'session_id', 100), 'purchase', v_order.total,
            left(p->'utm'->>'source', 100), left(p->'utm'->>'medium', 100), left(p->'utm'->>'campaign', 150));
  end if;

  return jsonb_build_object('id', v_order.id, 'number', v_order.number, 'token', v_order.token,
                            'total', v_order.total, 'payment_method', v_pay, 'status', v_order.status);
end $$;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- SUIVI CLIENT
create or replace function public.get_order(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'type', o.type, 'created_at', o.created_at,
    'customer_name', o.customer_name, 'address', o.address, 'zone', o.zone,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'discount', o.discount, 'total', o.total,
    'promo_code', o.promo_code,
    'accepted_at', o.accepted_at, 'ready_at', o.ready_at, 'delivering_at', o.delivering_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'driver', case when d.id is not null and o.status = 'delivering'
                   then jsonb_build_object('name', d.name, 'phone', d.phone) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                       'options', i.options, 'total', i.total, 'note', i.note)) from order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from orders o left join drivers d on d.id = o.driver_id
  where o.token = p_token;
$$;
grant execute on function public.get_order(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- PORTAIL LIVREUR
create or replace function public.driver_portal(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d drivers; v_tz text := 'Africa/Casablanca';
begin
  select * into d from drivers where access_token = p_token and active;
  if not found then return null; end if;
  return jsonb_build_object(
    'driver', jsonb_build_object('id', d.id, 'name', d.name, 'status', d.status),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'number', o.number, 'status', o.status, 'customer_name', o.customer_name,
        'customer_phone', o.customer_phone, 'address', o.address, 'address_details', o.address_details,
        'zone', o.zone, 'notes', o.notes, 'total', o.total, 'payment_method', o.payment_method,
        'payment_status', o.payment_status, 'created_at', o.created_at,
        'items', (select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity)) from order_items i where i.order_id = o.id)
      ) order by o.created_at)
      from orders o where o.driver_id = d.id and o.status in ('accepted','preparing','ready','delivering')
    ), '[]'::jsonb),
    'today', jsonb_build_object(
      'delivered', (select count(*) from orders o where o.driver_id = d.id and o.status = 'delivered'
                     and (o.delivered_at at time zone v_tz)::date = (now() at time zone v_tz)::date),
      'cash_to_settle', (select coalesce(sum(total), 0) from orders o where o.driver_id = d.id and o.status = 'delivered'
                     and o.payment_method = 'cash' and not o.cash_settled)
    )
  );
end $$;
grant execute on function public.driver_portal(uuid) to anon, authenticated;

create or replace function public.driver_set_status(p_token uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('available','busy','offline') then return false; end if;
  update drivers set status = p_status where access_token = p_token and active;
  return found;
end $$;
grant execute on function public.driver_set_status(uuid, text) to anon, authenticated;

create or replace function public.driver_update_order(p_token uuid, p_order uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare d drivers;
begin
  if p_status not in ('delivering','delivered') then return false; end if;
  select * into d from drivers where access_token = p_token and active;
  if not found then return false; end if;
  update orders set
    status = p_status,
    payment_status = case when p_status = 'delivered' and payment_method in ('cash','card_on_delivery')
                          then 'paid' else payment_status end
  where id = p_order and driver_id = d.id and status in ('accepted','preparing','ready','delivering');
  if not found then return false; end if;
  update drivers set status = case when p_status = 'delivering' then 'busy'
    when exists (select 1 from orders where driver_id = d.id and status = 'delivering') then 'busy'
    else 'available' end
  where id = d.id;
  return true;
end $$;
grant execute on function public.driver_update_order(uuid, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------- STATISTIQUES (équipe)
create or replace function public.admin_stats(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tz text := 'Africa/Casablanca';
begin
  if not is_staff() then raise exception 'Accès refusé'; end if;

  with o as (
    select * from orders where created_at >= p_from and created_at < p_to and status <> 'pending_payment'
  ), ok as (
    select * from o where status <> 'cancelled'
  ), ev as (
    select * from analytics_events where created_at >= p_from and created_at < p_to
  ), sess as (
    select distinct on (session_id) session_id,
      coalesce(nullif(utm_source, ''),
               nullif(substring(referrer from '^https?://(?:www\.|m\.|l\.|lm\.)?([^/:?]+)'), ''),
               'direct') as src,
      coalesce(device, 'inconnu') as device
    from ev where event = 'page_view'
    order by session_id, created_at
  )
  select jsonb_build_object(
    'orders', (select count(*) from ok),
    'revenue', (select coalesce(sum(total), 0) from ok),
    'aov', (select coalesce(round(avg(total), 2), 0) from ok),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'discounts', (select coalesce(sum(discount), 0) from ok),
    'delivery_fees', (select coalesce(sum(delivery_fee), 0) from ok),
    'visitors', (select count(*) from sess),
    'page_views', (select count(*) from ev where event = 'page_view'),
    'avg_prep_min', (select coalesce(round(avg(extract(epoch from (ready_at - created_at)) / 60)::numeric, 1), 0)
                     from ok where ready_at is not null),
    'avg_delivery_min', (select coalesce(round(avg(extract(epoch from (delivered_at - created_at)) / 60)::numeric, 1), 0)
                     from ok where delivered_at is not null and type = 'delivery'),
    'funnel', jsonb_build_object(
      'visit', (select count(*) from sess),
      'product', (select count(distinct session_id) from ev where event = 'view_product'),
      'cart', (select count(distinct session_id) from ev where event = 'add_to_cart'),
      'checkout', (select count(distinct session_id) from ev where event = 'begin_checkout'),
      'purchase', (select count(distinct session_id) from ev where event = 'purchase')
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day::date,
        'revenue', coalesce((select sum(total) from ok where (ok.created_at at time zone v_tz)::date = d.day::date), 0),
        'orders', (select count(*) from ok where (ok.created_at at time zone v_tz)::date = d.day::date),
        'visitors', (select count(distinct session_id) from ev where ev.event = 'page_view'
                     and (ev.created_at at time zone v_tz)::date = d.day::date)
      ) order by d.day), '[]'::jsonb)
      from generate_series((p_from at time zone v_tz)::date,
                           ((p_to - interval '1 second') at time zone v_tz)::date,
                           interval '1 day') as d(day)
    ),
    'top_products', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select oi.product_name as name, sum(oi.quantity)::int as qty, sum(oi.total) as revenue
        from order_items oi join ok on ok.id = oi.order_id
        group by oi.product_name order by qty desc, revenue desc limit 10
      ) t
    ),
    'top_options', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select opt->>'name' as name, opt->>'group' as "group", sum(oi.quantity)::int as qty
        from order_items oi join ok on ok.id = oi.order_id, jsonb_array_elements(oi.options) opt
        group by 1, 2 order by qty desc limit 10
      ) t
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h.h, 'orders',
        (select count(*) from ok where extract(hour from ok.created_at at time zone v_tz) = h.h)) order by h.h), '[]'::jsonb)
      from generate_series(0, 23) h(h)
    ),
    'weekdays', (
      select coalesce(jsonb_agg(jsonb_build_object('day', w.d, 'orders',
        (select count(*) from ok where extract(isodow from ok.created_at at time zone v_tz) = w.d),
        'revenue', (select coalesce(sum(total), 0) from ok where extract(isodow from ok.created_at at time zone v_tz) = w.d)
      ) order by w.d), '[]'::jsonb)
      from generate_series(1, 7) w(d)
    ),
    'sources', (
      select coalesce(jsonb_agg(t order by t.visitors desc), '[]'::jsonb) from (
        select s.src as source, count(distinct s.session_id)::int as visitors,
               count(distinct ok.id)::int as orders, coalesce(sum(ok.total), 0) as revenue
        from sess s left join ok on ok.session_id = s.session_id
        group by s.src
      ) t
    ),
    'devices', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select device, count(*)::int as visitors from sess group by device order by 2 desc
      ) t
    ),
    'payment_methods', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select payment_method as method, count(*)::int as orders, sum(total) as revenue from ok group by 1 order by 2 desc
      ) t
    ),
    'types', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select type, count(*)::int as orders, sum(total) as revenue from ok group by 1
      ) t
    ),
    'zones', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select coalesce(zone, '—') as zone, count(*)::int as orders, sum(total) as revenue
        from ok where type = 'delivery' group by 1 order by 2 desc limit 10
      ) t
    ),
    'customers', jsonb_build_object(
      'total', (select count(distinct customer_phone) from ok),
      'new', (select count(distinct customer_phone) from ok where not exists (
                select 1 from orders o2 where o2.customer_phone = ok.customer_phone and o2.created_at < p_from
                and o2.status not in ('cancelled','pending_payment'))),
      'returning', (select count(distinct customer_phone) from ok where exists (
                select 1 from orders o2 where o2.customer_phone = ok.customer_phone and o2.created_at < p_from
                and o2.status not in ('cancelled','pending_payment')))
    ),
    'promos', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select promo_code as code, count(*)::int as uses, sum(discount) as discount, sum(total) as revenue
        from ok where promo_code is not null group by 1 order by 2 desc
      ) t
    )
  ) into r;
  return r;
end $$;
revoke execute on function public.admin_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_stats(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- CLIENTS (équipe)
create or replace function public.admin_customers() returns table (
  phone text, name text, email text, orders int, total_spent numeric,
  first_order timestamptz, last_order timestamptz, last_address text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Accès refusé'; end if;
  return query
  select o.customer_phone,
         (array_agg(o.customer_name order by o.created_at desc))[1],
         (array_agg(o.customer_email order by o.created_at desc) filter (where o.customer_email is not null))[1],
         count(*)::int,
         sum(o.total),
         min(o.created_at),
         max(o.created_at),
         (array_agg(o.address order by o.created_at desc) filter (where o.address is not null))[1]
  from orders o
  where o.status not in ('cancelled','pending_payment')
  group by o.customer_phone
  order by max(o.created_at) desc;
end $$;
revoke execute on function public.admin_customers() from public, anon;
grant execute on function public.admin_customers() to authenticated;

-- ---------------------------------------------------------------- ÉQUIPE (liste avec invitations)
revoke execute on function public.claim_staff() from public, anon;
grant execute on function public.claim_staff() to authenticated;
grant execute on function public.has_owner() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_owner() to authenticated;
-- =====================================================================
-- DUNK SMASH BURGER — menu de démonstration (modifiable depuis /admin/produits)
-- =====================================================================
do $$
declare
  c_burgers uuid; c_chicken uuid; c_sides uuid; c_drinks uuid; c_desserts uuid;
  p_rookie uuid; p_dunk uuid; p_slam uuid; p_buzzer uuid; p_alley uuid; p_crossover uuid;
  p_fries uuid; p_cheesefries uuid; p_tenders uuid; p_rings uuid;
  p_coca uuid; p_fanta uuid; p_sprite uuid; p_water uuid;
  p_cookie uuid; p_shake uuid;
  g_steaks uuid; g_extras uuid; g_sauces uuid; g_remove uuid; g_menu uuid; g_menu_drink uuid;
  g_fries_sauce uuid; g_shake uuid; g_tenders_sauce uuid;
begin
  if exists (select 1 from categories) then return; end if;

  insert into categories (name, description, position) values ('Smash Burgers', 'Steaks smashés minute sur la plancha, bien croustillants', 1) returning id into c_burgers;
  insert into categories (name, description, position) values ('Chicken', 'Poulet crispy mariné 24h', 2) returning id into c_chicken;
  insert into categories (name, description, position) values ('Sides', 'Pour accompagner', 3) returning id into c_sides;
  insert into categories (name, description, position) values ('Boissons', null, 4) returning id into c_drinks;
  insert into categories (name, description, position) values ('Desserts', null, 5) returning id into c_desserts;

  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'The Rookie', 'Steak smashé, cheddar fondu, oignons, cornichons, sauce Dunk', 45, null, false, 1) returning id into p_rookie;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'The Dunk', 'Double steak smashé, double cheddar, oignons caramélisés, cornichons, sauce Dunk', 62, 'Best-seller', true, 2) returning id into p_dunk;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'Slam Dunk', 'Triple steak smashé, triple cheddar, bacon de bœuf, oignons croustillants, sauce BBQ fumée', 79, 'XXL', true, 3) returning id into p_slam;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_burgers, 'Buzzer Beater', 'Double steak smashé, cheddar, jalapeños, sauce piquante maison, oignons rouges', 65, 'Épicé 🌶️', false, 4) returning id into p_buzzer;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_chicken, 'Alley-Oop', 'Poulet crispy, cheddar, salade, pickles, mayo épicée', 55, null, true, 1) returning id into p_alley;
  insert into products (category_id, name, description, price, badge, featured, position) values
    (c_chicken, 'Crossover', 'Poulet crispy + steak smashé, cheddar, sauce Dunk. Le meilleur des deux mondes', 72, 'Nouveau', false, 2) returning id into p_crossover;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Frites maison', 'Frites fraîches double cuisson', 18, 1) returning id into p_fries;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Cheese Fries', 'Frites nappées de cheddar fondu et oignons croustillants', 29, 2) returning id into p_cheesefries;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Tenders x5', '5 tenders de poulet crispy', 39, 3) returning id into p_tenders;
  insert into products (category_id, name, description, price, position) values
    (c_sides, 'Onion Rings x8', 'Rondelles d''oignon panées', 24, 4) returning id into p_rings;
  insert into products (category_id, name, price, position) values (c_drinks, 'Coca-Cola 33cl', 12, 1) returning id into p_coca;
  insert into products (category_id, name, price, position) values (c_drinks, 'Fanta 33cl', 12, 2) returning id into p_fanta;
  insert into products (category_id, name, price, position) values (c_drinks, 'Sprite 33cl', 12, 3) returning id into p_sprite;
  insert into products (category_id, name, price, position) values (c_drinks, 'Eau minérale 50cl', 8, 4) returning id into p_water;
  insert into products (category_id, name, description, price, position) values
    (c_desserts, 'Cookie géant', 'Cookie moelleux aux pépites de chocolat', 18, 1) returning id into p_cookie;
  insert into products (category_id, name, description, price, position) values
    (c_desserts, 'Milkshake', 'Milkshake épais, chantilly', 32, 2) returning id into p_shake;

  -- Groupes d'options
  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Nombre de steaks', 'Steaks Rookie/Buzzer', 1, 1, 1) returning id into g_steaks;
  insert into options (group_id, name, price, position) values
    (g_steaks, 'Simple', 0, 1), (g_steaks, 'Double', 15, 2), (g_steaks, 'Triple', 28, 3);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Suppléments', 'Suppléments burgers', 0, 6, 2) returning id into g_extras;
  insert into options (group_id, name, price, position) values
    (g_extras, 'Cheddar', 5, 1), (g_extras, 'Steak smashé', 15, 2), (g_extras, 'Bacon de bœuf', 10, 3),
    (g_extras, 'Oignons caramélisés', 5, 4), (g_extras, 'Jalapeños', 5, 5), (g_extras, 'Œuf', 5, 6);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Change ta sauce', 'Sauces burgers', 0, 2, 3) returning id into g_sauces;
  insert into options (group_id, name, price, position) values
    (g_sauces, 'Sauce Dunk', 0, 1), (g_sauces, 'BBQ fumée', 0, 2), (g_sauces, 'Mayo épicée', 0, 3),
    (g_sauces, 'Algérienne', 0, 4), (g_sauces, 'Ketchup', 0, 5);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Retirer', 'Retirer ingrédients', 0, 4, 4) returning id into g_remove;
  insert into options (group_id, name, price, position) values
    (g_remove, 'Sans oignons', 0, 1), (g_remove, 'Sans cornichons', 0, 2), (g_remove, 'Sans sauce', 0, 3), (g_remove, 'Sans fromage', 0, 4);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Fais-en un menu', 'Formule menu', 0, 1, 5) returning id into g_menu;
  insert into options (group_id, name, price, position) values
    (g_menu, 'Menu : frites + boisson', 25, 1), (g_menu, 'Menu XL : cheese fries + boisson', 38, 2);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Boisson du menu', 'Boisson formule', 0, 1, 6) returning id into g_menu_drink;
  insert into options (group_id, name, price, position) values
    (g_menu_drink, 'Coca-Cola', 0, 1), (g_menu_drink, 'Coca-Cola Zéro', 0, 2), (g_menu_drink, 'Fanta', 0, 3),
    (g_menu_drink, 'Sprite', 0, 4), (g_menu_drink, 'Eau minérale', 0, 5);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Sauce pour tes frites', 'Sauce frites', 0, 2, 7) returning id into g_fries_sauce;
  insert into options (group_id, name, price, position) values
    (g_fries_sauce, 'Ketchup', 0, 1), (g_fries_sauce, 'Mayo', 0, 2), (g_fries_sauce, 'Sauce Dunk', 3, 3), (g_fries_sauce, 'Cheddar fondu', 7, 4);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Sauce tenders', 'Sauce tenders', 1, 2, 8) returning id into g_tenders_sauce;
  insert into options (group_id, name, price, position) values
    (g_tenders_sauce, 'BBQ fumée', 0, 1), (g_tenders_sauce, 'Honey mustard', 0, 2), (g_tenders_sauce, 'Mayo épicée', 0, 3);

  insert into option_groups (name, internal_name, min_select, max_select, position) values
    ('Parfum', 'Parfum milkshake', 1, 1, 9) returning id into g_shake;
  insert into options (group_id, name, price, position) values
    (g_shake, 'Vanille', 0, 1), (g_shake, 'Chocolat', 0, 2), (g_shake, 'Fraise', 0, 3), (g_shake, 'Oreo', 5, 4);

  -- Associations : chaque groupe n'est relié qu'aux produits concernés
  insert into product_option_groups (product_id, group_id, position) values
    (p_rookie, g_steaks, 1),
    (p_rookie, g_extras, 2), (p_dunk, g_extras, 2), (p_slam, g_extras, 2), (p_buzzer, g_extras, 2), (p_alley, g_extras, 2), (p_crossover, g_extras, 2),
    (p_rookie, g_sauces, 3), (p_dunk, g_sauces, 3), (p_slam, g_sauces, 3), (p_buzzer, g_sauces, 3), (p_alley, g_sauces, 3), (p_crossover, g_sauces, 3),
    (p_rookie, g_remove, 4), (p_dunk, g_remove, 4), (p_slam, g_remove, 4), (p_buzzer, g_remove, 4), (p_alley, g_remove, 4), (p_crossover, g_remove, 4),
    (p_rookie, g_menu, 5), (p_dunk, g_menu, 5), (p_slam, g_menu, 5), (p_buzzer, g_menu, 5), (p_alley, g_menu, 5), (p_crossover, g_menu, 5),
    (p_rookie, g_menu_drink, 6), (p_dunk, g_menu_drink, 6), (p_slam, g_menu_drink, 6), (p_buzzer, g_menu_drink, 6), (p_alley, g_menu_drink, 6), (p_crossover, g_menu_drink, 6),
    (p_fries, g_fries_sauce, 1), (p_cheesefries, g_fries_sauce, 1),
    (p_tenders, g_tenders_sauce, 1),
    (p_shake, g_shake, 1);

  -- Code promo de bienvenue
  insert into promo_codes (code, description, type, value, min_order, first_order_only, max_uses_per_customer)
  values ('DUNK15', '-15% sur la première commande', 'percent', 15, 60, true, 1);
end $$;
