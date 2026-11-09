-- Run in the Supabase SQL Editor to allow registration without address or branch.
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
