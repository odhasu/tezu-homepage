begin;

-- Personal ownership. Identity and project relationships are immutable.
create table public.accounts (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 120),
  created_at timestamptz not null default clock_timestamp()
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, owner_id)
);
create index projects_owner_idx on public.projects (owner_id);
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null default auth.uid(),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  label text not null default '' check (length(label) <= 160),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, project_id, owner_id),
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade
);
create index jobs_project_owner_idx on public.jobs (project_id, owner_id);
create index jobs_owner_idx on public.jobs (owner_id);
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null default auth.uid(),
  filename text not null check (length(btrim(filename)) between 1 and 255),
  content_type text not null check (length(content_type) between 1 and 127),
  byte_size bigint not null check (byte_size between 0 and 9007199254740991),
  status text not null default 'pending' check (status in ('pending','ready','failed')),
  object_key text generated always as ('owners/' || owner_id::text || '/projects/' || project_id::text || '/uploads/' || id::text) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade
);
create index uploads_project_owner_idx on public.uploads (project_id, owner_id);
create index uploads_owner_idx on public.uploads (owner_id);
create table public.outputs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null,
  job_id uuid not null,
  filename text not null check (length(btrim(filename)) between 1 and 255),
  content_type text not null check (length(content_type) between 1 and 127),
  byte_size bigint not null check (byte_size between 0 and 9007199254740991),
  object_key text generated always as ('owners/' || owner_id::text || '/projects/' || project_id::text || '/outputs/' || id::text) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade,
  foreign key (job_id, project_id, owner_id) references public.jobs(id, project_id, owner_id) on delete cascade
);
create index outputs_project_owner_idx on public.outputs (project_id, owner_id);
create index outputs_job_project_owner_idx on public.outputs (job_id, project_id, owner_id);
create index outputs_owner_idx on public.outputs (owner_id);

create or replace function private.enforce_record_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  identity_column text;
begin
  foreach identity_column in array tg_argv loop
    if to_jsonb(new) -> identity_column is distinct from to_jsonb(old) -> identity_column then
      raise exception 'Record identity is immutable' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.enforce_record_identity() from public, anon, authenticated, service_role;
create trigger accounts_immutable_identity before update on public.accounts for each row
  execute function private.enforce_record_identity('user_id','created_at');
create trigger projects_immutable_identity before update on public.projects for each row
  execute function private.enforce_record_identity('id','owner_id','created_at');
create trigger jobs_immutable_identity before update on public.jobs for each row
  execute function private.enforce_record_identity('id','project_id','owner_id','created_at');
create trigger uploads_immutable_identity before update on public.uploads for each row
  execute function private.enforce_record_identity('id','project_id','owner_id','created_at');
create trigger outputs_immutable_identity before update on public.outputs for each row
  execute function private.enforce_record_identity('id','project_id','owner_id','job_id','created_at');
drop trigger if exists video_credit_accounts_immutable_identity on public.video_credit_accounts;
create trigger video_credit_accounts_immutable_identity before update on public.video_credit_accounts for each row
  execute function private.enforce_record_identity('user_id','created_at');

create function private.initialize_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.initialize_account() from public, anon, authenticated, service_role, supabase_auth_admin;
create trigger initialize_account after insert on auth.users for each row
  execute function private.initialize_account();
insert into public.accounts (user_id) select id from auth.users on conflict (user_id) do nothing;

alter table public.accounts enable row level security;
alter table public.accounts force row level security;
revoke all on public.accounts from public, anon, authenticated, service_role;
grant select on public.accounts to authenticated, service_role;
grant delete on public.accounts to authenticated;
create policy accounts_owner_select on public.accounts for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_verified_session()));
create policy accounts_owner_insert on public.accounts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_verified_session()));
create policy accounts_owner_update on public.accounts for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_verified_session()))
  with check (user_id = (select auth.uid()) and (select private.is_verified_session()));
create policy accounts_owner_delete on public.accounts for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_verified_session()));

alter table public.projects enable row level security;
alter table public.projects force row level security;
revoke all on public.projects from public, anon, authenticated, service_role;
grant select on public.projects to authenticated, service_role;
grant delete on public.projects to authenticated;
create policy projects_owner_select on public.projects for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()));
create policy projects_owner_insert on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()));
create policy projects_owner_update on public.projects for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()))
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()));
create policy projects_owner_delete on public.projects for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()));

alter table public.jobs enable row level security;
alter table public.jobs force row level security;
revoke all on public.jobs from public, anon, authenticated, service_role;
grant select on public.jobs to authenticated, service_role;
grant delete on public.jobs to authenticated;
create policy jobs_owner_select on public.jobs for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = jobs.project_id
      and p.owner_id = jobs.owner_id and p.owner_id = (select auth.uid())));
create policy jobs_owner_insert on public.jobs for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = jobs.project_id
      and p.owner_id = jobs.owner_id and p.owner_id = (select auth.uid())));
create policy jobs_owner_update on public.jobs for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = jobs.project_id
      and p.owner_id = jobs.owner_id and p.owner_id = (select auth.uid())))
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = jobs.project_id
      and p.owner_id = jobs.owner_id and p.owner_id = (select auth.uid())));
create policy jobs_owner_delete on public.jobs for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = jobs.project_id
      and p.owner_id = jobs.owner_id and p.owner_id = (select auth.uid())));

alter table public.uploads enable row level security;
alter table public.uploads force row level security;
revoke all on public.uploads from public, anon, authenticated, service_role;
grant select on public.uploads to authenticated, service_role;
grant delete on public.uploads to authenticated;
create policy uploads_owner_select on public.uploads for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = uploads.project_id
      and p.owner_id = uploads.owner_id and p.owner_id = (select auth.uid())));
create policy uploads_owner_insert on public.uploads for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = uploads.project_id
      and p.owner_id = uploads.owner_id and p.owner_id = (select auth.uid())));
create policy uploads_owner_update on public.uploads for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = uploads.project_id
      and p.owner_id = uploads.owner_id and p.owner_id = (select auth.uid())))
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = uploads.project_id
      and p.owner_id = uploads.owner_id and p.owner_id = (select auth.uid())));
create policy uploads_owner_delete on public.uploads for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = uploads.project_id
      and p.owner_id = uploads.owner_id and p.owner_id = (select auth.uid())));

alter table public.outputs enable row level security;
alter table public.outputs force row level security;
revoke all on public.outputs from public, anon, authenticated, service_role;
grant select on public.outputs to authenticated, service_role;
grant delete on public.outputs to authenticated;
create policy outputs_owner_select on public.outputs for select to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = outputs.project_id
      and p.owner_id = outputs.owner_id and p.owner_id = (select auth.uid())) and exists (
    select 1 from public.jobs j where j.id = outputs.job_id
      and j.project_id = outputs.project_id and j.owner_id = outputs.owner_id));
create policy outputs_owner_update on public.outputs for update to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = outputs.project_id
      and p.owner_id = outputs.owner_id and p.owner_id = (select auth.uid())) and exists (
    select 1 from public.jobs j where j.id = outputs.job_id
      and j.project_id = outputs.project_id and j.owner_id = outputs.owner_id))
  with check (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = outputs.project_id
      and p.owner_id = outputs.owner_id and p.owner_id = (select auth.uid())) and exists (
    select 1 from public.jobs j where j.id = outputs.job_id
      and j.project_id = outputs.project_id and j.owner_id = outputs.owner_id));
create policy outputs_owner_delete on public.outputs for delete to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_verified_session()) and exists (
    select 1 from public.projects p where p.id = outputs.project_id
      and p.owner_id = outputs.owner_id and p.owner_id = (select auth.uid())) and exists (
    select 1 from public.jobs j where j.id = outputs.job_id
      and j.project_id = outputs.project_id and j.owner_id = outputs.owner_id));

grant insert (user_id, display_name) on public.accounts to authenticated;
grant update (display_name) on public.accounts to authenticated;
grant insert (id, owner_id, name) on public.projects to authenticated;
grant update (name) on public.projects to authenticated;
grant insert (id, project_id, owner_id, label) on public.jobs to authenticated;
grant update (label) on public.jobs to authenticated;
grant insert (id, project_id, owner_id, filename, content_type, byte_size) on public.uploads to authenticated;
grant update (filename) on public.uploads to authenticated;
grant update (filename) on public.outputs to authenticated;

-- Service credentials alone never authorize a user-facing job request. These
-- narrow capabilities are for signature-verified server workers only; no HTTP
-- worker/webhook endpoint is enabled by this migration.
create function private.advance_owned_job(p_job_id uuid, p_project_id uuid, p_owner_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('running','succeeded','failed','cancelled') then
    raise exception 'Invalid job transition' using errcode = '22023';
  end if;
  update public.jobs set status = p_status
    where id = p_job_id and project_id = p_project_id and owner_id = p_owner_id
      and ((status = 'queued' and p_status in ('running','cancelled'))
        or (status = 'running' and p_status in ('succeeded','failed','cancelled')))
      and exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id);
  return found;
end;
$$;
create function public.advance_owned_job(p_job_id uuid, p_project_id uuid, p_owner_id uuid, p_status text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.advance_owned_job(p_job_id, p_project_id, p_owner_id, p_status);
$$;
create function private.record_owned_output(
  p_job_id uuid, p_project_id uuid, p_owner_id uuid, p_filename text, p_content_type text, p_byte_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs%rowtype;
  v_output_id uuid;
begin
  select * into v_job from public.jobs
    where id = p_job_id and project_id = p_project_id and owner_id = p_owner_id for update;
  if not found or v_job.status <> 'running' or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id) then
    raise exception 'Job is not authorized for output recording' using errcode = '42501';
  end if;
  insert into public.outputs (job_id, project_id, owner_id, filename, content_type, byte_size)
    values (p_job_id, p_project_id, p_owner_id, p_filename, p_content_type, p_byte_size)
    returning id into v_output_id;
  return v_output_id;
end;
$$;
create function public.record_owned_output(
  p_job_id uuid, p_project_id uuid, p_owner_id uuid, p_filename text, p_content_type text, p_byte_size bigint)
returns uuid language sql security invoker set search_path = '' as $$
  select private.record_owned_output(p_job_id, p_project_id, p_owner_id, p_filename, p_content_type, p_byte_size);
$$;
revoke all on function private.advance_owned_job(uuid,uuid,uuid,text), public.advance_owned_job(uuid,uuid,uuid,text),
  private.record_owned_output(uuid,uuid,uuid,text,text,bigint), public.record_owned_output(uuid,uuid,uuid,text,text,bigint)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function private.advance_owned_job(uuid,uuid,uuid,text), public.advance_owned_job(uuid,uuid,uuid,text),
  private.record_owned_output(uuid,uuid,uuid,text,text,bigint), public.record_owned_output(uuid,uuid,uuid,text,text,bigint)
  to service_role;

comment on table public.accounts is 'Personal account profile only; no billing, role, or credit authority comes from user metadata.';
comment on table public.uploads is 'Metadata reservation only. Pending rows do not prove an R2 upload exists or is safe.';
comment on table public.outputs is 'Worker-created metadata, bound to an immutable owned job and project. No public media URL is stored.';

notify pgrst, 'reload schema';
commit;
