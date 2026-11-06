-- Apply this once in Supabase SQL Editor to add GCash checkout settings
-- to an existing Rey Summit database. Safe to run again if needed.

create table if not exists public.gcash_settings (
    id             integer primary key default 1 check (id = 1),
    mobile_number  text,
    qr_path        text,
    updated_at     timestamptz not null default now()
);
insert into public.gcash_settings (id) values (1) on conflict do nothing;
alter table public.gcash_settings enable row level security;

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gcash-assets', 'gcash-assets', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
    set public = true, file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public reads gcash qr codes" on storage.objects;
drop policy if exists "admins upload gcash qr codes" on storage.objects;
drop policy if exists "admins update gcash qr codes" on storage.objects;
drop policy if exists "admins delete gcash qr codes" on storage.objects;

create policy "public reads gcash qr codes" on storage.objects for select to public
    using (bucket_id = 'gcash-assets');
create policy "admins upload gcash qr codes" on storage.objects for insert to authenticated
    with check (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin());
create policy "admins update gcash qr codes" on storage.objects for update to authenticated
    using (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin())
    with check (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin());
create policy "admins delete gcash qr codes" on storage.objects for delete to authenticated
    using (bucket_id = 'gcash-assets' and (storage.foldername(name))[1] = 'gcash' and public.rsm_is_admin());

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

revoke all on function public.rsm_get_gcash_settings() from public, anon, authenticated;
revoke all on function public.rsm_admin_save_gcash_settings(text, text, boolean) from public, anon, authenticated;
grant execute on function public.rsm_get_gcash_settings() to authenticated;
grant execute on function public.rsm_admin_save_gcash_settings(text, text, boolean) to authenticated;
