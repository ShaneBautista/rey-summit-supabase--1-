begin;

create or replace function public.rsm_admin_update_order(p_order_id bigint, p_status text, p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
    o record;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    if p_order_id is null or p_order_id < 1 or p_status is null
       or p_status not in ('pending','confirmed','preparing','out_for_delivery','completed','cancelled') then
        return public.rsm_fail('Invalid order update.', 400);
    end if;
    if p_status = 'completed' then
        return public.rsm_fail('Only delivery staff can mark an order as delivered.', 403);
    end if;

    select order_status, payment_method, payment_verification_status into o
      from public.orders where order_id = p_order_id and (v_b = 'all' or branch = v_b) for update;
    if not found then return public.rsm_fail('Order not found in the selected branch.', 404); end if;

    if p_status in ('confirmed','preparing','out_for_delivery','completed')
       and o.payment_method = 'gcash' and o.payment_verification_status <> 'approved' then
        return public.rsm_fail('Approve the GCash payment before advancing this order.', 409);
    end if;

    update public.orders set order_status = p_status where order_id = p_order_id;
    return jsonb_build_object('success', true, 'message', 'Order status updated.');
end $$;

create or replace function public.rsm_admin_sales_list(p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    return jsonb_build_object('success', true, 'branch', v_b, 'orders', coalesce((
        select jsonb_agg(u.j order by u.day desc, u.sort desc)
        from (
            select to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD') as day,
                   to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD HH24:MI:SS') || lpad(o.order_id::text, 12, '0') as sort,
                   jsonb_build_object(
                       'order_id', o.order_id, 'total_amount', o.total_amount,
                       'delivery_address', o.delivery_address,
                       'order_day', to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD'),
                       'order_time', to_char(public.rsm_local(o.order_date), 'HH12:MI:SS AM'),
                       'sale_sort', to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD HH24:MI:SS'),
                       'username', c.username, 'branch', coalesce(o.branch, c.branch),
                       'delivered_by', coalesce(nullif(sa.full_name, ''), 'N/A'),
                       'sale_number', '#' || o.order_id, 'sale_type', 'Online',
                       'payment_method', case when o.payment_method = 'gcash' then 'GCash' else 'Cash' end,
                       'location', coalesce(nullif(o.delivery_address, ''),
                                            nullif(coalesce(o.branch, c.branch), ''), '—')) as j
            from public.orders o
            join public.customers c on c.id = o.customer_id
            left join public.staff_accounts sa on sa.staff_id = o.delivered_by_staff_id
            where o.order_status = 'completed'
              and o.delivered_by_staff_id is not null
              and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b)
            union all
            select to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD'),
                   to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD HH24:MI:SS') || lpad(cs.sale_id::text, 12, '0'),
                   jsonb_build_object(
                       'sale_id', cs.sale_id,
                       'sale_type', case when cs.sale_type = 'walk_in' then 'Walk-in' else 'Call' end,
                       'customer_name', cs.customer_name, 'username', cs.customer_name,
                       'location', cs.location,
                       'payment_method', case when cs.payment_method = 'gcash' then 'GCash' else 'Cash' end,
                       'branch', cs.branch, 'delivered_by', cs.delivered_by,
                       'total_amount', cs.total_amount,
                       'order_day', to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD'),
                       'order_time', to_char(public.rsm_local(cs.sale_date), 'HH12:MI:SS AM'),
                       'sale_sort', to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD HH24:MI:SS'),
                       'sale_number', 'S-' || lpad(cs.sale_id::text, 6, '0'))
            from public.counter_sales cs
            where v_b = 'all' or cs.branch = v_b
        ) u
    ), '[]'::jsonb));
end $$;

create or replace function public.rsm_admin_sales_list_filtered(
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
    v_orders jsonb;
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

    select coalesce(jsonb_agg(u.j order by u.day desc, u.sort desc), '[]')
      into v_orders
      from (
          select to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD') as day,
                 to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD HH24:MI:SS') || lpad(o.order_id::text, 12, '0') as sort,
                 jsonb_build_object(
                     'order_id', o.order_id, 'total_amount', o.total_amount,
                     'delivery_address', o.delivery_address,
                     'order_day', to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD'),
                     'order_time', to_char(public.rsm_local(o.order_date), 'HH12:MI:SS AM'),
                     'sale_sort', to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD HH24:MI:SS'),
                     'username', c.username, 'branch', coalesce(o.branch, c.branch),
                     'delivered_by', coalesce(nullif(sa.full_name, ''), 'N/A'),
                     'sale_number', '#' || o.order_id, 'sale_type', 'Online',
                     'payment_method', case when o.payment_method = 'gcash' then 'GCash' else 'Cash' end,
                     'location', coalesce(nullif(o.delivery_address, ''),
                                          nullif(coalesce(o.branch, c.branch), ''), '—')) as j
            from public.orders o
            join public.customers c on c.id = o.customer_id
            left join public.staff_accounts sa on sa.staff_id = o.delivered_by_staff_id
           where o.order_status = 'completed'
             and o.delivered_by_staff_id is not null
             and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b)
             and public.rsm_local(o.order_date)::date between v_start and v_end
          union all
          select to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD'),
                 to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD HH24:MI:SS') || lpad(cs.sale_id::text, 12, '0'),
                 jsonb_build_object(
                     'sale_id', cs.sale_id,
                     'sale_type', case when cs.sale_type = 'walk_in' then 'Walk-in' else 'Call' end,
                     'customer_name', cs.customer_name, 'username', cs.customer_name,
                     'location', cs.location,
                     'payment_method', case when cs.payment_method = 'gcash' then 'GCash' else 'Cash' end,
                     'branch', cs.branch, 'delivered_by', cs.delivered_by,
                     'total_amount', cs.total_amount,
                     'order_day', to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD'),
                     'order_time', to_char(public.rsm_local(cs.sale_date), 'HH12:MI:SS AM'),
                     'sale_sort', to_char(public.rsm_local(cs.sale_date), 'YYYY-MM-DD HH24:MI:SS'),
                     'sale_number', 'S-' || lpad(cs.sale_id::text, 6, '0'))
            from public.counter_sales cs
           where (v_b = 'all' or cs.branch = v_b)
             and public.rsm_local(cs.sale_date)::date between v_start and v_end
      ) u;

    return jsonb_build_object(
        'success', true, 'branch', v_b, 'period', v_period,
        'selected_date', v_selected, 'orders', v_orders);
end $$;

commit;
