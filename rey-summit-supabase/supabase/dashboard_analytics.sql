-- Update the Overview dashboard analytics without rerunning the full schema.
-- Run this file once in the Supabase SQL Editor.

create or replace function public.rsm_admin_overview_analytics(
    p_branch text default 'all',
    p_period text default 'day',
    p_date text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
    v_period text := lower(coalesce(p_period, ''));
    v_selected date;
    v_start date;
    v_end date;
    v_revenue jsonb;
    v_statuses jsonb;
    v_top jsonb;
    v_kpis jsonb;
    v_branch_sales jsonb;
    v_inventory jsonb;
    v_daily_orders jsonb;
    v_best_branch text;
    v_best_branch_revenue numeric;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    if v_period not in ('day', 'month', 'year') then
        return public.rsm_fail('Choose a valid date period.', 422);
    end if;
    begin
        if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'invalid date';
        end if;
        v_selected := p_date::date;
    exception when others then
        return public.rsm_fail('Choose a valid date.', 422);
    end;

    if v_period = 'day' then
        v_start := v_selected;
        v_end := v_selected;
    elsif v_period = 'month' then
        v_start := date_trunc('month', v_selected)::date;
        v_end := (v_start + interval '1 month - 1 day')::date;
    else
        v_start := date_trunc('year', v_selected)::date;
        v_end := (v_start + interval '1 year - 1 day')::date;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('sale_date', to_char(g.bucket, 'YYYY-MM-DD'), 'revenue', g.revenue)
                              order by g.bucket), '[]')
      into v_revenue
      from (select case when v_period = 'year'
                        then date_trunc('month', public.rsm_local(s.sale_date))::date
                        else public.rsm_local(s.sale_date)::date end as bucket,
                   sum(s.total_amount) as revenue
              from public.rsm_int_sales_rows() s
             where (v_b = 'all' or s.branch = v_b)
               and public.rsm_local(s.sale_date)::date between v_start and v_end
             group by 1) g;

    select coalesce(jsonb_agg(jsonb_build_object('order_status', g.order_status, 'order_count', g.n)), '[]')
      into v_statuses
      from (select statuses.order_status, count(*) as n
              from (
                  select s.order_status
                    from public.rsm_int_sales_rows() s
                   where (v_b = 'all' or s.branch = v_b)
                     and public.rsm_local(s.sale_date)::date between v_start and v_end
                  union all
                  select o.order_status
                    from public.orders o
                    join public.customers c on c.id = o.customer_id
                   where o.order_status = 'cancelled'
                     and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b)
                     and public.rsm_local(o.order_date)::date between v_start and v_end
              ) statuses
             group by statuses.order_status) g;

    select coalesce(jsonb_agg(jsonb_build_object('product_name', g.product_name, 'units_sold', g.units)
                              order by g.units desc, g.product_name), '[]')
      into v_top
      from (select p.product_name, sum(i.quantity) as units
              from public.rsm_int_item_rows() i
              join public.products p on p.product_id = i.product_id
             where (v_b = 'all' or i.branch = v_b)
               and public.rsm_local(i.sale_date)::date between v_start and v_end
             group by p.product_id, p.product_name
             order by units desc, p.product_name limit 5) g;

    select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'revenue', coalesce(t.revenue, 0))
                              order by b.ord), '[]')
      into v_branch_sales
      from unnest(public.rsm_int_branches()) with ordinality as b(name, ord)
      left join lateral (
          select sum(s.total_amount) as revenue
            from public.rsm_int_sales_rows() s
           where s.branch = b.name
             and s.order_status = 'completed'
             and public.rsm_local(s.sale_date)::date between v_start and v_end
      ) t on true;

    select b.name, b.revenue
      into v_best_branch, v_best_branch_revenue
      from jsonb_to_recordset(v_branch_sales) as b(name text, revenue numeric)
     order by b.revenue desc, b.name
     limit 1;

    select jsonb_build_object(
        'total_revenue', coalesce((select sum(s.total_amount)
                                     from public.rsm_int_sales_rows() s
                                    where s.order_status = 'completed'
                                      and (v_b = 'all' or s.branch = v_b)
                                      and public.rsm_local(s.sale_date)::date between v_start and v_end), 0),
        'total_orders', coalesce((select count(*)
                                    from public.rsm_int_sales_rows() s
                                   where (v_b = 'all' or s.branch = v_b)
                                     and public.rsm_local(s.sale_date)::date between v_start and v_end), 0),
        'products_sold',
            coalesce((select sum(oi.quantity)
                        from public.order_items oi
                        join public.orders o on o.order_id = oi.order_id
                        join public.customers c on c.id = o.customer_id
                       where o.order_status = 'completed'
                         and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b)
                         and public.rsm_local(o.order_date)::date between v_start and v_end), 0)
            + coalesce((select sum(csi.quantity)
                          from public.counter_sale_items csi
                          join public.counter_sales cs on cs.sale_id = csi.sale_id
                         where (v_b = 'all' or coalesce(nullif(cs.branch, ''),
                                   case when cs.location = any (public.rsm_int_branches()) then cs.location end) = v_b)
                           and public.rsm_local(cs.sale_date)::date between v_start and v_end), 0),
        'low_stock_products', coalesce((select count(distinct p.product_id)
                                          from public.products p
                                          cross join unnest(public.rsm_int_branches()) as b(name)
                                          left join public.product_branch_stock pbs
                                            on pbs.product_id = p.product_id and pbs.branch = b.name
                                         where p.is_active
                                           and coalesce(pbs.stock_qty, 0) <= 10
                                           and (v_b = 'all' or b.name = v_b)), 0),
        'completed_orders', coalesce((select count(*)
                                        from public.rsm_int_sales_rows() s
                                       where s.order_status = 'completed'
                                         and (v_b = 'all' or s.branch = v_b)
                                         and public.rsm_local(s.sale_date)::date between v_start and v_end), 0),
        'pending_payments', coalesce((select count(*)
                                        from public.orders o
                                        join public.customers c on c.id = o.customer_id
                                       where o.order_status <> 'cancelled'
                                         and o.payment_verification_status = 'pending'
                                         and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b)
                                         and public.rsm_local(o.order_date)::date between v_start and v_end), 0),
        'best_performing_branch', case when coalesce(v_best_branch_revenue, 0) > 0 then v_best_branch else 'No sales' end,
        'best_branch_revenue', coalesce(v_best_branch_revenue, 0))
      into v_kpis;

    select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', p.product_id,
               'product_name', p.product_name,
               'branches', stock.branches) order by p.product_name), '[]')
      into v_inventory
      from public.products p
      cross join lateral (
          select coalesce(jsonb_agg(jsonb_build_object(
                     'name', b.name,
                     'stock_qty', coalesce(pbs.stock_qty, 0)) order by b.ord), '[]') as branches
            from unnest(public.rsm_int_branches()) with ordinality as b(name, ord)
            left join public.product_branch_stock pbs
              on pbs.product_id = p.product_id and pbs.branch = b.name
      ) stock
     where p.is_active;

    select coalesce(jsonb_agg(jsonb_build_object(
               'sale_date', to_char(g.sale_day, 'YYYY-MM-DD'),
               'order_count', g.order_count) order by g.sale_day), '[]')
      into v_daily_orders
      from (select public.rsm_local(s.sale_date)::date as sale_day, count(*) as order_count
              from public.rsm_int_sales_rows() s
             where (v_b = 'all' or s.branch = v_b)
               and public.rsm_local(s.sale_date)::date between v_start and v_end
             group by public.rsm_local(s.sale_date)::date) g;

    return jsonb_build_object(
        'success', true, 'branch', v_b, 'period', v_period, 'selected_date', v_selected,
        'daily_revenue', v_revenue, 'monthly_statuses', v_statuses, 'top_products', v_top,
        'kpis', v_kpis, 'branch_sales', v_branch_sales,
        'inventory_stock', v_inventory, 'daily_orders', v_daily_orders);
end $$;

grant execute on function public.rsm_admin_overview_analytics(text, text, text) to authenticated;
