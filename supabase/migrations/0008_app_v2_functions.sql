-- =====================================================================
-- DUNK v2 — logique serveur : horaires, livraison au km, promos v2,
-- calcul de commande, commande, fidélité, notes, livreur
-- Tous les montants sont calculés et vérifiés ici, jamais côté client.
-- =====================================================================

-- ---------------------------------------------------------------- HORAIRES
create or replace function public.is_open_at(p_ts timestamptz) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb;
  v_local timestamp := p_ts at time zone 'Africa/Casablanca';
  v_dow int := extract(dow from v_local)::int;
  v_min int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  d jsonb;
  o int; c int;
begin
  select data into s from settings where id = 1;
  if jsonb_typeof(s->'hours') <> 'array' or jsonb_array_length(s->'hours') = 0 then return true; end if;
  -- jour même
  select h.value into d from jsonb_array_elements(s->'hours') h where (h.value->>'day')::int = v_dow limit 1;
  if d is not null and not coalesce((d->>'closed')::boolean, false) then
    o := split_part(d->>'open', ':', 1)::int * 60 + split_part(d->>'open', ':', 2)::int;
    c := split_part(d->>'close', ':', 1)::int * 60 + split_part(d->>'close', ':', 2)::int;
    if c > o and v_min >= o and v_min < c then return true; end if;
    if c <= o and v_min >= o then return true; end if;
  end if;
  -- service de la veille qui déborde après minuit
  d := null;
  select h.value into d from jsonb_array_elements(s->'hours') h where (h.value->>'day')::int = (v_dow + 6) % 7 limit 1;
  if d is not null and not coalesce((d->>'closed')::boolean, false) then
    o := split_part(d->>'open', ':', 1)::int * 60 + split_part(d->>'open', ':', 2)::int;
    c := split_part(d->>'close', ':', 1)::int * 60 + split_part(d->>'close', ':', 2)::int;
    if c <= o and v_min < c then return true; end if;
  end if;
  return false;
end $$;
grant execute on function public.is_open_at(timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------- FRAIS SELON LA DISTANCE
create or replace function public.delivery_fee_for_km(p_km numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; t jsonb;
begin
  select data->'delivery' into cfg from settings where id = 1;
  if p_km is null or p_km > coalesce((cfg->>'max_km')::numeric, 10) then return null; end if;
  for t in select value from jsonb_array_elements(cfg->'tiers') order by (value->>'up_to_km')::numeric loop
    if p_km <= (t->>'up_to_km')::numeric then return (t->>'fee')::numeric; end if;
  end loop;
  return null;
end $$;
grant execute on function public.delivery_fee_for_km(numeric) to anon, authenticated;

-- ---------------------------------------------------------------- PROMOS v2
create or replace function public._promo_eval(p_code text, p_subtotal numeric, p_fee numeric, p_phone text,
                                              p_customer uuid, p_type text, p_pay text)
returns table(promo_id uuid, discount numeric, free_delivery boolean, error text)
language plpgsql stable security definer set search_path = public as $$
declare
  p promo_codes;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_count int;
  v_signup timestamptz;
  v_spent numeric;
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
  if (p.requires_account or p.valid_days_after_signup is not null) and p_customer is null then
    return query select null::uuid, 0::numeric, false, 'Connecte-toi pour utiliser ce code'; return;
  end if;
  if p.valid_days_after_signup is not null then
    select created_at into v_signup from auth.users where id = p_customer;
    if v_signup is null or now() > v_signup + make_interval(days => p.valid_days_after_signup) then
      return query select null::uuid, 0::numeric, false,
        format('Ce code était valable %s jours après ton inscription', p.valid_days_after_signup); return;
    end if;
  end if;
  if p.order_types is not null and p_type is not null and not (p_type = any(p.order_types)) then
    return query select null::uuid, 0::numeric, false, 'Ce code ne s''applique pas à ce mode de commande'; return;
  end if;
  if p.payment_methods is not null and p_pay is not null and not (p_pay = any(p.payment_methods)) then
    return query select null::uuid, 0::numeric, false, 'Ce code ne s''applique pas à ce moyen de paiement'; return;
  end if;
  if p_subtotal < p.min_order then
    return query select null::uuid, 0::numeric, false, format('Minimum de %s DH de produits pour ce code', p.min_order); return;
  end if;
  if p.first_order_only and exists (
    select 1 from orders o where o.status not in ('cancelled','failed','pending_payment')
      and ((p_customer is not null and o.customer_id = p_customer) or (length(v_phone) >= 9 and o.customer_phone = v_phone))
  ) then
    return query select null::uuid, 0::numeric, false, 'Ce code est réservé à la première commande'; return;
  end if;
  if p.max_uses_per_customer is not null then
    select count(*) into v_count from orders o
      where o.promo_code_id = p.id and o.status not in ('cancelled','failed','pending_payment')
        and ((p_customer is not null and o.customer_id = p_customer) or (length(v_phone) >= 9 and o.customer_phone = v_phone));
    if v_count >= p.max_uses_per_customer then
      return query select null::uuid, 0::numeric, false, 'Tu as déjà utilisé ce code'; return;
    end if;
  end if;

  if p.type = 'percent' then
    d := round(p_subtotal * p.value / 100, 2);
    if p.max_discount is not null then d := least(d, p.max_discount); end if;
  elsif p.type = 'fixed' then
    d := least(p.value, p_subtotal);
  else
    d := coalesce(p_fee, 0);
  end if;

  if p.budget is not null then
    select coalesce(sum(o.discount), 0) into v_spent from orders o
      where o.promo_code_id = p.id and o.status not in ('cancelled','failed','pending_payment');
    if v_spent + d > p.budget then
      return query select null::uuid, 0::numeric, false, 'Le budget de cette offre est épuisé'; return;
    end if;
  end if;
  return query select p.id, d, p.type = 'free_delivery', null::text;
end $$;
revoke execute on function public._promo_eval(text, numeric, numeric, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- CALCUL COMPLET D'UNE COMMANDE (sans écriture)
create or replace function public.compute_order(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb;
  dl jsonb;
  v_uid uuid := auth.uid();
  v_cust customers;
  v_type text := p->>'type';
  v_pay text := p->>'payment_method';
  v_name text;
  v_phone text;
  v_email text;
  v_item jsonb;
  v_prod products;
  v_cat text;
  v_group record;
  v_qty int;
  v_unit numeric;
  v_opts jsonb;
  v_opt_ids uuid[];
  v_cnt int;
  v_items jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_fee numeric := 0;
  v_fee_before_free numeric := 0;
  v_min numeric := 0;
  v_free numeric;
  v_quote delivery_quotes;
  v_zone jsonb;
  v_discount numeric := 0;
  v_promo_id uuid;
  v_promo_code text;
  v_is_free_delivery boolean := false;
  v_err text;
  v_reward loyalty_rewards;
  v_reward_discount numeric := 0;
  v_credit_balance numeric := 0;
  v_credit_used numeric := 0;
  v_sched timestamptz;
  v_lead int;
  v_confirm boolean := false;
  v_total numeric;
  v_restaurant uuid;
begin
  select data into s from settings where id = 1;
  dl := coalesce(s->'delivery', '{}'::jsonb);
  select id into v_restaurant from restaurants where active order by created_at limit 1;

  if coalesce((s->'ordering'->>'accept_orders')::boolean, true) = false then
    raise exception 'Les commandes sont fermées pour le moment';
  end if;

  -- ---- client
  if v_uid is not null then
    select * into v_cust from customers where user_id = v_uid;
  end if;
  if coalesce((s->'ordering'->>'require_account')::boolean, false) and v_uid is null then
    raise exception 'Connecte-toi pour passer commande';
  end if;
  if v_cust.user_id is not null then
    v_name := trim(coalesce(v_cust.first_name, '') || ' ' || coalesce(v_cust.last_name, ''));
    v_phone := v_cust.phone;
    v_email := v_cust.email;
  end if;
  v_name := coalesce(nullif(v_name, ''), trim(coalesce(p->'customer'->>'name', '')));
  v_phone := coalesce(nullif(v_phone, ''), regexp_replace(coalesce(p->'customer'->>'phone', ''), '[^0-9+]', '', 'g'));
  v_email := coalesce(v_email, nullif(trim(p->'customer'->>'email'), ''));
  if v_name = '' or length(coalesce(v_phone, '')) < 9 then
    raise exception 'Complète ton nom et ton numéro de téléphone';
  end if;

  -- ---- mode et paiement
  if v_type is null or v_type not in ('delivery','pickup') then raise exception 'Mode de commande invalide'; end if;
  if v_type = 'delivery' and coalesce((s->'ordering'->>'delivery_enabled')::boolean, true) = false then
    raise exception 'La livraison est en pause pour le moment';
  end if;
  if v_type = 'pickup' and coalesce((s->'ordering'->>'pickup_enabled')::boolean, true) = false then
    raise exception 'Le retrait sur place est en pause pour le moment';
  end if;
  if v_pay is null or v_pay not in ('cash','card_on_delivery','cmi') then raise exception 'Moyen de paiement invalide'; end if;
  if coalesce((s->'payments'->>v_pay)::boolean, false) = false then raise exception 'Ce moyen de paiement n''est pas disponible'; end if;

  -- ---- horaire : dès que possible ou créneau programmé
  v_lead := case when v_type = 'delivery' then coalesce((s->'ordering'->>'delivery_time_min')::int, 40)
                 else coalesce((s->'ordering'->>'prep_time_min')::int, 20) end;
  if coalesce(p->>'scheduled_for', '') = '' then
    if coalesce((s->'ordering'->>'asap_enabled')::boolean, true) = false then
      raise exception 'Les commandes « dès que possible » sont en pause : choisis un créneau';
    end if;
    if not is_open_at(now()) then raise exception 'Nous sommes fermés : choisis un créneau pendant nos horaires'; end if;
  else
    if coalesce((s->'ordering'->>'scheduling_enabled')::boolean, true) = false then
      raise exception 'Les commandes programmées ne sont pas disponibles';
    end if;
    v_sched := (p->>'scheduled_for')::timestamptz;
    if v_sched < now() + make_interval(mins => v_lead) - interval '2 minutes' then
      raise exception 'Ce créneau est trop proche, choisis-en un plus tard';
    end if;
    if v_sched > now() + make_interval(days => coalesce((s->'ordering'->>'schedule_days_ahead')::int, 2)) then
      raise exception 'Ce créneau est trop loin';
    end if;
    if extract(minute from v_sched at time zone 'Africa/Casablanca')::int % coalesce((s->'ordering'->>'slot_minutes')::int, 15) <> 0 then
      raise exception 'Créneau invalide';
    end if;
    if not is_open_at(v_sched) then raise exception 'Ce créneau est en dehors de nos horaires'; end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(s->'ordering'->'disabled_slots', '[]'::jsonb)) x
               where x::timestamptz = v_sched) then
      raise exception 'Ce créneau n''est plus disponible';
    end if;
  end if;

  -- ---- articles (prix recalculés)
  if coalesce(jsonb_typeof(p->'items'), '') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Ton panier est vide'; end if;
  if jsonb_array_length(p->'items') > 50 then raise exception 'Trop d''articles dans le panier'; end if;

  for v_item in select value from jsonb_array_elements(p->'items') loop
    v_qty := greatest(1, least(50, coalesce((v_item->>'quantity')::int, 1)));
    select * into v_prod from products where id = (v_item->>'product_id')::uuid and active and available;
    if not found then raise exception 'Un produit de ton panier n''est plus disponible'; end if;
    select name into v_cat from categories where id = v_prod.category_id;

    select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_opt_ids
      from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) x;
    select count(*) into v_cnt from options o
      join product_option_groups pog on pog.group_id = o.group_id and pog.product_id = v_prod.id
      where o.id = any(v_opt_ids) and o.available;
    if v_cnt <> coalesce(array_length(v_opt_ids, 1), 0) then
      raise exception 'Une option choisie n''est plus disponible pour %', v_prod.name;
    end if;
    for v_group in
      select g.name, g.min_select, g.max_select,
             (select count(*) from options o where o.group_id = g.id and o.id = any(v_opt_ids)) as n
      from option_groups g join product_option_groups pog on pog.group_id = g.id where pog.product_id = v_prod.id
    loop
      if v_group.n < v_group.min_select then raise exception 'Choix obligatoire « % » pour %', v_group.name, v_prod.name; end if;
      if v_group.n > v_group.max_select then raise exception 'Trop de choix pour « % » (%)', v_group.name, v_prod.name; end if;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group', g.name, 'name', o.name, 'price', o.price)
                              order by pog.position, g.position, o.position), '[]'::jsonb),
           coalesce(sum(o.price), 0)
      into v_opts, v_unit
      from options o join option_groups g on g.id = o.group_id
      join product_option_groups pog on pog.group_id = g.id and pog.product_id = v_prod.id
      where o.id = any(v_opt_ids);
    v_unit := v_prod.price + v_unit;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'category', v_cat, 'base_price', v_prod.price,
      'unit_price', v_unit, 'quantity', v_qty, 'options', v_opts,
      'note', left(nullif(trim(v_item->>'note'), ''), 200), 'total', v_unit * v_qty));
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;

  -- ---- livraison : distance routière (devis serveur) ou zones
  if v_type = 'delivery' then
    if coalesce(trim(p->>'address'), '') = '' then raise exception 'Indique ton adresse de livraison'; end if;
    if coalesce(dl->>'mode', 'distance') = 'distance' then
      select * into v_quote from delivery_quotes where id = nullif(p->>'quote_id', '')::uuid and expires_at > now();
      if v_quote.id is null then raise exception 'Place ton adresse sur la carte pour calculer la livraison'; end if;
      v_fee := delivery_fee_for_km(v_quote.distance_km);
      if v_fee is null then
        raise exception 'Désolé, ton adresse est hors de notre zone de livraison (% km max)', coalesce(dl->>'max_km', '10');
      end if;
      v_min := coalesce((dl->>'min_order')::numeric, 0);
      v_free := nullif(dl->>'free_threshold', '')::numeric;
    else
      v_min := coalesce((s->'ordering'->>'min_order')::numeric, 0);
      v_fee := coalesce((s->'ordering'->>'delivery_fee')::numeric, 0);
      if jsonb_typeof(s->'zones') = 'array' and jsonb_array_length(s->'zones') > 0 then
        select z.value into v_zone from jsonb_array_elements(s->'zones') z
          where z.value->>'name' = p->>'zone' and coalesce((z.value->>'active')::boolean, true) limit 1;
        if v_zone is null then raise exception 'Choisis ta zone de livraison'; end if;
        v_fee := coalesce(nullif(v_zone->>'fee', '')::numeric, v_fee);
        v_min := coalesce(nullif(v_zone->>'min_order', '')::numeric, v_min);
      end if;
      v_free := nullif(s->'ordering'->>'free_delivery_threshold', '')::numeric;
    end if;
    if v_subtotal < v_min then raise exception 'Minimum de % DH de produits pour la livraison', v_min; end if;
  else
    v_min := coalesce((s->'ordering'->>'pickup_min_order')::numeric, 0);
    if v_subtotal < v_min then raise exception 'Minimum de % DH pour le retrait', v_min; end if;
  end if;
  v_fee_before_free := v_fee;

  -- ---- un seul avantage : code promo OU récompense fidélité
  if coalesce(trim(p->>'promo_code'), '') <> '' and coalesce(p->>'reward_id', '') <> '' then
    raise exception 'Un seul avantage par commande : code promo ou récompense fidélité';
  end if;

  if coalesce(trim(p->>'promo_code'), '') <> '' then
    select r.promo_id, r.discount, r.free_delivery, r.error into v_promo_id, v_discount, v_is_free_delivery, v_err
      from _promo_eval(p->>'promo_code', v_subtotal, v_fee, v_phone, v_uid, v_type, v_pay) r;
    if v_err is not null then raise exception '%', v_err; end if;
    v_promo_code := upper(trim(p->>'promo_code'));
  end if;

  if coalesce(p->>'reward_id', '') <> '' then
    if v_uid is null then raise exception 'Connecte-toi pour utiliser ta récompense'; end if;
    select * into v_reward from loyalty_rewards
      where id = (p->>'reward_id')::uuid and user_id = v_uid and status = 'available' and expires_at > now();
    if v_reward.id is null then raise exception 'Récompense indisponible ou expirée'; end if;
    select coalesce(max((i->>'base_price')::numeric), 0) into v_reward_discount
      from jsonb_array_elements(v_items) i where i->>'category' = v_reward.category;
    if v_reward_discount = 0 then
      raise exception 'Ajoute un article « % » à ton panier pour utiliser ta récompense', v_reward.category;
    end if;
  end if;

  -- livraison offerte au-delà du seuil (calculé après remises)
  if v_type = 'delivery' and v_free is not null and v_free > 0
     and (v_subtotal - case when v_is_free_delivery then 0 else v_discount end - v_reward_discount) >= v_free then
    v_fee := 0;
  end if;
  if v_is_free_delivery then v_discount := v_fee; end if;

  v_total := greatest(v_subtotal - v_discount - v_reward_discount + v_fee, 0);

  -- ---- crédit DUNK
  if v_uid is not null then
    select coalesce(sum(amount), 0) into v_credit_balance from customer_credits
      where user_id = v_uid and (expires_at is null or expires_at > now());
    if coalesce((p->>'use_credit')::boolean, false) and v_credit_balance > 0 then
      v_credit_used := least(v_credit_balance, v_total);
      v_total := v_total - v_credit_used;
    end if;
  end if;

  -- ---- 1ʳᵉ commande en espèces : confirmation avant préparation
  if v_pay = 'cash' and coalesce((s->'ordering'->>'first_cash_confirmation')::boolean, true)
     and not exists (select 1 from orders o where o.status = 'delivered'
                     and ((v_uid is not null and o.customer_id = v_uid) or o.customer_phone = v_phone)) then
    v_confirm := true;
  end if;

  return jsonb_build_object(
    'restaurant_id', v_restaurant, 'customer_id', v_uid,
    'customer_name', left(v_name, 100), 'customer_phone', v_phone, 'customer_email', left(v_email, 200),
    'type', v_type, 'payment_method', v_pay, 'items', v_items,
    'subtotal', v_subtotal, 'discount', v_discount, 'promo_id', v_promo_id, 'promo_code', v_promo_code,
    'reward_id', v_reward.id, 'reward_discount', v_reward_discount, 'reward_label', v_reward.label,
    'delivery_fee', v_fee, 'delivery_fee_before_free', v_fee_before_free,
    'free_delivery_threshold', v_free, 'min_order', v_min,
    'credit_balance', v_credit_balance, 'credit_used', v_credit_used,
    'total', v_total,
    'distance_km', v_quote.distance_km, 'lat', v_quote.lat, 'lng', v_quote.lng,
    'scheduled_for', v_sched, 'requires_confirmation', v_confirm);
end $$;
revoke execute on function public.compute_order(jsonb) from public, anon, authenticated;

-- Aperçu côté client (totaux exacts calculés par le serveur)
create or replace function public.preview_order(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  r := compute_order(p);
  return jsonb_build_object('ok', true) || (r - 'customer_phone' - 'customer_email' - 'customer_id' - 'restaurant_id');
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
grant execute on function public.preview_order(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- PASSER COMMANDE v2
create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  v_order orders;
  v_status text;
begin
  c := compute_order(p);
  v_status := case when c->>'payment_method' = 'cmi' then 'pending_payment'
                   when (c->>'requires_confirmation')::boolean then 'pending_confirmation'
                   else 'new' end;

  insert into orders (
    restaurant_id, customer_id, status, type, customer_name, customer_phone, customer_email,
    address, address_details, zone, notes, payment_method, subtotal, delivery_fee, discount, total,
    promo_code, promo_code_id, reward_id, reward_discount, credit_used, requires_confirmation,
    scheduled_for, pickup_code, distance_km, lat, lng,
    source, utm_source, utm_medium, utm_campaign, session_id
  ) values (
    (c->>'restaurant_id')::uuid, nullif(c->>'customer_id', '')::uuid, v_status, c->>'type',
    c->>'customer_name', c->>'customer_phone', c->>'customer_email',
    case when c->>'type' = 'delivery' then left(trim(p->>'address'), 300) end,
    case when c->>'type' = 'delivery' then left(nullif(trim(p->>'address_details'), ''), 300) end,
    case when c->>'type' = 'delivery' then left(p->>'zone', 100) end,
    left(nullif(trim(p->>'notes'), ''), 500),
    c->>'payment_method', (c->>'subtotal')::numeric, (c->>'delivery_fee')::numeric,
    (c->>'discount')::numeric, (c->>'total')::numeric,
    c->>'promo_code', nullif(c->>'promo_id', '')::uuid, nullif(c->>'reward_id', '')::uuid,
    (c->>'reward_discount')::numeric, (c->>'credit_used')::numeric, (c->>'requires_confirmation')::boolean,
    nullif(c->>'scheduled_for', '')::timestamptz,
    case when c->>'type' = 'pickup' then lpad((floor(random() * 10000))::int::text, 4, '0') end,
    nullif(c->>'distance_km', '')::numeric, nullif(c->>'lat', '')::double precision, nullif(c->>'lng', '')::double precision,
    left(p->>'source', 200), left(p->'utm'->>'source', 100), left(p->'utm'->>'medium', 100),
    left(p->'utm'->>'campaign', 150), left(p->>'session_id', 100)
  ) returning * into v_order;

  insert into order_items (order_id, product_id, product_name, unit_price, quantity, options, note, total)
  select v_order.id, (i->>'product_id')::uuid, i->>'name', (i->>'unit_price')::numeric,
         (i->>'quantity')::int, i->'options', i->>'note', (i->>'total')::numeric
  from jsonb_array_elements(c->'items') i;

  if v_order.reward_id is not null then
    update loyalty_rewards set status = 'used', used_order_id = v_order.id where id = v_order.reward_id;
  end if;
  if v_order.credit_used > 0 then
    insert into customer_credits (user_id, kind, amount, order_id, note)
    values (v_order.customer_id, 'promo', -v_order.credit_used, v_order.id, 'Utilisé sur la commande n°' || v_order.number);
  end if;

  if coalesce(p->>'session_id', '') <> '' then
    insert into analytics_events (session_id, event, value, utm_source, utm_medium, utm_campaign)
    values (left(p->>'session_id', 100), 'purchase', v_order.total,
            left(p->'utm'->>'source', 100), left(p->'utm'->>'medium', 100), left(p->'utm'->>'campaign', 150));
  end if;

  return jsonb_build_object('id', v_order.id, 'number', v_order.number, 'token', v_order.token,
                            'total', v_order.total, 'payment_method', v_order.payment_method, 'status', v_order.status);
end $$;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- Commande annulée / échouée : on rend la récompense et le crédit utilisés
create or replace function public.orders_release_benefits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('cancelled','failed') and old.status not in ('cancelled','failed') then
    if new.reward_id is not null then
      update loyalty_rewards set status = case when expires_at > now() then 'available' else 'expired' end, used_order_id = null
        where id = new.reward_id and used_order_id = new.id;
    end if;
    if new.credit_used > 0 and new.customer_id is not null then
      insert into customer_credits (user_id, kind, amount, order_id, note)
      values (new.customer_id, 'promo', new.credit_used, new.id, 'Crédit rendu (commande n°' || new.number || ' annulée)');
    end if;
  end if;
  return new;
end $$;
create or replace trigger orders_release_benefits after update of status on public.orders
  for each row execute function public.orders_release_benefits();

-- ---------------------------------------------------------------- SUIVI CLIENT v2
create or replace function public.get_order(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'type', o.type, 'created_at', o.created_at,
    'customer_name', o.customer_name, 'address', o.address, 'zone', o.zone,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'discount', o.discount, 'total', o.total,
    'promo_code', o.promo_code, 'reward_discount', o.reward_discount, 'credit_used', o.credit_used,
    'scheduled_for', o.scheduled_for, 'pickup_code', o.pickup_code, 'distance_km', o.distance_km,
    'requires_confirmation', o.requires_confirmation, 'rating', o.rating,
    'accepted_at', o.accepted_at, 'ready_at', o.ready_at, 'delivering_at', o.delivering_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'failed_reason', o.failed_reason,
    'driver', case when d.id is not null and o.status = 'delivering'
                   then jsonb_build_object('name', d.name, 'phone', d.phone) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', i.product_name,
                       'quantity', i.quantity, 'options', i.options, 'total', i.total, 'note', i.note))
                       from order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from orders o left join drivers d on d.id = o.driver_id
  where o.token = p_token;
$$;
grant execute on function public.get_order(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- NOTE CLIENT
create or replace function public.rate_order(p_token uuid, p_rating int, p_comment text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then return false; end if;
  update orders set rating = p_rating, rating_comment = left(nullif(trim(p_comment), ''), 500), rated_at = now()
    where token = p_token and status = 'delivered' and rating is null;
  return found;
end $$;
grant execute on function public.rate_order(uuid, int, text) to anon, authenticated;

-- ---------------------------------------------------------------- FIDÉLITÉ : vue client + choix de récompense
create or replace function public.my_loyalty() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); cfg jsonb;
begin
  if v_uid is null then return null; end if;
  select data->'loyalty' into cfg from settings where id = 1;
  return jsonb_build_object(
    'enabled', coalesce((cfg->>'enabled')::boolean, false),
    'required', coalesce((cfg->>'stamps_required')::int, 5),
    'min_order', coalesce((cfg->>'min_order')::numeric, 75),
    'options', coalesce(cfg->'rewards', '[]'::jsonb),
    'stamps', (select count(*) from loyalty_stamps where user_id = v_uid and not consumed and not expired),
    'last_stamp_at', (select max(created_at) from loyalty_stamps where user_id = v_uid and not consumed and not expired),
    'progress_expiry_days', coalesce((cfg->>'progress_expiry_days')::int, 180),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'label', label,
                  'reward_type', reward_type, 'category', category, 'amount', amount, 'expires_at', expires_at) order by unlocked_at)
                from loyalty_rewards where user_id = v_uid and status in ('to_choose','available') and expires_at > now()), '[]'::jsonb),
    'credit', (select coalesce(sum(amount), 0) from customer_credits where user_id = v_uid and (expires_at is null or expires_at > now()))
  );
end $$;
grant execute on function public.my_loyalty() to authenticated;

create or replace function public.choose_reward(p_reward uuid, p_option int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r loyalty_rewards; opt jsonb;
begin
  select * into r from loyalty_rewards where id = p_reward and user_id = v_uid and status = 'to_choose' and expires_at > now();
  if r.id is null then return false; end if;
  select data->'loyalty'->'rewards'->p_option into opt from settings where id = 1;
  if opt is null then return false; end if;
  if opt->>'type' = 'credit' then
    insert into customer_credits (user_id, kind, amount, note, expires_at)
    values (v_uid, 'promo', (opt->>'amount')::numeric, 'Récompense DUNK Card', r.expires_at);
    update loyalty_rewards set status = 'used', reward_type = 'credit', label = opt->>'label',
           amount = (opt->>'amount')::numeric, chosen_at = now() where id = r.id;
  else
    update loyalty_rewards set status = 'available', reward_type = 'category', label = opt->>'label',
           category = opt->>'category', chosen_at = now() where id = r.id;
  end if;
  return true;
end $$;
grant execute on function public.choose_reward(uuid, int) to authenticated;

-- ---------------------------------------------------------------- LIVREUR v2 : échec, espèces encaissées
create or replace function public.driver_update_order_v2(p_token uuid, p_order uuid, p_status text,
                                                         p_cash numeric, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare d drivers;
begin
  if p_status not in ('delivering','delivered','failed') then return false; end if;
  select * into d from drivers where access_token = p_token and active;
  if not found then return false; end if;
  update orders set
    status = p_status,
    failed_reason = case when p_status = 'failed' then left(nullif(trim(p_note), ''), 300) else failed_reason end,
    cash_collected = case when p_status = 'delivered' and payment_method = 'cash' then coalesce(p_cash, total) else cash_collected end,
    payment_status = case when p_status = 'delivered' and payment_method in ('cash','card_on_delivery') then 'paid' else payment_status end
  where id = p_order and driver_id = d.id and status in ('accepted','preparing','ready','delivering');
  if not found then return false; end if;
  update drivers set status = case
      when p_status = 'delivering' then 'busy'
      when exists (select 1 from orders where driver_id = d.id and status = 'delivering') then 'busy'
      else 'available' end
  where id = d.id;
  return true;
end $$;
grant execute on function public.driver_update_order_v2(uuid, uuid, text, numeric, text) to anon, authenticated;
