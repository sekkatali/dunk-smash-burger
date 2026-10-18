-- Rôles étendus : Manager, Cuisine, Marketing, Support (appliqué le 19/10/2026)
create or replace function public.has_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff where user_id = auth.uid() and role = any(p_roles));
$$;
grant execute on function public.has_role(text[]) to authenticated;

-- Menu et livreurs : propriétaire, admin, manager (et ancien rôle « équipe »)
do $$
declare t text;
begin
  foreach t in array array['categories','products','option_groups','options','product_option_groups','drivers'] loop
    execute format('create policy "role menu insert" on public.%I as restrictive for insert to authenticated with check ((select public.has_role(array[''owner'',''admin'',''manager'',''staff''])))', t);
    execute format('create policy "role menu update" on public.%I as restrictive for update to authenticated using ((select public.has_role(array[''owner'',''admin'',''manager'',''staff''])))', t);
    execute format('create policy "role menu delete" on public.%I as restrictive for delete to authenticated using ((select public.has_role(array[''owner'',''admin'',''manager'',''staff''])))', t);
  end loop;
end $$;

-- Codes promo : propriétaire, admin, marketing
alter policy "admin insert only" on public.promo_codes with check ((select public.has_role(array['owner','admin','marketing'])));
alter policy "admin update only" on public.promo_codes using ((select public.has_role(array['owner','admin','marketing']))) with check ((select public.has_role(array['owner','admin','marketing'])));
alter policy "admin delete only" on public.promo_codes using ((select public.has_role(array['owner','admin','marketing'])));
-- Fichier clients : propriétaire, admin, marketing, support (admin_customers vérifie has_role)
