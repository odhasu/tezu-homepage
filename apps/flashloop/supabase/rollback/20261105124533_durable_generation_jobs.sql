-- Stop job-enabled traffic, Inngest workers and provider callback delivery first.
-- Never remove replay evidence, provider bindings or financial holds to satisfy
-- this guard. Populated deployments require a reviewed forward recovery plan.
begin;
lock table private.generation_policy,private.generation_requests,private.generation_reservations,
  private.generation_active_jobs,private.generation_global_days,private.generation_account_days,
  private.job_dispatch_outbox,private.provider_job_bindings,private.provider_callback_events in access exclusive mode;
do $$ begin
  if exists(select 1 from private.generation_policy where generation_enabled) then
    raise exception 'Rollback refused: generation must be disabled first' using errcode='55000';
  end if;
  if exists(select 1 from private.provider_callback_events) then
    raise exception 'Rollback refused: callback replay receipts remain' using errcode='55000';
  end if;
  if exists(select 1 from private.provider_job_bindings) then
    raise exception 'Rollback refused: provider job bindings remain' using errcode='55000';
  end if;
  if exists(select 1 from private.job_dispatch_outbox) then
    raise exception 'Rollback refused: durable dispatch records remain' using errcode='55000';
  end if;
  if exists(select 1 from private.generation_reservations where status in ('reserved','dispatching','dispatched','unknown','reconciliation_required')
      or held_cost_micros<>0)
    or exists(select 1 from private.generation_active_jobs where active_jobs<>0)
    or exists(select 1 from private.generation_global_days where reserved_micros<>0)
    or exists(select 1 from private.generation_account_days where reserved_micros<>0) then
    raise exception 'Rollback refused: outstanding generation obligations remain' using errcode='55000';
  end if;
end; $$;

drop function public.apply_generation_callback(text,text,text,text,bigint,text);
drop function private.apply_generation_callback(text,text,text,text,bigint,text);
drop function public.generation_bind_reconciled_job(uuid,text,text);
drop function private.generation_bind_reconciled_job(uuid,text,text);
drop function public.generation_reconciliation_batch(integer);
drop function private.generation_reconciliation_batch(integer);
drop function public.generation_dispatch_sent(uuid);
drop function private.generation_dispatch_sent(uuid);
drop function public.generation_dispatch_batch(integer);
drop function private.generation_dispatch_batch(integer);
drop function public.generation_job_context(uuid);
drop function private.generation_job_context(uuid);
drop trigger generation_dispatch_enqueued on private.generation_reservations;
drop function private.enqueue_generation_dispatch();
drop trigger generation_provider_job_bound on private.generation_reservations;
drop function private.bind_generation_provider_job();
drop table private.provider_callback_events;
drop table private.provider_job_bindings;
drop table private.job_dispatch_outbox;

-- Restore the historical transition implementation and its original service-only
-- capability. Existing entitlement/public wrappers and financial tables survive.
drop function private.transition_generation(uuid,text,text,text,bigint,text);
alter function private.transition_generation_base(uuid,text,text,text,bigint,text) rename to transition_generation;
revoke all on function private.transition_generation(uuid,text,text,text,bigint,text)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function private.transition_generation(uuid,text,text,text,bigint,text) to service_role;
notify pgrst,'reload schema';
commit;
