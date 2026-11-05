begin;
create schema test_signup;
create table test_signup.assertions (label text primary key);
create function test_signup.ok(condition boolean, label text)
returns void language plpgsql security invoker as $$
begin
  if condition is not true then raise exception 'Assertion failed: %', label; end if;
  insert into test_signup.assertions values (label);
end;
$$;
create function test_signup.raises(query text, expected_state text, label text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate = expected_state then
      insert into test_signup.assertions values (label);
      return;
    end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE %: %', expected_state, label;
end;
$$;
create function test_signup.event(p_email text, p_token text)
returns jsonb language sql security invoker as $$
  select jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),
    'user',jsonb_build_object('email',p_email,'is_anonymous',false,
      'app_metadata',jsonb_build_object('provider','email'),
      'user_metadata',jsonb_build_object('signup_permit',p_token)));
$$;
grant usage on schema test_signup to anon, authenticated, service_role, supabase_auth_admin;
grant all on all tables in schema test_signup to anon, authenticated, service_role, supabase_auth_admin;
grant execute on all functions in schema test_signup to anon, authenticated, service_role, supabase_auth_admin;

select test_signup.ok((select relrowsecurity from pg_class where oid='private.signup_ip_quota'::regclass), 'signup IP quota has RLS');
select test_signup.ok((select not prosecdef from pg_proc where oid='public.issue_signup_permit_for_ip(text,text,text)'::regprocedure), 'exposed IP permit RPC is security invoker');
select test_signup.ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc
  where oid in ('private.issue_signup_permit_for_ip(text,text,text)'::regprocedure,
    'private.consume_signup_ip_quota()'::regprocedure, 'private.cleanup_signup_security(integer)'::regprocedure)),
  'private quota definers use empty search path');
select test_signup.ok(not has_function_privilege('anon','private.consume_signup_ip_quota()','EXECUTE')
  and not has_function_privilege('authenticated','private.consume_signup_ip_quota()','EXECUTE')
  and not has_function_privilege('service_role','private.consume_signup_ip_quota()','EXECUTE'), 'trigger is not client or service callable');
set role anon;
select test_signup.raises('select public.get_signup_ip_quota(repeat(''1'',64))','42501','anonymous cannot inspect signup IP allowance');
select test_signup.raises('select public.issue_signup_permit_for_ip(''a@example.test'',repeat(''a'',64),repeat(''1'',64))','42501','anonymous cannot issue IP permits');
select test_signup.raises('select * from private.signup_ip_quota','42501','anonymous cannot read signup quota');
reset role;
set role authenticated;
select test_signup.raises('select public.get_signup_ip_quota(repeat(''1'',64))','42501','user cannot inspect signup IP allowance');
select test_signup.raises('select public.issue_signup_permit_for_ip(''a@example.test'',repeat(''a'',64),repeat(''1'',64))','42501','user cannot issue IP permits');
select test_signup.raises('delete from private.signup_ip_quota','42501','user cannot reset IP quota');
select test_signup.raises('select private.cleanup_signup_security(1)','42501','user cannot prune signup protections');
reset role;
set role service_role;
select test_signup.ok(public.get_signup_ip_quota(repeat('1',64))='{"allowed":true,"retry_after_seconds":0}'::jsonb, 'quota status reports empty IP allowance without issuance');
select test_signup.raises('select * from private.signup_ip_quota','42501','service client lacks direct quota table access');
select test_signup.raises('select public.issue_signup_permit(''old@example.test'',repeat(''f'',64))','55000','legacy quota-free permit issuer is closed');
select test_signup.raises('select public.issue_signup_permit_for_ip(''bad'',repeat(''a'',64),repeat(''1'',64))','22023','invalid email rejected');
select test_signup.raises('select public.issue_signup_permit_for_ip(''a@example.test'',''bad'',repeat(''1'',64))','22023','invalid permit hash rejected');
select test_signup.raises('select public.issue_signup_permit_for_ip(''a@example.test'',repeat(''a'',64),null)','22023','missing IP key rejected');
select test_signup.raises('select public.issue_signup_permit_for_ip(''a@example.test'',repeat(''a'',64),''bad'')','22023','malformed IP key rejected');
select test_signup.ok(public.issue_signup_permit_for_ip(' FIRST@example.test ',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),repeat('1',64))
  = '{"allowed":true,"retry_after_seconds":0}'::jsonb, 'first permit allowed with explicit response');
-- Three permits may pass an early precheck before any Auth insert. Only the
-- trigger is authoritative; a successful CAPTCHA does not reserve a quota slot.
select public.issue_signup_permit_for_ip('second@example.test',encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'),repeat('1',64));
select public.issue_signup_permit_for_ip('third@example.test',encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'),repeat('1',64));
reset role;
select test_signup.ok((select count(*)=0 from private.signup_ip_quota), 'permits without successful user insert consume no creation quota');
set role supabase_auth_admin;
select test_signup.ok(public.before_user_created(test_signup.event('first@example.test',repeat('a',64)))='{}'::jsonb, 'first hook claims IP-bound permit');
select test_signup.ok(public.before_user_created(test_signup.event('first@example.test',repeat('a',64))) ? 'error', 'hook replay is denied');
select test_signup.ok(public.before_user_created(test_signup.event('second@example.test',repeat('b',64)))='{}'::jsonb, 'second alternate-email hook claims same-IP permit');
select test_signup.ok(public.before_user_created(test_signup.event('third@example.test',repeat('c',64)))='{}'::jsonb, 'third preissued permit may be claimed before quota insert');
reset role;
select test_signup.ok((select count(*)=0 from private.signup_ip_quota), 'successful hook without Auth insert consumes no creation quota');
select test_signup.ok((select count(*)=3 and bool_and(hook_consumed_at is not null) from private.signup_permits where ip_key_hash=repeat('1',64)), 'hook claims persist instead of deleting permits');
commit;

-- Hook claims committed above; these are separate insert transactions.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000001','first@example.test',jsonb_build_object('signup_permit',repeat('a',64)));
select test_signup.ok((select first_created_at is not null and second_created_at is null from private.signup_ip_quota where ip_key_hash=repeat('1',64)), 'first successful account consumes exactly one slot');
select test_signup.ok((select count(*)=1 and bool_and(credits=0) from public.video_credit_accounts where user_id='31000000-0000-4000-8000-000000000001'), 'quota-backed account receives zero credits');
select test_signup.ok(not exists(select 1 from private.signup_permits where email='first@example.test'), 'successful insert deletes its claimed permit');
commit;
begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000002','second@example.test',jsonb_build_object('signup_permit',repeat('b',64)));
select test_signup.ok((select first_created_at is not null and second_created_at is not null from private.signup_ip_quota where ip_key_hash=repeat('1',64)), 'second successful account fills same-IP quota');
select test_signup.raises($query$insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000003','third@example.test',jsonb_build_object('signup_permit',repeat('c',64)))$query$,
  'P0001','third alternate-email creation denied by trigger after separate hook transaction');
select test_signup.ok(not exists(select 1 from auth.users where id='31000000-0000-4000-8000-000000000003')
  and not exists(select 1 from public.video_credit_accounts where user_id='31000000-0000-4000-8000-000000000003'), 'denied third insert creates neither account nor credits');
set role service_role;
select test_signup.ok((public.issue_signup_permit_for_ip('fourth@example.test',encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'),repeat('1',64))->>'allowed')::boolean=false,
  'full IP quota rejects early permit issuance');
select test_signup.ok((public.issue_signup_permit_for_ip('fourth@example.test',encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'),repeat('1',64))->>'retry_after_seconds')::integer between 345590 and 345600,
  'full quota retry uses remaining rolling96-hour time');
select test_signup.ok((public.get_signup_ip_quota(repeat('1',64))->>'allowed')::boolean=false
  and (public.get_signup_ip_quota(repeat('1',64))->>'retry_after_seconds')::integer between 345590 and 345600,
  'read-only status detects quota filled after early permit precheck');
reset role;
select test_signup.ok(not exists(select 1 from private.signup_permits where email='fourth@example.test'), 'quota status and rejected issuance create no new permits');
delete from auth.users where id='31000000-0000-4000-8000-000000000001';
select test_signup.ok((select second_created_at is not null from private.signup_ip_quota where ip_key_hash=repeat('1',64)), 'deleting created account does not reset IP quota');
select test_signup.raises($query$insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000004','first@example.test',jsonb_build_object('signup_permit',repeat('a',64)))$query$,
  '42501','insert cannot replay already consumed signup permit');

set role service_role;
select test_signup.ok((public.issue_signup_permit_for_ip('other-ip@example.test',encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex'),repeat('2',64))->>'allowed')::boolean,
  'different IP retains independent creation allowance');
reset role;
set role supabase_auth_admin;
select test_signup.ok(public.before_user_created(test_signup.event('other-ip@example.test',repeat('e',64)))='{}'::jsonb, 'independent IP hook succeeds');
reset role;
insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000005','other-ip@example.test',jsonb_build_object('signup_permit',repeat('e',64)));
select test_signup.ok((select first_created_at is not null and second_created_at is null from private.signup_ip_quota where ip_key_hash=repeat('2',64)), 'independent IP insert charges only its quota');

-- Rollback after Auth insertion must restore the permit and creation slot.
set role service_role;
select public.issue_signup_permit_for_ip('rollback@example.test',encode(sha256(convert_to(repeat('f',64),'UTF8')),'hex'),repeat('3',64));
reset role;
set role supabase_auth_admin;
select public.before_user_created(test_signup.event('rollback@example.test',repeat('f',64)));
reset role;
commit;
begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000006','rollback@example.test',jsonb_build_object('signup_permit',repeat('f',64)));
rollback;
begin;
select test_signup.ok(not exists(select 1 from private.signup_ip_quota where ip_key_hash=repeat('3',64)), 'rolled-back account insert consumes no IP slot');
select test_signup.ok(exists(select 1 from private.signup_permits where email='rollback@example.test' and hook_consumed_at is not null), 'rollback restores prior committed hook claim');
select test_signup.ok(not exists(select 1 from auth.users where id='31000000-0000-4000-8000-000000000006')
  and not exists(select 1 from public.video_credit_accounts where user_id='31000000-0000-4000-8000-000000000006'), 'rollback removes account and zero-credit row');

-- Boundary data is controlled test state, never a public RPC parameter.
update private.signup_ip_quota set first_created_at=clock_timestamp()-interval '96 hours', second_created_at=clock_timestamp()-interval '1 hour'
  where ip_key_hash=repeat('1',64);
set role service_role;
select test_signup.ok((public.issue_signup_permit_for_ip('boundary@example.test',encode(sha256(convert_to(repeat('1',64),'UTF8')),'hex'),repeat('1',64))->>'allowed')::boolean,
  'creation at or beyond96-hour boundary no longer counts');
reset role;
set role supabase_auth_admin;
select public.before_user_created(test_signup.event('boundary@example.test',repeat('1',64)));
reset role;
insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000007','boundary@example.test',jsonb_build_object('signup_permit',repeat('1',64)));
select test_signup.ok((select first_created_at > clock_timestamp()-interval '2 hours' and second_created_at is not null from private.signup_ip_quota where ip_key_hash=repeat('1',64)),
  'expired oldest creation slides away while recent creation remains');
set role service_role;
select test_signup.ok((public.issue_signup_permit_for_ip('too-soon@example.test',encode(sha256(convert_to(repeat('2',64),'UTF8')),'hex'),repeat('1',64))->>'retry_after_seconds')::integer between 341990 and 342000,
  'sliding quota retry follows oldest retained creation');
reset role;

-- Invalid, unclaimed, or legacy permits must never create a public-path account.
set role service_role;
select public.issue_signup_permit_for_ip('unclaimed@example.test',encode(sha256(convert_to(repeat('3',64),'UTF8')),'hex'),repeat('4',64));
reset role;
select test_signup.raises($query$insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000008','unclaimed@example.test',jsonb_build_object('signup_permit',repeat('3',64)))$query$,
  '42501','user insert rejects permit not claimed by native hook');
insert into private.signup_permits(email,permit_hash) values('legacy@example.test',encode(sha256(convert_to(repeat('4',64),'UTF8')),'hex'));
set role supabase_auth_admin;
select test_signup.ok(public.before_user_created(test_signup.event('legacy@example.test',repeat('4',64))) ? 'error', 'legacy permit without IP cannot pass hook');
select test_signup.ok(public.before_user_created('{}') ? 'error', 'native hook still rejects direct signup without permit');
reset role;
select test_signup.raises($query$insert into auth.users(id,email,raw_user_meta_data) values
  ('31000000-0000-4000-8000-000000000009','unclaimed@example.test',jsonb_build_object('signup_permit',null))$query$,
  '42501','presented null permit cannot use administrative provisioning exception');

-- Bounded maintenance removes only expired records, not recent quota rows.
insert into private.signup_ip_quota(ip_key_hash,first_created_at) values
  (repeat('5',64),clock_timestamp()-interval '97 hours'), (repeat('6',64),clock_timestamp()-interval '97 hours');
update private.signup_permits set expires_at=clock_timestamp()-interval '1 second' where email in ('rollback@example.test','legacy@example.test');
set role service_role;
select test_signup.ok(private.cleanup_signup_security(1)=2, 'maintenance obeys separate one-row permit and quota batch bounds');
select test_signup.raises('select private.cleanup_signup_security(0)','22023','invalid maintenance batch rejected');
reset role;
select test_signup.ok((select count(*)=1 from private.signup_ip_quota where ip_key_hash in(repeat('5',64),repeat('6',64))), 'bounded maintenance retains remaining expired rows for later batch');
select test_signup.ok((select count(*)=2 from private.signup_ip_quota where ip_key_hash in(repeat('1',64),repeat('2',64))), 'maintenance preserves active IP quotas');

select count(*)::integer as passed, array_agg(label order by label) as assertions from test_signup.assertions;
rollback;
