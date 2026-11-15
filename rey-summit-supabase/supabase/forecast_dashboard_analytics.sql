-- Read-only demand history and per-branch inventory for the forecasting dashboard.
-- Run this file once in the Supabase SQL Editor after review.
create or replace function public.rsm_admin_forecast_data(
    p_branch text default 'all',
    p_days integer default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := coalesce(p_branch, '');
    v_today date := public.rsm_today();
    v_history_start date;
    v_products jsonb;
    v_sales jsonb;
begin
    if not public.rsm_is_admin() then
        return public.rsm_fail('Admin login required.', 401);
    end if;
    if v_b <> 'all' and not (v_b = any (public.rsm_int_branches())) then
        return public.rsm_fail('Choose a valid branch.', 422);
    end if;
    if p_days is null or p_days not in (28, 60, 90) then
        return public.rsm_fail('Choose a 28, 60, or 90-day history range.', 422);
    end if;

    v_history_start := v_today - (p_days - 1);

    select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', p.product_id,
               'product_name', p.product_name,
               'price', p.price,
               'branches', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'branch', b.name,
                              'stock_qty', coalesce(pbs.stock_qty, 0))
                              order by b.ordinality), '[]'::jsonb)
                     from unnest(public.rsm_int_branches()) with ordinality as b(name, ordinality)
                     left join public.product_branch_stock pbs
                       on pbs.product_id = p.product_id and pbs.branch = b.name
               )) order by p.product_name), '[]'::jsonb)
      into v_products
      from public.products p
     where p.is_active;

    with item_sales as (
        select oi.product_id,
               oi.quantity,
               o.order_date as sale_date,
               coalesce(o.branch, c.branch)::text as branch
          from public.order_items oi
          join public.orders o on o.order_id = oi.order_id
          join public.customers c on c.id = o.customer_id
         where o.order_status = 'completed'
           and (o.payment_method <> 'gcash' or o.payment_verification_status = 'approved')
           and public.rsm_local(o.order_date)::date between v_history_start and v_today
        union all
        select csi.product_id,
               csi.quantity,
               cs.sale_date,
               coalesce(nullif(cs.branch, ''),
                        case when cs.location = any (public.rsm_int_branches()) then cs.location end)::text
          from public.counter_sale_items csi
          join public.counter_sales cs on cs.sale_id = csi.sale_id
         where public.rsm_local(cs.sale_date)::date between v_history_start and v_today
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', daily.product_id,
               'branch', daily.branch,
               'sale_date', to_char(daily.day, 'YYYY-MM-DD'),
               'units', daily.units)
               order by daily.day, daily.product_id, daily.branch), '[]'::jsonb)
      into v_sales
      from (
          select item_sales.product_id,
                 item_sales.branch,
                 public.rsm_local(item_sales.sale_date)::date as day,
                 sum(item_sales.quantity)::integer as units
            from item_sales
            join public.products p on p.product_id = item_sales.product_id and p.is_active
           where item_sales.branch = any (public.rsm_int_branches())
           group by item_sales.product_id, item_sales.branch,
                    public.rsm_local(item_sales.sale_date)::date
      ) daily;

    return jsonb_build_object(
        'success', true,
        'branch', v_b,
        'history_days', p_days,
        'history_start', to_char(v_history_start, 'YYYY-MM-DD'),
        'as_of', to_char(v_today, 'YYYY-MM-DD'),
        'products', v_products,
        'sales', v_sales
    );
end $$;

revoke all on function public.rsm_admin_forecast_data(text, integer) from public, anon, authenticated;
grant execute on function public.rsm_admin_forecast_data(text, integer) to authenticated;

notify pgrst, 'reload schema';
