begin;
create schema test_storage;
create table test_storage.assertions(label text primary key);
create table test_storage.state(name text primary key, value jsonb);
create function test_storage.ok(condition boolean,label text) returns void
language plpgsql security invoker as $$ begin
  if condition is not true then raise exception 'Assertion failed: %',label; end if;
  insert into test_storage.assertions values(label);
end; $$;
create function test_storage.raises(query text,expected_state text,label text) returns void
language plpgsql security invoker as $$ begin
  begin execute query;
  exception when others then
    if sqlstate = expected_state then insert into test_storage.assertions values(label); return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE %: %',expected_state,label;
end; $$;
grant usage on schema test_storage to anon,authenticated,service_role;
grant all on all tables in schema test_storage to anon,authenticated,service_role;
grant execute on all functions in schema test_storage to anon,authenticated,service_role;

insert into auth.users(id,email,email_confirmed_at) values
  ('11000000-0000-4000-8000-000000000001','storage-a@example.test',now()),
  ('11000000-0000-4000-8000-000000000002','storage-b@example.test',now());
insert into auth.sessions(id,user_id) values
  ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002'),
  ('22000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001');
insert into private.session_verifications(session_id,user_id,state,verified_at) values
  ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','verified',now()),
  ('22000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','verified',now());
insert into public.projects(id,owner_id,name) values
  ('33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Storage A'),
  ('33000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','Storage B'),
  ('33000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','Storage A second');
insert into public.jobs(id,owner_id,project_id,label,status) values
  ('44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','A running','running'),
  ('44000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','B queued','queued');

select test_storage.ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.project_objects'::regclass),'object metadata enables and forces RLS');
select test_storage.ok((select count(*)=9 and not bool_or(p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('storage_policy','configure_storage_policy','reserve_project_upload','storage_reserve_output','storage_complete_object','delete_project_object','storage_cleanup_batch','storage_cleanup_done','storage_expire_objects')),
  'public storage wrappers are invoker functions');
set role service_role;
select test_storage.ok((public.storage_policy()->>'enabled')::boolean = false,'storage policy starts disabled');
reset role;
set role anon;
select test_storage.raises('select * from public.project_objects','42501','anonymous cannot select object metadata');
select test_storage.raises('select public.reserve_project_upload(gen_random_uuid(),''a'',''image/png'',10)','42501','anonymous cannot reserve uploads');
select test_storage.raises('select public.storage_cleanup_batch(1)','42501','anonymous cannot access cleanup queue');
reset role;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","session_id":"22000000-0000-4000-8000-000000000001"}',true);
set role authenticated;
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000001'',''a.png'',''image/png'',400)','55000','disabled policy denies reservation');
select test_storage.raises('select public.storage_policy()','42501','user cannot read private policy');
select test_storage.raises('select public.configure_storage_policy(true,30,60,1000,2000,1,array[''image/png''])','42501','user cannot configure storage caps');
select test_storage.raises('select public.storage_complete_object(gen_random_uuid(),gen_random_uuid(),auth.uid(),''etag'',1)','42501','user cannot mark uploads verified');
select test_storage.raises('insert into public.project_objects(owner_id,project_id,kind,filename,content_type,byte_size,upload_expires_at,retention_expires_at) values(auth.uid(),''33000000-0000-4000-8000-000000000001'',''upload'',''a.png'',''image/png'',1,now(),now())','42501','user cannot bypass reservation via raw insert');
select test_storage.raises('update public.project_objects set status=''ready''','42501','user cannot alter object status');
select test_storage.raises('delete from public.project_objects','42501','user cannot bypass deletion outbox');
reset role;
set role service_role;
select test_storage.raises('select public.configure_storage_policy(true,null,null,null,null,null,null)','23514','incomplete policy cannot be enabled');
select test_storage.raises('select public.configure_storage_policy(true,30,60,1000,2000,1,array[''text/html''])','23514','policy cannot permit active HTML');
select public.configure_storage_policy(true,30,60,1000,2000,1,array['image/png','image/webp']);
reset role;
set role authenticated;
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000002'',''a.png'',''image/png'',10)','P0002','A cannot reserve under B project');
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000001'',''a.png'',''image/png'',1001)','22023','oversized declaration rejected');
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000001'',''a.svg'',''image/svg+xml'',10)','22023','unpermitted MIME rejected');
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000001'',''a.png'',''image/png'',0)','22023','zero size rejected');
insert into test_storage.state values ('a1',public.reserve_project_upload('33000000-0000-4000-8000-000000000001','../../b.png','image/png',400));
insert into test_storage.state values ('a2',public.reserve_project_upload('33000000-0000-4000-8000-000000000001','second.png','image/png',300));
select test_storage.ok((select count(*)=2 and bool_and(status='pending') from public.project_objects),'A sees only pending owned reservations');
select test_storage.ok((select value->'object'->>'staging_key' = 'private/owners/11000000-0000-4000-8000-000000000001/projects/33000000-0000-4000-8000-000000000001/staging/' || (value->'object'->>'id')
  and value->'object'->>'object_key' = 'private/owners/11000000-0000-4000-8000-000000000001/projects/33000000-0000-4000-8000-000000000001/objects/' || (value->'object'->>'id') from test_storage.state where name='a1'),
  'keys derive from owner project and random ID not filename');
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000001'',''over.png'',''image/png'',400)','54000','account cap counts all reservations and staging copies');
reset role;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000002","session_id":"22000000-0000-4000-8000-000000000002"}',true);
set role authenticated;
select test_storage.ok((select count(*)=0 from public.project_objects),'B cannot see A metadata');
select test_storage.ok(not public.delete_project_object((select (value->'object'->>'id')::uuid from test_storage.state where name='a1'),'33000000-0000-4000-8000-000000000001'),'B cannot delete A object');
insert into test_storage.state values ('b1',public.reserve_project_upload('33000000-0000-4000-8000-000000000002','b.webp','image/webp',500));
reset role;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","session_id":"22000000-0000-4000-8000-000000000003"}',true);
set role authenticated;
select test_storage.ok((select count(*)=0 from public.project_objects),'pending session cannot see object metadata');
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000001'',''a.png'',''image/png'',1)','42501','pending session cannot reserve');
reset role;
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","session_id":"22000000-0000-4000-8000-000000000001"}',true);
set role service_role;
select test_storage.raises('insert into public.project_objects(owner_id,project_id,kind,filename,content_type,byte_size,upload_expires_at,retention_expires_at) values(''11000000-0000-4000-8000-000000000001'',''33000000-0000-4000-8000-000000000001'',''upload'',''x'',''image/png'',1,now(),now())','42501','service cannot bypass narrow reservation RPC');
select test_storage.raises('select public.storage_complete_object((select (value->''object''->>''id'')::uuid from test_storage.state where name=''a1''),''33000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000002'',''etag'',400)','P0002','worker completion requires exact persisted owner tuple');
select test_storage.raises('select public.storage_complete_object((select (value->''object''->>''id'')::uuid from test_storage.state where name=''a1''),''33000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000001'',''etag'',401)','22023','worker cannot complete beyond reserved bytes');
select test_storage.ok((public.storage_complete_object((select (value->'object'->>'id')::uuid from test_storage.state where name='a1'),'33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','sealed-a',400)->>'status')='ready','worker marks verified sealed object ready');
select test_storage.ok((public.storage_complete_object((select (value->'object'->>'id')::uuid from test_storage.state where name='a1'),'33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','sealed-a',400)->>'status')='ready','exact completion replay is idempotent');
select test_storage.raises('select public.storage_complete_object((select (value->''object''->>''id'')::uuid from test_storage.state where name=''a1''),''33000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000001'',''replacement'',400)','22023','ready object cannot be replaced');
select test_storage.raises('select public.storage_reserve_output(''44000000-0000-4000-8000-000000000002'',''33000000-0000-4000-8000-000000000002'',''11000000-0000-4000-8000-000000000002'',''out.png'',''image/png'',10)','42501','queued job cannot reserve output');
select test_storage.raises('select public.storage_reserve_output(''44000000-0000-4000-8000-000000000001'',''33000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000002'',''out.png'',''image/png'',10)','42501','worker output requires exact running job owner tuple');
insert into test_storage.state values ('ao',public.storage_reserve_output('44000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','out.png','image/png',100));
select test_storage.ok((select value->'object'->>'kind'='output' and value->'object'->>'job_id'='44000000-0000-4000-8000-000000000001' from test_storage.state where name='ao'),'running job output stores immutable job binding');
reset role;
select test_storage.raises('update public.project_objects set owner_id=''11000000-0000-4000-8000-000000000002'' where id=(select (value->''object''->>''id'')::uuid from test_storage.state where name=''a1'')','23514','identity trigger prevents privileged owner reassignment');
select test_storage.raises('update public.project_objects set staging_key=''injected''','428C9','generated staging key cannot be injected');
-- Shift one fixture's deadline without waiting. Production has no such capability.
alter table public.project_objects disable trigger project_objects_immutable_identity;
update public.project_objects set upload_expires_at=clock_timestamp()-interval '2 minutes'
  where id=(select (value->'object'->>'id')::uuid from test_storage.state where name='a2');
alter table public.project_objects enable trigger project_objects_immutable_identity;
set role service_role;
select test_storage.raises('select public.storage_complete_object((select (value->''object''->>''id'')::uuid from test_storage.state where name=''a2''),''33000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000001'',''etag'',300)','22023','expired pending upload cannot become ready');
reset role;
set role authenticated;
delete from public.projects where id='33000000-0000-4000-8000-000000000001';
reset role;
select test_storage.ok((select count(*)=3 and sum(byte_size)=1600 from private.storage_cleanup where owner_id='11000000-0000-4000-8000-000000000001'),'project deletion atomically queues every exact object and keeps quota charge');
select test_storage.ok((select count(*)=1 and bool_and(owner_id='11000000-0000-4000-8000-000000000002') from public.project_objects),'deleting A project leaves B objects intact');
select test_storage.ok((select bool_and(staging_key='private/owners/'||owner_id::text||'/projects/'||project_id::text||'/staging/'||id::text
  and object_key='private/owners/'||owner_id::text||'/projects/'||project_id::text||'/objects/'||id::text) from private.storage_cleanup),'cleanup captures generated exact keys not prefix deletion');
set role authenticated;
select test_storage.raises('select public.reserve_project_upload(''33000000-0000-4000-8000-000000000003'',''new.png'',''image/png'',300)','54000','deletion does not free quota before physical cleanup');
reset role;
set role service_role;
select test_storage.ok(jsonb_array_length(public.storage_cleanup_batch(100))=1,'cleanup waits until upload URLs expire plus grace');
select test_storage.ok(not public.storage_cleanup_done((select (value->'object'->>'id')::uuid from test_storage.state where name='a1')),'cleanup cannot acknowledge before replay window closes');
select test_storage.ok(public.storage_cleanup_done((select (value->'object'->>'id')::uuid from test_storage.state where name='a2')),'due cleanup acknowledgement releases reservation');
select test_storage.ok(not public.storage_cleanup_done((select (value->'object'->>'id')::uuid from test_storage.state where name='a2')),'cleanup acknowledgement replay is harmless');
reset role;
set role authenticated;
insert into test_storage.state values ('an',public.reserve_project_upload('33000000-0000-4000-8000-000000000003','new.png','image/png',500));
select test_storage.ok((select count(*)=1 from public.project_objects),'released cleanup bytes permit a fresh reservation');
reset role;
update public.project_objects set status='ready',verified_byte_size=500,etag='sealed-b',retention_expires_at=clock_timestamp()-interval '1 second'
  where id=(select (value->'object'->>'id')::uuid from test_storage.state where name='b1');
set role service_role;
select test_storage.ok(public.storage_expire_objects(100)=1,'retention sweep deletes expired ready metadata');
reset role;
select test_storage.ok((select count(*)=1 from private.storage_cleanup where owner_id='11000000-0000-4000-8000-000000000002'),'retention expiry creates durable cleanup record');
delete from auth.users where id='11000000-0000-4000-8000-000000000001';
select test_storage.ok((select count(*)=3 from private.storage_cleanup where owner_id='11000000-0000-4000-8000-000000000001'),'account deletion preserves existing cleanup and queues remaining object');
select test_storage.ok((select count(*)=1 from private.storage_cleanup where owner_id='11000000-0000-4000-8000-000000000002'),'account deletion does not modify another account cleanup');
select count(*)::integer as passed from test_storage.assertions;
rollback;
