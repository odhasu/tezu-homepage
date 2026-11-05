begin;

-- This policy deliberately has no operational defaults. Applying the migration
-- does not authorize uploads or choose a retention/billing policy.
create table private.storage_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  upload_url_seconds integer check (upload_url_seconds between 30 and 900),
  download_url_seconds integer check (download_url_seconds between 1 and 900),
  max_upload_bytes bigint check (max_upload_bytes between 1 and 20971520),
  max_account_bytes bigint check (max_account_bytes between 2 and 1099511627776),
  retention_days integer check (retention_days between 1 and 365),
  allowed_content_types text[] check (cardinality(allowed_content_types) between 1 and 3
    and allowed_content_types <@ array['image/png','image/jpeg','image/webp']::text[]
    and array_position(allowed_content_types, null) is null),
  check (not enabled or (upload_url_seconds is not null and download_url_seconds is not null
    and max_upload_bytes is not null and max_account_bytes is not null
    and max_account_bytes >= max_upload_bytes * 2 and retention_days is not null
    and allowed_content_types is not null))
);
insert into private.storage_policy(singleton) values (true);
alter table private.storage_policy enable row level security;
alter table private.storage_policy force row level security;
revoke all on private.storage_policy from public, anon, authenticated, service_role;

create table public.project_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null,
  job_id uuid,
  kind text not null check (kind in ('upload','output')),
  filename text not null check (length(btrim(filename)) between 1 and 255),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 20971520),
  verified_byte_size bigint check (verified_byte_size > 0 and verified_byte_size <= byte_size),
  status text not null default 'pending' check (status in ('pending','ready','rejected')),
  staging_key text generated always as ('private/owners/' || owner_id::text || '/projects/' || project_id::text || '/staging/' || id::text) stored,
  object_key text generated always as ('private/owners/' || owner_id::text || '/projects/' || project_id::text || '/objects/' || id::text) stored,
  upload_expires_at timestamptz not null,
  retention_expires_at timestamptz not null,
  etag text check (length(etag) between 1 and 256),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade,
  foreign key (job_id, project_id, owner_id) references public.jobs(id, project_id, owner_id) on delete cascade,
  check ((kind = 'upload' and job_id is null) or (kind = 'output' and job_id is not null)),
  check (status <> 'ready' or (etag is not null and verified_byte_size is not null))
);
create index project_objects_owner_idx on public.project_objects(owner_id);
create index project_objects_parent_idx on public.project_objects(project_id,owner_id);
create index project_objects_pending_expiry_idx on public.project_objects(upload_expires_at) where status <> 'ready';
create index project_objects_retention_idx on public.project_objects(retention_expires_at) where status = 'ready';
create trigger project_objects_immutable_identity before update on public.project_objects for each row
  execute function private.enforce_record_identity('id','owner_id','project_id','job_id','kind','filename','content_type','byte_size','upload_expires_at','created_at');
alter table public.project_objects enable row level security;
alter table public.project_objects force row level security;
revoke all on public.project_objects from public, anon, authenticated, service_role;
grant select on public.project_objects to authenticated, service_role;
create policy project_objects_owner_select on public.project_objects for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = project_objects.project_id and p.owner_id = project_objects.owner_id));

-- No FK: cleanup must survive project/job/Auth cascades. Keys come only from
-- generated columns on deleted metadata, never from an event or user body.
create table private.storage_cleanup (
  id uuid primary key,
  owner_id uuid not null,
  project_id uuid not null,
  staging_key text not null,
  object_key text not null,
  byte_size bigint not null check (byte_size > 0),
  not_before timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index storage_cleanup_due_idx on private.storage_cleanup(not_before);
create index storage_cleanup_owner_idx on private.storage_cleanup(owner_id);
alter table private.storage_cleanup enable row level security;
alter table private.storage_cleanup force row level security;
revoke all on private.storage_cleanup from public, anon, authenticated, service_role;

create function private.queue_storage_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_cleanup(id,owner_id,project_id,staging_key,object_key,byte_size,not_before)
    values (old.id,old.owner_id,old.project_id,old.staging_key,old.object_key,old.byte_size * 2,
      greatest(clock_timestamp(), old.upload_expires_at + interval '60 seconds'))
    on conflict (id) do nothing;
  return old;
end;
$$;
revoke all on function private.queue_storage_cleanup() from public, anon, authenticated, service_role, supabase_auth_admin;
create trigger project_objects_cleanup after delete on public.project_objects for each row
  execute function private.queue_storage_cleanup();

create function private.storage_policy()
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(p) - 'singleton' from private.storage_policy p where singleton;
$$;
create function public.storage_policy()
returns jsonb language sql security invoker set search_path = '' as $$ select private.storage_policy(); $$;
create function private.configure_storage_policy(
  p_enabled boolean, p_upload_url_seconds integer, p_download_url_seconds integer,
  p_max_upload_bytes bigint, p_max_account_bytes bigint, p_retention_days integer, p_allowed_content_types text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update private.storage_policy set enabled = p_enabled, upload_url_seconds = p_upload_url_seconds,
    download_url_seconds = p_download_url_seconds, max_upload_bytes = p_max_upload_bytes,
    max_account_bytes = p_max_account_bytes, retention_days = p_retention_days,
    allowed_content_types = p_allowed_content_types where singleton;
  return private.storage_policy();
end;
$$;
create function public.configure_storage_policy(
  p_enabled boolean, p_upload_url_seconds integer, p_download_url_seconds integer,
  p_max_upload_bytes bigint, p_max_account_bytes bigint, p_retention_days integer, p_allowed_content_types text[])
returns jsonb language sql security invoker set search_path = '' as $$
  select private.configure_storage_policy(p_enabled,p_upload_url_seconds,p_download_url_seconds,
    p_max_upload_bytes,p_max_account_bytes,p_retention_days,p_allowed_content_types);
$$;

-- Internal helper. The authenticated wrapper derives identity from the current
-- verified session; output reservation checks a persisted running job instead.
create function private.reserve_storage_object(
  p_owner_id uuid, p_project_id uuid, p_job_id uuid, p_filename text, p_content_type text, p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_policy private.storage_policy%rowtype;
  v_object public.project_objects%rowtype;
  v_usage numeric;
begin
  perform 1 from public.projects where id = p_project_id and owner_id = p_owner_id for key share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  -- A consistent lock order serializes all reservations for this owner.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 479321));
  select * into v_policy from private.storage_policy where singleton for share;
  if not v_policy.enabled then raise exception 'Private storage unavailable' using errcode = '55000'; end if;
  if p_filename is null or length(btrim(p_filename)) not between 1 and 255
    or p_byte_size is null or p_byte_size < 1 or p_byte_size > v_policy.max_upload_bytes
    or p_content_type is null or not (p_content_type = any(v_policy.allowed_content_types)) then
    raise exception 'Invalid storage reservation' using errcode = '22023';
  end if;
  select coalesce((select sum(byte_size::numeric * 2) from public.project_objects where owner_id = p_owner_id),0)
    + coalesce((select sum(byte_size::numeric) from private.storage_cleanup where owner_id = p_owner_id),0) into v_usage;
  if v_usage + p_byte_size::numeric * 2 > v_policy.max_account_bytes then
    raise exception 'Account storage limit exceeded' using errcode = '54000';
  end if;
  insert into public.project_objects(owner_id,project_id,job_id,kind,filename,content_type,byte_size,upload_expires_at,retention_expires_at)
    values (p_owner_id,p_project_id,p_job_id,case when p_job_id is null then 'upload' else 'output' end,
      btrim(p_filename),p_content_type,p_byte_size,
      clock_timestamp() + make_interval(secs => v_policy.upload_url_seconds),
      clock_timestamp() + make_interval(days => v_policy.retention_days)) returning * into v_object;
  return jsonb_build_object('object', to_jsonb(v_object), 'policy', to_jsonb(v_policy) - 'singleton');
end;
$$;
revoke all on function private.reserve_storage_object(uuid,uuid,uuid,text,text,bigint) from public, anon, authenticated, service_role, supabase_auth_admin;

create function private.reserve_project_upload(p_project_id uuid,p_filename text,p_content_type text,p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_verified_session() or auth.uid() is null then
    raise exception 'Verified session required' using errcode = '42501';
  end if;
  return private.reserve_storage_object(auth.uid(),p_project_id,null,p_filename,p_content_type,p_byte_size);
end;
$$;
create function public.reserve_project_upload(p_project_id uuid,p_filename text,p_content_type text,p_byte_size bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_project_upload(p_project_id,p_filename,p_content_type,p_byte_size);
$$;
create function private.storage_reserve_output(
  p_job_id uuid,p_project_id uuid,p_owner_id uuid,p_filename text,p_content_type text,p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.jobs where id = p_job_id and project_id = p_project_id and owner_id = p_owner_id and status = 'running' for update;
  if not found then raise exception 'Running job required' using errcode = '42501'; end if;
  return private.reserve_storage_object(p_owner_id,p_project_id,p_job_id,p_filename,p_content_type,p_byte_size);
end;
$$;
create function public.storage_reserve_output(
  p_job_id uuid,p_project_id uuid,p_owner_id uuid,p_filename text,p_content_type text,p_byte_size bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.storage_reserve_output(p_job_id,p_project_id,p_owner_id,p_filename,p_content_type,p_byte_size);
$$;

create function private.storage_complete_object(p_id uuid,p_project_id uuid,p_owner_id uuid,p_etag text,p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_object public.project_objects%rowtype; v_policy private.storage_policy%rowtype;
begin
  select * into v_policy from private.storage_policy where singleton for share;
  if not v_policy.enabled then raise exception 'Private storage unavailable' using errcode = '55000'; end if;
  select * into v_object from public.project_objects
    where id = p_id and owner_id = p_owner_id and project_id = p_project_id for update;
  if not found then raise exception 'Object not found' using errcode = 'P0002'; end if;
  if v_object.status = 'ready' and v_object.etag = p_etag and v_object.verified_byte_size = p_byte_size then return to_jsonb(v_object); end if;
  if v_object.status <> 'pending' or v_object.upload_expires_at <= clock_timestamp()
    or p_etag is null or length(p_etag) not between 1 and 256
    or p_byte_size is null or p_byte_size <= 0 or p_byte_size > v_object.byte_size then
    raise exception 'Object cannot be completed' using errcode = '22023';
  end if;
  if v_object.kind = 'output' then
    perform 1 from public.jobs where id = v_object.job_id
      and owner_id = p_owner_id and project_id = p_project_id and status = 'running' for share;
    if not found then raise exception 'Running job required' using errcode = '42501'; end if;
  end if;
  update public.project_objects set status = 'ready', etag = p_etag, verified_byte_size = p_byte_size,
    retention_expires_at = clock_timestamp() + make_interval(days => v_policy.retention_days)
    where id = p_id returning * into v_object;
  return to_jsonb(v_object);
end;
$$;
create function public.storage_complete_object(p_id uuid,p_project_id uuid,p_owner_id uuid,p_etag text,p_byte_size bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.storage_complete_object(p_id,p_project_id,p_owner_id,p_etag,p_byte_size);
$$;

create function private.delete_project_object(p_id uuid,p_project_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_verified_session() or auth.uid() is null then
    raise exception 'Verified session required' using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project_id and owner_id = auth.uid() for key share;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 479321));
  delete from public.project_objects where id = p_id and owner_id = auth.uid() and project_id = p_project_id;
  return found;
end;
$$;
create function public.delete_project_object(p_id uuid,p_project_id uuid)
returns boolean language sql security invoker set search_path = '' as $$ select private.delete_project_object(p_id,p_project_id); $$;

create function private.storage_cleanup_batch(p_limit integer default 100)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
    select * from private.storage_cleanup where not_before <= clock_timestamp()
      order by not_before,id limit greatest(1,least(coalesce(p_limit,100),100))
  ) q;
$$;
create function public.storage_cleanup_batch(p_limit integer default 100)
returns jsonb language sql security invoker set search_path = '' as $$ select private.storage_cleanup_batch(p_limit); $$;
create function private.storage_cleanup_done(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from private.storage_cleanup where id = p_id and not_before <= clock_timestamp();
  return found;
end;
$$;
create function public.storage_cleanup_done(p_id uuid)
returns boolean language sql security invoker set search_path = '' as $$ select private.storage_cleanup_done(p_id); $$;
create function private.storage_expire_objects(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with expired as (select id from public.project_objects where
    (status = 'ready' and retention_expires_at <= clock_timestamp()) or
    (status <> 'ready' and upload_expires_at + interval '60 seconds' <= clock_timestamp())
    order by created_at,id limit greatest(1,least(coalesce(p_limit,100),100)) for update skip locked)
  delete from public.project_objects p using expired e where p.id = e.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
create function public.storage_expire_objects(p_limit integer default 100)
returns integer language sql security invoker set search_path = '' as $$ select private.storage_expire_objects(p_limit); $$;

revoke all on function private.reserve_project_upload(uuid,text,text,bigint),public.reserve_project_upload(uuid,text,text,bigint),
  private.delete_project_object(uuid,uuid),public.delete_project_object(uuid,uuid)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function private.reserve_project_upload(uuid,text,text,bigint),public.reserve_project_upload(uuid,text,text,bigint),
  private.delete_project_object(uuid,uuid),public.delete_project_object(uuid,uuid) to authenticated;
revoke all on function private.storage_policy(),public.storage_policy(),
  private.configure_storage_policy(boolean,integer,integer,bigint,bigint,integer,text[]),public.configure_storage_policy(boolean,integer,integer,bigint,bigint,integer,text[]),
  private.storage_reserve_output(uuid,uuid,uuid,text,text,bigint),public.storage_reserve_output(uuid,uuid,uuid,text,text,bigint),
  private.storage_complete_object(uuid,uuid,uuid,text,bigint),public.storage_complete_object(uuid,uuid,uuid,text,bigint),
  private.storage_cleanup_batch(integer),public.storage_cleanup_batch(integer),private.storage_cleanup_done(uuid),public.storage_cleanup_done(uuid),
  private.storage_expire_objects(integer),public.storage_expire_objects(integer)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function private.storage_policy(),public.storage_policy(),
  private.configure_storage_policy(boolean,integer,integer,bigint,bigint,integer,text[]),public.configure_storage_policy(boolean,integer,integer,bigint,bigint,integer,text[]),
  private.storage_reserve_output(uuid,uuid,uuid,text,text,bigint),public.storage_reserve_output(uuid,uuid,uuid,text,text,bigint),
  private.storage_complete_object(uuid,uuid,uuid,text,bigint),public.storage_complete_object(uuid,uuid,uuid,text,bigint),
  private.storage_cleanup_batch(integer),public.storage_cleanup_batch(integer),private.storage_cleanup_done(uuid),public.storage_cleanup_done(uuid),
  private.storage_expire_objects(integer),public.storage_expire_objects(integer) to service_role;

comment on table public.project_objects is 'Private R2 upload/output authority. Only verified sealed bytes become ready; legacy uploads/outputs never authorize signing.';
comment on table private.storage_cleanup is 'Durable exact-key deletion outbox. Delayed past upload URL expiry to prevent resurrection; charged until acknowledged.';
notify pgrst, 'reload schema';
commit;
