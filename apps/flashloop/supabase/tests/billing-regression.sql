-- Synthetic identities only. No credentials, GoTrue calls, payment or hosted data.
insert into auth.users(id,email,email_confirmed_at) values
 ('b0000000-0000-4000-8000-000000000001','billing-a@example.test',clock_timestamp()),
 ('b0000000-0000-4000-8000-000000000002','billing-b@example.test',clock_timestamp());
insert into auth.sessions(id,user_id) values
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001'),
 ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002');
insert into private.session_verifications(session_id,user_id,state,verified_at) values
 ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','verified',clock_timestamp()),
 ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','verified',clock_timestamp());
insert into public.projects(id,owner_id,name) values('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','Billing fixture');
