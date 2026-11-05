begin;

-- Money uses integer millionths of the explicitly configured currency. There is
-- no default currency, price, cap, credit grant, or enabled generation path.
create table private.generation_policy (
  id boolean primary key default true check (id),
  generation_enabled boolean not null default false,
  currency_code text check (currency_code ~ '^[A-Z]{3}$'),
  daily_global_limit_micros bigint check (daily_global_limit_micros between 1 and 9000000000000000),
  daily_account_limit_micros bigint check (daily_account_limit_micros between 1 and 9000000000000000),
  max_concurrent_jobs integer check (max_concurrent_jobs between 1 and 100000),
  reset_timezone text,
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.generation_policy(id) values (true);
create table private.generation_account_limits (
  user_id uuid primary key references auth.users(id) on delete restrict,
  enabled boolean not null default false,
  daily_limit_micros bigint check (daily_limit_micros between 1 and 9000000000000000),
  max_concurrent_jobs integer check (max_concurrent_jobs between 1 and 100000)
);
create table private.generation_prices (
  price_key text primary key check (price_key ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),
  credits bigint not null check (credits between 1 and 9000000000000000),
  worst_case_cost_micros bigint not null check (worst_case_cost_micros between 1 and 9000000000000000),
  -- Fixed provider/model/quantity/duration/resolution options, selected by trusted
  -- configuration. Users supply only prompt text, never billable model options.
  provider_profile jsonb not null check (jsonb_typeof(provider_profile) = 'object' and provider_profile <> '{}'::jsonb),
  active boolean not null default false
);
create table private.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  project_id uuid not null,
  job_id uuid not null unique,
  origin_session_id uuid not null,
  request_key text not null check (request_key ~ '^[A-Za-z0-9._:-]{16,200}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  price_key text not null references private.generation_prices(price_key) on delete restrict,
  prompt text not null check (length(btrim(prompt)) between 1 and 6000),
  provider_profile jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_key),
  foreign key (job_id, project_id, user_id) references public.jobs(id, project_id, owner_id) on delete restrict
);
create table private.generation_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references private.generation_requests(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  spend_day date not null,
  settled_day date,
  currency_code text not null,
  credits_reserved bigint not null check (credits_reserved between 1 and 9000000000000000),
  worst_case_cost_micros bigint not null check (worst_case_cost_micros between 1 and 9000000000000000),
  held_cost_micros bigint not null check (held_cost_micros between 0 and 9000000000000000),
  terminal_outcome text check (terminal_outcome in ('succeeded','failed','cancelled')),
  actual_cost_micros bigint check (actual_cost_micros between 0 and 9000000000000000),
  provider_job_id text check (length(provider_job_id) between 1 and 255),
  status text not null default 'reserved' check (status in ('reserved','dispatching','dispatched','unknown','committed','released','reconciliation_required')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index generation_requests_owner_idx on private.generation_requests(user_id);
create index generation_reservations_owner_idx on private.generation_reservations(user_id, status);
create table private.generation_global_days (
  spend_day date primary key,
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  committed_micros bigint not null default 0 check (committed_micros >= 0)
);
create table private.generation_account_days (
  user_id uuid not null references auth.users(id) on delete restrict,
  spend_day date not null,
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  committed_micros bigint not null default 0 check (committed_micros >= 0),
  primary key (user_id, spend_day)
);
create table private.generation_active_jobs (
  user_id uuid primary key references auth.users(id) on delete restrict,
  active_jobs integer not null default 0 check (active_jobs >= 0)
);

do $$
declare t text;
begin
  foreach t in array array['generation_policy','generation_account_limits','generation_prices','generation_requests',
    'generation_reservations','generation_global_days','generation_account_days','generation_active_jobs'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('alter table private.%I force row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role, supabase_auth_admin', t);
  end loop;
end;
$$;

create function private.require_generation_service()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- PostgreSQL role selected by PostgREST, never a user-editable metadata claim.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Generation worker access denied' using errcode = '42501';
  end if;
end;
$$;

create function private.generation_reservation_json(p_request private.generation_requests, p_reservation private.generation_reservations)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('requestId', p_request.id, 'requestKey', p_request.request_key,
    'reservationId', p_reservation.id, 'projectId', p_request.project_id, 'jobId', p_request.job_id,
    'priceKey', p_request.price_key, 'currency', p_reservation.currency_code,
    'status', p_reservation.status, 'creditsReserved', p_reservation.credits_reserved,
    'worstCaseCostMicros', p_reservation.worst_case_cost_micros, 'heldCostMicros', p_reservation.held_cost_micros,
    'actualCostMicros', p_reservation.actual_cost_micros, 'spendDay', p_reservation.spend_day,
    'settledDay', p_reservation.settled_day, 'outcome', p_reservation.terminal_outcome, 'providerJobId', p_reservation.provider_job_id,
    'providerIdempotencyKey', 'flashloop:' || p_reservation.id::text);
$$;

-- Both adapters use this transaction. Service callers must supply the original
-- verified session, not merely an owner ID from an event or future MCP payload.
create function private.reserve_generation(p_user_id uuid, p_session_id uuid, p_project_id uuid,
  p_request_key text, p_price_key text, p_prompt text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_policy private.generation_policy;
  v_limits private.generation_account_limits;
  v_price private.generation_prices;
  v_request private.generation_requests;
  v_reservation private.generation_reservations;
  v_day date;
  v_fingerprint text;
  v_credits bigint;
  v_global_reserved bigint;
  v_account_reserved bigint;
  v_global_committed bigint;
  v_account_committed bigint;
  v_active integer;
  v_job_id uuid := gen_random_uuid();
begin
  if p_user_id is null or p_session_id is null or p_project_id is null
    or p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,200}$'
    or p_price_key is null or p_prompt is null or length(btrim(p_prompt)) not between 1 and 6000
    or p_label is null or length(p_label) > 160 then
    raise exception 'Invalid generation request' using errcode = '22023';
  end if;
  if current_setting('role', true) = 'authenticated' then
    if auth.uid() is null or auth.uid() is distinct from p_user_id
      or (auth.jwt()->>'session_id') is distinct from p_session_id::text
      or not private.is_verified_session() then
      raise exception 'Verified session required' using errcode = '42501';
    end if;
  else
    perform private.require_generation_service();
  end if;
  if not exists (select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    join private.session_verifications v on v.session_id=s.id and v.user_id=u.id
    where u.id=p_user_id and s.id=p_session_id and v.state='verified'
      and u.email_confirmed_at is not null and u.is_anonymous is not true
      and (u.banned_until is null or u.banned_until <= statement_timestamp())
      and (s.not_after is null or s.not_after > statement_timestamp())) then
    raise exception 'Verified session required' using errcode = '42501';
  end if;
  -- The singleton mutex also serializes configuration, claims, cancellation, and
  -- reconciliation. All counter reads below are fresh statements after this lock.
  select * into strict v_policy from private.generation_policy where id for update;
  perform 1 from public.projects where id=p_project_id and owner_id=p_user_id for key share;
  if not found then raise exception 'Generation project not found' using errcode = 'P0002'; end if;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('project',p_project_id,
    'price',p_price_key,'prompt',p_prompt,'label',p_label)::text,'UTF8')),'hex');
  select * into v_request from private.generation_requests where user_id=p_user_id and request_key=p_request_key;
  if found then
    if v_request.request_fingerprint is distinct from v_fingerprint then
      raise exception 'Idempotency key reused with different request' using errcode = '23505';
    end if;
    select * into strict v_reservation from private.generation_reservations where request_id=v_request.id;
    return private.generation_reservation_json(v_request,v_reservation);
  end if;
  if not v_policy.generation_enabled then raise exception 'Generation kill switch is enabled' using errcode = 'P0001'; end if;
  if v_policy.currency_code is null or v_policy.reset_timezone is null or v_policy.daily_global_limit_micros is null
    or v_policy.daily_account_limit_micros is null or v_policy.max_concurrent_jobs is null then
    raise exception 'Generation spend policy is not configured' using errcode = 'P0001';
  end if;
  select * into v_limits from private.generation_account_limits where user_id=p_user_id;
  if not found or not v_limits.enabled then raise exception 'Generation entitlement denied' using errcode = '42501'; end if;
  select * into v_price from private.generation_prices where price_key=p_price_key and active;
  if not found then raise exception 'Generation price is not configured' using errcode = 'P0001'; end if;
  v_day := (clock_timestamp() at time zone v_policy.reset_timezone)::date;
  select credits into v_credits from public.video_credit_accounts where user_id=p_user_id for update;
  if v_credits is null or v_credits < v_price.credits then raise exception 'Insufficient video credits' using errcode = 'P0001'; end if;
  insert into private.generation_global_days(spend_day) values(v_day) on conflict do nothing;
  insert into private.generation_account_days(user_id,spend_day) values(p_user_id,v_day) on conflict do nothing;
  insert into private.generation_active_jobs(user_id) values(p_user_id) on conflict do nothing;
  select committed_micros into v_global_committed from private.generation_global_days where spend_day=v_day for update;
  select committed_micros into v_account_committed from private.generation_account_days where user_id=p_user_id and spend_day=v_day for update;
  select coalesce(sum(reserved_micros),0) into v_global_reserved from private.generation_global_days;
  select coalesce(sum(reserved_micros),0) into v_account_reserved from private.generation_account_days where user_id=p_user_id;
  select active_jobs into v_active from private.generation_active_jobs where user_id=p_user_id for update;
  -- All in-flight costs count, including unknown outcomes from earlier days.
  if v_global_committed + v_global_reserved + v_price.worst_case_cost_micros > v_policy.daily_global_limit_micros then
    raise exception 'Global daily spend cap reached' using errcode = 'P0001';
  end if;
  if v_account_committed + v_account_reserved + v_price.worst_case_cost_micros > least(v_policy.daily_account_limit_micros,coalesce(v_limits.daily_limit_micros,v_policy.daily_account_limit_micros)) then
    raise exception 'Account daily spend cap reached' using errcode = 'P0001';
  end if;
  if v_active >= least(v_policy.max_concurrent_jobs,coalesce(v_limits.max_concurrent_jobs,v_policy.max_concurrent_jobs)) then
    raise exception 'Account concurrent job limit reached' using errcode = 'P0001';
  end if;
  insert into public.jobs(id,project_id,owner_id,label) values(v_job_id,p_project_id,p_user_id,p_label);
  insert into private.generation_requests(user_id,project_id,job_id,origin_session_id,request_key,request_fingerprint,price_key,prompt,provider_profile)
    values(p_user_id,p_project_id,v_job_id,p_session_id,p_request_key,v_fingerprint,p_price_key,p_prompt,v_price.provider_profile) returning * into v_request;
  insert into private.generation_reservations(request_id,user_id,spend_day,currency_code,credits_reserved,worst_case_cost_micros,held_cost_micros)
    values(v_request.id,p_user_id,v_day,v_policy.currency_code,v_price.credits,v_price.worst_case_cost_micros,v_price.worst_case_cost_micros) returning * into v_reservation;
  update public.video_credit_accounts set credits=credits-v_price.credits where user_id=p_user_id;
  update private.generation_global_days set reserved_micros=reserved_micros+v_price.worst_case_cost_micros where spend_day=v_day;
  update private.generation_account_days set reserved_micros=reserved_micros+v_price.worst_case_cost_micros where user_id=p_user_id and spend_day=v_day;
  update private.generation_active_jobs set active_jobs=active_jobs+1 where user_id=p_user_id;
  return private.generation_reservation_json(v_request,v_reservation);
end;
$$;

create function private.transition_generation(p_user_id uuid,p_request_key text,p_action text,
  p_provider_job_id text default null,p_actual_cost_micros bigint default null,p_outcome text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_policy private.generation_policy;
  v_request private.generation_requests;
  v_reservation private.generation_reservations;
  v_limits private.generation_account_limits;
  v_day date;
  v_delta bigint;
  v_cost bigint;
  v_result jsonb;
begin
  perform private.require_generation_service();
  if p_user_id is null or p_request_key is null or p_action is null
    or p_action not in ('claim','dispatch','unknown','commit','release','reconcile')
    or (p_actual_cost_micros is not null and p_actual_cost_micros not between 0 and 9000000000000000) then
    raise exception 'Invalid generation transition' using errcode = '22023';
  end if;
  select * into strict v_policy from private.generation_policy where id for update;
  select * into v_request from private.generation_requests where user_id=p_user_id and request_key=p_request_key;
  if not found then raise exception 'Generation request not found' using errcode = 'P0002'; end if;
  select * into strict v_reservation from private.generation_reservations where request_id=v_request.id for update;
  v_result := private.generation_reservation_json(v_request,v_reservation);
  v_day := (clock_timestamp() at time zone v_policy.reset_timezone)::date;
  if p_action='claim' then
    if v_reservation.status <> 'reserved' then return v_result || jsonb_build_object('dispatchAllowed',false); end if;
    if not v_policy.generation_enabled then raise exception 'Generation kill switch is enabled' using errcode='P0001'; end if;
    select * into v_limits from private.generation_account_limits where user_id=p_user_id;
    if not found or not v_limits.enabled or not exists(select 1 from auth.users where id=p_user_id
      and email_confirmed_at is not null and is_anonymous is not true
      and (banned_until is null or banned_until <= statement_timestamp())) then
      raise exception 'Generation entitlement denied' using errcode='42501';
    end if;
    if (select coalesce(sum(reserved_micros),0) from private.generation_global_days)
      + coalesce((select committed_micros from private.generation_global_days where spend_day=v_day),0) > v_policy.daily_global_limit_micros
      or (select coalesce(sum(reserved_micros),0) from private.generation_account_days where user_id=p_user_id)
      + coalesce((select committed_micros from private.generation_account_days where user_id=p_user_id and spend_day=v_day),0)
        > least(v_policy.daily_account_limit_micros,coalesce(v_limits.daily_limit_micros,v_policy.daily_account_limit_micros)) then
      raise exception 'Generation daily spend cap reached' using errcode='P0001';
    end if;
    -- This transition commits BEFORE network dispatch. Only this invocation may
    -- send; a lost claim response/retried event never grants another dispatch.
    update private.generation_reservations set status='dispatching',updated_at=clock_timestamp() where id=v_reservation.id returning * into v_reservation;
    update public.jobs set status='running' where id=v_request.job_id;
    return private.generation_reservation_json(v_request,v_reservation) || jsonb_build_object('dispatchAllowed',true,
      'providerRequest',jsonb_build_object('profile',v_request.provider_profile,'prompt',v_request.prompt));
  elsif p_action='dispatch' then
    if p_provider_job_id is null or length(p_provider_job_id) not between 1 and 255 then raise exception 'Invalid provider job ID' using errcode='22023'; end if;
    if v_reservation.provider_job_id is not null then
      if v_reservation.provider_job_id is distinct from p_provider_job_id then raise exception 'Provider job ID changed' using errcode='23505'; end if;
      return v_result;
    end if;
    if v_reservation.status not in ('dispatching','unknown') then raise exception 'Generation cannot be dispatched' using errcode='55000'; end if;
    update private.generation_reservations set status='dispatched',provider_job_id=p_provider_job_id,updated_at=clock_timestamp() where id=v_reservation.id returning * into v_reservation;
  elsif p_action='unknown' then
    if v_reservation.status in ('unknown','reconciliation_required','committed') then return v_result; end if;
    if v_reservation.status not in ('dispatching','dispatched') then raise exception 'Generation has no dispatch claim' using errcode='55000'; end if;
    update private.generation_reservations set status='unknown',updated_at=clock_timestamp() where id=v_reservation.id returning * into v_reservation;
  elsif p_action='release' then
    if v_reservation.status='released' then return v_result; end if;
    if v_reservation.status <> 'reserved' then raise exception 'Claimed or ambiguous reservation cannot be released' using errcode='55000'; end if;
    -- Same mutex as claim, so cancellation can never refund a claimed request.
    update public.video_credit_accounts set credits=credits+v_reservation.credits_reserved where user_id=p_user_id;
    update private.generation_global_days set reserved_micros=reserved_micros-v_reservation.held_cost_micros where spend_day=v_reservation.spend_day;
    update private.generation_account_days set reserved_micros=reserved_micros-v_reservation.held_cost_micros where user_id=p_user_id and spend_day=v_reservation.spend_day;
    update private.generation_active_jobs set active_jobs=active_jobs-1 where user_id=p_user_id;
    update private.generation_reservations set status='released',held_cost_micros=0,updated_at=clock_timestamp() where id=v_reservation.id returning * into v_reservation;
    update public.jobs set status='cancelled' where id=v_request.job_id;
  else
    if p_actual_cost_micros is null or p_outcome is null or p_outcome not in ('succeeded','failed','cancelled') then raise exception 'Actual provider cost and final outcome required' using errcode='22023'; end if;
    if v_reservation.status='committed' then
      if v_reservation.actual_cost_micros is distinct from p_actual_cost_micros or v_reservation.terminal_outcome is distinct from p_outcome then raise exception 'Actual provider cost changed' using errcode='23505'; end if;
      return v_result;
    end if;
    if v_reservation.status='reconciliation_required' and (v_reservation.actual_cost_micros is distinct from p_actual_cost_micros or v_reservation.terminal_outcome is distinct from p_outcome) then
      raise exception 'Actual provider cost changed' using errcode='23505';
    end if;
    if p_action='reconcile' and v_reservation.status <> 'reconciliation_required' then raise exception 'Generation does not require reconciliation' using errcode='55000'; end if;
    if v_reservation.status not in ('dispatching','dispatched','unknown','reconciliation_required') then raise exception 'Generation has no dispatch claim' using errcode='55000'; end if;
    if p_action='commit' and p_actual_cost_micros > v_reservation.worst_case_cost_micros then
      -- Known exposure is recorded immediately, even if the provider broke its
      -- bound. Stop all new work; never hide cost to make a cap appear satisfied.
      v_delta := p_actual_cost_micros-v_reservation.held_cost_micros;
      update private.generation_global_days set reserved_micros=reserved_micros+v_delta where spend_day=v_reservation.spend_day;
      update private.generation_account_days set reserved_micros=reserved_micros+v_delta where user_id=p_user_id and spend_day=v_reservation.spend_day;
      update private.generation_policy set generation_enabled=false,updated_at=clock_timestamp() where id;
      update private.generation_reservations set status='reconciliation_required',terminal_outcome=p_outcome,actual_cost_micros=p_actual_cost_micros,held_cost_micros=p_actual_cost_micros,updated_at=clock_timestamp() where id=v_reservation.id returning * into v_reservation;
      return private.generation_reservation_json(v_request,v_reservation);
    end if;
    if p_action='commit' and v_reservation.status='reconciliation_required' then return v_result; end if;
    -- Charge actual cost to the settlement day. All prior-day pending exposure
    -- counted against today's budget until this atomic move to committed spend.
    insert into private.generation_global_days(spend_day) values(v_day) on conflict do nothing;
    insert into private.generation_account_days(user_id,spend_day) values(p_user_id,v_day) on conflict do nothing;
    update private.generation_global_days set reserved_micros=reserved_micros-v_reservation.held_cost_micros where spend_day=v_reservation.spend_day;
    update private.generation_account_days set reserved_micros=reserved_micros-v_reservation.held_cost_micros where user_id=p_user_id and spend_day=v_reservation.spend_day;
    update private.generation_global_days set committed_micros=committed_micros+p_actual_cost_micros where spend_day=v_day;
    update private.generation_account_days set committed_micros=committed_micros+p_actual_cost_micros where user_id=p_user_id and spend_day=v_day;
    update private.generation_active_jobs set active_jobs=active_jobs-1 where user_id=p_user_id;
    update private.generation_reservations set status='committed',terminal_outcome=p_outcome,held_cost_micros=0,actual_cost_micros=p_actual_cost_micros,settled_day=v_day,updated_at=clock_timestamp() where id=v_reservation.id returning * into v_reservation;
    update public.jobs set status=p_outcome where id=v_request.job_id;
  end if;
  return private.generation_reservation_json(v_request,v_reservation);
end;
$$;

create function private.configure_generation_policy(p_generation_enabled boolean,p_currency_code text,
  p_daily_global_limit_micros bigint,p_daily_account_limit_micros bigint,p_max_concurrent_jobs integer,p_reset_timezone text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_policy private.generation_policy;
begin
  perform private.require_generation_service();
  if p_generation_enabled is null or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$'
    or p_daily_global_limit_micros is null or p_daily_global_limit_micros not between 1 and 9000000000000000
    or p_daily_account_limit_micros is null or p_daily_account_limit_micros not between 1 and 9000000000000000
    or p_max_concurrent_jobs is null or p_max_concurrent_jobs not between 1 and 100000
    or p_reset_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_reset_timezone) then
    raise exception 'Invalid generation policy' using errcode='22023';
  end if;
  select * into strict v_policy from private.generation_policy where id for update;
  if exists(select 1 from private.generation_requests) and (v_policy.currency_code is distinct from p_currency_code or v_policy.reset_timezone is distinct from p_reset_timezone) then
    raise exception 'Currency and timezone require a separate ledger migration' using errcode='55000';
  end if;
  if p_generation_enabled and exists(select 1 from private.generation_reservations where status='reconciliation_required') then
    raise exception 'Provider reconciliation required before enabling generation' using errcode='55000';
  end if;
  update private.generation_policy set generation_enabled=p_generation_enabled,currency_code=p_currency_code,
    daily_global_limit_micros=p_daily_global_limit_micros,daily_account_limit_micros=p_daily_account_limit_micros,
    max_concurrent_jobs=p_max_concurrent_jobs,reset_timezone=p_reset_timezone,updated_at=clock_timestamp() where id;
  return true;
end;
$$;
create function private.set_generation_enabled(p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.require_generation_service();
  perform 1 from private.generation_policy where id for update;
  if p_enabled is null then raise exception 'Invalid generation switch' using errcode='22023'; end if;
  if p_enabled and (exists(select 1 from private.generation_policy where currency_code is null or reset_timezone is null
    or daily_global_limit_micros is null or daily_account_limit_micros is null or max_concurrent_jobs is null)
    or exists(select 1 from private.generation_reservations where status='reconciliation_required')) then
    raise exception 'Generation spend policy is not configured or reconciliation is required' using errcode='55000';
  end if;
  update private.generation_policy set generation_enabled=p_enabled,updated_at=clock_timestamp() where id;
  return p_enabled;
end;
$$;
create function private.configure_generation_account(p_user_id uuid,p_enabled boolean,p_daily_limit_micros bigint,p_max_concurrent_jobs integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.require_generation_service();
  perform 1 from private.generation_policy where id for update;
  insert into private.generation_account_limits(user_id,enabled,daily_limit_micros,max_concurrent_jobs)
    values(p_user_id,p_enabled,p_daily_limit_micros,p_max_concurrent_jobs) on conflict(user_id) do update
    set enabled=excluded.enabled,daily_limit_micros=excluded.daily_limit_micros,max_concurrent_jobs=excluded.max_concurrent_jobs;
  return true;
end;
$$;
create function private.upsert_generation_price(p_price_key text,p_credits bigint,p_worst_case_cost_micros bigint,p_provider_profile jsonb,p_active boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.require_generation_service();
  perform 1 from private.generation_policy where id for update;
  insert into private.generation_prices(price_key,credits,worst_case_cost_micros,provider_profile,active)
    values(p_price_key,p_credits,p_worst_case_cost_micros,p_provider_profile,p_active) on conflict(price_key) do update
    set credits=excluded.credits,worst_case_cost_micros=excluded.worst_case_cost_micros,provider_profile=excluded.provider_profile,active=excluded.active;
  return true;
end;
$$;

-- Exposed wrappers carry no definer rights. Only the website wrapper is granted
-- to authenticated; provider state and setup are exclusively service capabilities.
create function public.reserve_generation(p_project_id uuid,p_request_key text,p_price_key text,p_prompt text,p_label text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reserve_generation(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_project_id,p_request_key,p_price_key,p_prompt,p_label);
$$;
create function public.reserve_generation_for_user(p_user_id uuid,p_session_id uuid,p_project_id uuid,p_request_key text,p_price_key text,p_prompt text,p_label text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reserve_generation(p_user_id,p_session_id,p_project_id,p_request_key,p_price_key,p_prompt,p_label);
$$;
create function public.claim_generation(p_user_id uuid,p_request_key text)
returns jsonb language sql security invoker set search_path='' as $$ select private.transition_generation(p_user_id,p_request_key,'claim'); $$;
create function public.mark_generation_dispatched(p_user_id uuid,p_request_key text,p_provider_job_id text)
returns jsonb language sql security invoker set search_path='' as $$ select private.transition_generation(p_user_id,p_request_key,'dispatch',p_provider_job_id); $$;
create function public.mark_generation_unknown(p_user_id uuid,p_request_key text)
returns jsonb language sql security invoker set search_path='' as $$ select private.transition_generation(p_user_id,p_request_key,'unknown'); $$;
create function public.resolve_generation(p_user_id uuid,p_request_key text,p_actual_cost_micros bigint,p_outcome text default 'succeeded')
returns jsonb language sql security invoker set search_path='' as $$ select private.transition_generation(p_user_id,p_request_key,'commit',null,p_actual_cost_micros,p_outcome); $$;
create function public.reconcile_generation(p_user_id uuid,p_request_key text,p_actual_cost_micros bigint,p_outcome text default 'succeeded')
returns jsonb language sql security invoker set search_path='' as $$ select private.transition_generation(p_user_id,p_request_key,'reconcile',null,p_actual_cost_micros,p_outcome); $$;
create function public.release_generation(p_user_id uuid,p_request_key text)
returns jsonb language sql security invoker set search_path='' as $$ select private.transition_generation(p_user_id,p_request_key,'release'); $$;
create function public.configure_generation_policy(p_generation_enabled boolean,p_currency_code text,p_daily_global_limit_micros bigint,p_daily_account_limit_micros bigint,p_max_concurrent_jobs integer,p_reset_timezone text)
returns boolean language sql security invoker set search_path='' as $$ select private.configure_generation_policy(p_generation_enabled,p_currency_code,p_daily_global_limit_micros,p_daily_account_limit_micros,p_max_concurrent_jobs,p_reset_timezone); $$;
create function public.set_generation_enabled(p_enabled boolean)
returns boolean language sql security invoker set search_path='' as $$ select private.set_generation_enabled(p_enabled); $$;
create function public.configure_generation_account(p_user_id uuid,p_enabled boolean,p_daily_limit_micros bigint default null,p_max_concurrent_jobs integer default null)
returns boolean language sql security invoker set search_path='' as $$ select private.configure_generation_account(p_user_id,p_enabled,p_daily_limit_micros,p_max_concurrent_jobs); $$;
create function public.upsert_generation_price(p_price_key text,p_credits bigint,p_worst_case_cost_micros bigint,p_provider_profile jsonb,p_active boolean)
returns boolean language sql security invoker set search_path='' as $$ select private.upsert_generation_price(p_price_key,p_credits,p_worst_case_cost_micros,p_provider_profile,p_active); $$;

-- Revoke the platform's default function EXECUTE, including private helpers.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and p.proname in ('require_generation_service','generation_reservation_json',
      'reserve_generation','reserve_generation_for_user','transition_generation','claim_generation','mark_generation_dispatched',
      'mark_generation_unknown','resolve_generation','reconcile_generation','release_generation','configure_generation_policy',
      'set_generation_enabled','configure_generation_account','upsert_generation_price') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role, supabase_auth_admin',f.signature);
    if f.proname <> 'generation_reservation_json' then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end;
$$;
grant execute on function private.reserve_generation(uuid,uuid,uuid,text,text,text,text),public.reserve_generation(uuid,text,text,text,text) to authenticated;
create or replace function private.advance_owned_job(p_job_id uuid, p_project_id uuid, p_owner_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from private.generation_requests where job_id=p_job_id) then
    raise exception 'Generation jobs require the entitlement service' using errcode='55000';
  end if;
  if p_status is null or p_status not in ('running','succeeded','failed','cancelled') then
    raise exception 'Invalid job transition' using errcode = '22023';
  end if;
  update public.jobs set status = p_status
    where id = p_job_id and project_id = p_project_id and owner_id = p_owner_id
      and ((status = 'queued' and p_status in ('running','cancelled'))
        or (status = 'running' and p_status in ('succeeded','failed','cancelled')))
      and exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id);
  return found;
end;
$$;
create or replace function private.record_owned_output(
  p_job_id uuid, p_project_id uuid, p_owner_id uuid, p_filename text, p_content_type text, p_byte_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs%rowtype;
  v_output_id uuid;
begin
  if exists(select 1 from private.generation_requests q join private.generation_reservations r on r.request_id=q.id
    where q.job_id=p_job_id and r.status not in ('dispatched','unknown')) then
    raise exception 'Generation output requires an accepted provider request' using errcode='55000';
  end if;
  select * into v_job from public.jobs
    where id = p_job_id and project_id = p_project_id and owner_id = p_owner_id for update;
  if not found or v_job.status <> 'running' or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id) then
    raise exception 'Job is not authorized for output recording' using errcode = '42501';
  end if;
  insert into public.outputs (job_id, project_id, owner_id, filename, content_type, byte_size)
    values (p_job_id, p_project_id, p_owner_id, p_filename, p_content_type, p_byte_size)
    returning id into v_output_id;
  return v_output_id;
end;
$$;
comment on table private.generation_reservations is 'Durable financial ledger. Never delete unknown requests, expire a dispatch claim, or refund an ambiguous provider outcome.';
notify pgrst,'reload schema';
commit;
