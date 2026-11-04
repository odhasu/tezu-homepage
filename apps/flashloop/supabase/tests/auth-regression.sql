begin;
create schema test_auth;
create table test_auth.assertions (label text primary key);
create table test_auth.state (name text primary key, value text);
create function test_auth.ok(condition boolean, label text)
returns void language plpgsql security invoker as $$
begin
  if condition is not true then raise exception 'Assertion failed: %', label; end if;
  insert into test_auth.assertions values (label);
end;
$$;
create function test_auth.raises(query text, expected_state text, label text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate = expected_state then
      insert into test_auth.assertions values (label);
      return;
    end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE %: %', expected_state, label;
end;
$$;
grant usage on schema test_auth to anon, authenticated, service_role, supabase_auth_admin;
grant all on all tables in schema test_auth to anon, authenticated, service_role, supabase_auth_admin;
grant execute on all functions in schema test_auth to anon, authenticated, service_role, supabase_auth_admin;

insert into auth.users (id, email, email_confirmed_at, is_anonymous, banned_until) values
  ('10000000-0000-4000-8000-000000000002', 'other@example.test', now(), false, null),
  ('10000000-0000-4000-8000-000000000003', 'unconfirmed@example.test', null, false, null),
  ('10000000-0000-4000-8000-000000000004', 'banned@example.test', now(), false, now() + interval '1 day'),
  ('10000000-0000-4000-8000-000000000005', null, now(), true, null);
insert into auth.sessions (id, user_id, not_after) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', null),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', null),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', null),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', null),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', null),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', now() - interval '1 second'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000004', null),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000005', null);
update auth.users set raw_user_meta_data = '{"verified":true,"credits":1000,"verification":"verified"}'
  where id = '10000000-0000-4000-8000-000000000001';

select test_auth.ok((select count(*) = 5 and bool_and(credits = 0) from public.video_credit_accounts),
  'backfill and newly inserted accounts receive exactly zero credits');
-- A trusted test top-up lets the suite distinguish hidden balances from zero
-- initialization. No signup or client operation performs this update.
update public.video_credit_accounts set credits=25 where user_id='10000000-0000-4000-8000-000000000001';
select test_auth.ok((select count(*) = 7 and not bool_or(p.prosecdef)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('issue_signup_permit', 'before_user_created',
    'get_auth_context', 'begin_session_verification', 'finish_session_verification',
    'revoke_current_session', 'consume_auth_rate_limit')), 'all exposed RPCs are security invoker');
select test_auth.ok((select bool_and(c.relrowsecurity) from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname = 'private' and c.relname in ('signup_permits', 'session_verifications', 'auth_rate_limits'))
    or (n.nspname = 'public' and c.relname = 'video_credit_accounts')), 'RLS enabled on every application table');

set role anon;
select test_auth.raises('select public.get_auth_context()', '42501', 'anonymous caller cannot inspect auth context');
select test_auth.raises('select public.before_user_created(''{}''::jsonb)', '42501', 'anonymous caller cannot invoke signup hook');
select test_auth.raises('select * from public.video_credit_accounts', '42501', 'anonymous caller cannot read balances');
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001","user_metadata":{"verified":true}}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() = '{"user_id":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001","email_confirmed":true,"verification":"pending","credits":0}'::jsonb,
  'context matches backend contract and ignores user metadata');
select test_auth.ok(public.get_auth_context()->>'credits'='0', 'pending context hides previously funded credits');
select test_auth.ok((select count(*) = 0 from public.video_credit_accounts), 'pending JWT cannot read protected balance');
select test_auth.raises('insert into public.video_credit_accounts(user_id,credits) values (auth.uid(),1000)', '42501', 'user cannot insert own video credits');
select test_auth.raises('update public.video_credit_accounts set credits=1000 where user_id=auth.uid()', '42501', 'user cannot update own video credits');
select test_auth.raises('select public.issue_signup_permit(''fake@example.test'',repeat(''a'',64))', '42501', 'user cannot issue signup permits');
select test_auth.raises('select public.consume_auth_rate_limit(repeat(''a'',64),1000,1)', '42501', 'user cannot reset authentication rate limits');
select test_auth.raises('select public.finish_session_verification(auth.uid(),gen_random_uuid(),gen_random_uuid(),true)', '42501', 'user cannot self-verify session');
select test_auth.raises('select * from private.session_verifications', '42501', 'user cannot inspect private verification table');
insert into test_auth.state values ('first_attempt', public.begin_session_verification());
select test_auth.ok((select value is not null and value::uuid is not null from test_auth.state where name='first_attempt'), 'begin returns attempt UUID as text');
select test_auth.ok(public.get_auth_context()->>'verification' = 'verifying', 'begin moves pending session to verifying');
select test_auth.ok(public.begin_session_verification() is null, 'concurrent begin cannot replace active attempt');
reset role;

set role service_role;
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',(select value::uuid from test_auth.state where name='first_attempt'),true), 'finish cannot target wrong user');
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',gen_random_uuid(),true), 'finish cannot use wrong attempt');
select test_auth.ok(public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',(select value::uuid from test_auth.state where name='first_attempt'),true), 'successful server verification grants session');
reset role;
set role authenticated;
select test_auth.ok(public.get_auth_context()->>'verification' = 'verified', 'verified session visible to same JWT');
select test_auth.ok(public.get_auth_context()->>'credits'='25', 'verified context exposes current funded balance');
select test_auth.ok((select count(*) = 1 and bool_and(user_id = auth.uid()) and bool_and(credits = 25) from public.video_credit_accounts), 'verified user sees only own funded balance');
select test_auth.ok(public.revoke_current_session(), 'revoke persists application session denial');
select test_auth.ok(public.get_auth_context()->>'verification' = 'failed', 'existing JWT sees terminal failure without token refresh');
select test_auth.ok(public.get_auth_context()->>'credits'='0', 'failed context hides previously funded credits');
select test_auth.ok((select count(*) = 0 from public.video_credit_accounts), 'existing JWT loses protected table access immediately');
select test_auth.ok(public.begin_session_verification() is null, 'failed session cannot start new verification');
reset role;
set role service_role;
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',(select value::uuid from test_auth.state where name='first_attempt'),true), 'late success cannot restore revoked session');
reset role;

-- Test both commit orderings of success and failure for one attempt. PGlite
-- serializes commands; provider-backed tests must also exercise real connections.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000003"}', true);
set role authenticated;
insert into test_auth.state values ('failure_first', public.begin_session_verification());
reset role;
set role service_role;
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',(select value::uuid from test_auth.state where name='failure_first'),false), 'failure outcome grants no access');
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',(select value::uuid from test_auth.state where name='failure_first'),true), 'failure-first ordering defeats success');
reset role;
set role authenticated;
select test_auth.ok((select count(*)=0 from public.video_credit_accounts), 'failure-first ordering denies direct Data API reads');
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000004"}', true);
set role authenticated;
insert into test_auth.state values ('success_first', public.begin_session_verification());
reset role;
set role service_role;
select test_auth.ok(public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004',(select value::uuid from test_auth.state where name='success_first'),true), 'success-first ordering initially verifies');
select public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004',(select value::uuid from test_auth.state where name='success_first'),false);
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004',(select value::uuid from test_auth.state where name='success_first'),true), 'later failure defeats earlier success permanently');
reset role;
set role authenticated;
select test_auth.ok(public.get_auth_context()->>'verification'='failed' and (select count(*)=0 from public.video_credit_accounts), 'success-first then failure denies existing JWT');
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000002"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context()->>'verification'='pending', 'another session does not inherit verification or failure');
insert into test_auth.state values ('logged_out', public.begin_session_verification());
reset role;
set role service_role;
select test_auth.ok(public.finish_session_verification('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',(select value::uuid from test_auth.state where name='logged_out'),true), 'second session can verify independently');
reset role;
delete from auth.sessions where id='20000000-0000-4000-8000-000000000002';
set role authenticated;
select test_auth.ok(public.get_auth_context() is null and (select count(*)=0 from public.video_credit_accounts), 'deleted Auth session invalidates unchanged JWT through live session check');
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","session_id":"20000000-0000-4000-8000-000000000005"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context()->>'email_confirmed'='false' and public.begin_session_verification() is null, 'unconfirmed email cannot begin verification');
select test_auth.ok((select count(*)=0 from public.video_credit_accounts), 'unconfirmed email cannot read protected balance');
reset role;
update auth.users set email_confirmed_at=now() where id='10000000-0000-4000-8000-000000000003';
set role authenticated;
insert into test_auth.state values ('email_changed', public.begin_session_verification());
reset role;
update auth.users set email_confirmed_at=null where id='10000000-0000-4000-8000-000000000003';
set role service_role;
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000005',(select value::uuid from test_auth.state where name='email_changed'),true), 'finish rechecks current email confirmation');
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000001"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() is null, 'JWT subject cannot borrow another user session');
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000006"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() is null and public.begin_session_verification() is null, 'expired Auth session fails closed');
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","session_id":"20000000-0000-4000-8000-000000000007"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() is null, 'banned account fails closed');
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","session_id":"20000000-0000-4000-8000-000000000008"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() is null, 'anonymous identity cannot pass verification gate');
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"malformed"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() is null, 'malformed session claim fails closed');
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001"}', true);
set role authenticated;
select test_auth.ok(public.get_auth_context() is null, 'missing session claim fails closed');
reset role;

insert into auth.sessions(id,user_id) values
  ('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002');
update public.video_credit_accounts set credits=7 where user_id='10000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000009"}', true);
set role authenticated;
insert into test_auth.state values ('confirmed_then_changed', public.begin_session_verification());
reset role;
set role service_role;
select test_auth.ok(public.finish_session_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000009',(select value::uuid from test_auth.state where name='confirmed_then_changed'),true), 'confirmed second user can verify own session');
reset role;
update auth.users set email_confirmed_at=null where id='10000000-0000-4000-8000-000000000002';
set role authenticated;
select test_auth.ok(public.get_auth_context()->>'verification'='verified'
  and public.get_auth_context()->>'email_confirmed'='false'
  and (select count(*)=0 from public.video_credit_accounts), 'RLS rechecks live email confirmation after session verified');
select test_auth.ok(public.get_auth_context()->>'credits'='0', 'unconfirmed verified context hides funded credits');
reset role;
update auth.users set email_confirmed_at=now() where id='10000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000010"}', true);
set role authenticated;
insert into test_auth.state values ('expired_during_attempt', public.begin_session_verification());
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='20000000-0000-4000-8000-000000000010';
set role service_role;
select test_auth.ok(not public.finish_session_verification('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000010',(select value::uuid from test_auth.state where name='expired_during_attempt'),true), 'finish rechecks session expiry after challenge begins');
reset role;

insert into private.auth_rate_limits(key_hash,window_started_at,window_seconds,attempts) values
  (repeat('e',64),clock_timestamp()-interval '49 hours',86400,2),
  (repeat('f',64),clock_timestamp()-interval '25 hours',86400,2),
  (repeat('1',64),clock_timestamp()-interval '48 hours',600,2);
set role service_role;
select test_auth.ok(public.consume_auth_rate_limit(repeat('a',64),2,600), 'first rate-limited request allowed');
reset role;
select test_auth.ok((select count(*)=0 from private.auth_rate_limits where key_hash in (repeat('e',64),repeat('1',64))), 'counters expired more than 24 hours are deleted');
select test_auth.ok((select count(*)=1 from private.auth_rate_limits where key_hash=repeat('f',64)), 'counter expired less than 24 hours is preserved');
set role service_role;
select test_auth.ok(public.consume_auth_rate_limit(repeat('a',64),2,600), 'second request within limit allowed');
select test_auth.ok(not public.consume_auth_rate_limit(repeat('a',64),2,600), 'request beyond rate limit rejected');
select test_auth.raises('select public.consume_auth_rate_limit(''invalid'',2,600)', '22023', 'invalid rate-limit key rejected');
select test_auth.raises('select public.before_user_created(''{}''::jsonb)', '42501', 'service key cannot impersonate Auth hook');
reset role;
update private.auth_rate_limits set window_started_at=clock_timestamp()-interval '601 seconds' where key_hash=repeat('a',64);
set role service_role;
select test_auth.ok(public.consume_auth_rate_limit(repeat('a',64),2,600), 'rate-limit window resets after expiry');

select public.issue_signup_permit('  New@Example.test  ',encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'));
select public.issue_signup_permit('expires@example.test',encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'));
reset role;
update private.signup_permits set expires_at=clock_timestamp()-interval '1 second' where email='expires@example.test';
set role supabase_auth_admin;
select test_auth.ok(public.before_user_created('{}') ? 'error', 'missing signup proof rejected by Auth hook');
select test_auth.ok(public.before_user_created('{"metadata":{"name":"before-user-created"},"user":{"email":"new@example.test","is_anonymous":false,"app_metadata":{"provider":"email"},"user_metadata":{"verified":true}}}') ? 'error', 'metadata verification flag is not signup proof');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','wrong@example.test','is_anonymous',false,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_permit',repeat('b',64))))) ? 'error', 'permit bound to exact normalized email');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','new@example.test','is_anonymous',false,'app_metadata',jsonb_build_object('provider','google'),'user_metadata',jsonb_build_object('signup_permit',repeat('b',64))))) ? 'error', 'non-email signup method rejected');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','new@example.test','is_anonymous',true,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_permit',repeat('b',64))))) ? 'error', 'anonymous signup rejected even with permit');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','expires@example.test','is_anonymous',false,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_permit',repeat('c',64))))) ? 'error', 'expired signup permit rejected');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','new@example.test','is_anonymous',false,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_permit',repeat('d',64))))) ? 'error', 'invalid signup permit rejected');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','NEW@example.test','is_anonymous',false,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_permit',repeat('b',64))))) = '{}'::jsonb, 'fresh server-issued signup permit accepted once');
select test_auth.ok(public.before_user_created(jsonb_build_object('metadata',jsonb_build_object('name','before-user-created'),'user',jsonb_build_object('email','new@example.test','is_anonymous',false,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_permit',repeat('b',64))))) ? 'error', 'replayed signup permit rejected');
reset role;

select count(*)::integer as passed, array_agg(label order by label) as assertions from test_auth.assertions;
rollback;
