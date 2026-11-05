begin;

-- Billing is deliberately unconfigured. Operator configuration supplies all commercial values.
create table private.billing_policy (
  id boolean primary key default true check (id),
  environment text check (environment in ('sandbox','production')),
  company_id text,
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.billing_policy(id) values (true);
create table private.billing_plans (
  environment text not null check (environment in ('sandbox','production')),
  plan_key text not null check (plan_key ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'),
  plan_id text not null,
  product_id text not null,
  credits bigint not null check (credits between 1 and 9000000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor between 1 and 9000000000000000),
  active boolean not null default false,
  primary key(environment,plan_key), unique(environment,plan_id)
);
create table private.billing_link_states (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null, state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  consumed_at timestamptz, bound_at timestamptz
);
create table private.billing_identities (
  environment text not null check(environment in ('sandbox','production')),
  user_id uuid not null references auth.users(id) on delete restrict,
  whop_user_id text not null check(length(whop_user_id) between 1 and 255),
  linked_session_id uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  primary key(environment,user_id), unique(environment,whop_user_id)
);
create table private.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(), environment text not null check(environment in ('sandbox','production')),
  user_id uuid not null references auth.users(id) on delete restrict, session_id uuid not null,
  whop_user_id text not null, plan_key text not null, request_key text not null check(length(request_key) between 16 and 200),
  plan_id text not null, product_id text not null, credits bigint not null, currency text not null, amount_minor bigint not null,
  status text not null default 'create_claimed' check(status in ('create_claimed','provider_created','unknown','completed','conflict')),
  provider_checkout_id text unique, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(environment,user_id,request_key), unique(environment,id)
);
create table private.billing_webhook_receipts (
  id uuid primary key default gen_random_uuid(), environment text not null check(environment in ('sandbox','production')),
  evidence jsonb not null default '{}'::jsonb,
  event_id text not null, event_type text not null, resource_id text not null, payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  disposition text not null default 'pending' check(disposition in ('pending','applied','duplicate','review','conflict','ignored')),
  attempts integer not null default 0 check(attempts >= 0), next_attempt_at timestamptz not null default clock_timestamp(), applied_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), unique(environment,event_id)
);
create table private.billing_memberships (
  environment text not null, membership_id text not null, user_id uuid not null references auth.users(id) on delete restrict,
  whop_user_id text not null, plan_key text not null, plan_id text not null, product_id text not null,
  status text not null, valid boolean not null, period_start timestamptz not null, period_end timestamptz not null,
  checkout_id text, observed_at timestamptz not null,
  cancel_at_period_end boolean not null default false, review_required boolean not null default false, updated_at timestamptz not null default clock_timestamp(),
  primary key(environment,membership_id), foreign key(environment,user_id) references private.billing_identities(environment,user_id) on delete restrict
);
create table private.billing_payments (
  environment text not null, payment_id text not null, user_id uuid not null references auth.users(id) on delete restrict,
  membership_id text, plan_key text not null, checkout_id text not null, status text not null, paid boolean not null,
  refunded boolean not null default false, disputed boolean not null default false, billing_reason text not null,
  amount_minor bigint not null check(amount_minor >= 0), currency text not null, created_at timestamptz not null,
  paid_at timestamptz, period_proven boolean not null default false, review_required boolean not null default false,
  plan_id text not null, product_id text not null,
  primary key(environment,payment_id), foreign key(environment,user_id) references private.billing_identities(environment,user_id) on delete restrict
);
create table private.billing_credit_buckets (
  id uuid primary key default gen_random_uuid(), environment text not null, user_id uuid not null references auth.users(id) on delete restrict,
  payment_id text not null, credits_total bigint not null check(credits_total > 0), credits_remaining bigint not null check(credits_remaining between 0 and credits_total),
  membership_id text not null, period_start timestamptz not null,
  expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
  unique(environment,payment_id), unique(environment,membership_id,period_start), foreign key(environment,payment_id) references private.billing_payments(environment,payment_id) on delete restrict
);
create index billing_receipts_due on private.billing_webhook_receipts(disposition,next_attempt_at);
create index billing_membership_user on private.billing_memberships(environment,user_id,period_end);
create index billing_buckets_user on private.billing_credit_buckets(environment,user_id,expires_at);

do $$ declare t text; begin foreach t in array array['billing_policy','billing_plans','billing_link_states','billing_identities','billing_checkout_intents','billing_webhook_receipts','billing_memberships','billing_payments','billing_credit_buckets'] loop execute format('alter table private.%I enable row level security',t); execute format('alter table private.%I force row level security',t); execute format('revoke all on private.%I from public,anon,authenticated,service_role,supabase_auth_admin',t); end loop; end $$;

create table private.billing_credit_allocations (
 reservation_id uuid not null references private.generation_reservations(id) on delete restrict,
 bucket_id uuid not null references private.billing_credit_buckets(id) on delete restrict,
 credits bigint not null check(credits>0), restored boolean not null default false,
 primary key(reservation_id,bucket_id)
);
alter table private.billing_credit_allocations enable row level security;
alter table private.billing_credit_allocations force row level security;
revoke all on private.billing_credit_allocations from public,anon,authenticated,service_role,supabase_auth_admin;
-- Persisted provider/owner tuples remain valid even for privileged code defects.
alter table private.billing_identities add unique(environment,user_id,whop_user_id);
alter table private.billing_checkout_intents add foreign key(environment,user_id,whop_user_id) references private.billing_identities(environment,user_id,whop_user_id) on delete restrict;
alter table private.billing_memberships add unique(environment,membership_id,user_id);
alter table private.billing_memberships add foreign key(environment,user_id,whop_user_id) references private.billing_identities(environment,user_id,whop_user_id) on delete restrict;
alter table private.billing_payments add unique(environment,payment_id,user_id);
alter table private.billing_payments add foreign key(environment,membership_id,user_id) references private.billing_memberships(environment,membership_id,user_id) on delete restrict;
alter table private.billing_credit_buckets add foreign key(environment,payment_id,user_id) references private.billing_payments(environment,payment_id,user_id) on delete restrict;
alter table private.billing_credit_buckets add foreign key(environment,membership_id,user_id) references private.billing_memberships(environment,membership_id,user_id) on delete restrict;
create trigger billing_identity_immutable before update on private.billing_identities for each row execute function private.enforce_record_identity('environment','user_id','whop_user_id','linked_session_id','linked_at');
create trigger billing_intent_immutable before update on private.billing_checkout_intents for each row execute function private.enforce_record_identity('id','environment','user_id','session_id','whop_user_id','plan_key','plan_id','product_id','credits','currency','amount_minor','request_key','created_at');
create trigger billing_receipt_immutable before update on private.billing_webhook_receipts for each row execute function private.enforce_record_identity('id','environment','event_id','event_type','resource_id','payload_hash','evidence','created_at');
create trigger billing_member_immutable before update on private.billing_memberships for each row execute function private.enforce_record_identity('environment','membership_id','user_id','whop_user_id','plan_key','plan_id','product_id');
create trigger billing_payment_immutable before update on private.billing_payments for each row execute function private.enforce_record_identity('environment','payment_id','user_id','membership_id','plan_key','plan_id','product_id','checkout_id','billing_reason','amount_minor','currency','created_at');
create trigger billing_bucket_immutable before update on private.billing_credit_buckets for each row execute function private.enforce_record_identity('id','environment','user_id','payment_id','membership_id','period_start','credits_total','created_at');
-- Generic service-role balance writes are replaced by the bounded financial RPCs.
revoke update(credits) on public.video_credit_accounts from service_role;

create function private.billing_current_user(p_user_id uuid,p_session_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
 join private.session_verifications v on v.user_id=u.id and v.session_id=s.id
 where u.id=p_user_id and s.id=p_session_id and v.state='verified'
 and u.email_confirmed_at is not null and u.is_anonymous is not true
 and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and (s.not_after is null or s.not_after>statement_timestamp()));
$$;
create function private.billing_configured() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.billing_policy where id and enabled and environment is not null and company_id is not null);
$$;
create function private.billing_generation_allowed(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.billing_policy p join private.billing_memberships m
 on m.environment=p.environment and m.user_id=p_user_id
 where p.id and p.enabled and m.valid and not m.review_required and m.status='active'
 and m.period_start<=statement_timestamp() and m.period_end>statement_timestamp()
 and exists(select 1 from private.billing_credit_buckets b join private.billing_payments pay
 on pay.environment=b.environment and pay.payment_id=b.payment_id
 where b.environment=m.environment and b.user_id=m.user_id and b.membership_id=m.membership_id
 and b.period_start=m.period_start and b.expires_at=m.period_end and pay.paid and not pay.refunded and not pay.disputed and not pay.review_required)
 and not exists(select 1 from private.billing_memberships hold where hold.environment=p.environment and hold.user_id=p_user_id and hold.review_required));
$$;
create function private.configure_billing_policy(p_environment text,p_company_id text,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare old private.billing_policy;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if p_environment is null or p_environment not in ('sandbox','production') or p_company_id is null or length(p_company_id) not between 1 and 255 or p_enabled is null then raise exception 'Invalid billing policy' using errcode='22023'; end if;
 select * into strict old from private.billing_policy where id for update;
 if old.environment is not null and (old.environment is distinct from p_environment or old.company_id is distinct from p_company_id) and (exists(select 1 from private.billing_identities) or exists(select 1 from private.billing_webhook_receipts)) then raise exception 'Billing merchant binding is immutable after use' using errcode='55000'; end if;
 update private.billing_policy set environment=p_environment,company_id=p_company_id,enabled=p_enabled,updated_at=clock_timestamp() where id;
 return true;
end; $$;
create function private.configure_billing_plan(p_environment text,p_plan_key text,p_plan_id text,p_product_id text,p_credits bigint,p_currency text,p_amount_minor bigint,p_active boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if p_environment is null or p_environment not in ('sandbox','production') or p_plan_key is null or p_plan_key !~ '^[a-z0-9][a-z0-9._:-]{0,63}$' or p_plan_id is null or length(p_plan_id) not between 1 and 255 or p_product_id is null or length(p_product_id) not between 1 and 255 or p_credits is null or p_credits not between 1 and 9000000000000000 or p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_amount_minor is null or p_amount_minor not between 1 and 9000000000000000 or p_active is null then raise exception 'Invalid billing plan' using errcode='22023'; end if;
 -- Existing plan definitions are versioned rather than silently changing a sold entitlement.
 if exists(select 1 from private.billing_plans where environment=p_environment and plan_key=p_plan_key and (plan_id is distinct from p_plan_id or product_id is distinct from p_product_id or credits is distinct from p_credits or currency is distinct from p_currency or amount_minor is distinct from p_amount_minor)) and exists(select 1 from private.billing_checkout_intents where environment=p_environment and plan_key=p_plan_key) then raise exception 'Used billing plan requires a new versioned key' using errcode='55000'; end if;
 insert into private.billing_plans values(p_environment,p_plan_key,p_plan_id,p_product_id,p_credits,p_currency,p_amount_minor,p_active)
 on conflict(environment,plan_key) do update set plan_id=excluded.plan_id,product_id=excluded.product_id,credits=excluded.credits,currency=excluded.currency,amount_minor=excluded.amount_minor,active=excluded.active;
 return true;
end; $$;
create function private.billing_begin_link(p_user_id uuid,p_session_id uuid,p_state_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if not private.billing_current_user(p_user_id,p_session_id) then raise exception 'Verified session required' using errcode='42501'; end if;
 if not private.billing_configured() then raise exception 'Billing not configured' using errcode='55000'; end if;
 if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid link proof' using errcode='22023'; end if;
 insert into private.billing_link_states(user_id,session_id,state_hash,expires_at) values(p_user_id,p_session_id,p_state_hash,clock_timestamp()+interval '10 minutes'); return true;
end; $$;
create function private.billing_consume_link(p_user_id uuid,p_session_id uuid,p_state_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if not private.billing_current_user(p_user_id,p_session_id) then raise exception 'Verified session required' using errcode='42501'; end if;
 update private.billing_link_states set consumed_at=clock_timestamp() where user_id=p_user_id and session_id=p_session_id and state_hash=p_state_hash and consumed_at is null and expires_at>clock_timestamp();
 if not found then raise exception 'Billing link proof invalid' using errcode='42501'; end if; return true;
end; $$;
create function private.billing_bind_identity(p_user_id uuid,p_session_id uuid,p_whop_user_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e text; existing text; proof uuid;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if not private.billing_current_user(p_user_id,p_session_id) then raise exception 'Verified session required' using errcode='42501'; end if;
 select environment into e from private.billing_policy where id and enabled;
 if e is null or p_whop_user_id is null or length(p_whop_user_id) not between 1 and 255 then raise exception 'Billing not configured or identity invalid' using errcode='22023'; end if;
 select whop_user_id into existing from private.billing_identities where environment=e and user_id=p_user_id for update;
 if found then if existing is distinct from p_whop_user_id then raise exception 'Billing identity conflict' using errcode='23505'; end if; return jsonb_build_object('environment',e,'whopUserId',existing); end if;
 select id into proof from private.billing_link_states where user_id=p_user_id and session_id=p_session_id and consumed_at is not null and bound_at is null and expires_at>clock_timestamp() order by consumed_at desc limit 1 for update;
 if proof is null then raise exception 'Consumed billing link proof required' using errcode='42501'; end if;
 insert into private.billing_identities(environment,user_id,whop_user_id,linked_session_id) values(e,p_user_id,p_whop_user_id,p_session_id);
 update private.billing_link_states set bound_at=clock_timestamp() where id=proof;
 return jsonb_build_object('environment',e,'whopUserId',p_whop_user_id);
end; $$;
create function private.billing_intent_json(i private.billing_checkout_intents,p_create boolean) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('intentId',i.id,'createAllowed',p_create,'status',i.status,'providerCheckoutId',i.provider_checkout_id,'whopUserId',i.whop_user_id,'plan',jsonb_build_object('planKey',i.plan_key,'planId',i.plan_id,'productId',i.product_id,'credits',i.credits,'currency',i.currency,'amountMinor',i.amount_minor));
$$;
create function private.billing_begin_checkout(p_user_id uuid,p_session_id uuid,p_plan_key text,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e text; w text; p private.billing_plans; i private.billing_checkout_intents;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if not private.billing_current_user(p_user_id,p_session_id) then raise exception 'Verified session required' using errcode='42501'; end if;
 select environment into e from private.billing_policy where id and enabled;
 if e is null then raise exception 'Billing not configured' using errcode='55000'; end if;
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{16,200}$' then raise exception 'Invalid checkout request' using errcode='22023'; end if;
 select whop_user_id into w from private.billing_identities where environment=e and user_id=p_user_id;
 if w is null then raise exception 'Billing identity required' using errcode='42501'; end if;
 select * into i from private.billing_checkout_intents where environment=e and user_id=p_user_id and request_key=p_request_key;
 if found then if i.plan_key is distinct from p_plan_key then raise exception 'Checkout request changed' using errcode='23505'; end if; return private.billing_intent_json(i,false); end if;
 if exists(select 1 from private.billing_checkout_intents where environment=e and user_id=p_user_id and status in ('create_claimed','provider_created','unknown')) then raise exception 'Existing checkout requires reconciliation' using errcode='55000'; end if;
 if exists(select 1 from private.billing_memberships where environment=e and user_id=p_user_id and period_end>clock_timestamp() and (valid or review_required)) then raise exception 'Existing subscription requires billing management' using errcode='55000'; end if;
 select * into p from private.billing_plans where environment=e and plan_key=p_plan_key and active;
 if not found then raise exception 'Billing plan unavailable' using errcode='P0002'; end if;
 insert into private.billing_checkout_intents(environment,user_id,session_id,whop_user_id,plan_key,plan_id,product_id,credits,currency,amount_minor,request_key) values(e,p_user_id,p_session_id,w,p.plan_key,p.plan_id,p.product_id,p.credits,p.currency,p.amount_minor,p_request_key) returning * into i;
 return private.billing_intent_json(i,true);
end; $$;
create function private.billing_finish_checkout(p_intent_id uuid,p_provider_checkout_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.billing_checkout_intents;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 select * into i from private.billing_checkout_intents where id=p_intent_id for update;
 if not found then raise exception 'Checkout intent not found' using errcode='P0002'; end if;
 if p_provider_checkout_id is null or length(p_provider_checkout_id) not between 1 and 255 then raise exception 'Invalid provider checkout ID' using errcode='22023'; end if;
 if i.provider_checkout_id is not null and i.provider_checkout_id is distinct from p_provider_checkout_id then raise exception 'Checkout identity changed' using errcode='23505'; end if;
 update private.billing_checkout_intents set provider_checkout_id=p_provider_checkout_id,status=case when status='completed' then status else 'provider_created' end,updated_at=clock_timestamp() where id=i.id returning * into i;
 return private.billing_intent_json(i,false);
end; $$;
create function private.billing_unknown_checkout(p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.billing_checkout_intents;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 update private.billing_checkout_intents set status='unknown',updated_at=clock_timestamp() where id=p_intent_id and provider_checkout_id is null returning * into i;
 if not found then select * into i from private.billing_checkout_intents where id=p_intent_id; if not found then raise exception 'Checkout intent not found' using errcode='P0002'; end if; end if;
 return private.billing_intent_json(i,false);
end; $$;
create function private.billing_receive_webhook(p_environment text,p_event_id text,p_event_type text,p_resource_id text,p_payload_hash text,p_evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.billing_webhook_receipts;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if p_environment is null or p_environment not in ('sandbox','production') or p_event_id is null or length(p_event_id) not between 1 and 255 or p_event_type is null or length(p_event_type) not between 1 and 100 or p_resource_id is null or length(p_resource_id) not between 1 and 255 or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>1500 or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('membershipId','paymentId','periodStart','periodEnd')) then raise exception 'Invalid billing receipt' using errcode='22023'; end if;
 select * into r from private.billing_webhook_receipts where environment=p_environment and event_id=p_event_id for update;
 if found then if r.payload_hash<>p_payload_hash or r.resource_id<>p_resource_id or r.event_type<>p_event_type or r.evidence is distinct from p_evidence then raise exception 'Billing event conflict' using errcode='23505'; end if; return jsonb_build_object('receiptId',r.id,'disposition',r.disposition,'duplicate',true); end if;
 insert into private.billing_webhook_receipts(environment,event_id,event_type,resource_id,payload_hash,evidence) values(p_environment,p_event_id,p_event_type,p_resource_id,p_payload_hash,p_evidence) returning * into r;
 return jsonb_build_object('receiptId',r.id,'disposition',r.disposition,'duplicate',false);
end; $$;
create function private.billing_due_receipts(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_generation_service(); if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid receipt limit' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('receiptId',id,'environment',environment,'eventType',event_type,'resourceId',resource_id,'evidence',evidence,'attempts',attempts) order by created_at) from(select * from private.billing_webhook_receipts where disposition='pending' and next_attempt_at<=clock_timestamp() order by created_at,id limit p_limit) q),'[]'::jsonb);
end; $$;
create function private.billing_defer_receipt(p_receipt_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 update private.billing_webhook_receipts set attempts=least(attempts+1,1000000),next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*(attempts+1))) where id=p_receipt_id and disposition='pending'; return found;
end; $$;

create function private.billing_apply_snapshot(p_receipt_id uuid,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 r private.billing_webhook_receipts; pol private.billing_policy; plan private.billing_plans;
 oldm private.billing_memberships; oldpay private.billing_payments; intent private.billing_checkout_intents;
 m jsonb; pay jsonb; owner uuid; whop text; mem text; checkout text; payment text; reason text;
 start_at timestamptz; end_at timestamptz; observed timestamptz; created timestamptz; paid_at timestamptz;
 amount bigint; grant_credits bigint:=0; hold boolean:=false; valid_charge boolean:=false;
 v_disposition text:='applied'; existing_member boolean:=false; stale boolean:=false; bucket uuid;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 select * into strict pol from private.billing_policy where id for update;
 select * into r from private.billing_webhook_receipts where id=p_receipt_id for update;
 if not found then raise exception 'Billing receipt not found' using errcode='P0002'; end if;
 if r.disposition in ('applied','duplicate','ignored','conflict') then return jsonb_build_object('receiptId',r.id,'disposition','duplicate','grantedCredits',0); end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>12000 then raise exception 'Invalid billing snapshot' using errcode='22023'; end if;
 if not pol.enabled or r.environment is distinct from pol.environment or p_snapshot->>'environment' is distinct from r.environment or p_snapshot->>'companyId' is distinct from pol.company_id or p_snapshot->>'resourceId' is distinct from r.resource_id then
  update private.billing_webhook_receipts set disposition='review',attempts=attempts+1 where id=r.id;
  return jsonb_build_object('receiptId',r.id,'disposition','review','grantedCredits',0);
 end if;
 whop:=p_snapshot->>'whopUserId';
 select user_id into owner from private.billing_identities where environment=pol.environment and whop_user_id=whop for update;
 if owner is null then
  update private.billing_webhook_receipts set disposition='review',attempts=attempts+1 where id=r.id;
  return jsonb_build_object('receiptId',r.id,'disposition','review','grantedCredits',0);
 end if;
 hold:=r.event_type like 'refund.%' or r.event_type like 'dispute%';
 if hold then update private.billing_memberships set review_required=true where environment=pol.environment and user_id=owner; end if;
 m:=p_snapshot->'membership'; pay:=p_snapshot->'payment';
 if (m->>'whopUserId' is not null and m->>'whopUserId' is distinct from whop) or (m->>'accountId' is not null and m->>'accountId' is distinct from pol.company_id) or (pay->>'accountId' is not null and pay->>'accountId' is distinct from pol.company_id) then raise exception 'Billing provider identity conflict' using errcode='23505'; end if;
 if jsonb_typeof(m) is distinct from 'object' or m->>'id' is null or length(m->>'id') not between 1 and 255 or m->>'planId' is null or m->>'productId' is null or m->>'status' is null or length(m->>'status')>100 or jsonb_typeof(m->'valid') is distinct from 'boolean' or jsonb_typeof(m->'cancelAtPeriodEnd') is distinct from 'boolean' then raise exception 'Invalid membership snapshot' using errcode='22023'; end if;
 mem:=m->>'id'; start_at:=nullif(m->>'periodStart','')::timestamptz; end_at:=nullif(m->>'periodEnd','')::timestamptz; observed:=nullif(p_snapshot->>'observedAt','')::timestamptz;
 if observed is null or observed>clock_timestamp()+interval '30 seconds' or start_at is null or end_at is null or end_at<=start_at or end_at-start_at>interval '35 days' then
  update private.billing_webhook_receipts set disposition='review',attempts=attempts+1 where id=r.id;
  return jsonb_build_object('receiptId',r.id,'disposition','review','grantedCredits',0);
 end if;
 select * into plan from private.billing_plans where environment=pol.environment and plan_id=m->>'planId' and product_id=m->>'productId' and plan_key=m->>'planKey';
 if not found then update private.billing_webhook_receipts set disposition='review',attempts=attempts+1 where id=r.id; return jsonb_build_object('receiptId',r.id,'disposition','review','grantedCredits',0); end if;
 select * into oldm from private.billing_memberships where environment=pol.environment and membership_id=mem for update;
 existing_member:=found;
 if existing_member and (oldm.user_id is distinct from owner or oldm.whop_user_id is distinct from whop) then raise exception 'Membership identity conflict' using errcode='23505'; end if;
 stale:=existing_member and (observed<oldm.observed_at or start_at<oldm.period_start);
 if jsonb_typeof(pay)='object' then
  payment:=pay->>'id'; checkout:=nullif(pay->>'checkoutId',''); reason:=pay->>'billingReason';
  if payment is null or length(payment) not between 1 and 255 or pay->>'membershipId' is distinct from mem or pay->>'planId' is distinct from plan.plan_id or pay->>'currency' is null or pay->>'amountMinor' is null or pay->>'status' is null or jsonb_typeof(pay->'paid') is distinct from 'boolean' or jsonb_typeof(pay->'refunded') is distinct from 'boolean' or jsonb_typeof(pay->'disputed') is distinct from 'boolean' then raise exception 'Invalid payment snapshot' using errcode='22023'; end if;
  amount:=(pay->>'amountMinor')::bigint; created:=(pay->>'createdAt')::timestamptz; paid_at:=nullif(pay->>'paidAt','')::timestamptz;
  if amount<0 or amount>9000000000000000 or created is null then raise exception 'Invalid payment snapshot' using errcode='22023'; end if;
  hold:=(pay->>'refunded')::boolean or (pay->>'disputed')::boolean or r.event_type like 'refund.%' or r.event_type like 'dispute%';
  select * into oldpay from private.billing_payments where environment=pol.environment and payment_id=payment for update;
  if found and (oldpay.user_id is distinct from owner or oldpay.membership_id is distinct from mem or oldpay.plan_id is distinct from plan.plan_id or oldpay.amount_minor is distinct from amount or oldpay.currency is distinct from pay->>'currency' or oldpay.created_at is distinct from created or oldpay.billing_reason is distinct from reason or (oldpay.checkout_id is not null and checkout is not null and oldpay.checkout_id<>checkout)) then
   update private.billing_memberships set review_required=true where environment=pol.environment and user_id=owner;
   update private.billing_webhook_receipts set disposition='conflict',attempts=attempts+1,applied_at=clock_timestamp() where id=r.id;
   return jsonb_build_object('receiptId',r.id,'disposition','conflict','grantedCredits',0);
  end if;
 end if;
 checkout:=coalesce(checkout,oldm.checkout_id);
 if checkout is not null then
  select * into intent from private.billing_checkout_intents where environment=pol.environment and user_id=owner and whop_user_id=whop and provider_checkout_id=checkout and plan_id=plan.plan_id and product_id=plan.product_id for update;
 end if;
 -- A provider membership alone never binds an external purchase to a local owner.
 if intent.id is null and not existing_member then
  update private.billing_webhook_receipts set disposition='review',attempts=attempts+1 where id=r.id;
  return jsonb_build_object('receiptId',r.id,'disposition','review','grantedCredits',0);
 end if;
 if existing_member and oldm.checkout_id is not null and checkout is distinct from oldm.checkout_id then hold:=true; end if;
 if not existing_member then
  insert into private.billing_memberships(environment,membership_id,user_id,whop_user_id,plan_key,plan_id,product_id,status,valid,period_start,period_end,cancel_at_period_end,checkout_id,observed_at,review_required)
  values(pol.environment,mem,owner,whop,plan.plan_key,plan.plan_id,plan.product_id,m->>'status',(m->>'valid')::boolean,start_at,end_at,(m->>'cancelAtPeriodEnd')::boolean,checkout,observed,hold);
 elsif not stale then
  -- A plan change is deliberately held for review; no automatic proration policy exists.
  hold:=hold or oldm.plan_id is distinct from plan.plan_id;
  update private.billing_memberships set status=m->>'status',valid=(m->>'valid')::boolean,period_start=start_at,period_end=end_at,cancel_at_period_end=(m->>'cancelAtPeriodEnd')::boolean,checkout_id=coalesce(checkout_id,checkout),observed_at=observed,review_required=review_required or hold,updated_at=clock_timestamp() where environment=pol.environment and membership_id=mem;
 end if;
 if hold then update private.billing_memberships set review_required=true where environment=pol.environment and user_id=owner; end if;
 if payment is not null then
  insert into private.billing_payments(environment,payment_id,user_id,membership_id,plan_key,plan_id,product_id,checkout_id,status,paid,refunded,disputed,billing_reason,amount_minor,currency,created_at,paid_at,period_proven,review_required)
  values(pol.environment,payment,owner,mem,plan.plan_key,plan.plan_id,plan.product_id,checkout,pay->>'status',(pay->>'paid')::boolean,(pay->>'refunded')::boolean,(pay->>'disputed')::boolean,coalesce(reason,'unknown'),amount,pay->>'currency',created,paid_at,coalesce((pay->>'periodProven')::boolean,false),hold)
  on conflict(environment,payment_id) do update set paid=billing_payments.paid or excluded.paid,refunded=billing_payments.refunded or excluded.refunded,disputed=billing_payments.disputed or excluded.disputed,review_required=billing_payments.review_required or excluded.review_required,status=excluded.status,paid_at=coalesce(billing_payments.paid_at,excluded.paid_at);
  -- Paid timestamps alone are insufficient. A signature-verified activation receipt
  -- must independently record the very same membership period and payment.
  valid_charge:=not stale and not hold and plan.active and intent.id is not null
   and (pay->>'paid')::boolean and pay->>'status'='paid' and coalesce((pay->>'periodProven')::boolean,false)
   and reason in ('subscription_create','subscription_cycle') and amount=intent.amount_minor and pay->>'currency'=intent.currency
   and created>=start_at and created<end_at and paid_at>=start_at and paid_at<end_at
   and end_at>clock_timestamp() and (m->>'valid')::boolean and m->>'status'='active'
   and exists(select 1 from private.billing_webhook_receipts proof where proof.environment=pol.environment and proof.event_type='membership.activated' and proof.resource_id=mem and proof.evidence->>'membershipId'=mem and (proof.evidence->>'periodStart')::timestamptz=start_at and (proof.evidence->>'periodEnd')::timestamptz=end_at and (proof.evidence->>'paymentId' is null or proof.evidence->>'paymentId'=payment))
   and not exists(select 1 from private.billing_memberships where environment=pol.environment and user_id=owner and review_required)
   and not exists(select 1 from private.billing_payments where environment=pol.environment and payment_id=payment and (refunded or disputed or review_required));
  if valid_charge then
   insert into private.billing_credit_buckets(environment,user_id,payment_id,membership_id,period_start,credits_total,credits_remaining,expires_at)
   values(pol.environment,owner,payment,mem,start_at,intent.credits,intent.credits,end_at)
   on conflict do nothing returning id into bucket;
   if bucket is not null then update public.video_credit_accounts set credits=credits+intent.credits where user_id=owner; grant_credits:=intent.credits; end if;
   update private.billing_checkout_intents set status='completed',updated_at=clock_timestamp() where id=intent.id;
  elsif not exists(select 1 from private.billing_credit_buckets where environment=pol.environment and payment_id=payment) then v_disposition:=case when hold or reason not in ('subscription_create','subscription_cycle') then 'review' else 'pending' end;
  end if;
 else v_disposition:=case when hold then 'review' else 'pending' end;
 end if;
 if stale and not hold then v_disposition:='ignored'; end if;
 update private.billing_webhook_receipts set disposition=v_disposition,attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '5 minutes',applied_at=case when v_disposition in ('applied','ignored','review') then clock_timestamp() else null end where id=r.id;
 return jsonb_build_object('receiptId',r.id,'disposition',v_disposition,'grantedCredits',grant_credits);
end; $$;

create function private.expire_billing_credits(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare expired bigint;
begin
 perform 1 from private.generation_policy where id for update;
 perform 1 from public.video_credit_accounts where user_id=p_user_id for update;
 select coalesce(sum(credits_remaining),0) into expired from private.billing_credit_buckets where user_id=p_user_id and expires_at<=clock_timestamp() and credits_remaining>0;
 if expired>0 then
  update private.billing_credit_buckets set credits_remaining=0 where user_id=p_user_id and expires_at<=clock_timestamp() and credits_remaining>0;
  update public.video_credit_accounts set credits=greatest(0,credits-expired) where user_id=p_user_id;
 end if;
end; $$;
create function private.billing_allocate_credits() returns trigger language plpgsql security definer set search_path='' as $$
declare b private.billing_credit_buckets; remaining bigint:=new.credits_reserved; take bigint;
begin
 -- Reserve already owns the global accounting lock and account row.
 for b in select * from private.billing_credit_buckets where user_id=new.user_id and expires_at>clock_timestamp() and credits_remaining>0 order by expires_at,id for update loop
  exit when remaining=0;
  take:=least(remaining,b.credits_remaining);
  insert into private.billing_credit_allocations(reservation_id,bucket_id,credits) values(new.id,b.id,take);
  update private.billing_credit_buckets set credits_remaining=credits_remaining-take where id=b.id;
  remaining:=remaining-take;
 end loop;
 -- Existing manually funded pre-billing balance is not minted again, reclassified,
 -- expired, or granted by a subscription callback. It still requires paid access.
 return new;
end; $$;
create trigger generation_paid_bucket_allocation after insert on private.generation_reservations for each row execute function private.billing_allocate_credits();
create function private.billing_restore_credits() returns trigger language plpgsql security definer set search_path='' as $$
declare a record; expired bigint:=0;
begin
 for a in select x.*,b.expires_at from private.billing_credit_allocations x join private.billing_credit_buckets b on b.id=x.bucket_id where x.reservation_id=new.id and not x.restored for update of x,b loop
  if a.expires_at>clock_timestamp() then update private.billing_credit_buckets set credits_remaining=credits_remaining+a.credits where id=a.bucket_id;
  else expired:=expired+a.credits; end if;
  update private.billing_credit_allocations set restored=true where reservation_id=a.reservation_id and bucket_id=a.bucket_id;
 end loop;
 -- The existing generation release refunded the full reservation. Deduct the
 -- expired paid portion once; unknown/claimed results never enter this trigger.
 if expired>0 then update public.video_credit_accounts set credits=credits-expired where user_id=new.user_id; end if;
 return new;
end; $$;
create trigger generation_paid_bucket_release after update of status on private.generation_reservations for each row when (old.status='reserved' and new.status='released') execute function private.billing_restore_credits();
create function private.billing_generation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.generation_policy where id for update;
 if not private.billing_generation_allowed(new.user_id) then raise exception 'Billing entitlement denied' using errcode='42501'; end if;
 return new;
end; $$;
create trigger billing_generation_request_guard before insert on private.generation_requests for each row execute function private.billing_generation_guard();
create trigger billing_generation_claim_guard before update of status on private.generation_reservations for each row when(new.status='dispatching') execute function private.billing_generation_guard();
create function private.billing_account(p_user_id uuid,p_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e text; w text; c bigint; plans jsonb;
begin
 perform private.require_generation_service(); perform 1 from private.generation_policy where id for update;
 if not private.billing_current_user(p_user_id,p_session_id) then raise exception 'Verified session required' using errcode='42501'; end if;
 perform private.expire_billing_credits(p_user_id);
 select environment into e from private.billing_policy where id;
 select credits into c from public.video_credit_accounts where user_id=p_user_id;
 select whop_user_id into w from private.billing_identities where environment=e and user_id=p_user_id;
 select coalesce(jsonb_agg(jsonb_build_object('planKey',plan_key,'planId',plan_id,'productId',product_id,'credits',credits,'currency',currency,'amountMinor',amount_minor) order by amount_minor),'[]'::jsonb) into plans from private.billing_plans where environment=e and active;
 return jsonb_build_object('linked',w is not null,'environment',e,'whopUserId',w,'billingEnabled',private.billing_configured(),'billingAccess',private.billing_generation_allowed(p_user_id),'reviewRequired',exists(select 1 from private.billing_memberships where environment=e and user_id=p_user_id and review_required),'videoCredits',coalesce(c,0),'subscription',(select jsonb_build_object('membershipId',membership_id,'planKey',plan_key,'status',status,'periodEnd',period_end,'cancelAtPeriodEnd',cancel_at_period_end) from private.billing_memberships where environment=e and user_id=p_user_id order by updated_at desc,membership_id limit 1),'plans',plans);
end; $$;

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
  if not private.billing_generation_allowed(p_user_id) then raise exception 'Billing entitlement denied' using errcode='42501'; end if;
  perform private.expire_billing_credits(p_user_id);
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
create function public.configure_billing_policy(p_environment text,p_company_id text,p_enabled boolean) returns boolean language sql security invoker set search_path='' as $$ select private.configure_billing_policy($1,$2,$3); $$;
create function public.configure_billing_plan(p_environment text,p_plan_key text,p_plan_id text,p_product_id text,p_credits bigint,p_currency text,p_amount_minor bigint,p_active boolean) returns boolean language sql security invoker set search_path='' as $$ select private.configure_billing_plan($1,$2,$3,$4,$5,$6,$7,$8); $$;
create function public.billing_begin_link(p_user_id uuid,p_session_id uuid,p_state_hash text) returns boolean language sql security invoker set search_path='' as $$ select private.billing_begin_link($1,$2,$3); $$;
create function public.billing_consume_link(p_user_id uuid,p_session_id uuid,p_state_hash text) returns boolean language sql security invoker set search_path='' as $$ select private.billing_consume_link($1,$2,$3); $$;
create function public.billing_bind_identity(p_user_id uuid,p_session_id uuid,p_whop_user_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_bind_identity($1,$2,$3); $$;
create function public.billing_begin_checkout(p_user_id uuid,p_session_id uuid,p_plan_key text,p_request_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_begin_checkout($1,$2,$3,$4); $$;
create function public.billing_finish_checkout(p_intent_id uuid,p_provider_checkout_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_finish_checkout($1,$2); $$;
create function public.billing_unknown_checkout(p_intent_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_unknown_checkout($1); $$;
create function public.billing_receive_webhook(p_environment text,p_event_id text,p_event_type text,p_resource_id text,p_payload_hash text,p_evidence jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_receive_webhook($1,$2,$3,$4,$5,$6); $$;
create function public.billing_due_receipts(p_limit integer) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_due_receipts($1); $$;
create function public.billing_defer_receipt(p_receipt_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.billing_defer_receipt($1); $$;
create function public.billing_apply_snapshot(p_receipt_id uuid,p_snapshot jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_apply_snapshot($1,$2); $$;
create function public.billing_account(p_user_id uuid,p_session_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.billing_account($1,$2); $$;
do $$ declare f record; begin for f in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and (p.proname like 'billing_%' or p.proname in ('configure_billing_policy','configure_billing_plan','expire_billing_credits')) loop execute format('revoke all on function %s from public,anon,authenticated,service_role,supabase_auth_admin',f.sig); if f.proname not in ('billing_allocate_credits','billing_restore_credits','billing_generation_guard','billing_intent_json','billing_generation_allowed','billing_configured','billing_current_user','expire_billing_credits') then execute format('grant execute on function %s to service_role',f.sig); end if; end loop; end $$;
-- Authenticated reservation runs a SECURITY DEFINER implementation, never these helpers directly.
commit;
