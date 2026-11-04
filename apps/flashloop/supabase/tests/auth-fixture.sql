-- Disposable PostgreSQL fixture for the executable PGlite regression suite.
-- This models the Auth columns read by this migration. It is not GoTrue.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean default false,
  banned_until timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select (auth.jwt() ->> 'sub')::uuid;
$$;
grant usage on schema auth, public to anon, authenticated, service_role, supabase_auth_admin;
insert into auth.users (id, email, email_confirmed_at)
  values ('10000000-0000-4000-8000-000000000001', 'existing@example.test', now());
