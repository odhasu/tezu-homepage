-- Read-only catalog audit. This statement neither changes grants nor runs user functions.
-- The caller must fail its check when audit.passed is false; this query reports all
-- findings together instead of raising an exception that hides the JSON result.
-- public is the explicitly reviewed exposure scope, not a discovery of PostgREST
-- configuration. Confirm Data API exposed schemas separately and extend this scope.
-- Project policy requires an empty search_path on private SECURITY DEFINER code.
with
scope as (
  select array['public']::name[] as exposed_schemas
),
client_roles as (
  select oid, rolname, rolsuper, rolbypassrls
  from pg_catalog.pg_roles
  where rolname in ('anon', 'authenticated')
),
relations as (
  select c.oid, n.nspname as schema_name, c.relname, c.relkind,
    c.relowner, c.relrowsecurity, c.relforcerowsecurity,
    exists (
      select 1 from pg_catalog.pg_options_to_table(c.reloptions) o
      where o.option_name = 'security_invoker'
        and o.option_value in ('true', 'on', '1')
    ) as security_invoker,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.rolname,
        'schema_usage', pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE'),
        'select', pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT'),
        'insert', pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT'),
        'update', pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE'),
        'delete', pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE')
      ) order by r.rolname)
      from client_roles r
    ), '[]'::jsonb) as client_access,
    exists (
      select 1 from client_roles r
      where pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE')
        and (pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
          or pg_catalog.has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE'))
    ) as client_accessible
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join scope s
  where n.nspname = any(s.exposed_schemas)
    and c.relkind in ('r', 'p', 'f', 'v', 'm')
),
functions as (
  select p.oid, n.nspname as schema_name, p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
    p.prosecdef as security_definer, p.proconfig,
    exists (
      select 1 from unnest(p.proconfig) setting
      where setting in ('search_path=', 'search_path=""')
    ) as empty_search_path,
    exists (
      select 1
      from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_execute,
    coalesce((
      select jsonb_agg(r.rolname order by r.rolname)
      from pg_catalog.pg_roles r
      where r.rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin')
        and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
    ), '[]'::jsonb) as execute_roles,
    exists (
      select 1 from client_roles r
      where r.rolname = 'anon'
        and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
    ) as anon_execute
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join scope s
  where n.nspname = any(s.exposed_schemas) or n.nspname = 'private'
),
violations as (
  select 'rls_disabled'::text as code,
    format('%I.%I', t.schema_name, t.relname) as object_name,
    jsonb_build_object('client_accessible', t.client_accessible,
      'relation_kind', t.relkind) as details
  from relations t
  where t.relkind in ('r', 'p', 'f') and not t.relrowsecurity
  union all
  select 'unsafe_accessible_view', format('%I.%I', t.schema_name, t.relname),
    jsonb_build_object('relation_kind', t.relkind, 'security_invoker', t.security_invoker)
  from relations t
  where t.client_accessible and
    (t.relkind = 'm' or (t.relkind = 'v' and not t.security_invoker))
  union all
  select 'client_bypassrls_role', r.rolname::text,
    jsonb_build_object('superuser', r.rolsuper, 'bypassrls', r.rolbypassrls)
  from client_roles r where r.rolsuper or r.rolbypassrls
  union all
  select 'client_owner_bypasses_rls', format('%I.%I', t.schema_name, t.relname),
    jsonb_build_object('role', r.rolname)
  from relations t cross join client_roles r
  where t.relkind in ('r', 'p') and not t.relforcerowsecurity
    and pg_catalog.pg_has_role(r.oid, t.relowner, 'USAGE')
  union all
  select 'unsafe_client_table_grant', format('%I.%I', t.schema_name, t.relname),
    jsonb_build_object('role', r.rolname, 'privilege', privilege)
  from relations t cross join client_roles r
  cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
  where t.relkind in ('r', 'p', 'f')
    and (pg_catalog.has_table_privilege(r.oid, t.oid, privilege)
      or (privilege = 'REFERENCES'
        and pg_catalog.has_any_column_privilege(r.oid, t.oid, 'REFERENCES')))
  union all
  select 'exposed_security_definer',
    format('%I.%I(%s)', f.schema_name, f.proname, f.arguments),
    jsonb_build_object('execute_roles', f.execute_roles)
  from functions f cross join scope s
  where f.schema_name = any(s.exposed_schemas) and f.security_definer
  union all
  select 'unrestricted_function_execute',
    format('%I.%I(%s)', f.schema_name, f.proname, f.arguments),
    jsonb_build_object('public_execute', f.public_execute, 'anon_execute', f.anon_execute)
  from functions f cross join scope s
  where (f.schema_name = any(s.exposed_schemas)
      or (f.schema_name = 'private' and f.security_definer))
    and (f.public_execute or f.anon_execute)
  union all
  select 'unapproved_definer_search_path',
    format('%I.%I(%s)', f.schema_name, f.proname, f.arguments),
    jsonb_build_object('required', 'empty search_path')
  from functions f
  where f.schema_name = 'private' and f.security_definer and not f.empty_search_path
  union all
  select 'missing_client_role', expected.role_name, '{}'::jsonb
  from (values ('anon'), ('authenticated')) expected(role_name)
  where not exists (select 1 from client_roles r where r.rolname = expected.role_name)
)
select jsonb_build_object(
  'passed', not exists (select 1 from violations),
  'violation_count', (select count(*) from violations),
  'exposed_schemas_reviewed', (select to_jsonb(exposed_schemas) from scope),
  'violations', coalesce((
    select jsonb_agg(jsonb_build_object('code', code, 'object', object_name, 'details', details)
      order by code, object_name, details::text) from violations
  ), '[]'::jsonb),
  'tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'name', t.relname, 'kind', t.relkind,
      'rls_enabled', t.relrowsecurity, 'rls_forced', t.relforcerowsecurity,
      'client_access', t.client_access
    ) order by t.schema_name, t.relname)
    from relations t where t.relkind in ('r', 'p', 'f')
  ), '[]'::jsonb),
  'views', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'name', t.relname, 'kind', t.relkind,
      'security_invoker', t.security_invoker, 'client_accessible', t.client_accessible
    ) order by t.schema_name, t.relname)
    from relations t where t.relkind in ('v', 'm')
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', f.schema_name, 'name', f.proname, 'arguments', f.arguments,
      'security_definer', f.security_definer, 'empty_search_path', f.empty_search_path,
      'public_execute', f.public_execute, 'execute_roles', f.execute_roles
    ) order by f.schema_name, f.proname, f.arguments) from functions f
  ), '[]'::jsonb),
  'limitations', jsonb_build_array(
    'Confirm PostgREST/Data API exposed schemas outside this catalog audit; public is the reviewed scope.',
    'A passing catalog audit does not prove policy predicates, function bodies, triggers, webhooks, or application authorization are correct.',
    'Run real two-identity Data API and Route Handler tests in staging; catalog checks do not prove production security.',
    'Service-role and Auth-administrator EXECUTE grants are reported for review, not automatically rejected.',
    'This query returns diagnostics only; the caller must reject a result with passed=false.'
  )
) as audit;
