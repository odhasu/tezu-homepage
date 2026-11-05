begin;

-- Disposable PostgreSQL assertions. These synthetic Auth rows are not GoTrue,
-- and sequential execution does not establish multi-connection concurrency.
create schema test_generation;
create table test_generation.assertions (label text primary key);
create table test_generation.results (label text primary key, value jsonb not null);
create table test_generation.identities (
  actor text primary key, user_id uuid not null, session_id uuid not null, project_id uuid not null
);
create function test_generation.ok(condition boolean, label text)
returns void language plpgsql security invoker as $$
begin
  if condition is not true then raise exception 'Assertion failed: %', label; end if;
  insert into test_generation.assertions values (label);
end;
$$;
create function test_generation.raises(query text, expected_state text, label text)
returns void language plpgsql security invoker as $$
begin
  begin execute query;
  exception when others then
    if sqlstate = expected_state then insert into test_generation.assertions values (label); return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE %: %', expected_state, label;
end;
$$;
create function test_generation.result(p_label text)
returns jsonb language sql security invoker as $$ select value from test_generation.results where label=p_label; $$;
create function test_generation.claims(p_actor text)
returns text language sql security invoker as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub',user_id,'session_id',session_id)::text,true)
  from test_generation.identities where actor=p_actor;
$$;
create function test_generation.web_reserve(p_actor text,p_key text,p_price text default 'video.standard',p_prompt text default 'Stored prompt',p_label text default 'Video test')
returns jsonb language sql security invoker as $$
  select public.reserve_generation(project_id,p_key,p_price,p_prompt,p_label)
  from test_generation.identities where actor=p_actor;
$$;
create function test_generation.worker_reserve(p_actor text,p_key text,p_price text default 'video.standard',p_prompt text default 'Stored prompt',p_label text default 'Video test')
returns jsonb language sql security invoker as $$
  select public.reserve_generation_for_user(user_id,session_id,project_id,p_key,p_price,p_prompt,p_label)
  from test_generation.identities where actor=p_actor;
$$;
grant usage on schema test_generation to anon,authenticated,service_role;
grant all on all tables in schema test_generation to anon,authenticated,service_role;
grant execute on all functions in schema test_generation to anon,authenticated,service_role;

insert into test_generation.identities values
  ('a','10000000-0000-0000-8000-000000000010','20000000-0000-0000-8000-000000000010','30000000-0000-0000-8000-000000000010'),
  ('b','10000000-0000-0000-8000-000000000011','20000000-0000-0000-8000-000000000011','30000000-0000-0000-8000-000000000011'),
  ('zero','10000000-0000-0000-8000-000000000012','20000000-0000-0000-8000-000000000012','30000000-0000-0000-8000-000000000012'),
  ('no-entitlement','10000000-0000-0000-8000-000000000013','20000000-0000-0000-8000-000000000013','30000000-0000-0000-8000-000000000013'),
  ('revoked','10000000-0000-0000-8000-000000000014','20000000-0000-0000-8000-000000000014','30000000-0000-0000-8000-000000000014');
insert into auth.users(id,email,email_confirmed_at)
  select user_id,actor || '@generation.example.test',clock_timestamp() from test_generation.identities;
insert into auth.sessions(id,user_id) select session_id,user_id from test_generation.identities;
insert into private.session_verifications(session_id,user_id,state,verified_at)
  select session_id,user_id,'verified',clock_timestamp() from test_generation.identities;
insert into public.projects(id,owner_id,name) select project_id,user_id,'Quota project ' || actor from test_generation.identities;
update public.video_credit_accounts set credits=1000 where user_id in
  (select user_id from test_generation.identities where actor <> 'zero');
update private.session_verifications set state='failed',verified_at=null,failed_at=clock_timestamp()
  where user_id=(select user_id from test_generation.identities where actor='revoked');

select test_generation.ok((select credits=0 from public.video_credit_accounts where user_id=(select user_id from test_generation.identities where actor='zero')),
  'new accounts receive zero automatic credits');
select test_generation.ok((select count(*)=8 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'generation_%'),
  'all generation tables enable and force RLS');
set role anon;
select test_generation.raises($q$select test_generation.web_reserve('a','request-anon-000001')$q$,'42501','anonymous caller cannot reserve');
reset role;
set role service_role;
select test_generation.raises($q$select test_generation.worker_reserve('a','request-default-0001')$q$,'P0001','generation kill switch defaults disabled');
select public.configure_generation_policy(true,'USD',10000,10000,10,'UTC');
select public.upsert_generation_price('video.standard',10,100,'{"provider":"fixture","model":"fixed-v1","quantity":1,"duration_seconds":5,"resolution":"720p"}',true);
select public.configure_generation_account(user_id,true) from test_generation.identities where actor <> 'no-entitlement';
reset role;

-- Identity is checked inside PostgreSQL, including direct calls to its private
-- implementation. A missing subject must never turn an authenticated role into
-- the service capability.
set role authenticated;
select set_config('request.jwt.claims','{"session_id":"20000000-0000-0000-8000-000000000010"}',true);
select test_generation.raises($q$select test_generation.web_reserve('a','request-null-web-001')$q$,'22023','website RPC rejects missing JWT subject');
select test_generation.raises($q$select private.reserve_generation('10000000-0000-0000-8000-000000000010','20000000-0000-0000-8000-000000000010','30000000-0000-0000-8000-000000000010','request-null-sub-001','video.standard','Stored prompt','Video test')$q$,
  '42501','private reservation denies missing JWT subject');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-8000-000000000011","session_id":"20000000-0000-0000-8000-000000000010"}',true);
select test_generation.raises($q$select test_generation.web_reserve('b','request-forged-00001')$q$,'42501','forged subject cannot use another live session');
select test_generation.claims('a');
select test_generation.raises($q$select test_generation.worker_reserve('b','request-worker-00001')$q$,'42501','authenticated caller cannot use worker reservation alias');
select test_generation.raises($q$select public.claim_generation('10000000-0000-0000-8000-000000000010','request-claim-000001')$q$,'42501','authenticated caller cannot claim provider dispatch');
select test_generation.raises($q$select public.configure_generation_account('10000000-0000-0000-8000-000000000010',true)$q$,'42501','authenticated caller cannot grant entitlements');
select test_generation.raises($q$select test_generation.web_reserve('b','request-cross-owner1')$q$,'P0002','cross-owner project is rejected');
select test_generation.claims('revoked');
select test_generation.raises($q$select test_generation.web_reserve('revoked','request-revoked-0001')$q$,'42501','revoked session cannot reserve on website');
select test_generation.claims('no-entitlement');
select test_generation.raises($q$select test_generation.web_reserve('no-entitlement','request-entitle-0001')$q$,'42501','funded account without entitlement cannot reserve');
select test_generation.claims('zero');
select test_generation.raises($q$select test_generation.web_reserve('zero','request-zero-0000001')$q$,'P0001','zero-credit account cannot start paid generation');
reset role;
set role service_role;
select test_generation.raises($q$select test_generation.worker_reserve('revoked','request-revoked-job1')$q$,'42501','worker must provide an originating verified live session');
reset role;
select test_generation.ok((select count(*)=0 from private.generation_requests) and (select count(*)=0 from private.generation_reservations) and (select count(*)=0 from public.jobs),
  'denied reservations create no request reservation or job');
select test_generation.ok((select credits=1000 from public.video_credit_accounts where user_id='10000000-0000-0000-8000-000000000010'),
  'denied reservations do not debit funded account');

set role authenticated;
select test_generation.claims('a');
insert into test_generation.results values('first',test_generation.web_reserve('a','request-first-000001'));
insert into test_generation.results values('replay',test_generation.web_reserve('a','request-first-000001'));
select test_generation.ok(test_generation.result('first')=test_generation.result('replay'),'same request key returns same reservation');
select test_generation.ok((select credits=990 from public.video_credit_accounts where user_id=auth.uid()),'website reservation debits credits once');
select test_generation.raises($q$select test_generation.web_reserve('a','request-first-000001','video.standard','Changed prompt')$q$,'23505','same key cannot change prompt');
select test_generation.raises($q$select test_generation.web_reserve('a','request-first-000001','video.standard','Stored prompt','Changed label')$q$,'23505','same key cannot change request label');
reset role;
select test_generation.ok((select count(*)=1 from private.generation_requests) and (select count(*)=1 from private.generation_reservations) and (select count(*)=1 from public.jobs),
  'one atomic reservation creates one request one reservation and one job');
select test_generation.ok((select j.owner_id=r.user_id and j.project_id=r.project_id and j.status='queued' and r.prompt='Stored prompt'
  from private.generation_requests r join public.jobs j on j.id=r.job_id where r.request_key='request-first-000001'),
  'persisted payload and owned job agree');
select test_generation.ok((select sum(reserved_micros)=100 and sum(committed_micros)=0 from private.generation_global_days)
  and (select active_jobs=1 from private.generation_active_jobs where user_id='10000000-0000-0000-8000-000000000010'),
  'request reserves worst-case cost and active slot atomically');
create function test_generation.reject_reservation()
returns trigger language plpgsql security invoker as $$
begin
  raise exception 'Synthetic late database failure' using errcode='23514';
end;
$$;
create trigger test_generation_reject_reservation before insert on private.generation_reservations
  for each row execute function test_generation.reject_reservation();
set role authenticated;
select test_generation.claims('a');
select test_generation.raises($q$select test_generation.web_reserve('a','request-rollback-001')$q$,'23514','late reservation failure rolls back transaction');
reset role;
drop trigger test_generation_reject_reservation on private.generation_reservations;
select test_generation.ok((select count(*)=1 from private.generation_requests) and (select count(*)=1 from public.jobs)
  and (select credits=990 from public.video_credit_accounts where user_id='10000000-0000-0000-8000-000000000010')
  and (select sum(reserved_micros)=100 from private.generation_global_days),
  'late failure leaves no orphan job request debit or spend counter');
set role service_role;
select test_generation.raises($q$delete from private.generation_reservations$q$,'42501','service credential cannot delete financial reservations directly');
select test_generation.raises($q$select public.advance_owned_job((test_generation.result('first')->>'jobId')::uuid,'30000000-0000-0000-8000-000000000010','10000000-0000-0000-8000-000000000010','running')$q$,
  '55000','legacy worker status RPC cannot bypass generation claim');
select test_generation.raises($q$select public.record_owned_output((test_generation.result('first')->>'jobId')::uuid,'30000000-0000-0000-8000-000000000010','10000000-0000-0000-8000-000000000010','test.mp4','video/mp4',1)$q$,
  '55000','legacy output RPC cannot record an unclaimed generation');
select public.upsert_generation_price('video.standard',20,200,'{"provider":"fixture","model":"changed-v2","quantity":2}',true);
insert into test_generation.results values('claim-first',public.claim_generation('10000000-0000-0000-8000-000000000010','request-first-000001'));
insert into test_generation.results values('claim-replay',public.claim_generation('10000000-0000-0000-8000-000000000010','request-first-000001'));
select test_generation.ok((test_generation.result('claim-first')->>'dispatchAllowed')::boolean,'first durable claim alone permits dispatch');
select test_generation.ok(test_generation.result('claim-first')->'providerRequest'='{"profile":{"provider":"fixture","model":"fixed-v1","quantity":1,"duration_seconds":5,"resolution":"720p"},"prompt":"Stored prompt"}'::jsonb
  and test_generation.result('claim-first')->>'creditsReserved'='10' and test_generation.result('claim-first')->>'worstCaseCostMicros'='100',
  'claim uses snapshotted provider profile prompt credits and worst-case bound');
select test_generation.ok(test_generation.result('claim-first')->>'providerIdempotencyKey'='flashloop:' || (test_generation.result('first')->>'reservationId'),
  'provider idempotency key is stable and reservation specific');
select test_generation.ok(test_generation.result('claim-replay')->>'dispatchAllowed'='false' and not(test_generation.result('claim-replay') ? 'providerRequest'),
  'retried claim never permits a second provider call or returns dispatch payload');
select test_generation.raises($q$select public.release_generation('10000000-0000-0000-8000-000000000010','request-first-000001')$q$,'55000','durable dispatch claim cannot be refunded after crash');
select test_generation.raises($q$select public.record_owned_output((test_generation.result('first')->>'jobId')::uuid,'30000000-0000-0000-8000-000000000010','10000000-0000-0000-8000-000000000010','test.mp4','video/mp4',1)$q$,
  '55000','dispatch claim alone cannot masquerade as provider acceptance');
select public.mark_generation_dispatched('10000000-0000-0000-8000-000000000010','request-first-000001','provider-job-first');
select test_generation.ok(public.mark_generation_dispatched('10000000-0000-0000-8000-000000000010','request-first-000001','provider-job-first')->>'status'='dispatched',
  'provider acknowledgement replay is idempotent');
select test_generation.raises($q$select public.mark_generation_dispatched('10000000-0000-0000-8000-000000000010','request-first-000001','provider-job-changed')$q$,'23505','provider job acknowledgement cannot change');
select public.mark_generation_unknown('10000000-0000-0000-8000-000000000010','request-first-000001');
select test_generation.raises($q$select public.release_generation('10000000-0000-0000-8000-000000000010','request-first-000001')$q$,'55000','actual unknown provider outcome cannot be refunded');
select test_generation.ok(public.mark_generation_unknown('10000000-0000-0000-8000-000000000010','request-first-000001')->>'status'='unknown',
  'unknown outcome replay retains reservation');
insert into test_generation.results values('settled-first',public.resolve_generation('10000000-0000-0000-8000-000000000010','request-first-000001',80,'succeeded'));
select test_generation.ok(public.resolve_generation('10000000-0000-0000-8000-000000000010','request-first-000001',80,'succeeded')=test_generation.result('settled-first'),
  'confirmed actual cost commits once despite replay');
select test_generation.raises($q$select public.resolve_generation('10000000-0000-0000-8000-000000000010','request-first-000001',81,'succeeded')$q$,'23505','committed actual cost cannot change');
select test_generation.raises($q$select public.resolve_generation('10000000-0000-0000-8000-000000000010','request-first-000001',80,'failed')$q$,'23505','committed terminal outcome cannot change');
select public.upsert_generation_price('video.standard',10,100,'{"provider":"fixture","model":"fixed-v1","quantity":1,"duration_seconds":5,"resolution":"720p"}',true);
reset role;
select test_generation.ok((select sum(reserved_micros)=0 and sum(committed_micros)=80 from private.generation_global_days)
  and (select active_jobs=0 from private.generation_active_jobs where user_id='10000000-0000-0000-8000-000000000010'),
  'settlement releases only unused cost and active slot');
select test_generation.ok((select credits=990 from public.video_credit_accounts where user_id='10000000-0000-0000-8000-000000000010'),
  'cost reconciliation does not invent credit conversion or refund spent credits');

-- Cancellation and the kill switch use the same mutex as claim.
set role service_role;
insert into test_generation.results values('cancel',test_generation.worker_reserve('a','request-cancel-00001'));
select test_generation.ok(public.release_generation('10000000-0000-0000-8000-000000000010','request-cancel-00001')->>'status'='released','unclaimed reservation safely releases');
select test_generation.ok(public.release_generation('10000000-0000-0000-8000-000000000010','request-cancel-00001')->>'status'='released','release replay does not refund twice');
select test_generation.ok(public.claim_generation('10000000-0000-0000-8000-000000000010','request-cancel-00001')->>'dispatchAllowed'='false','cancelled reservation never grants a claim');
insert into test_generation.results values('switch',test_generation.worker_reserve('a','request-switch-00001'));
select public.set_generation_enabled(false);
select test_generation.raises($q$select public.claim_generation('10000000-0000-0000-8000-000000000010','request-switch-00001')$q$,'P0001','kill switch blocks claim of previously reserved job');
select test_generation.raises($q$select test_generation.worker_reserve('b','request-switch-new01')$q$,'P0001','kill switch blocks new worker reservations');
select public.release_generation('10000000-0000-0000-8000-000000000010','request-switch-00001');
select public.set_generation_enabled(true);
reset role;
select test_generation.ok((select credits=990 from public.video_credit_accounts where user_id='10000000-0000-0000-8000-000000000010'),
  'only unclaimed cancellation restores reserved credits exactly once');

-- Account concurrency and spend ceilings count all held reservations.
set role service_role;
select public.configure_generation_account('10000000-0000-0000-8000-000000000010',true,null,1);
select test_generation.worker_reserve('a','request-job-limit01');
select test_generation.raises($q$select test_generation.worker_reserve('a','request-job-limit02')$q$,'P0001','per-account concurrent job ceiling blocks next reservation');
select public.release_generation('10000000-0000-0000-8000-000000000010','request-job-limit01');
select public.configure_generation_account('10000000-0000-0000-8000-000000000010',true,150,10);
select test_generation.raises($q$select test_generation.worker_reserve('a','request-account-cap1')$q$,'P0001','account-specific daily cap counts committed cost');
select public.configure_generation_account('10000000-0000-0000-8000-000000000010',true,null,10);
select public.configure_generation_policy(true,'USD',250,10000,10,'UTC');
select test_generation.worker_reserve('b','request-global-cap01');
select test_generation.raises($q$select test_generation.worker_reserve('a','request-global-cap02')$q$,'P0001','global daily cap combines committed and in-flight cost across accounts');
select public.release_generation('10000000-0000-0000-8000-000000000011','request-global-cap01');
select public.configure_generation_policy(true,'USD',10000,10000,10,'UTC');
select test_generation.worker_reserve('a','request-prior-day001');
select public.claim_generation('10000000-0000-0000-8000-000000000010','request-prior-day001');
select public.mark_generation_unknown('10000000-0000-0000-8000-000000000010','request-prior-day001');
reset role;

-- Move a synthetic held reservation to yesterday without changing aggregate
-- exposure. This exercises rollover accounting without depending on the clock.
update private.generation_global_days set reserved_micros=reserved_micros-100 where spend_day=(clock_timestamp() at time zone 'UTC')::date;
insert into private.generation_global_days(spend_day,reserved_micros) values((clock_timestamp() at time zone 'UTC')::date-1,100);
update private.generation_account_days set reserved_micros=reserved_micros-100 where user_id='10000000-0000-0000-8000-000000000010' and spend_day=(clock_timestamp() at time zone 'UTC')::date;
insert into private.generation_account_days(user_id,spend_day,reserved_micros) values('10000000-0000-0000-8000-000000000010',(clock_timestamp() at time zone 'UTC')::date-1,100);
update private.generation_reservations set spend_day=(clock_timestamp() at time zone 'UTC')::date-1
  where request_id=(select id from private.generation_requests where request_key='request-prior-day001');
set role service_role;
select public.configure_generation_policy(true,'USD',180,10000,10,'UTC');
select test_generation.raises($q$select test_generation.worker_reserve('b','request-crossday-g01')$q$,'P0001','prior-day unknown exposure counts against current global cap');
select public.configure_generation_policy(true,'USD',10000,180,10,'UTC');
select test_generation.raises($q$select test_generation.worker_reserve('a','request-crossday-a01')$q$,'P0001','prior-day unknown exposure counts against current account cap');
select public.resolve_generation('10000000-0000-0000-8000-000000000010','request-prior-day001',50,'failed');
reset role;
select test_generation.ok((select sum(reserved_micros)=0 and sum(committed_micros)=130 from private.generation_global_days)
  and (select sum(committed_micros)=130 from private.generation_global_days where spend_day=(clock_timestamp() at time zone 'UTC')::date),
  'cross-day settlement moves actual cost into current day once');
select test_generation.ok((select j.status='failed' from public.jobs j join private.generation_requests r on r.job_id=j.id where r.request_key='request-prior-day001'),
  'charged provider failure retains failed outcome independently of cost');
set role service_role;
select test_generation.raises($q$select test_generation.worker_reserve('a','request-settled-cap1')$q$,'P0001','settled previous-day request still counts against current daily cap');
select public.configure_generation_policy(true,'USD',10000,10000,10,'UTC');
select test_generation.worker_reserve('a','request-free-result1');
select public.claim_generation('10000000-0000-0000-8000-000000000010','request-free-result1');
select public.resolve_generation('10000000-0000-0000-8000-000000000010','request-free-result1',0,'succeeded');
reset role;
select test_generation.ok((select j.status='succeeded' and s.actual_cost_micros=0 from public.jobs j join private.generation_requests r on r.job_id=j.id
  join private.generation_reservations s on s.request_id=r.id where r.request_key='request-free-result1'),
  'zero-cost provider success does not become failed merely because cost is zero');

-- A violated provider bound records the full exposure immediately and switches
-- off new generation. Reconciliation cannot hide existing billed cost to fit caps.
set role service_role;
select test_generation.worker_reserve('a','request-overage-0001');
select test_generation.worker_reserve('b','request-after-over01');
select public.claim_generation('10000000-0000-0000-8000-000000000010','request-overage-0001');
select public.configure_generation_policy(true,'USD',350,10000,10,'UTC');
insert into test_generation.results values('overage',public.resolve_generation('10000000-0000-0000-8000-000000000010','request-overage-0001',200,'succeeded'));
select test_generation.ok(test_generation.result('overage')->>'status'='reconciliation_required' and test_generation.result('overage')->>'heldCostMicros'='200',
  'provider overage is held at actual exposure pending reconciliation');
select test_generation.raises($q$select public.set_generation_enabled(true)$q$,'55000','unreconciled overage prevents switch re-enabling');
select test_generation.raises($q$select public.configure_generation_policy(true,'USD',10000,10000,10,'UTC')$q$,'55000','policy replacement cannot bypass unresolved overage');
select test_generation.raises($q$select test_generation.worker_reserve('b','request-overage-new1')$q$,'P0001','overage kill switch blocks new reservations');
select test_generation.raises($q$select public.claim_generation('10000000-0000-0000-8000-000000000011','request-after-over01')$q$,'P0001','overage kill switch blocks existing unclaimed dispatch');
select test_generation.raises($q$select public.reconcile_generation('10000000-0000-0000-8000-000000000010','request-overage-0001',199,'succeeded')$q$,'23505','reconciliation cannot lower previously recorded actual cost');
select test_generation.raises($q$select public.reconcile_generation('10000000-0000-0000-8000-000000000010','request-overage-0001',200,'failed')$q$,'23505','reconciliation cannot change previously recorded outcome');
reset role;
select test_generation.ok((select not generation_enabled from private.generation_policy) and (select sum(reserved_micros)=300 and sum(committed_micros)=130 from private.generation_global_days),
  'known overage increases shared counter immediately and disables generation');
set role service_role;
select test_generation.ok(public.reconcile_generation('10000000-0000-0000-8000-000000000010','request-overage-0001',200,'succeeded')->>'status'='committed',
  'confirmed over-cap actual cost remains recorded when reconciled');
select test_generation.ok(public.reconcile_generation('10000000-0000-0000-8000-000000000010','request-overage-0001',200,'succeeded')->>'status'='committed',
  'reconciliation replay does not spend twice');
select public.release_generation('10000000-0000-0000-8000-000000000011','request-after-over01');
reset role;
select test_generation.ok((select sum(reserved_micros)=0 and sum(committed_micros)=330 from private.generation_global_days),
  'reconciliation preserves all actual spend despite breached cap');
set role service_role;
select test_generation.raises($q$select public.configure_generation_policy(false,'EUR',10000,10000,10,'UTC')$q$,'55000','existing ledger pins currency');
select test_generation.raises($q$select public.configure_generation_policy(false,'USD',10000,10000,10,'Europe/Amsterdam')$q$,'55000','existing ledger pins reset timezone');
select public.configure_generation_policy(true,'USD',10000,10000,10,'UTC');
reset role;

-- Financial history must survive account and ordinary project/job deletion.
select test_generation.raises($q$delete from auth.users where id='10000000-0000-0000-8000-000000000010'$q$,'23001','Auth account deletion cannot cascade away ledger');
select test_generation.raises($q$delete from public.jobs where id=(select job_id from private.generation_requests where request_key='request-first-000001')$q$,'23001','job deletion cannot erase request and financial ledger');
select test_generation.raises($q$delete from public.projects where id='30000000-0000-0000-8000-000000000010'$q$,'23001','project cascade cannot erase paid job ledger');
select test_generation.ok((select count(*)>0 from private.generation_requests) and (select sum(committed_micros)=330 from private.generation_global_days),
  'failed deletions preserve request history and spend counters');

select count(*)::integer as passed from test_generation.assertions;
rollback;
