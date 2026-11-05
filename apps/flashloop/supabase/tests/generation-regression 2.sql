begin;

create schema test_generation;
create table test_generation.assertions (label text primary key);
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
grant usage on schema test_generation to anon, authenticated, service_role;
grant all on all tables in schema test_generation to anon, authenticated, service_role;
grant execute on all functions in schema test_generation to anon, authenticated, service_role;

insert into auth.users(id, email, email_confirmed_at) values
  ('10000000-0000-0000-8000-000000000010', 'quota-a@example.test', now()),
  ('10000000-0000-0000-8000-000000000011', 'quota-b@example.test', now()),
  ('10000000-0000-0000-8000-000000000012', 'quota-zero@example.test', now());
insert into auth.sessions(id, user_id) values
  ('20000000-0000-0000-8000-000000000010', '10000000-0000-0000-8000-000000000010'),
  ('20000000-0000-0000-8000-000000000011', '10000000-0000-0000-8000-000000000011'),
  ('20000000-0000-0000-8000-000000000012', '10000000-0000-0000-8000-000000000012');
insert into private.session_verifications(session_id, user_id, state, verified_at) values
  ('20000000-0000-0000-8000-000000000010', '10000000-0000-0000-8000-000000000010', 'verified', now()),
  ('20000000-0000-0000-8000-000000000011', '10000000-0000-0000-8000-000000000011', 'verified', now()),
  ('20000000-0000-0000-8000-000000000012', '10000000-0000-0000-8000-000000000012', 'verified', now());
update public.video_credit_accounts set credits = 100
  where user_id in ('10000000-0000-0000-8000-000000000010', '10000000-0000-0000-8000-000000000011');

select test_generation.raises(
  'select public.reserve_generation(''10000000-0000-0000-8000-000000000010'',''request-key-0000001'',repeat(''a'',64),''video.standard'')',
  'P0001', 'kill switch blocks generation by default');
set role service_role;
select public.configure_generation_policy(true, 'USD', 1000, 1000, 2, 'UTC');
select public.upsert_generation_price('video.standard', 10, 100, true);
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-8000-000000000012","session_id":"20000000-0000-0000-8000-000000000012"}', true);
select test_generation.raises(
  'select public.reserve_generation(auth.uid(), ''request-key-zero-0001'', repeat(''f'',64), ''video.standard'')',
  'P0001', 'zero-credit account cannot start paid generation');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-8000-000000000010","session_id":"20000000-0000-0000-8000-000000000010"}', true);
select test_generation.raises(
  'select public.reserve_generation(''10000000-0000-0000-8000-000000000012'',''request-key-0000001'',repeat(''a'',64),''video.standard'')',
  '42501', 'authenticated cannot reserve another account');
select public.reserve_generation(auth.uid(), 'request-key-0000001', repeat('a',64), 'video.standard');
select test_generation.ok((select credits = 90 from public.video_credit_accounts where user_id = auth.uid()), 'reserve debits credits atomically');
select public.reserve_generation(auth.uid(), 'request-key-0000001', repeat('a',64), 'video.standard');
select test_generation.ok((select credits = 90 from public.video_credit_accounts where user_id = auth.uid()), 'replay does not debit twice');
select test_generation.raises(
  'select public.reserve_generation(''10000000-0000-0000-8000-000000000010'',''request-key-0000001'',repeat(''b'',64),''video.standard'')',
  '23505', 'idempotency key cannot change request');
select test_generation.raises(
  'select public.mark_generation_dispatched(auth.uid(), ''request-key-0000001'', ''forged-provider-job'')',
  '42501', 'authenticated cannot mutate provider state');
reset role;
set role service_role;
select public.mark_generation_dispatched('10000000-0000-0000-8000-000000000010', 'request-key-0000001', 'provider-job-1');
select public.mark_generation_unknown('10000000-0000-0000-8000-000000000010', 'request-key-0000001');
select test_generation.ok((public.mark_generation_unknown('10000000-0000-0000-8000-000000000010', 'request-key-0000001')->>'status') = 'unknown', 'ambiguous timeout stays reserved');
select public.resolve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000001', 80);
select test_generation.ok((public.resolve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000001', 80)->>'status') = 'committed', 'resolve reconciles worst-case to actual cost');
select public.resolve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000001', 80);
select test_generation.ok((public.resolve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000001', 80)->>'status') = 'committed', 'replayed resolve does not double-spend');
select public.reserve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000002', repeat('c',64), 'video.standard');
select public.release_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000002');
select test_generation.ok((select credits = 90 from public.video_credit_accounts where user_id = '10000000-0000-0000-8000-000000000010'), 'safe pre-dispatch release restores credits');
select test_generation.raises(
  'select public.release_generation(''10000000-0000-0000-8000-000000000010'',''request-key-0000001'')',
  'P0001', 'ambiguous reservation cannot be released');
select public.configure_generation_policy(true, 'USD', 190, 190, 10, 'UTC');
select public.reserve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000003', repeat('d',64), 'video.standard');
select public.mark_generation_dispatched('10000000-0000-0000-8000-000000000010', 'request-key-0000003', 'provider-job-3');
select test_generation.ok((public.resolve_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000003', 120)->>'status') = 'reconciliation_required', 'provider overage stays held for reconciliation');
reset role;
set role service_role;
select test_generation.raises(
  'select public.reconcile_generation(''10000000-0000-0000-8000-000000000010'', ''request-key-0000003'', 120)',
  'P0001', 'reconciliation counts committed cost against caps');
select public.configure_generation_policy(true, 'USD', 1000, 1000, 10, 'UTC');
select test_generation.ok((public.reconcile_generation('10000000-0000-0000-8000-000000000010', 'request-key-0000003', 120)->>'status') = 'committed', 'service reconciliation commits confirmed overage once');
reset role;

set role service_role;
select public.configure_generation_policy(true, 'USD', 350, 1000, 10, 'UTC');
select public.upsert_generation_price('video.cap', 1, 100, true);
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-8000-000000000011","session_id":"20000000-0000-0000-8000-000000000011"}', true);
select public.reserve_generation(auth.uid(), 'request-key-0000003', repeat('d',64), 'video.cap');
select test_generation.raises(
  'select public.reserve_generation(''10000000-0000-0000-8000-000000000011'',''request-key-0000004'',repeat(''e'',64),''video.cap'')',
  'P0001', 'global cap includes in-flight reservations');
reset role;

set role service_role;
select public.configure_generation_policy(true, 'USD', 10000, 150, 10, 'UTC');
select public.upsert_generation_price('video.account-cap', 1, 100, true);
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-8000-000000000011","session_id":"20000000-0000-0000-8000-000000000011"}', true);
select test_generation.raises(
  'select public.reserve_generation(''10000000-0000-0000-8000-000000000011'',''request-key-0000005'',repeat(''f'',64),''video.account-cap'')',
  'P0001', 'account cap includes in-flight reservations');
reset role;

select count(*)::integer as passed from test_generation.assertions;
rollback;
