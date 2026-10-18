-- =====================================================================
-- DUNK — statistiques avancées : trafic, clients, produits, analyse (LTV…)
-- =====================================================================

alter table public.analytics_events add column if not exists visitor_id text;
create index if not exists analytics_visitor_idx on public.analytics_events(visitor_id);

-- ---------------------------------------------------------------- TRAFIC
create or replace function public.admin_traffic(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tz text := 'Africa/Casablanca';
begin
  if not is_staff() then raise exception 'Accès refusé'; end if;

  with ev as (
    select * from analytics_events where created_at >= p_from and created_at < p_to
  ), sess as (
    select session_id,
           min(created_at) as started, max(created_at) as ended,
           max(visitor_id) as visitor_id,
           count(*) filter (where event = 'page_view') as pv,
           bool_or(event = 'view_product') as viewed,
           bool_or(event = 'add_to_cart') as carted,
           bool_or(event = 'begin_checkout') as checkout,
           bool_or(event = 'purchase') as purchased,
           count(*) as events
    from ev group by session_id
  ), first_ev as (
    select distinct on (session_id) session_id,
      coalesce(nullif(utm_source, ''),
               nullif(substring(referrer from '^https?://(?:www\.|m\.|l\.|lm\.)?([^/:?]+)'), ''), 'direct') as src,
      coalesce(nullif(utm_medium, ''), case when coalesce(referrer, '') = '' then '(aucun)' else 'referral' end) as medium,
      coalesce(nullif(utm_campaign, ''), '(aucune)') as campaign,
      coalesce(path, '/') as landing,
      coalesce(device, 'inconnu') as device
    from ev where event = 'page_view'
    order by session_id, created_at
  ), s as (
    select sess.*, f.src, f.medium, f.campaign, f.landing, f.device,
           coalesce(sess.visitor_id, sess.session_id) as vid
    from sess join first_ev f using (session_id)
  ), o as (
    select * from orders
    where created_at >= p_from and created_at < p_to and status not in ('cancelled','pending_payment')
  ), vis as (
    select visitor_id, min(created_at) as first_seen
    from analytics_events where visitor_id is not null group by visitor_id
  ), so as (
    select s.*, ord.id as order_id, ord.total
    from s left join o ord on ord.session_id = s.session_id
  )
  select jsonb_build_object(
    'sessions', (select count(*) from s),
    'visitors', (select count(distinct vid) from s),
    'new_visitors', (select count(distinct s.vid) from s left join vis on vis.visitor_id = s.visitor_id
                     where vis.first_seen is null or vis.first_seen >= p_from),
    'returning_visitors', (select count(distinct s.vid) from s join vis on vis.visitor_id = s.visitor_id
                     where vis.first_seen < p_from),
    'page_views', (select coalesce(sum(pv), 0) from s),
    'pages_per_session', (select coalesce(round(avg(pv), 2), 0) from s),
    'bounce_rate', (select coalesce(round(100.0 * count(*) filter (where pv <= 1 and not viewed and not carted) / nullif(count(*), 0), 1), 0) from s),
    'avg_duration_sec', (select coalesce(round(avg(extract(epoch from (ended - started)))::numeric), 0) from s where events > 1),
    'product_view_rate', (select coalesce(round(100.0 * count(*) filter (where viewed) / nullif(count(*), 0), 1), 0) from s),
    'cart_rate', (select coalesce(round(100.0 * count(*) filter (where carted) / nullif(count(*), 0), 1), 0) from s),
    'checkout_rate', (select coalesce(round(100.0 * count(*) filter (where checkout) / nullif(count(*), 0), 1), 0) from s),
    'conversion_rate', (select coalesce(round(100.0 * count(*) filter (where purchased) / nullif(count(*), 0), 2), 0) from s),
    'abandoned_carts', (select count(*) from s where carted and not purchased),
    'abandoned_checkouts', (select count(*) from s where checkout and not purchased),
    'revenue_per_session', (select coalesce(round(sum(total) / nullif(count(distinct session_id), 0), 2), 0) from so),
    'funnel', jsonb_build_object(
      'visit', (select count(*) from s),
      'product', (select count(*) from s where viewed),
      'cart', (select count(*) from s where carted),
      'checkout', (select count(*) from s where checkout),
      'purchase', (select count(*) from s where purchased)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day::date,
        'sessions', (select count(*) from s where (s.started at time zone v_tz)::date = d.day::date),
        'visitors', (select count(distinct vid) from s where (s.started at time zone v_tz)::date = d.day::date),
        'purchases', (select count(*) from s where purchased and (s.started at time zone v_tz)::date = d.day::date)
      ) order by d.day), '[]'::jsonb)
      from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d(day)
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h.h,
        'sessions', (select count(*) from s where extract(hour from s.started at time zone v_tz) = h.h),
        'purchases', (select count(*) from s where purchased and extract(hour from s.started at time zone v_tz) = h.h)
      ) order by h.h), '[]'::jsonb) from generate_series(0, 23) h(h)
    ),
    'sources', (select coalesce(jsonb_agg(t order by t.sessions desc), '[]'::jsonb) from (
      select src as name, count(distinct session_id)::int as sessions, count(distinct vid)::int as visitors,
             count(distinct order_id)::int as orders, coalesce(sum(total), 0) as revenue,
             round(100.0 * count(*) filter (where carted) / nullif(count(*), 0), 1) as cart_rate
      from so group by src) t),
    'mediums', (select coalesce(jsonb_agg(t order by t.sessions desc), '[]'::jsonb) from (
      select medium as name, count(distinct session_id)::int as sessions, count(distinct order_id)::int as orders, coalesce(sum(total), 0) as revenue
      from so group by medium) t),
    'campaigns', (select coalesce(jsonb_agg(t order by t.sessions desc), '[]'::jsonb) from (
      select src || ' / ' || campaign as name, count(distinct session_id)::int as sessions, count(distinct order_id)::int as orders, coalesce(sum(total), 0) as revenue
      from so where campaign <> '(aucune)' group by src, campaign) t),
    'landings', (select coalesce(jsonb_agg(t order by t.sessions desc), '[]'::jsonb) from (
      select landing as name, count(distinct session_id)::int as sessions, count(distinct order_id)::int as orders,
             round(100.0 * count(*) filter (where pv <= 1 and not viewed and not carted) / nullif(count(*), 0), 1) as bounce_rate
      from so group by landing order by count(distinct session_id) desc limit 15) t),
    'devices', (select coalesce(jsonb_agg(t order by t.sessions desc), '[]'::jsonb) from (
      select device as name, count(distinct session_id)::int as sessions, count(distinct order_id)::int as orders, coalesce(sum(total), 0) as revenue
      from so group by device) t)
  ) into r;
  return r;
end $$;
revoke execute on function public.admin_traffic(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_traffic(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- CLIENTS
create or replace function public.admin_customer_stats(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tz text := 'Africa/Casablanca';
begin
  if not is_staff() then raise exception 'Accès refusé'; end if;

  with allo as (
    select * from orders where status not in ('cancelled','pending_payment')
  ), ranked as (
    select allo.*, row_number() over (partition by customer_phone order by created_at) as rn
    from allo
  ), firsts as (
    select customer_phone, min(created_at) as first_at, max(created_at) as last_at,
           count(*) as n_all, sum(total) as spent_all,
           (array_agg(customer_name order by created_at desc))[1] as name,
           (array_agg(coalesce(nullif(utm_source, ''), 'direct') order by created_at))[1] as first_source
    from allo group by customer_phone
  ), per as (
    select r.*, f.first_at, (f.first_at >= p_from) as is_new
    from ranked r join firsts f using (customer_phone)
    where r.created_at >= p_from and r.created_at < p_to
  ), percust as (
    select customer_phone, bool_or(is_new) as is_new, count(*) as n, sum(total) as spent
    from per group by customer_phone
  ), seconds as (
    select a.customer_phone, extract(epoch from (b.created_at - a.created_at)) / 86400 as days
    from ranked a join ranked b on a.customer_phone = b.customer_phone and a.rn = 1 and b.rn = 2
  )
  select jsonb_build_object(
    'customers', (select count(*) from percust),
    'new_customers', (select count(*) from percust where is_new),
    'returning_customers', (select count(*) from percust where not is_new),
    'orders_new', (select count(*) from per where is_new),
    'orders_returning', (select count(*) from per where not is_new),
    'revenue_new', (select coalesce(sum(total), 0) from per where is_new),
    'revenue_returning', (select coalesce(sum(total), 0) from per where not is_new),
    'aov_new', (select coalesce(round(avg(total), 2), 0) from per where is_new),
    'aov_returning', (select coalesce(round(avg(total), 2), 0) from per where not is_new),
    'first_orders', (select count(*) from per where rn = 1),
    'repeat_orders', (select count(*) from per where rn > 1),
    'repeat_in_period', (select coalesce(round(100.0 * count(*) filter (where n >= 2) / nullif(count(*), 0), 1), 0) from percust),
    'orders_per_customer', (select coalesce(round(avg(n), 2), 0) from percust),
    'revenue_per_customer', (select coalesce(round(avg(spent), 2), 0) from percust),
    'median_days_to_second', (select coalesce(round((percentile_cont(0.5) within group (order by days))::numeric, 1), 0) from seconds),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day::date,
        'new', (select count(*) from per where rn = 1 and (per.created_at at time zone v_tz)::date = d.day::date),
        'returning', (select count(*) from per where rn > 1 and (per.created_at at time zone v_tz)::date = d.day::date)
      ) order by d.day), '[]'::jsonb)
      from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d(day)
    ),
    'new_by_source', (select coalesce(jsonb_agg(t order by t.customers desc), '[]'::jsonb) from (
      select f.first_source as name, count(*)::int as customers, round(avg(f.spent_all), 2) as ltv
      from firsts f where f.first_at >= p_from and f.first_at < p_to group by f.first_source) t),
    'order_rank', (select coalesce(jsonb_agg(t order by t.rank), '[]'::jsonb) from (
      select least(rn, 5)::int as rank, count(*)::int as orders, coalesce(sum(total), 0) as revenue
      from per group by least(rn, 5)) t),
    'top_customers', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select f.name, p.customer_phone as phone, p.n::int as orders, p.spent as revenue,
             f.n_all::int as orders_all, f.spent_all, f.first_at, f.last_at
      from percust p join firsts f using (customer_phone)
      order by p.spent desc limit 15) t),
    'at_risk', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select name, customer_phone as phone, n_all::int as orders_all, spent_all,
             (extract(epoch from (now() - last_at)) / 86400)::int as days_since
      from firsts where n_all >= 2 and last_at < now() - interval '21 days'
      order by spent_all desc limit 20) t),
    'at_risk_count', (select count(*) from firsts where n_all >= 2 and last_at < now() - interval '21 days')
  ) into r;
  return r;
end $$;
revoke execute on function public.admin_customer_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_customer_stats(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- PRODUITS & PANIER
create or replace function public.admin_product_stats(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tz text := 'Africa/Casablanca';
begin
  if not is_staff() then raise exception 'Accès refusé'; end if;

  with o as (
    select * from orders where created_at >= p_from and created_at < p_to and status not in ('cancelled','pending_payment')
  ), oc as (
    select * from orders where created_at >= p_from and created_at < p_to and status = 'cancelled'
  ), it as (
    select oi.*, coalesce(c.name, 'Sans catégorie') as category
    from order_items oi
    join o on o.id = oi.order_id
    left join products p on p.id = oi.product_id
    left join categories c on c.id = p.category_id
  ), tot as (
    select coalesce(sum(total), 0) as rev, count(*) as n from it
  ), norders as (
    select count(*) as n from o
  ), basket as (
    select order_id, sum(quantity) as qty from it group by order_id
  )
  select jsonb_build_object(
    'items_per_order', (select coalesce(round(avg(qty), 2), 0) from basket),
    'basket_sizes', (select coalesce(jsonb_agg(t order by t.size), '[]'::jsonb) from (
      select least(qty, 5)::int as size, count(*)::int as orders from basket group by least(qty, 5)) t),
    'products', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
      select product_name as name, category, sum(quantity)::int as qty, sum(total) as revenue,
             count(distinct order_id)::int as orders,
             round(100.0 * sum(total) / nullif((select rev from tot), 0), 1) as share,
             round(100.0 * count(distinct order_id) / nullif((select n from norders), 0), 1) as attach
      from it group by product_name, category) t),
    'categories', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
      select category as name, sum(quantity)::int as qty, sum(total) as revenue,
             round(100.0 * count(distinct order_id) / nullif((select n from norders), 0), 1) as attach,
             round(100.0 * sum(total) / nullif((select rev from tot), 0), 1) as share
      from it group by category) t),
    'options', (select coalesce(jsonb_agg(t order by t.qty desc), '[]'::jsonb) from (
      select opt->>'name' as name, opt->>'group' as "group", sum(it.quantity)::int as qty,
             sum(it.quantity * coalesce((opt->>'price')::numeric, 0)) as revenue
      from it, jsonb_array_elements(it.options) opt group by 1, 2 limit 25) t),
    'pairs', (select coalesce(jsonb_agg(t order by t.orders desc), '[]'::jsonb) from (
      select a.product_name as a, b.product_name as b, count(distinct a.order_id)::int as orders
      from it a join it b on a.order_id = b.order_id and a.product_name < b.product_name
      group by 1, 2 order by 3 desc limit 12) t),
    'unsold', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
               from products p where p.active and not exists (select 1 from it where it.product_id = p.id)),
    'heatmap', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select extract(isodow from created_at at time zone v_tz)::int as dow,
             extract(hour from created_at at time zone v_tz)::int as hour, count(*)::int as orders
      from o group by 1, 2) t),
    'cancel_reasons', (select coalesce(jsonb_agg(t order by t.orders desc), '[]'::jsonb) from (
      select coalesce(nullif(cancel_reason, ''), 'Sans motif') as reason, count(*)::int as orders, sum(total) as lost
      from oc group by 1) t)
  ) into r;
  return r;
end $$;
revoke execute on function public.admin_product_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_product_stats(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- ANALYSE (historique complet)
create or replace function public.admin_analysis() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_tz text := 'Africa/Casablanca';
begin
  if not is_staff() then raise exception 'Accès refusé'; end if;

  with allo as (
    select * from orders where status not in ('cancelled','pending_payment')
  ), ranked as (
    select allo.*, row_number() over (partition by customer_phone order by created_at) as rn,
           lag(created_at) over (partition by customer_phone order by created_at) as prev_at
    from allo
  ), cust as (
    select customer_phone, min(created_at) as first_at, max(created_at) as last_at,
           count(*) as n, sum(total) as spent,
           (array_agg(customer_name order by created_at desc))[1] as name,
           date_trunc('month', min(created_at) at time zone v_tz) as cohort,
           (extract(epoch from (now() - max(created_at))) / 86400) as recency
    from allo group by customer_phone
  ), seg as (
    select cust.*,
      case
        when recency <= 14 and n >= 4 then 'Champions'
        when recency <= 30 and n >= 3 then 'Fidèles'
        when recency <= 30 and n = 2 then 'Prometteurs'
        when recency <= 14 and n = 1 then 'Nouveaux'
        when recency > 60 and n >= 3 then 'En danger'
        when recency > 30 and n >= 2 then 'À relancer'
        when recency > 60 then 'Perdus'
        else 'Occasionnels'
      end as segment
    from cust
  ), ranked_spend as (
    select spent, ntile(10) over (order by spent desc) as decile, ntile(5) over (order by spent desc) as quint from cust
  ), it as (
    select oi.*, coalesce(c.name, 'Sans catégorie') as category
    from order_items oi join allo on allo.id = oi.order_id
    left join products p on p.id = oi.product_id left join categories c on c.id = p.category_id
  ), cohort_activity as (
    select c.cohort,
           (extract(year from age(date_trunc('month', a.created_at at time zone v_tz), c.cohort)) * 12
            + extract(month from age(date_trunc('month', a.created_at at time zone v_tz), c.cohort)))::int as m,
           a.customer_phone, a.total
    from allo a join cust c using (customer_phone)
  )
  select jsonb_build_object(
    'customers', (select count(*) from cust),
    'orders', (select count(*) from allo),
    'revenue', (select coalesce(sum(total), 0) from allo),
    'ltv', (select coalesce(round(avg(spent), 2), 0) from cust),
    'ltv_median', (select coalesce(round((percentile_cont(0.5) within group (order by spent))::numeric, 2), 0) from cust),
    'ltv_repeaters', (select coalesce(round(avg(spent), 2), 0) from cust where n >= 2),
    'ltv_30', (select coalesce(round(avg(x), 2), 0) from (
                 select sum(a.total) as x from allo a join cust c using (customer_phone)
                 where c.first_at < now() - interval '30 days' and a.created_at < c.first_at + interval '30 days'
                 group by a.customer_phone) t),
    'ltv_90', (select coalesce(round(avg(x), 2), 0) from (
                 select sum(a.total) as x from allo a join cust c using (customer_phone)
                 where c.first_at < now() - interval '90 days' and a.created_at < c.first_at + interval '90 days'
                 group by a.customer_phone) t),
    'aov', (select coalesce(round(avg(total), 2), 0) from allo),
    'frequency', (select coalesce(round(avg(n), 2), 0) from cust),
    'repeat_rate', (select coalesce(round(100.0 * count(*) filter (where n >= 2) / nullif(count(*), 0), 1), 0) from cust),
    'avg_days_between', (select coalesce(round(avg(extract(epoch from (created_at - prev_at)) / 86400)::numeric, 1), 0) from ranked where prev_at is not null),
    'avg_lifespan_days', (select coalesce(round(avg(extract(epoch from (last_at - first_at)) / 86400)::numeric, 1), 0) from cust where n >= 2),
    'top10_share', (select coalesce(round(100.0 * sum(spent) filter (where decile = 1) / nullif(sum(spent), 0), 1), 0) from ranked_spend),
    'top20_share', (select coalesce(round(100.0 * sum(spent) filter (where quint = 1) / nullif(sum(spent), 0), 1), 0) from ranked_spend),
    'segments', (select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
      select segment as name, count(*)::int as customers, sum(spent) as revenue,
             round(avg(spent), 2) as avg_spent, round(avg(recency)::numeric, 0) as avg_recency, round(avg(n), 1) as avg_orders
      from seg group by segment) t),
    'cohorts', (select coalesce(jsonb_agg(t order by t.cohort), '[]'::jsonb) from (
      select to_char(c.cohort, 'YYYY-MM') as cohort,
             count(distinct c.customer_phone)::int as size,
             (select jsonb_agg(jsonb_build_object(
                 'm', m.m,
                 'active', (select count(distinct ca.customer_phone) from cohort_activity ca where ca.cohort = c.cohort and ca.m = m.m),
                 'revenue', (select coalesce(sum(ca.total), 0) from cohort_activity ca where ca.cohort = c.cohort and ca.m <= m.m)
               ) order by m.m)
              from generate_series(0, least(11, (extract(year from age(date_trunc('month', now() at time zone v_tz), c.cohort)) * 12
                                                + extract(month from age(date_trunc('month', now() at time zone v_tz), c.cohort)))::int)) m(m)
             ) as months
      from cust c
      where c.cohort >= date_trunc('month', now() at time zone v_tz) - interval '11 months'
      group by c.cohort) t),
    'monthly', (select coalesce(jsonb_agg(t order by t.month), '[]'::jsonb) from (
      select to_char(date_trunc('month', created_at at time zone v_tz), 'YYYY-MM') as month,
             count(*)::int as orders, sum(total) as revenue, count(distinct customer_phone)::int as customers,
             count(*) filter (where rn = 1)::int as new_customers, round(avg(total), 2) as aov
      from ranked where created_at >= date_trunc('month', now()) - interval '11 months'
      group by 1) t),
    'promo_impact', jsonb_build_object(
      'with_count', (select count(*) from allo where promo_code is not null),
      'with_aov', (select coalesce(round(avg(total), 2), 0) from allo where promo_code is not null),
      'without_aov', (select coalesce(round(avg(total), 2), 0) from allo where promo_code is null),
      'discount_total', (select coalesce(sum(discount), 0) from allo),
      'promo_new_share', (select coalesce(round(100.0 * count(*) filter (where rn = 1) / nullif(count(*), 0), 1), 0) from ranked where promo_code is not null),
      'promo_repeat_rate', (select coalesce(round(100.0 * count(*) filter (where c.n >= 2) / nullif(count(*), 0), 1), 0)
                            from ranked r2 join cust c using (customer_phone) where r2.rn = 1 and r2.promo_code is not null),
      'nopromo_repeat_rate', (select coalesce(round(100.0 * count(*) filter (where c.n >= 2) / nullif(count(*), 0), 1), 0)
                            from ranked r2 join cust c using (customer_phone) where r2.rn = 1 and r2.promo_code is null)
    ),
    'type_compare', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select type, count(*)::int as orders, round(avg(total), 2) as aov, sum(total) as revenue from allo group by type) t),
    'first_product', (select coalesce(jsonb_agg(t order by t.customers desc), '[]'::jsonb) from (
      select i.product_name as name, count(distinct r3.customer_phone)::int as customers,
             round(100.0 * count(distinct r3.customer_phone) filter (where c.n >= 2) / nullif(count(distinct r3.customer_phone), 0), 1) as repeat_rate
      from ranked r3 join order_items i on i.order_id = r3.id join cust c using (customer_phone)
      where r3.rn = 1 group by i.product_name order by 2 desc limit 10) t),
    'category_attach', (select coalesce(jsonb_agg(t order by t.attach desc), '[]'::jsonb) from (
      select category as name, round(100.0 * count(distinct order_id) / nullif((select count(*) from allo), 0), 1) as attach,
             sum(total) as revenue
      from it group by category) t)
  ) into r;
  return r;
end $$;
revoke execute on function public.admin_analysis() from public, anon;
grant execute on function public.admin_analysis() to authenticated;
