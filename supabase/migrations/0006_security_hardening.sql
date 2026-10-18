-- =====================================================================
-- DUNK — durcissement sécurité (audit du 19/10/2026)
-- =====================================================================

-- 1. Anti-spam : limite le nombre de commandes par téléphone et par session
create or replace function public.orders_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare n_phone int; n_session int; n_global int;
begin
  select count(*) into n_phone from orders
    where customer_phone = new.customer_phone and created_at > now() - interval '10 minutes';
  if n_phone >= 3 then
    raise exception 'Trop de commandes en peu de temps avec ce numéro. Appelle-nous si besoin.';
  end if;
  if new.session_id is not null then
    select count(*) into n_session from orders
      where session_id = new.session_id and created_at > now() - interval '10 minutes';
    if n_session >= 4 then
      raise exception 'Trop de commandes en peu de temps. Réessaie dans quelques minutes.';
    end if;
  end if;
  select count(*) into n_global from orders where created_at > now() - interval '1 minute';
  if n_global >= 40 then
    raise exception 'Le site reçoit trop de commandes en ce moment, réessaie dans une minute.';
  end if;
  return new;
end $$;

create or replace trigger orders_rate_limit before insert on public.orders
  for each row execute function public.orders_rate_limit();
revoke execute on function public.orders_rate_limit() from public, anon, authenticated;

-- 2. Moindre privilège : le visiteur anonyme n'a aucun droit sur les tables privées
revoke all on public.orders, public.order_items, public.drivers, public.promo_codes,
              public.staff, public.staff_invites from anon;
revoke insert, update, delete on public.categories, public.products, public.option_groups,
              public.options, public.product_option_groups, public.settings from anon;
revoke update, delete on public.analytics_events from anon, authenticated;
revoke usage, select, update on sequence public.order_number_seq from anon, authenticated;
revoke execute on function public.is_owner() from anon;

-- 3. Événements statistiques : champs bornés (évite le remplissage de la base)
alter policy "public insert events" on public.analytics_events
  with check (
    event in ('page_view','view_product','add_to_cart','begin_checkout')
    and length(session_id) between 8 and 100
    and length(coalesce(visitor_id, '')) <= 100
    and length(coalesce(path, '')) <= 300
    and length(coalesce(referrer, '')) <= 500
    and length(coalesce(utm_source, '')) <= 100
    and length(coalesce(utm_medium, '')) <= 100
    and length(coalesce(utm_campaign, '')) <= 150
    and length(coalesce(device, '')) <= 30
    and (value is null or value between 0 and 100000)
  );

-- 4. Rôles : le rôle « Équipe » gère commandes / menu / livreurs,
--    mais seuls propriétaire et administrateurs touchent aux paramètres,
--    aux codes promo et aux invitations.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff where user_id = auth.uid() and role in ('owner','admin'));
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter policy "staff update" on public.settings
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "admin insert only" on public.promo_codes as restrictive for insert to authenticated with check ((select public.is_admin()));
create policy "admin update only" on public.promo_codes as restrictive for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin delete only" on public.promo_codes as restrictive for delete to authenticated using ((select public.is_admin()));

alter policy "staff all" on public.staff_invites
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- 5. Une invitation ne peut être utilisée qu'avec un e-mail confirmé
create or replace function public.claim_staff() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_role text;
begin
  if v_uid is null then return null; end if;
  select role into v_role from staff where user_id = v_uid;
  if v_role is not null then return v_role; end if;

  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then return null; end if;
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
revoke execute on function public.claim_staff() from public, anon;
grant execute on function public.claim_staff() to authenticated;
