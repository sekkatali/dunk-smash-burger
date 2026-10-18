-- =====================================================================
-- DUNK — derniers réglages de sécurité (à lancer une fois dans SQL Editor)
-- Retire les droits inutiles au visiteur anonyme (défense en profondeur)
-- et exige un e-mail confirmé pour utiliser une invitation à l'équipe.
-- =====================================================================

revoke all on public.orders, public.order_items, public.drivers, public.promo_codes,
              public.staff, public.staff_invites from anon;
revoke insert, update, delete on public.categories, public.products, public.option_groups,
              public.options, public.product_option_groups, public.settings from anon;
revoke update, delete on public.analytics_events from anon, authenticated;
revoke usage, select, update on sequence public.order_number_seq from anon, authenticated;
revoke execute on function public.is_owner() from anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.orders_rate_limit() from public, anon, authenticated;

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

-- Le fichier clients (téléphones, e-mails, adresses) est réservé aux administrateurs
create or replace function public.admin_customers() returns table (
  phone text, name text, email text, orders int, total_spent numeric,
  first_order timestamptz, last_order timestamptz, last_address text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Accès refusé'; end if;
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

select 'Sécurité appliquée ✅' as resultat;
