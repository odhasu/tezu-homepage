begin;
-- This is only an empty pre-activation rollback. Never erase provider identity,
-- receipt, checkout, grant or allocation evidence from a populated installation.
do $$
declare t text; populated boolean;
begin
 if (select generation_enabled from private.generation_policy where id) then raise exception 'Generation must be disabled first' using errcode='55000'; end if;
 foreach t in array array['billing_link_states','billing_identities','billing_checkout_intents','billing_webhook_receipts','billing_memberships','billing_payments','billing_credit_buckets','billing_credit_allocations'] loop
  execute format('select exists(select 1 from private.%I)',t) into populated;
  if populated then raise exception 'Billing rollback refuses retained % evidence',t using errcode='55000'; end if;
 end loop;
end; $$;
drop trigger billing_generation_request_guard on private.generation_requests;
drop trigger billing_generation_claim_guard on private.generation_reservations;
drop trigger generation_paid_bucket_allocation on private.generation_reservations;
drop trigger generation_paid_bucket_release on private.generation_reservations;
create or replace function private.reserve_generation(p_user_id uuid, p_session_id uuid, p_project_id uuid,
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
do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and (p.proname like 'billing_%' or p.proname in ('configure_billing_policy','configure_billing_plan','expire_billing_credits')) order by n.nspname desc loop execute format('drop function %s cascade',f.sig); end loop; end $$;
drop table private.billing_credit_allocations,private.billing_credit_buckets,private.billing_payments,private.billing_memberships,private.billing_webhook_receipts,private.billing_checkout_intents,private.billing_identities,private.billing_link_states,private.billing_plans,private.billing_policy;
-- Restore the historical privileged capability only after the rollback guard.
grant update(credits) on public.video_credit_accounts to service_role;
commit;
