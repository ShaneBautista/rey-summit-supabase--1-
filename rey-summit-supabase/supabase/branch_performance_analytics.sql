-- Add monthly branch sales data to the Branch Performance analytics.
-- Run this file once in the Supabase SQL Editor.

create or replace function public.rsm_admin_performance_analytics(
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
    v_monthly jsonb;
    v_monthly_sales jsonb;
    v_fulfillment numeric;
    v_open int;
    v_branches jsonb;
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

    select jsonb_build_object('revenue', coalesce(sum(s.total_amount), 0), 'order_count', count(*)),
           case when count(*) > 0
                then round(count(*) filter (where s.order_status = 'completed')::numeric / count(*) * 100)
                else 0 end
      into v_monthly, v_fulfillment
      from public.rsm_int_sales_rows() s
     where (v_b = 'all' or s.branch = v_b)
       and public.rsm_local(s.sale_date)::date between v_start and v_end;

    select count(*) into v_open
      from public.orders o
      join public.customers c on c.id = o.customer_id
     where o.order_status in ('pending','confirmed','preparing','out_for_delivery')
       and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b);

    select coalesce(jsonb_agg(jsonb_build_object(
               'name', b.name,
               'revenue', coalesce(t.revenue, 0),
               'orders', coalesce(t.n, 0),
               'fulfillment', case when coalesce(t.n, 0) > 0
                                   then round(t.completed::numeric / t.n * 100) else 0 end,
               'open', coalesce(t.open_count, 0)) order by b.ord), '[]')
      into v_branches
      from unnest(public.rsm_int_branches()) with ordinality as b(name, ord)
      left join (
          select s.branch, sum(s.total_amount) as revenue, count(*) as n,
                 count(*) filter (where s.order_status = 'completed') as completed,
                 count(*) filter (where s.order_status in ('pending','confirmed','preparing','out_for_delivery')) as open_count
            from public.rsm_int_sales_rows() s
           where public.rsm_local(s.sale_date)::date between v_start and v_end
           group by s.branch
      ) t on t.branch = b.name
     where v_b = 'all' or b.name = v_b;

    select coalesce(jsonb_agg(jsonb_build_object(
               'month', m.month, 'branch', b.name, 'revenue', coalesce(t.revenue, 0))
               order by m.month, b.ord), '[]'::jsonb)
      into v_monthly_sales
      from generate_series(1, 12) as m(month)
      cross join unnest(public.rsm_int_branches()) with ordinality as b(name, ord)
      left join (
          select s.branch,
                 extract(month from public.rsm_local(s.sale_date))::int as month,
                 sum(s.total_amount) as revenue
            from public.rsm_int_sales_rows() s
           where public.rsm_local(s.sale_date)::date >= date_trunc('year', v_selected)::date
             and public.rsm_local(s.sale_date)::date < (date_trunc('year', v_selected) + interval '1 year')::date
           group by s.branch, extract(month from public.rsm_local(s.sale_date))
      ) t on t.branch = b.name and t.month = m.month
     where v_b = 'all' or b.name = v_b;

    return jsonb_build_object(
        'success', true, 'branch', v_b, 'period', v_period, 'selected_date', v_selected,
        'monthly', v_monthly, 'monthly_sales', v_monthly_sales, 'fulfillment_rate', v_fulfillment,
        'open_deliveries', v_open, 'branches', v_branches);
end $$;

grant execute on function public.rsm_admin_performance_analytics(text, text, text) to authenticated;
