-- Generate one historical counter sale per branch per day.
-- Run in the Supabase SQL Editor after the schema and active products are set up.
-- Re-running this script produces the same sample sales and skips those already
-- present. It writes sales history only; product stock is not changed.
begin;

do $$
declare
    v_branches text[] := array['Alangilan', 'Sta Teresita', 'Mabini Lipa', 'San Luis'];
    v_customer_names text[] := array[
        'Alyssa Mendoza', 'Benjamin Cruz', 'Camille Reyes', 'Daniel Santos',
        'Ella Garcia', 'Francis Bautista', 'Gabrielle Flores', 'Hugo Navarro',
        'Isabelle Ramos', 'Jacob Castillo', 'Katrina Aquino', 'Liam Torres',
        'Mikaela Villanueva', 'Nathaniel Perez', 'Olivia Mercado', 'Paolo Dizon',
        'Queenie Rivera', 'Rafael Lim', 'Samantha Gonzales', 'Tristan Mendoza',
        'Una Santiago', 'Vincent Soriano', 'Wendy Fernandez', 'Xavier Abad',
        'Yasmin Dominguez', 'Zachary Valdez'
    ];
    v_delivered_by_names text[] := array[
        'Marco Villanueva', 'Liza Ramos', 'Julius Mercado', 'Rina Castillo',
        'Noel Bautista', 'Grace Navarro'
    ];
    v_alangilan_locations text[] := array[
        'Purok 1, Alangilan, Batangas City',
        'Purok 3, Alangilan, Batangas City',
        'Kumintang Ilaya, Batangas City',
        'Balagtas, Batangas City',
        'Banaba Center, Batangas City'
    ];
    v_sta_teresita_locations text[] := array[
        'Poblacion 1, Sta Teresita',
        'Poblacion 2, Sta Teresita',
        'Sampaga, Sta Teresita',
        'Saimsim, Lipa City',
        'Poblacion, San Nicolas'
    ];
    v_mabini_lipa_locations text[] := array[
        'Mabini Street, Lipa City',
        'Poblacion 5, Lipa City',
        'Sabang, Lipa City',
        'Marawoy, Lipa City',
        'Tambo, Lipa City'
    ];
    v_san_luis_locations text[] := array[
        'Poblacion, San Luis',
        'Bonliw, San Luis',
        'Taliba, San Luis',
        'San Isidro, San Luis',
        'Poblacion, Taal'
    ];
    v_locations text[];
    v_sale_day date;
    v_branch text;
    v_sale_date timestamptz;
    v_customer_name text;
    v_location text;
    v_delivered_by text;
    v_sale_type text;
    v_payment_method text;
    v_item_count integer;
    v_product_ids integer[];
    v_prices numeric[];
    v_quantities integer[];
    v_product_count integer;
    v_quantity integer;
    v_total numeric(10, 2);
    v_sale_id bigint;
    v_item_index integer;
begin
    if not exists (select 1 from public.products where is_active) then
        raise exception 'Add at least one active product before running the dummy sales seed.';
    end if;

    -- Keep generated values stable so the seed can safely be run more than once.
    perform setseed(0.271828);
    select count(*) into v_product_count
      from public.products
     where is_active;

    for v_sale_day in
        select generated_day::date
          from generate_series(date '2026-04-01', date '2026-11-11', interval '1 day') as days(generated_day)
    loop
        foreach v_branch in array v_branches
        loop
            v_locations := case v_branch
                when 'Alangilan' then v_alangilan_locations
                when 'Sta Teresita' then v_sta_teresita_locations
                when 'Mabini Lipa' then v_mabini_lipa_locations
                else v_san_luis_locations
            end;

            v_sale_date := (
                v_sale_day
                + time '07:00'
                + floor(random() * 840)::integer * interval '1 minute'
            ) at time zone 'Asia/Manila';
            v_customer_name := v_customer_names[
                1 + floor(random() * array_length(v_customer_names, 1))::integer
            ];
            v_location := v_locations[
                1 + floor(random() * array_length(v_locations, 1))::integer
            ];
            v_delivered_by := v_delivered_by_names[
                1 + floor(random() * array_length(v_delivered_by_names, 1))::integer
            ];
            v_sale_type := case when random() < 0.65 then 'walk_in' else 'call' end;
            v_payment_method := case when random() < 0.55 then 'cash' else 'gcash' end;
            v_item_count := 1 + floor(random() * least(3, v_product_count))::integer;

            select array_agg(selected.product_id), array_agg(selected.price)
              into v_product_ids, v_prices
              from (
                  select p.product_id, p.price
                    from public.products p
                   where p.is_active
                   order by random()
                   limit v_item_count
              ) as selected;

            v_quantities := array[]::integer[];
            v_total := 0;
            for v_item_index in 1..v_item_count
            loop
                v_quantity := 1 + floor(random() * 10)::integer;
                v_quantities := array_append(v_quantities, v_quantity);
                v_total := v_total + v_prices[v_item_index] * v_quantity;
            end loop;

            if exists (
                select 1
                  from public.counter_sales cs
                 where cs.branch = v_branch
                   and cs.sale_date = v_sale_date
                   and cs.customer_name = v_customer_name
                   and cs.location = v_location
                   and cs.delivered_by = v_delivered_by
            ) then
                continue;
            end if;

            insert into public.counter_sales (
                sale_type, customer_name, location, branch,
                payment_method, delivered_by, total_amount, sale_date
            )
            values (
                v_sale_type, v_customer_name, v_location, v_branch,
                v_payment_method, v_delivered_by, v_total, v_sale_date
            )
            returning sale_id into v_sale_id;

            for v_item_index in 1..v_item_count
            loop
                insert into public.counter_sale_items (
                    sale_id, product_id, quantity, unit_price
                )
                values (
                    v_sale_id,
                    v_product_ids[v_item_index],
                    v_quantities[v_item_index],
                    v_prices[v_item_index]
                );
            end loop;
        end loop;
    end loop;
end
$$;

commit;
