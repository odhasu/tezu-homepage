begin;

-- This migration intentionally closes the old permit API. Deploy only together
-- with trusted edge IP handling and the IP-bound application implementation.
alter table private.signup_permits
  add column ip_key_hash text check (ip_key_hash ~ '^[0-9a-f]{64}$'),
  add column hook_consumed_at timestamptz;

create table private.signup_ip_quota (
  ip_key_hash text primary key check (ip_key_hash ~ '^[0-9a-f]{64}$'),
  first_created_at timestamptz,
  second_created_at timestamptz,
  check (second_created_at is null or
    (first_created_at is not null and second_created_at >= first_created_at))
);
create index signup_ip_quota_latest_idx
  on private.signup_ip_quota ((coalesce(second_created_at, first_created_at)));
alter table private.signup_ip_quota enable row level security;
revoke all on private.signup_ip_quota from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function private.issue_signup_permit(p_email text, p_permit_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'IP-bound signup permits required' using errcode = '55000';
end;
$$;

create function private.get_signup_ip_quota(p_ip_key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_first timestamptz;
  v_second timestamptz;
  v_retry integer;
begin
  if p_ip_key_hash is null or p_ip_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid signup IP key' using errcode = '22023';
  end if;

  -- This read is an early rejection only. The user-insert trigger below locks
  -- and rechecks the quota, including when several permits were issued first.
  select first_created_at, second_created_at into v_first, v_second
    from private.signup_ip_quota where ip_key_hash = p_ip_key_hash;
  if v_first > v_now - interval '96 hours' and v_second > v_now - interval '96 hours' then
    v_retry := greatest(1, least(345600,
      ceil(extract(epoch from v_first + interval '96 hours' - v_now))::integer));
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry);
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

create function public.get_signup_ip_quota(p_ip_key_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_signup_ip_quota(p_ip_key_hash);
$$;

create function private.issue_signup_permit_for_ip(p_email text, p_permit_hash text, p_ip_key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_quota jsonb;
begin
  if p_email is null or length(p_email) > 254
    or lower(btrim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_permit_hash is null or p_permit_hash !~ '^[0-9a-f]{64}$'
    or p_ip_key_hash is null or p_ip_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid signup permit' using errcode = '22023';
  end if;
  v_quota := private.get_signup_ip_quota(p_ip_key_hash);
  if (v_quota->>'allowed')::boolean is not true then return v_quota; end if;

  insert into private.signup_permits (email, permit_hash, ip_key_hash)
    values (lower(btrim(p_email)), p_permit_hash, p_ip_key_hash);
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

create function public.issue_signup_permit_for_ip(p_email text, p_permit_hash text, p_ip_key_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.issue_signup_permit_for_ip(p_email, p_permit_hash, p_ip_key_hash);
$$;

create or replace function private.before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(event #>> '{user,email}'));
  v_permit text := event #>> '{user,user_metadata,signup_permit}';
  v_consumed text;
begin
  if event #>> '{metadata,name}' is distinct from 'before-user-created'
    or event #>> '{user,app_metadata,provider}' is distinct from 'email'
    or event #> '{user,is_anonymous}' is distinct from 'false'::jsonb
    or v_email is null or v_permit is null or v_permit !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Signup security verification is required.'));
  end if;

  -- Auth may call the hook in a separate transaction from inserting auth.users.
  -- Persist a single-use claim here, but charge no creation until that insert.
  update private.signup_permits set hook_consumed_at = clock_timestamp()
    where permit_hash = encode(sha256(convert_to(v_permit, 'UTF8')), 'hex')
      and email = v_email and expires_at > clock_timestamp()
      and hook_consumed_at is null and ip_key_hash is not null
    returning permit_hash into v_consumed;
  if v_consumed is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Signup security verification is required.'));
  end if;
  return '{}'::jsonb;
end;
$$;

create function private.consume_signup_ip_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_permit text := new.raw_user_meta_data ->> 'signup_permit';
  v_ip_key_hash text;
  v_first timestamptz;
  v_second timestamptz;
  v_now timestamptz;
begin
  -- Trusted administrative provisioning without a permit stays possible. Public
  -- Auth must retain its mandatory Before User Created hook, which denies this.
  if coalesce(new.raw_user_meta_data ? 'signup_permit', false) is false then return new; end if;
  if v_permit is null or v_permit !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid claimed signup permit' using errcode = '42501';
  end if;

  delete from private.signup_permits
    where permit_hash = encode(sha256(convert_to(v_permit, 'UTF8')), 'hex')
      and email = lower(btrim(new.email)) and ip_key_hash is not null
      and hook_consumed_at is not null and expires_at > clock_timestamp()
    returning ip_key_hash into v_ip_key_hash;
  if v_ip_key_hash is null then
    raise exception 'Invalid claimed signup permit' using errcode = '42501';
  end if;

  -- UPSERT creates or locks exactly this IP row and returns the latest committed
  -- state after any competing insert/cleanup. The lock survives until the user
  -- insert transaction commits. No user foreign key can reset this quota.
  insert into private.signup_ip_quota (ip_key_hash) values (v_ip_key_hash)
    on conflict (ip_key_hash) do update set ip_key_hash = excluded.ip_key_hash
    returning first_created_at, second_created_at into v_first, v_second;
  v_now := clock_timestamp();
  if v_first <= v_now - interval '96 hours' then v_first := null; end if;
  if v_second <= v_now - interval '96 hours' then v_second := null; end if;
  if v_first is null and v_second is not null then
    v_first := v_second;
    v_second := null;
  end if;
  if v_first is not null and v_second is not null then
    raise exception 'Signup IP quota reached.' using errcode = 'P0001';
  end if;
  if v_first is null then v_first := v_now;
  else v_second := v_now;
  end if;
  update private.signup_ip_quota
    set first_created_at = v_first, second_created_at = v_second
    where ip_key_hash = v_ip_key_hash;
  return new;
end;
$$;
create trigger consume_signup_ip_quota after insert on auth.users
  for each row execute function private.consume_signup_ip_quota();

-- Maintenance is separate from signup. Bounded indexed batches skip locked
-- rows and never select active quota rows for deletion.
create function private.cleanup_signup_security(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_permits integer;
  v_quotas integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'Invalid cleanup batch size' using errcode = '22023';
  end if;
  delete from private.signup_permits where permit_hash in (
    select permit_hash from private.signup_permits where expires_at <= v_now
      order by expires_at, permit_hash for update skip locked limit p_limit);
  get diagnostics v_permits = row_count;
  delete from private.signup_ip_quota where ip_key_hash in (
    select ip_key_hash from private.signup_ip_quota
      where coalesce(second_created_at, first_created_at) <= v_now - interval '96 hours'
      order by coalesce(second_created_at, first_created_at), ip_key_hash
      for update skip locked limit p_limit);
  get diagnostics v_quotas = row_count;
  return v_permits + v_quotas;
end;
$$;

revoke all on function private.issue_signup_permit_for_ip(text, text, text),
  public.issue_signup_permit_for_ip(text, text, text), private.consume_signup_ip_quota(),
  private.cleanup_signup_security(integer), private.get_signup_ip_quota(text), public.get_signup_ip_quota(text)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function private.issue_signup_permit_for_ip(text, text, text),
  public.issue_signup_permit_for_ip(text, text, text), private.cleanup_signup_security(integer),
  private.get_signup_ip_quota(text), public.get_signup_ip_quota(text)
  to service_role;

comment on table private.signup_ip_quota is
  'At most two successful permit-backed account creations per hashed IP in the trailing 96 hours; independent of user deletion.';
comment on function public.issue_signup_permit_for_ip(text, text, text) is
  'Service-only early quota check and five-minute IP-bound signup permit issuance. The auth.users insert trigger enforces the exact rolling quota.';

commit;
