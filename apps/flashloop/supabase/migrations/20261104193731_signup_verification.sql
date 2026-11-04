begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

create table private.signup_permits (
  permit_hash text primary key check (permit_hash ~ '^[0-9a-f]{64}$'),
  email text not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '5 minutes'),
  created_at timestamptz not null default clock_timestamp()
);
create index signup_permits_expiry_idx on private.signup_permits (expires_at);
alter table private.signup_permits enable row level security;

create table private.session_verifications (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'verifying', 'verified', 'failed')),
  attempt_id uuid,
  attempted_at timestamptz,
  verified_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint verified_has_timestamp check ((state = 'verified') = (verified_at is not null)),
  constraint failure_has_timestamp check ((state = 'failed') = (failed_at is not null))
);
create index session_verifications_user_idx on private.session_verifications (user_id);
alter table private.session_verifications enable row level security;

create table private.auth_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  attempts integer not null check (attempts > 0)
);
create index auth_rate_limits_started_at_idx on private.auth_rate_limits (window_started_at);
alter table private.auth_rate_limits enable row level security;

create table public.video_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits bigint not null default 0 check (credits between 0 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.video_credit_accounts enable row level security;

revoke all on private.signup_permits, private.session_verifications, private.auth_rate_limits
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on public.video_credit_accounts from public, anon, authenticated, service_role;
grant select on public.video_credit_accounts to authenticated, service_role;
grant update (credits) on public.video_credit_accounts to service_role;

-- The only signup proof is a random bearer permit whose hash the server issued
-- after Siteverify. User metadata is transport for this proof, never authorization.
create function private.issue_signup_permit(p_email text, p_permit_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_email is null or length(p_email) > 254
    or lower(btrim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_permit_hash is null or p_permit_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid signup permit' using errcode = '22023';
  end if;
  delete from private.signup_permits where expires_at <= clock_timestamp();
  insert into private.signup_permits (email, permit_hash)
    values (lower(btrim(p_email)), p_permit_hash);
  return true;
end;
$$;

create function private.before_user_created(event jsonb)
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

  delete from private.signup_permits
    where permit_hash = encode(sha256(convert_to(v_permit, 'UTF8')), 'hex')
      and email = v_email and expires_at > clock_timestamp()
    returning permit_hash into v_consumed;
  if v_consumed is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Signup security verification is required.'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- Authorization always binds the JWT subject and session ID to current rows.
-- A valid old JWT is insufficient after logout or application revocation.
create function private.current_session_identity()
returns table (user_id uuid, session_id uuid, email_confirmed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_session_id uuid;
begin
  begin
    v_user_id := auth.uid();
    v_session_id := (auth.jwt() ->> 'session_id')::uuid;
  exception when invalid_text_representation then
    return;
  end;
  if v_user_id is null or v_session_id is null then return; end if;
  return query
    select u.id, s.id, u.email_confirmed_at is not null
    from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = v_session_id and s.user_id = v_user_id
      and (s.not_after is null or s.not_after > statement_timestamp())
      and u.is_anonymous is not true
      and (u.banned_until is null or u.banned_until <= statement_timestamp());
end;
$$;

create function private.get_auth_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', i.user_id, 'session_id', i.session_id,
    'email_confirmed', i.email_confirmed,
    'verification', coalesce(v.state, 'pending'),
    'credits', case when i.email_confirmed and v.state = 'verified' then a.credits else 0 end)
  from private.current_session_identity() i
  join public.video_credit_accounts a on a.user_id = i.user_id
  left join private.session_verifications v
    on v.session_id = i.session_id and v.user_id = i.user_id;
$$;

create function private.is_verified_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.current_session_identity() i
    join private.session_verifications v
      on v.session_id = i.session_id and v.user_id = i.user_id
    where i.email_confirmed and v.state = 'verified');
$$;

create policy verified_owner_can_read_video_credits on public.video_credit_accounts
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_verified_session()));

create function private.begin_session_verification()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_identity record;
  v_attempt uuid;
begin
  select * into v_identity from private.current_session_identity();
  if not found or not v_identity.email_confirmed then return null; end if;
  insert into private.session_verifications (session_id, user_id)
    values (v_identity.session_id, v_identity.user_id)
    on conflict (session_id) do nothing;
  update private.session_verifications
    set state = 'verifying', attempt_id = gen_random_uuid(), attempted_at = clock_timestamp()
    where session_id = v_identity.session_id and user_id = v_identity.user_id
      and state = 'pending'
    returning attempt_id into v_attempt;
  return v_attempt::text;
end;
$$;

create function private.finish_session_verification(
  p_user_id uuid, p_session_id uuid, p_attempt_id uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_session_id is null or p_attempt_id is null or p_success is null then
    return false;
  end if;
  if not p_success then
    -- This also invalidates a success that committed just before its failure.
    -- Row locks serialize concurrent finish calls; failed is never recoverable.
    update private.session_verifications
      set state = 'failed', verified_at = null, failed_at = coalesce(failed_at, clock_timestamp())
      where user_id = p_user_id and session_id = p_session_id
        and attempt_id = p_attempt_id and state in ('verifying', 'verified', 'failed');
    return false;
  end if;
  update private.session_verifications v
    set state = 'verified', verified_at = clock_timestamp()
    where v.user_id = p_user_id and v.session_id = p_session_id
      and v.attempt_id = p_attempt_id and v.state = 'verifying'
      and exists (
        select 1 from auth.sessions s join auth.users u on u.id = s.user_id
        where s.id = p_session_id and s.user_id = p_user_id
          and (s.not_after is null or s.not_after > statement_timestamp())
          and u.email_confirmed_at is not null and u.is_anonymous is not true
          and (u.banned_until is null or u.banned_until <= statement_timestamp()));
  return found;
end;
$$;

create function private.revoke_current_session()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_identity record;
begin
  select * into v_identity from private.current_session_identity();
  if not found then return false; end if;
  insert into private.session_verifications (session_id, user_id, state, failed_at)
    values (v_identity.session_id, v_identity.user_id, 'failed', clock_timestamp())
    on conflict (session_id) do update
      set state = 'failed', verified_at = null,
        failed_at = coalesce(private.session_verifications.failed_at, clock_timestamp())
      where private.session_verifications.user_id = v_identity.user_id;
  return found;
end;
$$;

create function private.consume_auth_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$'
    or p_limit is null or p_limit not between 1 and 1000
    or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate limit' using errcode = '22023';
  end if;
  -- Preserve recent counters, including long windows that only just expired.
  -- The first predicate uses the timestamp index before checking exact expiry.
  delete from private.auth_rate_limits
    where window_started_at < v_now - interval '24 hours'
      and window_started_at + window_seconds * interval '1 second' < v_now - interval '24 hours';
  insert into private.auth_rate_limits (key_hash, window_started_at, window_seconds, attempts)
    values (p_key, v_now, p_window_seconds, 1)
    on conflict (key_hash) do update set
      attempts = case when private.auth_rate_limits.window_started_at
          + private.auth_rate_limits.window_seconds * interval '1 second' <= v_now
        then 1 else least(private.auth_rate_limits.attempts + 1, 1000000) end,
      window_started_at = case when private.auth_rate_limits.window_started_at
          + private.auth_rate_limits.window_seconds * interval '1 second' <= v_now
        then v_now else private.auth_rate_limits.window_started_at end,
      window_seconds = excluded.window_seconds
    returning attempts into v_attempts;
  return v_attempts <= p_limit;
end;
$$;

create function private.initialize_video_credits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.video_credit_accounts (user_id, credits) values (new.id, 0)
    on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger initialize_video_credits after insert on auth.users
  for each row execute function private.initialize_video_credits();
insert into public.video_credit_accounts (user_id, credits)
  select id, 0 from auth.users on conflict (user_id) do nothing;

-- Exposed RPCs carry no elevated privileges. Private implementations contain
-- the minimum required definer privileges and all caller/session checks.
create function public.issue_signup_permit(p_email text, p_permit_hash text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.issue_signup_permit(p_email, p_permit_hash);
$$;
create function public.before_user_created(event jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.before_user_created(event);
$$;
create function public.get_auth_context()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.get_auth_context();
$$;
create function public.begin_session_verification()
returns text language sql security invoker set search_path = '' as $$
  select private.begin_session_verification();
$$;
create function public.finish_session_verification(
  p_user_id uuid, p_session_id uuid, p_attempt_id uuid, p_success boolean)
returns boolean language sql security invoker set search_path = '' as $$
  select private.finish_session_verification(p_user_id, p_session_id, p_attempt_id, p_success);
$$;
create function public.revoke_current_session()
returns boolean language sql security invoker set search_path = '' as $$
  select private.revoke_current_session();
$$;
create function public.consume_auth_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language sql security invoker set search_path = '' as $$
  select private.consume_auth_rate_limit(p_key, p_limit, p_window_seconds);
$$;

revoke all on function private.issue_signup_permit(text, text), public.issue_signup_permit(text, text),
  private.before_user_created(jsonb), public.before_user_created(jsonb),
  private.current_session_identity(), private.get_auth_context(), public.get_auth_context(),
  private.is_verified_session(), private.begin_session_verification(), public.begin_session_verification(),
  private.finish_session_verification(uuid, uuid, uuid, boolean), public.finish_session_verification(uuid, uuid, uuid, boolean),
  private.revoke_current_session(), public.revoke_current_session(),
  private.consume_auth_rate_limit(text, integer, integer), public.consume_auth_rate_limit(text, integer, integer),
  private.initialize_video_credits()
  from public, anon, authenticated, service_role, supabase_auth_admin;

grant execute on function private.issue_signup_permit(text, text), public.issue_signup_permit(text, text),
  private.finish_session_verification(uuid, uuid, uuid, boolean), public.finish_session_verification(uuid, uuid, uuid, boolean),
  private.consume_auth_rate_limit(text, integer, integer), public.consume_auth_rate_limit(text, integer, integer)
  to service_role;
grant execute on function private.get_auth_context(), public.get_auth_context(),
  private.is_verified_session(), private.begin_session_verification(), public.begin_session_verification(),
  private.revoke_current_session(), public.revoke_current_session()
  to authenticated;
grant execute on function private.before_user_created(jsonb), public.before_user_created(jsonb)
  to supabase_auth_admin;

comment on function public.before_user_created(jsonb) is
  'Enable as the Supabase Before User Created hook; requires an unexpired, email-bound, server-issued one-use permit.';
comment on table public.video_credit_accounts is
  'New accounts start with exactly zero video credits. Clients cannot create or update balances.';

commit;
