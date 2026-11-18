-- Apply once to an existing Supabase project to enable product categorization.

insert into public.product_categories (category_name)
values ('General'), ('Crushed Ice'), ('Ice Tube')
on conflict (category_name) do nothing;

update public.products p
   set category_id = c.category_id
  from public.product_categories c
 where c.category_name = case
        when lower(concat_ws(' ', p.product_name, p.description)) like '%crush%' then 'Crushed Ice'
        when lower(concat_ws(' ', p.product_name, p.description)) like '%tube%' then 'Ice Tube'
       end
   and p.category_id is distinct from c.category_id;

create or replace function public.rsm_admin_products_list(p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    return jsonb_build_object('success', true, 'branch', v_b, 'products', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'product_id', q.product_id, 'product_name', q.product_name,
                   'description', q.description, 'price', q.price,
                   'stock_qty', q.stock, 'is_active', case when q.is_active then 1 else 0 end,
                   'category_name', q.category_name)
               order by q.is_active desc, q.product_name)
        from (select p.product_id, p.product_name, p.description, p.price, p.is_active,
                     c.category_name,
                     coalesce(sum(pbs.stock_qty), 0) as stock
                from public.products p
                left join public.product_categories c on c.category_id = p.category_id
                left join public.product_branch_stock pbs
                  on pbs.product_id = p.product_id and (v_b = 'all' or pbs.branch = v_b)
               where (v_b = 'all' or exists (
                     select 1 from public.product_branch_stock branch_stock
                      where branch_stock.product_id = p.product_id and branch_stock.branch = v_b
                 ))
               group by p.product_id, p.product_name, p.description, p.price, p.is_active, c.category_name) q
    ), '[]'::jsonb));
end $$;

create or replace function public.rsm_admin_product_action(p_input jsonb, p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
    v_action text := coalesce(p_input->>'action', '');
    v_id int := case when coalesce(p_input->>'product_id', '') ~ '^[0-9]{1,9}$'
                     then (p_input->>'product_id')::int end;
    v_name text := trim(coalesce(p_input->>'product_name', ''));
    v_category_name text := trim(coalesce(p_input->>'category_name', ''));
    v_category_id int;
    v_desc text := trim(coalesce(p_input->>'description', ''));
    v_price numeric;
    v_stock int;
    v_existing_active boolean;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    if v_b = 'all' then return public.rsm_fail('Choose one branch before changing its inventory.', 422); end if;

    if v_action = 'delete' then
        if v_id is null or v_id < 1 then return public.rsm_fail('A valid product is required.', 422); end if;
        delete from public.product_branch_stock where product_id = v_id and branch = v_b;
        if not found then return public.rsm_fail('Product not found or already deleted.', 404); end if;
        update public.products set is_active = false
         where product_id = v_id and is_active
           and not exists (select 1 from public.product_branch_stock where product_id = v_id);
        return jsonb_build_object('success', true, 'message', 'Product removed from this branch.');
    end if;

    if v_action in ('archive', 'unarchive') then
        if v_id is null or v_id < 1 then return public.rsm_fail('A valid product is required.', 422); end if;
        update public.products
           set is_active = (v_action = 'unarchive')
         where product_id = v_id
           and is_active = (v_action = 'archive')
           and exists (
               select 1 from public.product_branch_stock
                where product_id = v_id and branch = v_b
           );
        if not found then return public.rsm_fail('Product not found or already updated.', 404); end if;
        return jsonb_build_object(
            'success', true,
            'message', case when v_action = 'archive' then 'Product archived.' else 'Product unarchived.' end
        );
    end if;

    if v_action not in ('create', 'update') then return public.rsm_fail('Unknown product action.', 400); end if;
    if v_action = 'update' and (v_id is null or v_id < 1) then
        return public.rsm_fail('A valid product is required.', 422);
    end if;
    if v_name = '' or char_length(v_name) > 100 then
        return public.rsm_fail('Product name is required and must be at most 100 characters.', 422);
    end if;
    if v_category_name = '' or char_length(v_category_name) > 50 then
        return public.rsm_fail('Choose a product category.', 422);
    end if;
    select category_id into v_category_id
      from public.product_categories
     where category_name = v_category_name;
    if v_category_id is null then
        return public.rsm_fail('Choose a valid product category.', 422);
    end if;

    if coalesce(p_input->>'price', '') ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then
        v_price := (p_input->>'price')::numeric;
    end if;
    if coalesce(p_input->>'stock_qty', '') ~ '^[0-9]{1,9}$' then
        v_stock := (p_input->>'stock_qty')::int;
    end if;
    if v_price is null or v_price <= 0 or v_stock is null or v_stock < 0 then
        return public.rsm_fail('Enter a price above 0 and a stock quantity of 0 or more.', 422);
    end if;

    if v_action = 'update' and exists (
        select 1 from public.products
         where lower(trim(product_name)) = lower(v_name)
           and product_id <> v_id
    ) then
        return public.rsm_fail('A product with this name already exists.', 409);
    end if;

    if v_action = 'create' then
        select p.product_id, p.is_active
          into v_id, v_existing_active
          from public.products p
         where lower(trim(p.product_name)) = lower(v_name)
         order by p.is_active desc, p.product_id
         limit 1
         for update;

        if found then
            if v_existing_active and exists (
                select 1 from public.product_branch_stock
                 where product_id = v_id and branch = v_b
            ) then
                return public.rsm_fail('A product with this name already exists in this branch.', 409);
            end if;
            update public.products
               set product_name = v_name, category_id = v_category_id,
                   description = v_desc, price = v_price, is_active = true
             where product_id = v_id;
        else
            insert into public.products (category_id, product_name, description, price, stock_qty)
            values (v_category_id, v_name, v_desc, v_price, 0) returning product_id into v_id;
        end if;
    else
        update public.products
           set category_id = v_category_id, product_name = v_name, description = v_desc, price = v_price
         where product_id = v_id and is_active;
        if not found then return public.rsm_fail('Product not found or archived.', 404); end if;
    end if;

    insert into public.product_branch_stock (product_id, branch, stock_qty)
    values (v_id, v_b, v_stock)
    on conflict (product_id, branch) do update set stock_qty = excluded.stock_qty;

    return jsonb_build_object('success', true,
        'message', case when v_action = 'create' then 'Product added.' else 'Product updated.' end);
exception when unique_violation then
    return public.rsm_fail('A product with this name already exists.', 409);
end $$;

notify pgrst, 'reload schema';
