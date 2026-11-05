-- Stop ownership-enabled application traffic first. This rollback intentionally
-- refuses to discard account or project data. Export/archive records and remove
-- only authorized staging records before retrying. Never disable RLS to roll back.
begin;
lock table public.accounts, public.projects, public.jobs, public.uploads, public.outputs in access exclusive mode;
do $$
begin
  if exists (select 1 from public.accounts) or exists (select 1 from public.projects)
    or exists (select 1 from public.jobs) or exists (select 1 from public.uploads)
    or exists (select 1 from public.outputs) then
    raise exception 'Rollback refused: ownership tables contain data' using errcode = '55000';
  end if;
end;
$$;
drop function public.record_owned_output(uuid,uuid,uuid,text,text,bigint);
drop function private.record_owned_output(uuid,uuid,uuid,text,text,bigint);
drop function public.advance_owned_job(uuid,uuid,uuid,text);
drop function private.advance_owned_job(uuid,uuid,uuid,text);
drop trigger initialize_account on auth.users;
drop function private.initialize_account();
drop table public.outputs;
drop table public.uploads;
drop table public.jobs;
drop table public.projects;
drop table public.accounts;
-- Keep credit-account identity protection in place when removing this feature.
-- Its trigger and private.enforce_record_identity() remain intentionally.
commit;
