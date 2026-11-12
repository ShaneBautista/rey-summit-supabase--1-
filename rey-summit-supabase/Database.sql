-- =========================================================
--  Rey Summit Ordering System — Database (Supabase / Postgres)
--  Same idea as the old Database.sql: ONE file, run it once.
--  Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--
--  Sections (in order):
--    PART 1  Tables, security rules, storage      (was Database.sql)
--    PART 2  Back-end functions                   (was all the *.php files)
--    PART 3  Sample data + first admin steps      (was the INSERTs at the bottom)
-- =========================================================


-- #########################################################
-- PART 1 — TABLES
-- #########################################################

-- =========================================================
--  Rey Summit Ordering System — Supabase (Postgres) schema
--  Run this first, then 002_functions.sql, then seed.sql.
--
--  Differences from the old MySQL schema:
--   * customers / admins / staff_accounts no longer store passwords.
--     Supabase Auth (auth.users) owns credentials; these tables link to it.
--   * *_password_resets tables are gone (Supabase Auth sends reset emails).
--   * orders gets contact_phone, so delivery_address stays clean instead of
--     having " | Contact: .. | Payment: .." glued on.
--   * All reads/writes go through RLS + the rsm_* functions in 002.
-- =========================================================

-- ---------- time helpers (the shop operates in Philippine time) ----------
create or replace function public.rsm_local(ts timestamptz)
returns timestamp language sql immutable as
$$ select ts at time zone 'Asia/Manila' $$;

create or replace function public.rsm_today()
returns date language sql stable as
$$ select (now() at time zone 'Asia/Manila')::date $$;

create or replace function public.rsm_iso(ts timestamptz)
returns text language sql immutable as
$$ select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

-- ---------- customers ----------
create table public.customers (
    id          uuid primary key references auth.users(id) on delete cascade,
    username    varchar(50)  not null,
    email       varchar(255) not null,
    address     text         not null,
    branch      varchar(50),
    phone       varchar(20)  not null,
    created_at  timestamptz  not null default now(),
    constraint customers_branch_chk
        check (branch is null or branch in ('Alangilan','Sta Teresita','Mabini Lipa','San Luis')),
    constraint customers_phone_chk check (phone ~ '^[0-9]{11}$')
);
create unique index customers_username_key on public.customers (lower(username));
create unique index customers_email_key    on public.customers (lower(email));

-- ---------- support tickets ----------
create table public.support_tickets (
    ticket_id     bigint generated always as identity primary key,
    customer_id   uuid not null references public.customers(id) on delete cascade,
    category      text not null check (category in ('Order issue','Account issue','Delivery issue','Payment issue','Product inquiry','Other')),
    priority      text not null default 'medium' check (priority in ('low','medium','high','urgent')),
    status        text not null default 'open' check (status in ('open','in_progress','pending_customer','resolved','closed')),
    subject       text not null,
    message       text not null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
alter table public.support_tickets enable row level security;

create index support_tickets_customer_idx on public.support_tickets (customer_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status, created_at desc);

-- ---------- admins ----------
create table public.admins (
    admin_id    integer generated always as identity primary key,
    user_id     uuid not null unique references auth.users(id) on delete cascade,
    email       varchar(100) not null unique,
    full_name   varchar(100),
    created_at  timestamptz not null default now()
);

-- ---------- staff_accounts ----------
create table public.staff_accounts (
    staff_id         integer generated always as identity primary key,
    user_id          uuid not null unique references auth.users(id) on delete cascade,
    full_name        varchar(100) not null,
    normalized_name  varchar(100) not null unique,
    email            varchar(190) not null,
    normalized_email varchar(190) not null unique,
    role             text not null check (role in ('sales','delivery')),
    branch           varchar(50) not null default 'Alangilan'
                         check (branch in ('Alangilan','Sta Teresita','Mabini Lipa','San Luis')),
    is_active        boolean not null default true,
    created_at       timestamptz not null default now()
);

-- ---------- catalog ----------
create table public.product_categories (
    category_id   integer generated always as identity primary key,
    category_name varchar(50) not null unique
);

create table public.products (
    product_id   integer generated always as identity primary key,
    category_id  integer references public.product_categories(category_id) on delete set null,
    product_name varchar(100) not null,
    description  text,
    price        numeric(10,2) not null,
    stock_qty    integer not null default 0,      -- legacy total; real stock is per branch
    image_path   varchar(255),
    is_active    boolean not null default true,
    created_at   timestamptz not null default now()
);

create table public.product_branch_stock (
    product_id integer not null references public.products(product_id) on delete cascade,
    branch     varchar(50) not null,
    stock_qty  integer not null default 0 check (stock_qty >= 0),
    primary key (product_id, branch)
);

-- ---------- orders ----------
create table public.orders (
    order_id     bigint generated always as identity primary key,
    customer_id  uuid not null references public.customers(id) on delete cascade,
    order_status text not null default 'pending'
        check (order_status in ('pending','confirmed','preparing','out_for_delivery','completed','cancelled')),
    payment_method text not null default 'cash' check (payment_method in ('cash','gcash')),
    payment_verification_status text not null default 'not_required'
        check (payment_verification_status in ('not_required','pending','approved','rejected')),
    gcash_reference  varchar(80),
    gcash_proof_path varchar(255),            -- object name in the payment-proofs bucket
    payment_reviewed_by_staff_id integer references public.staff_accounts(staff_id) on delete set null,
    payment_reviewed_at timestamptz,
    delivery_address text not null,
    contact_phone    varchar(20),
    total_amount numeric(10,2) not null default 0,
    order_date   timestamptz not null default now(),
    delivered_by_staff_id integer references public.staff_accounts(staff_id) on delete set null,
    branch       varchar(50)
);

create table public.order_items (
    order_item_id bigint generated always as identity primary key,
    order_id   bigint  not null references public.orders(order_id) on delete cascade,
    product_id integer not null references public.products(product_id) on delete restrict,
    quantity   integer not null default 1 check (quantity > 0),
    unit_price numeric(10,2) not null,
    subtotal   numeric(12,2) generated always as (quantity * unit_price) stored
);

-- ---------- counter sales (walk-in / phone) ----------
create table public.counter_sales (
    sale_id       bigint generated always as identity primary key,
    sale_type     text not null check (sale_type in ('walk_in','call')),
    customer_name varchar(100) not null,
    location      varchar(255) not null,
    branch        varchar(50),
    payment_method text not null check (payment_method in ('cash','gcash')),
    delivered_by  varchar(100) not null,
    total_amount  numeric(10,2) not null,
    sale_date     timestamptz not null default now()
);

create table public.counter_sale_items (
    sale_item_id bigint generated always as identity primary key,
    sale_id    bigint  not null references public.counter_sales(sale_id) on delete cascade,
    product_id integer not null references public.products(product_id) on delete restrict,
    quantity   integer not null check (quantity > 0),
    unit_price numeric(10,2) not null
);

-- ---------- saved carts ----------
create table public.customer_cart (
    customer_id uuid    not null references public.customers(id) on delete cascade,
    product_id  integer not null references public.products(product_id) on delete cascade,
    quantity    integer not null default 1 check (quantity > 0),
    updated_at  timestamptz not null default now(),
    primary key (customer_id, product_id)
);

-- ---------- GCash checkout details ----------
create table public.gcash_settings (
    id             integer primary key default 1 check (id = 1),
    mobile_number  text,
    qr_path        text,
    updated_at     timestamptz not null default now()
);
insert into public.gcash_settings (id) values (1) on conflict do nothing;

create or replace function public.rsm_require_gcash_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.payment_method = 'gcash' and not exists (
        select 1 from public.gcash_settings
        where id = 1 and (nullif(trim(mobile_number), '') is not null or qr_path is not null)
    ) then
        raise exception using
            errcode = 'RS001',
            message = 'GCash payment is not available right now. Please choose another payment method.';
    end if;
    return new;
end $$;

drop trigger if exists rsm_orders_require_gcash_settings on public.orders;
create trigger rsm_orders_require_gcash_settings
    before insert on public.orders
    for each row execute function public.rsm_require_gcash_settings();

-- ---------- indexes ----------
create index idx_orders_customer on public.orders(customer_id);
create index idx_orders_status   on public.orders(order_status);
create index idx_orders_branch   on public.orders(branch);
create index idx_orders_date     on public.orders(order_date);
create index idx_staff_branch    on public.staff_accounts(branch);
create index idx_counter_sales_branch on public.counter_sales(branch);
create index idx_items_order     on public.order_items(order_id);
create index idx_items_product   on public.order_items(product_id);

-- ---------- role helpers (used by RLS and the rsm_* functions) ----------
create or replace function public.rsm_is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.rsm_staff_role()
returns text language sql stable security definer set search_path = public as
$$ select role from public.staff_accounts where user_id = auth.uid() and is_active $$;

create or replace function public.rsm_staff_branch()
returns text language sql stable security definer set search_path = public as
$$ select branch from public.staff_accounts where user_id = auth.uid() and is_active $$;

-- ---------- auth hooks ----------
-- Customer sign-up passes account_type='customer' plus profile fields in user metadata.
-- Staff/admin users are created by the admin-staff edge function and never get this flag.
create or replace function public.rsm_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
    if m->>'account_type' = 'customer' then
        insert into public.customers (id, username, email, address, branch, phone)
        values (new.id, trim(m->>'username'), new.email,
                trim(coalesce(m->>'address', '')), nullif(trim(m->>'branch'), ''), trim(m->>'phone'));
    end if;
    return new;
end $$;

drop trigger if exists rsm_on_auth_user_created on auth.users;
create trigger rsm_on_auth_user_created
    after insert on auth.users
    for each row execute function public.rsm_handle_new_user();

-- Keep customers.email in step when a customer changes their auth email.
create or replace function public.rsm_sync_customer_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    update public.customers set email = new.email where id = new.id;
    return new;
end $$;

drop trigger if exists rsm_on_auth_user_email_changed on auth.users;
create trigger rsm_on_auth_user_email_changed
    after update of email on auth.users
    for each row when (old.email is distinct from new.email)
    execute function public.rsm_sync_customer_email();

-- ---------- Row Level Security ----------
alter table public.customers            enable row level security;
alter table public.admins               enable row level security;
alter table public.staff_accounts       enable row level security;
alter table public.product_categories   enable row level security;
alter table public.products             enable row level security;
alter table public.product_branch_stock enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.counter_sales        enable row level security;
alter table public.counter_sale_items   enable row level security;
alter table public.customer_cart        enable row level security;
alter table public.gcash_settings      enable row level security;

-- The public catalog is readable by anyone; everything else is reachable only
-- through the security-definer rsm_* functions (no direct table policies).
create policy "catalog is public"    on public.products           for select using (is_active);
create policy "categories are public" on public.product_categories for select using (true);
create policy "customer reads self"  on public.customers          for select using (id = auth.uid());

-- ---------- Storage: GCash payment proofs (private bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
    set public = false, file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Customers manage files in their own folder: <auth uid>/<file>
create policy "customer uploads own proof" on storage.objects for insert to authenticated
    with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "customer reads own proof" on storage.objects for select to authenticated
    using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "customer deletes own proof" on storage.objects for delete to authenticated
    using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- Sales staff (same branch) and admins can view a proof attached to an order.
-- (A security-definer helper is needed because orders has RLS and no direct policies.)
create or replace function public.rsm_can_view_proof(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.orders o
        where o.gcash_proof_path = p_name
          and (public.rsm_is_admin()
               or (public.rsm_staff_role() = 'sales' and o.branch = public.rsm_staff_branch()))
    )
$$;
grant execute on function public.rsm_can_view_proof(text) to authenticated;

create policy "sales staff or admin read proofs" on storage.objects for select to authenticated
    using (bucket_id = 'payment-proofs' and public.rsm_can_view_proof(name));

-- ---------- Storage: customer-visible GCash QR codes ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gcash-assets', 'gcash-assets', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
    set public = true, file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create policy "public reads gcash qr codes" on storage.objects for select to public
    using (bucket_id = 'gcash-assets');
create policy "admins upload gcash qr codes" on storage.objects for insert to authenticated
    with check (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin());
create policy "admins update gcash qr codes" on storage.objects for update to authenticated
    using (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin())
    with check (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin());
create policy "admins delete gcash qr codes" on storage.objects for delete to authenticated
    using (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin());

-- #########################################################
-- PART 2 — BACK-END FUNCTIONS (replace the PHP files)
-- #########################################################

-- =========================================================
--  Rey Summit — server logic, ported from the PHP endpoints.
--  Every function is SECURITY DEFINER and checks the caller itself
--  (customer / staff / admin) using auth.uid(). Each returns the same
--  JSON shape the old PHP script echoed, so the front end barely changes.
--  Run after 001_schema.sql.
-- =========================================================

-- ---------- small helpers ----------
create or replace function public.rsm_fail(p_msg text, p_status int default 400)
returns jsonb language sql immutable as
$$ select jsonb_build_object('success', false, 'message', p_msg, 'status', p_status) $$;

create or replace function public.rsm_int_branches()
returns text[] language sql immutable as
$$ select array['Alangilan','Sta Teresita','Mabini Lipa','San Luis'] $$;

-- Parses [{product_id, quantity}, ...]; invalid values come back as NULL.
create or replace function public.rsm_int_parse_items(p_items jsonb)
returns table (ord bigint, product_id int, quantity int)
language sql immutable as $$
    select t.ord,
           case when jsonb_typeof(t.e) = 'object' and coalesce(t.e->>'product_id', '') ~ '^[0-9]{1,9}$'
                then (t.e->>'product_id')::int end,
           case when jsonb_typeof(t.e) = 'object' and coalesce(t.e->>'quantity', '') ~ '^[0-9]{1,9}$'
                then (t.e->>'quantity')::int end
    from jsonb_array_elements(
             case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
         ) with ordinality as t(e, ord)
$$;

-- Online orders + counter sales as one stream (used by the dashboards).
create or replace function public.rsm_int_sales_rows()
returns table (total_amount numeric, sale_date timestamptz, branch text, order_status text)
language sql security definer set search_path = public as $$
    select o.total_amount, o.order_date, coalesce(o.branch, c.branch)::text, o.order_status
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.order_status <> 'cancelled'
    union all
    select cs.total_amount, cs.sale_date,
           coalesce(nullif(cs.branch, ''),
                    case when cs.location = any (public.rsm_int_branches()) then cs.location end)::text,
           'completed'
    from public.counter_sales cs
$$;

create or replace function public.rsm_int_item_rows()
returns table (product_id int, quantity int, sale_date timestamptz, branch text)
language sql security definer set search_path = public as $$
    select oi.product_id, oi.quantity, o.order_date, coalesce(o.branch, c.branch)::text
    from public.order_items oi
    join public.orders o on o.order_id = oi.order_id
    join public.customers c on c.id = o.customer_id
    where o.order_status <> 'cancelled'
    union all
    select csi.product_id, csi.quantity, cs.sale_date, cs.branch::text
    from public.counter_sale_items csi join public.counter_sales cs on cs.sale_id = csi.sale_id
$$;

-- =========================================================
--  PUBLIC (anon) — login lookup, registration pre-check, catalog
-- =========================================================

-- Customers log in with a username; Supabase Auth wants an email.
create or replace function public.rsm_login_email(p_username text)
returns text language sql security definer set search_path = public as $$
    select email from public.customers where lower(username) = lower(trim(p_username)) limit 1
$$;

-- Mirrors the validation in the old Register.php. Returns NULL when OK, else the message.
create or replace function public.rsm_check_registration(
    p_username text, p_email text, p_branch text, p_phone text)
returns text language plpgsql security definer set search_path = public as $$
declare
    v_user text := trim(coalesce(p_username, ''));
    v_email text := trim(coalesce(p_email, ''));
begin
    if v_user = '' or v_email = '' or trim(coalesce(p_phone, '')) = '' then
        return 'All fields are required.';
    end if;
    if trim(coalesce(p_branch, '')) <> ''
       and not (trim(p_branch) = any (public.rsm_int_branches())) then
        return 'Please select a valid branch.';
    end if;
    if char_length(v_user) > 50 then return 'Username is too long.'; end if;
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        return 'Please enter a valid email address.';
    end if;
    if trim(p_phone) !~ '^09[0-9]{9}$' then
        return 'Phone number must be exactly 11 digits and start with 09.';
    end if;
    if exists (select 1 from public.customers where lower(username) = lower(v_user)) then
        return 'That username is already taken.';
    end if;
    if exists (select 1 from public.customers where lower(email) = lower(v_email))
       or exists (select 1 from auth.users where lower(email) = lower(v_email)) then
        return 'That email is already registered.';
    end if;
    return null;
end $$;

create or replace function public.rsm_get_products()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_is_customer boolean := false;
    v_branch text;
begin
    if v_uid is not null then
        select true, branch into v_is_customer, v_branch from public.customers where id = v_uid;
        v_is_customer := coalesce(v_is_customer, false);
    end if;

    return jsonb_build_object('success', true, 'products', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'product_id', x.product_id, 'product_name', x.product_name,
                   'description', x.description, 'price', x.price, 'stock_qty', x.stock_qty,
                   'image_path', x.image_path, 'category_name', x.category_name)
               order by x.category_name nulls first, x.product_name)
        from (
            select p.product_id, p.product_name, p.description, p.price,
                   case when v_is_customer then coalesce(pbs.stock_qty, 0) else p.stock_qty end as stock_qty,
                   p.image_path, c.category_name
            from public.products p
            left join public.product_branch_stock pbs
                   on v_is_customer and pbs.product_id = p.product_id and pbs.branch = v_branch
            left join public.product_categories c on c.category_id = p.category_id
            where p.is_active
              and (not v_is_customer or exists (
                  select 1 from public.product_branch_stock branch_stock
                   where branch_stock.product_id = p.product_id and branch_stock.branch = v_branch
              ))
        ) x
    ), '[]'::jsonb));
end $$;

-- =========================================================
--  CUSTOMER
-- =========================================================

create or replace function public.rsm_get_account()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.customers%rowtype;
begin
    select * into v_row from public.customers where id = auth.uid();
    if not found then
        return public.rsm_fail('Please log in to view your account details.', 401);
    end if;
    return jsonb_build_object('success', true, 'account', jsonb_build_object(
        'username', v_row.username, 'email', v_row.email, 'address', v_row.address,
        'branch', v_row.branch, 'phone', v_row.phone));
end $$;

-- Updates address / branch / phone. Email changes are applied by the client through
-- supabase.auth.updateUser (a trigger then mirrors it into customers.email);
-- this function just tells the client whether the email differs.
create or replace function public.rsm_update_account(
    p_email text, p_branch text, p_address text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_row public.customers%rowtype;
    v_email text := trim(coalesce(p_email, ''));
    v_address text := trim(coalesce(p_address, ''));
    v_phone text := trim(coalesce(p_phone, ''));
begin
    select * into v_row from public.customers where id = auth.uid() for update;
    if not found then
        return public.rsm_fail('Please log in to view your account details.', 401);
    end if;
    if v_email = '' then return public.rsm_fail('Email is required.', 400); end if;
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        return public.rsm_fail('Please enter a valid email address.', 400);
    end if;
    if p_branch is null or not (p_branch = any (public.rsm_int_branches())) then
        return public.rsm_fail('Please select a valid branch.', 400);
    end if;
    if v_address = '' then return public.rsm_fail('Delivery address is required.', 400); end if;
    if v_phone !~ '^[0-9]{11}$' then
        return public.rsm_fail('Contact number must be exactly 11 digits.', 400);
    end if;

    update public.customers set branch = p_branch, address = v_address, phone = v_phone
    where id = v_row.id;

    return jsonb_build_object('success', true,
                              'email_changed', lower(v_email) <> lower(v_row.email));
end $$;

create or replace function public.rsm_create_support_ticket(
    p_subject text, p_category text, p_priority text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_subject text := trim(coalesce(p_subject, ''));
    v_message text := trim(coalesce(p_message, ''));
    v_category text := lower(trim(coalesce(p_category, '')));
    v_priority text := lower(trim(coalesce(p_priority, 'medium')));
    v_ticket_id bigint;
begin
    if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
        return public.rsm_fail('Please log in to create a support ticket.', 401);
    end if;
    if v_subject = '' or char_length(v_subject) > 150 then
        return public.rsm_fail('Please keep the ticket subject between 1 and 150 characters.', 400);
    end if;
    if v_message = '' or char_length(v_message) > 2000 then
        return public.rsm_fail('Please enter a ticket message between 1 and 2000 characters.', 400);
    end if;
    if v_category not in ('order issue','account issue','delivery issue','payment issue','product inquiry','other') then
        return public.rsm_fail('Please choose a valid ticket category.', 400);
    end if;
    if v_priority not in ('low','medium','high','urgent') then
        return public.rsm_fail('Please choose a valid priority level.', 400);
    end if;

    insert into public.support_tickets (customer_id, category, priority, subject, message)
    values (
        v_uid,
        case v_category
            when 'order issue' then 'Order issue'
            when 'account issue' then 'Account issue'
            when 'delivery issue' then 'Delivery issue'
            when 'payment issue' then 'Payment issue'
            when 'product inquiry' then 'Product inquiry'
            when 'other' then 'Other'
        end,
        v_priority,
        v_subject,
        v_message
    )
    returning ticket_id into v_ticket_id;

    return jsonb_build_object(
        'success', true,
        'ticket_id', v_ticket_id,
        'message', 'Support ticket submitted successfully.'
    );
end $$;

create or replace function public.rsm_get_my_support_tickets()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
begin
    if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
        return public.rsm_fail('Please log in to view your support tickets.', 401);
    end if;

    return jsonb_build_object(
        'success', true,
        'tickets', coalesce((
            select jsonb_agg(jsonb_build_object(
                'ticket_id', st.ticket_id,
                'category', st.category,
                'priority', st.priority,
                'status', st.status,
                'subject', st.subject,
                'message', st.message,
                'created_at', public.rsm_iso(st.created_at),
                'updated_at', public.rsm_iso(st.updated_at)
            ) order by st.created_at desc)
            from public.support_tickets st
            where st.customer_id = v_uid
        ), '[]'::jsonb)
    );
end $$;

create or replace function public.rsm_admin_support_tickets()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
    if not public.rsm_is_admin() then
        return public.rsm_fail('Admin access required.', 401);
    end if;

    return jsonb_build_object(
        'success', true,
        'tickets', coalesce((
            select jsonb_agg(jsonb_build_object(
                'ticket_id', st.ticket_id,
                'customer_id', st.customer_id,
                'username', c.username,
                'email', c.email,
                'branch', c.branch,
                'category', st.category,
                'priority', st.priority,
                'status', st.status,
                'subject', st.subject,
                'message', st.message,
                'created_at', public.rsm_iso(st.created_at),
                'updated_at', public.rsm_iso(st.updated_at)
            ) order by st.created_at desc)
            from public.support_tickets st
            join public.customers c on c.id = st.customer_id
        ), '[]'::jsonb)
    );
end $$;

create or replace function public.rsm_update_support_ticket_status(
    p_ticket_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_status text := lower(trim(coalesce(p_status, '')));
begin
    if not public.rsm_is_admin() then
        return public.rsm_fail('Admin access required.', 401);
    end if;
    if p_ticket_id is null or p_ticket_id < 1 then
        return public.rsm_fail('Invalid ticket ID.', 400);
    end if;
    if v_status not in ('open','in_progress','pending_customer','resolved','closed') then
        return public.rsm_fail('Please choose a valid ticket status.', 400);
    end if;

    if not exists (select 1 from public.support_tickets where ticket_id = p_ticket_id) then
        return public.rsm_fail('Ticket not found.', 404);
    end if;

    update public.support_tickets
       set status = v_status, updated_at = now()
     where ticket_id = p_ticket_id;

    return jsonb_build_object('success', true, 'message', 'Ticket status updated.');
end $$;

create or replace function public.rsm_get_cart()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
    if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
        return public.rsm_fail('Please log in to save your cart.', 401);
    end if;
    return jsonb_build_object('success', true, 'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'product_id', p.product_id, 'product_name', p.product_name,
                   'description', p.description, 'price', p.price,
                   'stock_qty', coalesce(pbs.stock_qty, 0), 'image_path', p.image_path,
                   'category_name', pc.category_name, 'quantity', cc.quantity))
        from public.customer_cart cc
        join public.products p on p.product_id = cc.product_id and p.is_active
        join public.customers cu on cu.id = cc.customer_id
        left join public.product_branch_stock pbs
               on pbs.product_id = p.product_id and pbs.branch = cu.branch
        left join public.product_categories pc on pc.category_id = p.category_id
        where cc.customer_id = v_uid
    ), '[]'::jsonb));
end $$;

create or replace function public.rsm_save_cart(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_branch text;
begin
    select branch into v_branch from public.customers where id = v_uid;
    if not found then return public.rsm_fail('Please log in to save your cart.', 401); end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        return public.rsm_fail('Invalid cart data.', 400);
    end if;
    if exists (select 1 from public.rsm_int_parse_items(p_items) i
               where i.product_id is null or i.quantity is null or i.quantity < 1 or i.product_id < 1) then
        return public.rsm_fail('Cart quantities must be positive whole numbers.', 400);
    end if;

    -- last entry per product wins (same as the old PHP array assignment)
    create temporary table if not exists rsm_tmp_cart (product_id int, quantity int) on commit drop;
    truncate rsm_tmp_cart;
    insert into rsm_tmp_cart
        select distinct on (product_id) product_id, quantity
        from public.rsm_int_parse_items(p_items) order by product_id, ord desc;

    if exists (
        select 1 from rsm_tmp_cart i
        left join public.products p on p.product_id = i.product_id and p.is_active
        left join public.product_branch_stock pbs
               on pbs.product_id = i.product_id and pbs.branch = v_branch
        where p.product_id is null or i.quantity > coalesce(pbs.stock_qty, 0)
    ) then
        return public.rsm_fail('A cart item is unavailable or exceeds current stock.', 400);
    end if;

    delete from public.customer_cart where customer_id = v_uid;
    insert into public.customer_cart (customer_id, product_id, quantity)
        select v_uid, product_id, quantity from rsm_tmp_cart;
    return jsonb_build_object('success', true);
exception when others then
    raise log 'rsm_save_cart failed: %', sqlerrm;
    return public.rsm_fail('Could not save your cart.', 500);
end $$;

-- The proof image is uploaded to Storage by the browser first; this just records its path.
create or replace function public.rsm_place_order(
    p_cart jsonb, p_payment_method text, p_gcash_reference text, p_proof_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_c public.customers%rowtype;
    v_method text := lower(trim(coalesce(p_payment_method, '')));
    v_ref text := trim(coalesce(p_gcash_reference, ''));
    v_total numeric := 0;
    v_lines jsonb := '[]'::jsonb;
    v_order_id bigint;
    r record;
begin
    if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
        return public.rsm_fail('Please log in before placing an order.', 401);
    end if;
    if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
        return public.rsm_fail('Your cart is empty.', 400);
    end if;
    if v_method not in ('cash', 'gcash') then
        return public.rsm_fail('Please select a valid payment method.', 400);
    end if;
    if v_method = 'gcash' then
        if v_ref !~ '^[A-Za-z0-9-]{6,80}$' then
            return public.rsm_fail('Enter a valid GCash reference number.', 400);
        end if;
        if p_proof_path is null
           or split_part(p_proof_path, '/', 1) <> v_uid::text
           or not exists (select 1 from storage.objects
                          where bucket_id = 'payment-proofs' and name = p_proof_path) then
            return public.rsm_fail('Please upload a valid proof of payment.', 400);
        end if;
    end if;

    begin
        select * into v_c from public.customers where id = v_uid for update;
        if trim(v_c.address) = '' or v_c.phone !~ '^[0-9]{11}$'
           or v_c.branch is null or not (v_c.branch = any (public.rsm_int_branches())) then
            raise exception using errcode = 'RS001',
                message = 'Please add your address and a valid contact number in Account before placing an order.';
        end if;

        -- re-price every line from the database; never trust browser prices
        for r in
            select i.product_id, sum(i.q)::int as qty, p.product_name, p.price,
                   coalesce(pbs.stock_qty, 0) as stock
            from (select product_id, greatest(1, coalesce(quantity, 1)) as q
                  from public.rsm_int_parse_items(p_cart)) i
            left join public.products p on p.product_id = i.product_id and p.is_active
            left join public.product_branch_stock pbs
                   on pbs.product_id = i.product_id and pbs.branch = v_c.branch
            group by i.product_id, p.product_name, p.price, pbs.stock_qty
            order by i.product_id
        loop
            if r.product_name is null then
                raise exception using errcode = 'RS001',
                    message = 'One of the items in your cart is no longer available.';
            end if;
            if r.qty > r.stock then
                raise exception using errcode = 'RS001',
                    message = format('Not enough stock for "%s".', r.product_name);
            end if;
            v_total := v_total + r.price * r.qty;
            v_lines := v_lines || jsonb_build_object(
                'product_id', r.product_id, 'qty', r.qty, 'price', r.price);
        end loop;

        insert into public.orders (customer_id, order_status, payment_method,
                                   payment_verification_status, gcash_reference, gcash_proof_path,
                                   delivery_address, contact_phone, total_amount, branch)
        values (v_uid, 'pending', v_method,
                case when v_method = 'gcash' then 'pending' else 'not_required' end,
                case when v_method = 'gcash' then v_ref end,
                case when v_method = 'gcash' then p_proof_path end,
                trim(v_c.address), trim(v_c.phone), v_total, v_c.branch)
        returning order_id into v_order_id;

        for r in select * from jsonb_to_recordset(v_lines) as x(product_id int, qty int, price numeric)
        loop
            insert into public.order_items (order_id, product_id, quantity, unit_price)
            values (v_order_id, r.product_id, r.qty, r.price);

            update public.product_branch_stock set stock_qty = stock_qty - r.qty
            where product_id = r.product_id and branch = v_c.branch and stock_qty >= r.qty;
            if not found then
                raise exception using errcode = 'RS001',
                    message = 'Stock changed while placing your order. Please try again.';
            end if;
        end loop;

        delete from public.customer_cart where customer_id = v_uid;

        return jsonb_build_object('success', true, 'message', 'Order placed successfully!',
                                  'order_id', v_order_id,
                                  'redirect', 'order_confirmation.html?order_id=' || v_order_id);
    exception
        when sqlstate 'RS001' then return public.rsm_fail(sqlerrm, 400);
        when others then
            raise log 'rsm_place_order failed: %', sqlerrm;
            return public.rsm_fail('Server error. Please try again.', 500);
    end;
end $$;

create or replace function public.rsm_get_order(p_order_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    o record;
begin
    if v_uid is null then return public.rsm_fail('Please log in to view this order.', 401); end if;
    if p_order_id is null or p_order_id <= 0 then
        return public.rsm_fail('Missing or invalid order_id.', 400);
    end if;

    select ord.*, c.username, c.phone, sa.full_name as delivered_by_name
      into o
      from public.orders ord
      join public.customers c on c.id = ord.customer_id
      left join public.staff_accounts sa on sa.staff_id = ord.delivered_by_staff_id
     where ord.order_id = p_order_id;
    if not found then return public.rsm_fail('Order not found.', 404); end if;
    if o.customer_id <> v_uid then
        return public.rsm_fail('You don''t have access to this order.', 403);
    end if;

    return jsonb_build_object(
        'success', true,
        'order', jsonb_build_object(
            'order_id', o.order_id, 'customer_id', o.customer_id,
            'order_status', o.order_status,
            -- same display string the PHP app built: address | Contact | Payment
            'delivery_address', o.delivery_address
                || coalesce(' | Contact: ' || nullif(coalesce(o.contact_phone, o.phone), ''), '')
                || ' | Payment: ' || case when o.payment_method = 'gcash' then 'GCash' else 'Cash' end,
            'total_amount', o.total_amount, 'order_date', public.rsm_iso(o.order_date),
            'payment_method', o.payment_method,
            'payment_verification_status', o.payment_verification_status,
            'username', o.username, 'phone', o.phone,
            'delivered_by_name', o.delivered_by_name),
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'product_id', oi.product_id, 'product_name', p.product_name,
                       'quantity', oi.quantity, 'unit_price', oi.unit_price,
                       'subtotal', oi.subtotal) order by oi.order_item_id)
            from public.order_items oi join public.products p on p.product_id = oi.product_id
            where oi.order_id = o.order_id), '[]'::jsonb));
end $$;

create or replace function public.rsm_get_my_orders(p_tracking boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
    if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
        return public.rsm_fail('Please log in to view your orders.', 401);
    end if;
    return jsonb_build_object('success', true, 'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'order_id', t.order_id, 'order_status', t.order_status,
                   'total_amount', t.total_amount, 'order_date', public.rsm_iso(t.order_date),
                   'payment_method', t.payment_method,
                   'payment_verification_status', t.payment_verification_status)
               order by t.order_date desc)
        from (
            select * from public.orders o
            where o.customer_id = v_uid
              and (not coalesce(p_tracking, false) or o.order_status <> 'cancelled')
            order by o.order_date desc
            limit case when coalesce(p_tracking, false) then 20 end
        ) t
    ), '[]'::jsonb));
end $$;

-- Returns old_proof_path so the browser can delete the replaced image from Storage.
create or replace function public.rsm_resubmit_payment_proof(
    p_order_id bigint, p_reference text, p_proof_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_ref text := trim(coalesce(p_reference, ''));
    v_old text;
begin
    if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
        return public.rsm_fail('Please log in to update your payment proof.', 401);
    end if;
    if p_order_id is null or p_order_id < 1 or v_ref !~ '^[A-Za-z0-9-]{6,80}$' then
        return public.rsm_fail('Enter a valid GCash reference number.', 400);
    end if;
    if p_proof_path is null or split_part(p_proof_path, '/', 1) <> v_uid::text
       or not exists (select 1 from storage.objects
                      where bucket_id = 'payment-proofs' and name = p_proof_path) then
        return public.rsm_fail('Please upload a valid proof of payment.', 400);
    end if;

    select gcash_proof_path into v_old from public.orders
     where order_id = p_order_id and customer_id = v_uid and order_status = 'pending'
       and payment_method = 'gcash' and payment_verification_status = 'rejected'
     for update;
    if not found then
        return public.rsm_fail('This order is not waiting for a replacement proof.', 409);
    end if;

    update public.orders
       set gcash_reference = v_ref, gcash_proof_path = p_proof_path,
           payment_verification_status = 'pending',
           payment_reviewed_by_staff_id = null, payment_reviewed_at = null
     where order_id = p_order_id and customer_id = v_uid;

    return jsonb_build_object('success', true,
                              'message', 'Your new proof was submitted for review.',
                              'old_proof_path', v_old);
end $$;

-- =========================================================
--  STAFF / ADMIN IDENTITY
-- =========================================================

-- Used by the combined Admin & Staff login page to decide where to send the user.
create or replace function public.rsm_whoami()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; s record;
begin
    select * into a from public.admins where user_id = auth.uid();
    if found then
        return jsonb_build_object('type', 'admin', 'name', coalesce(a.full_name, 'Administrator'));
    end if;
    select * into s from public.staff_accounts where user_id = auth.uid() and is_active;
    if found then
        return jsonb_build_object('type', 'staff', 'role', s.role, 'branch', s.branch, 'name', s.full_name);
    end if;
    return null;
end $$;

-- =========================================================
--  STAFF QUEUE
-- =========================================================

create or replace function public.rsm_staff_orders()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    s record;
    v_statuses text[];
begin
    select * into s from public.staff_accounts where user_id = auth.uid() and is_active;
    if not found then return public.rsm_fail('Staff login required.', 401); end if;

    v_statuses := case when s.role = 'sales' then array['pending','confirmed']
                       else array['preparing','out_for_delivery'] end;

    return jsonb_build_object(
        'success', true,
        'staff', jsonb_build_object('name', s.full_name, 'role', s.role, 'branch', s.branch),
        'orders', coalesce((
            select jsonb_agg(jsonb_build_object(
                'order_id', o.order_id, 'order_status', o.order_status,
                'total_amount', o.total_amount, 'delivery_address', o.delivery_address,
                'payment_method', case when o.payment_method = 'gcash' then 'GCash' else 'Cash' end,
                'payment_verification_status', o.payment_verification_status,
                'gcash_reference', o.gcash_reference,
                'order_date', public.rsm_iso(o.order_date),
                'order_day', to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD'),
                'order_time', to_char(public.rsm_local(o.order_date), 'HH12:MI AM'),
                'username', c.username, 'phone', c.phone,
                'contact_phone', coalesce(o.contact_phone, c.phone),
                'has_payment_proof', o.gcash_proof_path is not null,
                -- only sales staff may fetch proof images (the browser signs this path)
                'proof_path', case when s.role = 'sales' then o.gcash_proof_path end,
                'items', coalesce((
                    select jsonb_agg(jsonb_build_object(
                               'order_id', oi.order_id, 'product_name', p.product_name,
                               'quantity', oi.quantity, 'unit_price', oi.unit_price)
                           order by oi.order_item_id)
                    from public.order_items oi join public.products p on p.product_id = oi.product_id
                    where oi.order_id = o.order_id), '[]'::jsonb)
            ) order by o.order_date asc)
            from public.orders o join public.customers c on c.id = o.customer_id
            where o.order_status = any (v_statuses) and o.branch = s.branch
        ), '[]'::jsonb));
end $$;

create or replace function public.rsm_staff_update_order(
    p_order_id bigint, p_status text, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    s record;
    o record;
    v_next text;
    v_decision text := coalesce(p_decision, '');
begin
    select * into s from public.staff_accounts where user_id = auth.uid() and is_active;
    if not found then return public.rsm_fail('Staff login required.', 401); end if;
    if p_order_id is null or p_order_id < 1 then
        return public.rsm_fail('Invalid order update.', 400);
    end if;

    -- ---- GCash payment review (sales only) ----
    if v_decision <> '' then
        if s.role <> 'sales' or v_decision not in ('approve', 'reject') then
            return public.rsm_fail('Invalid payment review.', 400);
        end if;
        select order_status, payment_method, payment_verification_status, gcash_proof_path
          into o from public.orders
         where order_id = p_order_id and branch = s.branch for update;
        if not found or o.order_status <> 'pending' or o.payment_method <> 'gcash'
           or o.payment_verification_status <> 'pending' or coalesce(o.gcash_proof_path, '') = '' then
            return public.rsm_fail('This payment proof is no longer waiting for review. Refresh the queue and try again.', 409);
        end if;
        update public.orders
           set payment_verification_status = case when v_decision = 'approve' then 'approved' else 'rejected' end,
               payment_reviewed_by_staff_id = s.staff_id, payment_reviewed_at = now()
         where order_id = p_order_id and branch = s.branch;
        return jsonb_build_object('success', true, 'message',
            case when v_decision = 'approve'
                 then 'GCash payment approved. You can now confirm the order.'
                 else 'GCash proof rejected. The customer will need to submit new proof.' end);
    end if;

    -- ---- status transition ----
    select order_status, payment_method, payment_verification_status
      into o from public.orders
     where order_id = p_order_id and branch = s.branch for update;

    if p_status = 'cancelled' then
        if not found or not (
            (s.role = 'sales' and o.order_status in ('pending','confirmed'))
            or (s.role = 'delivery' and o.order_status in ('preparing','out_for_delivery'))
        ) then
            return public.rsm_fail('This order has changed. Refresh the queue and try again.', 409);
        end if;
        update public.orders set order_status = 'cancelled'
         where order_id = p_order_id and branch = s.branch;
        return jsonb_build_object('success', true, 'message', 'Order cancelled.');
    end if;

    v_next := case
        when s.role = 'sales' and o.order_status = 'pending'   then 'confirmed'
        when s.role = 'sales' and o.order_status = 'confirmed' then 'preparing'
        when s.role = 'delivery' and o.order_status = 'preparing'        then 'out_for_delivery'
        when s.role = 'delivery' and o.order_status = 'out_for_delivery' then 'completed'
    end;

    if p_status is null or p_status not in ('confirmed','preparing','out_for_delivery','completed','cancelled') then
        return public.rsm_fail('Invalid order update.', 400);
    end if;
    if not found or v_next is null or v_next <> p_status then
        return public.rsm_fail('This order has changed. Refresh the queue and try again.', 409);
    end if;
    if s.role = 'sales' and o.order_status = 'pending' and o.payment_method = 'gcash'
       and o.payment_verification_status <> 'approved' then
        return public.rsm_fail('Approve the GCash payment before confirming this order.', 409);
    end if;

    if s.role = 'delivery' and p_status = 'completed' then
        update public.orders set order_status = p_status, delivered_by_staff_id = s.staff_id
         where order_id = p_order_id and branch = s.branch;
    else
        update public.orders set order_status = p_status
         where order_id = p_order_id and branch = s.branch;
    end if;

    return jsonb_build_object('success', true, 'message',
        case when s.role = 'sales' and p_status = 'preparing'
                  then 'Order started and handed off to the delivery queue.'
             when s.role = 'delivery' and p_status = 'out_for_delivery'
                  then 'Order marked out for delivery.'
             else 'Order marked delivered.' end);
end $$;

-- =========================================================
--  ADMIN
--  p_branch is the branch picker in the UI ('all' or one branch).
-- =========================================================

create or replace function public.rsm_admin_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
    select * into a from public.admins where user_id = auth.uid();
    if not found then return public.rsm_fail('Admin login required.', 401); end if;
    return jsonb_build_object('success', true,
                              'admin', jsonb_build_object('name', coalesce(a.full_name, 'Administrator')));
end $$;

create or replace function public.rsm_admin_dashboard_data(p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
    v_today date := public.rsm_today();
    v_name text;
    v_products jsonb; v_orders jsonb; v_monthly jsonb; v_recent jsonb; v_daily jsonb;
    v_statuses jsonb; v_top jsonb; v_cats jsonb; v_forecast jsonb; v_history jsonb;
    v_open int; v_delivered int; v_total_recent int;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    select coalesce(full_name, 'Administrator') into v_name from public.admins where user_id = auth.uid();

    select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', q.product_id, 'product_name', q.product_name,
               'price', q.price, 'stock_qty', q.stock) order by q.stock asc, q.product_name), '[]')
      into v_products
      from (select p.product_id, p.product_name, p.price, coalesce(sum(pbs.stock_qty), 0) as stock
              from public.products p
              left join public.product_branch_stock pbs
                     on pbs.product_id = p.product_id and (v_b = 'all' or pbs.branch = v_b)
             where p.is_active
             group by p.product_id, p.product_name, p.price) q;

    select coalesce(jsonb_agg(jsonb_build_object(
               'order_id', t.order_id, 'order_status', t.order_status, 'total_amount', t.total_amount,
               'delivery_address', t.delivery_address, 'order_date', public.rsm_iso(t.order_date),
               'username', t.username) order by t.order_date desc), '[]')
      into v_orders
      from (select o.*, c.username
              from public.orders o join public.customers c on c.id = o.customer_id
             where v_b = 'all' or coalesce(o.branch, c.branch) = v_b
             order by o.order_date desc limit 20) t;

    select jsonb_build_object('revenue', coalesce(sum(total_amount), 0), 'order_count', count(*))
      into v_monthly from public.rsm_int_sales_rows() s
     where (v_b = 'all' or s.branch = v_b)
       and public.rsm_local(s.sale_date)::date between date_trunc('month', v_today)::date and v_today;

    select jsonb_build_object('revenue', coalesce(sum(total_amount), 0), 'order_count', count(*))
      into v_recent from public.rsm_int_sales_rows() s
     where (v_b = 'all' or s.branch = v_b)
       and public.rsm_local(s.sale_date)::date between v_today - 7 and v_today;

    select coalesce(jsonb_agg(jsonb_build_object('sale_date', to_char(d.day, 'YYYY-MM-DD'), 'revenue', d.revenue)
                              order by d.day), '[]')
      into v_daily
      from (select public.rsm_local(s.sale_date)::date as day, sum(s.total_amount) as revenue
              from public.rsm_int_sales_rows() s
             where (v_b = 'all' or s.branch = v_b)
               and public.rsm_local(s.sale_date)::date between v_today - 6 and v_today
             group by 1) d;

    select coalesce(jsonb_agg(jsonb_build_object('order_status', g.order_status, 'order_count', g.n)), '[]')
      into v_statuses
      from (select s.order_status, count(*) as n from public.rsm_int_sales_rows() s
             where (v_b = 'all' or s.branch = v_b)
               and public.rsm_local(s.sale_date)::date between date_trunc('month', v_today)::date and v_today
             group by s.order_status) g;

    select coalesce(jsonb_agg(jsonb_build_object('product_name', g.product_name, 'units_sold', g.units)
                              order by g.units desc, g.product_name), '[]')
      into v_top
      from (select p.product_name, sum(i.quantity) as units
              from public.rsm_int_item_rows() i join public.products p on p.product_id = i.product_id
             where (v_b = 'all' or i.branch = v_b)
               and public.rsm_local(i.sale_date)::date between v_today - 29 and v_today
             group by p.product_id, p.product_name
             order by units desc, p.product_name limit 5) g;

    select coalesce(jsonb_agg(jsonb_build_object('category_name', g.cat, 'units', g.units)
                              order by g.units desc), '[]')
      into v_cats
      from (select coalesce(pc.category_name, 'Uncategorised') as cat, sum(i.quantity) as units
              from public.rsm_int_item_rows() i
              left join public.products p on p.product_id = i.product_id
              left join public.product_categories pc on pc.category_id = p.category_id
             where (v_b = 'all' or i.branch = v_b)
             group by 1 order by units desc limit 5) g;

    select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', q.product_id, 'product_name', q.product_name,
               'price', q.price, 'stock_qty', q.stock) order by q.product_name), '[]')
      into v_forecast
      from (select p.product_id, p.product_name, p.price, coalesce(sum(pbs.stock_qty), 0) as stock
              from public.products p
              left join public.product_branch_stock pbs
                     on pbs.product_id = p.product_id and (v_b = 'all' or pbs.branch = v_b)
             where p.is_active
             group by p.product_id, p.product_name, p.price) q;

    -- {product_id: {"YYYY-MM-DD": units}}; the browser turns this into the 7-day forecast
    select coalesce(jsonb_object_agg(y.pid, y.days), '{}')
      into v_history
      from (select x.product_id::text as pid, jsonb_object_agg(x.d, x.units) as days
              from (select i.product_id,
                           to_char(public.rsm_local(i.sale_date)::date, 'YYYY-MM-DD') as d,
                           sum(i.quantity) as units
                      from public.rsm_int_item_rows() i
                      join public.products p on p.product_id = i.product_id and p.is_active
                     where (v_b = 'all' or i.branch = v_b)
                       and public.rsm_local(i.sale_date)::date between v_today - 60 and v_today
                     group by 1, 2) x
             group by x.product_id) y;

    select count(*) into v_open
      from public.orders o join public.customers c on c.id = o.customer_id
     where o.order_status in ('pending','confirmed','preparing','out_for_delivery')
       and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b);

    select count(*) into v_delivered from public.rsm_int_sales_rows() s
     where s.order_status = 'completed' and (v_b = 'all' or s.branch = v_b)
       and public.rsm_local(s.sale_date)::date between v_today - 30 and v_today;

    select count(*) into v_total_recent from public.rsm_int_sales_rows() s
     where (v_b = 'all' or s.branch = v_b)
       and public.rsm_local(s.sale_date)::date between v_today - 30 and v_today;

    return jsonb_build_object(
        'success', true, 'admin', jsonb_build_object('name', v_name), 'branch', v_b,
        'products', v_products, 'orders', v_orders, 'monthly', v_monthly, 'recent', v_recent,
        'daily_revenue', v_daily, 'monthly_statuses', v_statuses, 'top_products', v_top,
        'categories', v_cats, 'forecast_products', v_forecast, 'daily_history', v_history,
        'open_deliveries', v_open, 'recent_sales_count', v_total_recent,
        'fulfillment_rate', case when v_total_recent > 0
                                 then round(v_delivered::numeric / v_total_recent * 100) else 0 end);
end $$;

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
      from (select s.order_status, count(*) as n
              from public.rsm_int_sales_rows() s
             where (v_b = 'all' or s.branch = v_b)
               and public.rsm_local(s.sale_date)::date between v_start and v_end
             group by s.order_status) g;

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

    return jsonb_build_object(
        'success', true, 'branch', v_b, 'period', v_period, 'selected_date', v_selected,
        'daily_revenue', v_revenue, 'monthly_statuses', v_statuses, 'top_products', v_top);
end $$;

create or replace function public.rsm_admin_branch_comparison(p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
    v_today date := public.rsm_today();
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    return jsonb_build_object('success', true, 'branches', (
        select jsonb_agg(jsonb_build_object(
                   'name', b.name,
                   'revenue', coalesce(t.revenue, 0), 'orders', coalesce(t.n, 0),
                   'fulfillment', case when coalesce(t.n, 0) > 0
                                       then round(t.completed::numeric / t.n * 100) else 0 end,
                   'open', coalesce(t.open_count, 0)) order by b.ord)
        from unnest(public.rsm_int_branches()) with ordinality as b(name, ord)
        left join (
            select s.branch, sum(s.total_amount) as revenue, count(*) as n,
                   count(*) filter (where s.order_status = 'completed') as completed,
                   count(*) filter (where s.order_status in ('pending','confirmed','preparing','out_for_delivery')) as open_count
              from public.rsm_int_sales_rows() s
             where public.rsm_local(s.sale_date)::date between date_trunc('month', v_today)::date and v_today
             group by s.branch) t on t.branch = b.name
        where v_b = 'all' or b.name = v_b));
end $$;

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

    return jsonb_build_object(
        'success', true, 'branch', v_b, 'period', v_period, 'selected_date', v_selected,
        'monthly', v_monthly, 'fulfillment_rate', v_fulfillment,
        'open_deliveries', v_open, 'branches', v_branches);
end $$;

create or replace function public.rsm_admin_delivery_data(p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    return jsonb_build_object('success', true, 'branch', v_b, 'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
                   'order_id', o.order_id, 'order_status', o.order_status,
                   'total_amount', o.total_amount, 'delivery_address', o.delivery_address,
                   'order_day', to_char(public.rsm_local(o.order_date), 'YYYY-MM-DD'),
                   'order_time', to_char(public.rsm_local(o.order_date), 'HH12:MI AM'),
                   'username', c.username,
                   'payment_method', case when o.payment_method = 'gcash' then 'GCash' else 'Cash' end)
               order by o.order_date desc)
        from public.orders o join public.customers c on c.id = o.customer_id
        where o.order_status not in ('completed', 'cancelled')
          and (v_b = 'all' or coalesce(o.branch, c.branch) = v_b)
    ), '[]'::jsonb));
end $$;

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
                       'items', coalesce((
                           select jsonb_agg(jsonb_build_object('product_name', p.product_name, 'quantity', oi.quantity)
                                            order by oi.order_item_id)
                           from public.order_items oi
                           join public.products p on p.product_id = oi.product_id
                           where oi.order_id = o.order_id
                       ), '[]'::jsonb),
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
                       'items', coalesce((
                           select jsonb_agg(jsonb_build_object('product_name', p.product_name, 'quantity', csi.quantity)
                                            order by csi.sale_item_id)
                           from public.counter_sale_items csi
                           join public.products p on p.product_id = csi.product_id
                           where csi.sale_id = cs.sale_id
                       ), '[]'::jsonb),
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
                     'items', coalesce((
                         select jsonb_agg(jsonb_build_object('product_name', p.product_name, 'quantity', oi.quantity)
                                          order by oi.order_item_id)
                         from public.order_items oi
                         join public.products p on p.product_id = oi.product_id
                         where oi.order_id = o.order_id
                     ), '[]'::jsonb),
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
                     'items', coalesce((
                         select jsonb_agg(jsonb_build_object('product_name', p.product_name, 'quantity', csi.quantity)
                                          order by csi.sale_item_id)
                         from public.counter_sale_items csi
                         join public.products p on p.product_id = csi.product_id
                         where csi.sale_id = cs.sale_id
                     ), '[]'::jsonb),
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

create or replace function public.rsm_admin_create_counter_sale(p_payload jsonb, p_selected_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_sel text := case when p_selected_branch = any (public.rsm_int_branches()) then p_selected_branch else 'all' end;
    v_type text := p_payload->>'sale_type';
    v_pay text := p_payload->>'payment_method';
    v_name text := trim(coalesce(p_payload->>'customer_name', ''));
    v_loc text := trim(coalesce(p_payload->>'location', ''));
    v_branch text := p_payload->>'branch';
    v_by text := trim(coalesce(p_payload->>'delivered_by', ''));
    v_items jsonb := p_payload->'items';
    v_total numeric := 0;
    v_sale_id bigint;
    r record;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;

    if v_type is null or v_type not in ('walk_in', 'call')
       or v_pay is null or v_pay not in ('cash', 'gcash')
       or v_branch is null or not (v_branch = any (public.rsm_int_branches()))
       or (v_sel <> 'all' and v_branch <> v_sel)
       or v_items is null or jsonb_typeof(v_items) <> 'array'
       or jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 50 then
        return public.rsm_fail('Enter valid sale details and select at least one product.', 422);
    end if;
    if v_name = '' or char_length(v_name) > 100 or v_loc = '' or char_length(v_loc) > 255
       or v_by = '' or char_length(v_by) > 100 then
        return public.rsm_fail('Customer name, location, and delivered by are required.', 422);
    end if;
    if exists (select 1 from public.rsm_int_parse_items(v_items) i
               where i.product_id is null or i.quantity is null or i.product_id < 1
                  or i.quantity < 1 or i.quantity > 10000) then
        return public.rsm_fail('Choose a valid product and quantity.', 422);
    end if;
    if exists (select 1 from public.rsm_int_parse_items(v_items) i
               group by i.product_id having sum(i.quantity) > 10000) then
        return public.rsm_fail('The quantity for each product must be 10,000 or less.', 422);
    end if;

    begin
        perform 1 from public.product_branch_stock
         where branch = v_branch
           and product_id in (select product_id from public.rsm_int_parse_items(v_items))
         order by product_id for update;

        create temporary table if not exists rsm_tmp_sale (product_id int, qty int, price numeric, name text)
            on commit drop;
        truncate rsm_tmp_sale;

        for r in
            select i.product_id, sum(i.quantity)::int as qty, p.product_name, p.price,
                   coalesce(pbs.stock_qty, 0) as stock
            from public.rsm_int_parse_items(v_items) i
            left join public.products p on p.product_id = i.product_id and p.is_active
            left join public.product_branch_stock pbs
                   on pbs.product_id = i.product_id and pbs.branch = v_branch
            group by i.product_id, p.product_name, p.price, pbs.stock_qty
            order by i.product_id
        loop
            if r.product_name is null then
                raise exception using errcode = 'RS001',
                    message = 'One or more selected products are no longer available.';
            end if;
            if r.qty > r.stock then
                raise exception using errcode = 'RS001',
                    message = 'Not enough stock for ' || r.product_name || '.';
            end if;
            v_total := v_total + round(r.price * 100) * r.qty / 100;
            insert into rsm_tmp_sale values (r.product_id, r.qty, r.price, r.product_name);
        end loop;

        insert into public.counter_sales (sale_type, customer_name, location, branch,
                                          payment_method, delivered_by, total_amount)
        values (v_type, v_name, v_loc, v_branch, v_pay, v_by, v_total)
        returning sale_id into v_sale_id;

        for r in select * from rsm_tmp_sale loop
            update public.product_branch_stock set stock_qty = stock_qty - r.qty
             where product_id = r.product_id and branch = v_branch and stock_qty >= r.qty;
            if not found then
                raise exception using errcode = 'RS001',
                    message = 'Product stock changed while saving. Please try again.';
            end if;
            insert into public.counter_sale_items (sale_id, product_id, quantity, unit_price)
            values (v_sale_id, r.product_id, r.qty, r.price);
        end loop;

        return jsonb_build_object('success', true, 'message', 'Sale saved.', 'sale_id', v_sale_id);
    exception
        when sqlstate 'RS001' then return public.rsm_fail(sqlerrm, 409);
        when others then
            raise log 'rsm_admin_create_counter_sale failed: %', sqlerrm;
            return public.rsm_fail('Could not save the sale. Please try again.', 500);
    end;
end $$;

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
               where p.is_active
                 and (v_b = 'all' or exists (
                     select 1 from public.product_branch_stock branch_stock
                      where branch_stock.product_id = p.product_id and branch_stock.branch = v_b
                 ))
               group by p.product_id, p.product_name, p.description, p.price, p.is_active, c.category_name) q
    ), '[]'::jsonb));
end $$;

-- p_input = { action: create | update | delete, product_id, product_name, category_name, description, price, stock_qty }
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

create or replace function public.rsm_admin_staff_list(p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
    v_name text;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    select coalesce(full_name, 'administrator') into v_name from public.admins where user_id = auth.uid();
    return jsonb_build_object('success', true, 'admin', jsonb_build_object('name', v_name),
        'branch', v_b, 'staff', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'staff_id', s.staff_id, 'full_name', s.full_name, 'email', s.email,
                       'role', s.role, 'branch', s.branch, 'is_active', case when s.is_active then 1 else 0 end,
                       'created_at', to_char(public.rsm_local(s.created_at), 'YYYY-MM-DD HH24:MI:SS'))
                   order by s.branch, s.full_name, s.staff_id)
            from public.staff_accounts s where v_b = 'all' or s.branch = v_b
        ), '[]'::jsonb));
end $$;

create or replace function public.rsm_admin_staff_toggle(p_staff_id int, p_branch text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b text := case when p_branch = any (public.rsm_int_branches()) then p_branch else 'all' end;
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    update public.staff_accounts set is_active = not is_active
     where staff_id = p_staff_id and (v_b = 'all' or branch = v_b);
    if not found then return public.rsm_fail('Staff account not found.', 404); end if;
    return jsonb_build_object('success', true, 'message', 'Staff access status updated.');
end $$;

create or replace function public.rsm_get_gcash_settings()
returns jsonb language sql stable security definer set search_path = public as $$
    select jsonb_build_object(
        'success', true,
        'mobile_number', s.mobile_number,
        'qr_path', s.qr_path
    )
    from public.gcash_settings s
    where s.id = 1
$$;

create or replace function public.rsm_admin_save_gcash_settings(
    p_mobile_number text,
    p_qr_path text default null,
    p_remove_qr boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_mobile text := nullif(trim(coalesce(p_mobile_number, '')), '');
    v_qr text := nullif(trim(coalesce(p_qr_path, '')), '');
begin
    if not public.rsm_is_admin() then return public.rsm_fail('Admin login required.', 401); end if;
    if v_mobile is not null and v_mobile !~ '^[0-9+() -]{7,20}$' then
        return public.rsm_fail('Enter a valid GCash mobile number.', 422);
    end if;
    if v_qr is not null and (
        v_qr !~ '^gcash/[^/]+$'
        or not exists (
            select 1 from storage.objects
            where bucket_id = 'gcash-assets' and name = v_qr
        )
    ) then
        return public.rsm_fail('Upload a valid GCash QR image.', 422);
    end if;

    insert into public.gcash_settings (id, mobile_number, qr_path, updated_at)
    values (1, v_mobile, v_qr, now())
    on conflict (id) do update
        set mobile_number = excluded.mobile_number,
            qr_path = case
                when p_remove_qr then null
                when v_qr is not null then v_qr
                else public.gcash_settings.qr_path
            end,
            updated_at = now();

    return jsonb_build_object(
        'success', true,
        'message', 'GCash details saved.',
        'mobile_number', v_mobile,
        'qr_path', case when p_remove_qr then null else coalesce(v_qr, (select qr_path from public.gcash_settings where id = 1)) end
    );
end $$;

-- =========================================================
--  Permissions: nothing is callable by anon except the three public RPCs;
--  rsm_int_* helpers are internal only.
-- =========================================================
do $$
declare r record;
begin
    for r in
        select p.oid::regprocedure as sig, p.proname
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'rsm\_%' escape '\'
    loop
        execute format('revoke all on function %s from public, anon, authenticated', r.sig);
        if r.proname not like 'rsm\_int\_%' escape '\' then
            execute format('grant execute on function %s to authenticated', r.sig);
        end if;
    end loop;
end $$;

grant execute on function public.rsm_login_email(text) to anon, authenticated;
grant execute on function public.rsm_check_registration(text, text, text, text) to anon, authenticated;
grant execute on function public.rsm_get_products() to anon, authenticated;
grant execute on function public.rsm_admin_overview_analytics(text, text, text) to authenticated;
grant execute on function public.rsm_admin_performance_analytics(text, text, text) to authenticated;
grant execute on function public.rsm_admin_sales_list_filtered(text, text, text) to authenticated;
-- used inside storage RLS policies for logged-in users
grant execute on function public.rsm_is_admin(), public.rsm_staff_role(), public.rsm_staff_branch()
    to authenticated;

notify pgrst, 'reload schema';

-- #########################################################
-- PART 3 — SAMPLE DATA
-- #########################################################

-- =========================================================
--  Seed data. Run after 001 and 002.
-- =========================================================

insert into public.product_categories (category_name) values ('General')
on conflict do nothing;

insert into public.product_categories (category_name)
values ('Crushed Ice'), ('Ice Tube')
on conflict do nothing;

update public.products p
   set category_id = c.category_id
  from public.product_categories c
 where c.category_name = case
        when lower(p.product_name) like '%crush%' then 'Crushed Ice'
        when lower(p.product_name) like '%tube%' then 'Ice Tube'
       end
   and p.category_id is distinct from c.category_id;

-- Sample products (delete/edit once you have real menu items)
insert into public.products (category_id, product_name, description, price, stock_qty)
select c.category_id, v.name, 'Placeholder product — edit me', v.price, v.stock
from public.product_categories c,
     (values ('Sample Item 1', 99.00, 50), ('Sample Item 2', 149.00, 30)) as v(name, price, stock)
where c.category_name = 'General'
  and not exists (select 1 from public.products p where p.product_name = v.name);

-- Give every product starting stock in every branch
insert into public.product_branch_stock (product_id, branch, stock_qty)
select p.product_id, b.branch, p.stock_qty
from public.products p
cross join (values ('Alangilan'), ('Sta Teresita'), ('Mabini Lipa'), ('San Luis')) as b(branch)
on conflict do nothing;

-- =========================================================
--  FIRST ADMIN (do this once)
--  1. Supabase Dashboard -> Authentication -> Users -> Add user
--     email: admin@rey.com  (or your own)   password: choose a strong one
--     tick "Auto Confirm User".
--  2. Then run this, using the same email:
-- =========================================================
-- insert into public.admins (user_id, email, full_name)
-- select id, email, 'System Administrator' from auth.users where email = 'admin@rey.com';
