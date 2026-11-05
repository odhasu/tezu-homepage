-- Stop storage-enabled traffic and workers first. Archive authorized data and
-- finish exact-key R2 deletion before rollback; never bypass this guard.
begin;
lock table private.storage_policy,public.project_objects,private.storage_cleanup in access exclusive mode;
do $$ begin
  if exists (select 1 from public.project_objects) or exists (select 1 from private.storage_cleanup) then
    raise exception 'Rollback refused: private objects or cleanup records remain' using errcode = '55000';
  end if;
end; $$;
drop function public.storage_expire_objects(integer);
drop function private.storage_expire_objects(integer);
drop function public.storage_cleanup_done(uuid);
drop function private.storage_cleanup_done(uuid);
drop function public.storage_cleanup_batch(integer);
drop function private.storage_cleanup_batch(integer);
drop function public.delete_project_object(uuid,uuid);
drop function private.delete_project_object(uuid,uuid);
drop function public.storage_complete_object(uuid,uuid,uuid,text,bigint);
drop function private.storage_complete_object(uuid,uuid,uuid,text,bigint);
drop function public.storage_reserve_output(uuid,uuid,uuid,text,text,bigint);
drop function private.storage_reserve_output(uuid,uuid,uuid,text,text,bigint);
drop function public.reserve_project_upload(uuid,text,text,bigint);
drop function private.reserve_project_upload(uuid,text,text,bigint);
drop function private.reserve_storage_object(uuid,uuid,uuid,text,text,bigint);
drop function public.configure_storage_policy(boolean,integer,integer,bigint,bigint,integer,text[]);
drop function private.configure_storage_policy(boolean,integer,integer,bigint,bigint,integer,text[]);
drop function public.storage_policy();
drop function private.storage_policy();
drop table public.project_objects;
drop function private.queue_storage_cleanup();
drop table private.storage_cleanup;
drop table private.storage_policy;
notify pgrst,'reload schema';
commit;
