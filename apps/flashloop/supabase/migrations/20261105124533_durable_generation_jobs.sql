begin;

-- Durable delivery metadata contains identifiers only. The original entitlement
-- transaction remains the sole authority for owned input and financial holds.
create table private.job_dispatch_outbox (
  request_id uuid primary key references private.generation_requests(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz
);
create index job_dispatch_outbox_due_idx on private.job_dispatch_outbox(delivered_at nulls first,created_at,request_id);
create table private.provider_job_bindings (
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  provider_job_id text not null check (length(provider_job_id) between 1 and 255),
  request_id uuid not null unique references private.generation_requests(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (provider, provider_job_id)
);
create table private.provider_callback_events (
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  event_id text not null check (length(event_id) between 1 and 255),
  request_id uuid not null references private.generation_requests(id) on delete restrict,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('running','succeeded','failed','cancelled')),
  actual_cost_micros bigint check (actual_cost_micros between 0 and 9000000000000000),
  applied boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (provider, event_id)
);
do $$
declare t text;
begin
  foreach t in array array['job_dispatch_outbox','provider_job_bindings','provider_callback_events'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role, supabase_auth_admin',t);
  end loop;
end;
$$;

create function private.enqueue_generation_dispatch()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.job_dispatch_outbox(request_id) values(new.request_id);
  return new;
end;
$$;
create trigger generation_dispatch_enqueued after insert on private.generation_reservations
for each row execute function private.enqueue_generation_dispatch();
insert into private.job_dispatch_outbox(request_id)
select request_id from private.generation_reservations where status in ('reserved','dispatching','unknown','dispatched');

-- Every provider ID update uses this trigger, including existing service RPCs.
-- A provider job can never be rebound to another project or reservation.
create function private.bind_generation_provider_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_provider text;
begin
  if old.provider_job_id is not null and old.provider_job_id is distinct from new.provider_job_id then
    raise exception 'Provider job ID changed' using errcode='23505';
  end if;
  if new.provider_job_id is not null then
    select provider_profile->>'provider' into strict v_provider from private.generation_requests where id=new.request_id;
    if v_provider is null or v_provider !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
      raise exception 'Provider identity is not configured' using errcode='22023';
    end if;
    insert into private.provider_job_bindings(provider,provider_job_id,request_id)
    values(v_provider,new.provider_job_id,new.request_id) on conflict(request_id) do nothing;
    if not exists(select 1 from private.provider_job_bindings where request_id=new.request_id
      and provider=v_provider and provider_job_id=new.provider_job_id) then
      raise exception 'Provider job binding changed' using errcode='23505';
    end if;
  end if;
  return new;
end;
$$;
create trigger generation_provider_job_bound before update of provider_job_id on private.generation_reservations
for each row execute function private.bind_generation_provider_job();
-- Existing contradictory bindings require explicit remediation before migration.
insert into private.provider_job_bindings(provider,provider_job_id,request_id)
select q.provider_profile->>'provider',r.provider_job_id,q.id
from private.generation_requests q join private.generation_reservations r on r.request_id=q.id
where r.provider_job_id is not null;

create function private.generation_job_context(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.require_generation_service();
  select jsonb_build_object('requestId',q.id,'userId',q.user_id,'requestKey',q.request_key,
    'projectId',q.project_id,'jobId',q.job_id,'provider',q.provider_profile->>'provider',
    'status',r.status,'providerJobId',r.provider_job_id,'providerIdempotencyKey','flashloop:'||r.id::text)
    into v_result from private.generation_requests q join private.generation_reservations r on r.request_id=q.id
    where q.id=p_request_id;
  return v_result;
end;
$$;
create function private.generation_dispatch_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.require_generation_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid dispatch batch limit' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(private.generation_job_context(x.request_id) order by x.delivered_at nulls first,x.created_at,x.request_id),'[]'::jsonb)
  into v_result from (select o.request_id,o.created_at,o.delivered_at from private.job_dispatch_outbox o
    join private.generation_reservations r on r.request_id=o.request_id
    where r.status in ('reserved','dispatching','unknown','dispatched')
      and (o.delivered_at is null or o.delivered_at < clock_timestamp()-interval '5 minutes')
    order by o.delivered_at nulls first,o.created_at,o.request_id limit p_limit) x;
  return v_result;
end;
$$;
create function private.generation_dispatch_sent(p_request_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.require_generation_service();
  update private.job_dispatch_outbox set delivered_at=clock_timestamp() where request_id=p_request_id;
  return found;
end;
$$;
create function private.generation_reconciliation_batch(p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.require_generation_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid reconciliation batch limit' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(private.generation_job_context(x.request_id) order by x.updated_at,x.request_id),'[]'::jsonb)
  into v_result from (select request_id,updated_at from private.generation_reservations
    where status in ('dispatching','unknown','dispatched') order by updated_at,request_id limit p_limit) x;
  return v_result;
end;
$$;

-- Recovery binds only an authoritatively read provider identity. This operation
-- cannot grant another dispatch, release money, or settle an unverified result.
create function private.generation_bind_reconciled_job(p_request_id uuid,p_provider text,p_provider_job_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request private.generation_requests;
begin
  perform private.require_generation_service();
  perform 1 from private.generation_policy where id for update;
  select * into v_request from private.generation_requests where id=p_request_id;
  if not found then raise exception 'Generation request not found' using errcode='P0002'; end if;
  if p_provider is null or p_provider is distinct from (v_request.provider_profile->>'provider') then
    raise exception 'Provider identity changed' using errcode='23505';
  end if;
  perform private.transition_generation(v_request.user_id,v_request.request_key,'dispatch',p_provider_job_id);
  return private.generation_job_context(p_request_id);
end;
$$;

create function private.apply_generation_callback(p_provider text,p_event_id text,p_provider_job_id text,
  p_outcome text,p_actual_cost_micros bigint,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_request private.generation_requests;
  v_reservation private.generation_reservations;
  v_event private.provider_callback_events;
  v_applied boolean := false;
  v_result jsonb;
begin
  perform private.require_generation_service();
  if p_provider is null or p_provider !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or p_event_id is null or length(p_event_id) not between 1 and 255
    or p_provider_job_id is null or length(p_provider_job_id) not between 1 and 255
    or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_outcome is null or p_outcome not in ('running','succeeded','failed','cancelled')
    or (p_outcome <> 'running' and p_actual_cost_micros is null)
    or (p_actual_cost_micros is not null and p_actual_cost_micros not between 0 and 9000000000000000) then
    raise exception 'Invalid provider callback' using errcode='22023';
  end if;
  -- Follow the existing entitlement lock order. No inbox/binding/reservation lock
  -- may precede this shared policy mutex, including out-of-order callbacks.
  perform 1 from private.generation_policy where id for update;
  select q.* into v_request from private.provider_job_bindings b
    join private.generation_requests q on q.id=b.request_id
    where b.provider=p_provider and b.provider_job_id=p_provider_job_id;
  if not found then raise exception 'Provider job not found' using errcode='P0002'; end if;
  select * into strict v_reservation from private.generation_reservations where request_id=v_request.id for update;
  if v_reservation.provider_job_id is distinct from p_provider_job_id then
    raise exception 'Provider job binding changed' using errcode='23505';
  end if;
  select * into v_event from private.provider_callback_events where provider=p_provider and event_id=p_event_id;
  if found then
    if v_event.request_id is distinct from v_request.id or v_event.payload_hash is distinct from p_payload_hash
      or v_event.outcome is distinct from p_outcome or v_event.actual_cost_micros is distinct from p_actual_cost_micros then
      raise exception 'Provider event ID reused with different payload' using errcode='23505';
    end if;
    return jsonb_build_object('requestId',v_request.id,'jobId',v_request.job_id,
      'status',v_reservation.status,'applied',false,'duplicate',true);
  end if;
  -- The first final result wins. Late progress, conflicting final callbacks and
  -- repeated final events cannot reopen a job or book another settlement.
  -- A known overage stays held for the explicit operator reconciliation RPC.
  if p_outcome <> 'running' and v_reservation.status in ('dispatching','dispatched','unknown') then
    v_result := private.transition_generation(v_request.user_id,v_request.request_key,'commit',null,p_actual_cost_micros,p_outcome);
    v_applied := true;
  elsif p_outcome='running' and v_reservation.status in ('dispatching','dispatched','unknown') then
    -- Claim already made the owned job running; a progress callback has no
    -- financial effect and never grants a second dispatch permission.
    v_applied := false;
  end if;
  insert into private.provider_callback_events(provider,event_id,request_id,payload_hash,outcome,actual_cost_micros,applied)
    values(p_provider,p_event_id,v_request.id,p_payload_hash,p_outcome,p_actual_cost_micros,v_applied);
  return jsonb_build_object('requestId',v_request.id,'jobId',v_request.job_id,
    'status',coalesce(v_result->>'status',v_reservation.status),'applied',v_applied,'duplicate',false);
end;
$$;

create function public.generation_job_context(p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.generation_job_context(p_request_id); $$;
create function public.generation_dispatch_batch(p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.generation_dispatch_batch(p_limit); $$;
create function public.generation_dispatch_sent(p_request_id uuid)
returns boolean language sql security invoker set search_path='' as $$ select private.generation_dispatch_sent(p_request_id); $$;
create function public.generation_reconciliation_batch(p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.generation_reconciliation_batch(p_limit); $$;
create function public.generation_bind_reconciled_job(p_request_id uuid,p_provider text,p_provider_job_id text)
returns jsonb language sql security invoker set search_path='' as $$ select private.generation_bind_reconciled_job(p_request_id,p_provider,p_provider_job_id); $$;
create function public.apply_generation_callback(p_provider text,p_event_id text,p_provider_job_id text,
  p_outcome text,p_actual_cost_micros bigint,p_payload_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.apply_generation_callback(p_provider,p_event_id,p_provider_job_id,p_outcome,p_actual_cost_micros,p_payload_hash);
$$;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and p.proname in ('enqueue_generation_dispatch','bind_generation_provider_job',
      'generation_job_context','generation_dispatch_batch','generation_dispatch_sent','generation_reconciliation_batch','generation_bind_reconciled_job','apply_generation_callback') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role,supabase_auth_admin',f.signature);
    if f.proname not in ('enqueue_generation_dispatch','bind_generation_provider_job') then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;
end;
$$;
-- Reservations already count toward concurrency. A policy/account limit may be
-- tightened while jobs wait for delivery; execution must recheck that live limit
-- before granting the single paid-dispatch claim. Retain all existing holds when
-- refusing execution so a policy change cannot silently refund ambiguous work.
alter function private.transition_generation(uuid,text,text,text,bigint,text) rename to transition_generation_base;
revoke all on function private.transition_generation_base(uuid,text,text,text,bigint,text)
  from public,anon,authenticated,service_role,supabase_auth_admin;
create function private.transition_generation(p_user_id uuid,p_request_key text,p_action text,
  p_provider_job_id text default null,p_actual_cost_micros bigint default null,p_outcome text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_policy private.generation_policy; v_limit integer; v_active integer;
begin
  perform private.require_generation_service();
  select * into strict v_policy from private.generation_policy where id for update;
  if p_action='claim' and exists(select 1 from private.generation_requests q
    join private.generation_reservations r on r.request_id=q.id
    where q.user_id=p_user_id and q.request_key=p_request_key and r.status='reserved') then
    select least(v_policy.max_concurrent_jobs,coalesce(max_concurrent_jobs,v_policy.max_concurrent_jobs))
      into v_limit from private.generation_account_limits where user_id=p_user_id;
    select active_jobs into v_active from private.generation_active_jobs where user_id=p_user_id;
    -- The reservation being claimed already occupies one of these slots.
    if v_active > v_limit then raise exception 'Account concurrent job limit reached' using errcode='P0001'; end if;
  end if;
  return private.transition_generation_base(p_user_id,p_request_key,p_action,p_provider_job_id,p_actual_cost_micros,p_outcome);
end;
$$;
revoke all on function private.transition_generation(uuid,text,text,text,bigint,text)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function private.transition_generation(uuid,text,text,text,bigint,text) to service_role;

comment on table private.provider_callback_events is 'Verified callback inbox: permanent event identity and atomic entitlement settlement; never store raw provider payloads or signatures.';
comment on table private.job_dispatch_outbox is 'Atomic reservation delivery: acknowledge only after Inngest accepted its stable event ID; duplicate delivery cannot grant another paid dispatch.';
commit;
