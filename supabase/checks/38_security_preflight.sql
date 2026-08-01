-- READ-ONLY PREFLIGHT. THIS FILE MUST NOT MODIFY DATABASE OBJECTS OR DATA.
--
-- Run manually in the target Supabase SQL Editor and export every result set.
-- This script reads PostgreSQL catalogs and migration metadata only.
-- It does not invoke any application function/RPC and does not read user rows,
-- auth credentials, passwords, tokens, or application data.

-- 1. Server and current namespace identity.
select
  current_database() as database_name,
  current_schema as current_schema,
  current_user as current_role,
  session_user as session_role,
  current_setting('server_version') as server_version;

select
  n.nspname as schema_name,
  pg_get_userbyid(n.nspowner) as schema_owner,
  n.nspacl as schema_acl
from pg_catalog.pg_namespace n
where n.nspname in ('public', 'auth', 'extensions', 'supabase_migrations')
order by n.nspname;

-- 2. Migration metadata. This intentionally reads version identifiers only.
-- If this relation is absent, preserve the error as evidence of a different
-- migration workflow; do not alter the database to make this query pass.
select
  version
from supabase_migrations.schema_migrations
order by version;

-- 3. Related table/column inventory (metadata only).
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.ordinal_position,
  c.data_type,
  c.udt_schema,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'profiles', 'clubs', 'club_members', 'matches', 'match_players',
    'score_confirmations', 'match_audit_logs', 'app_settings', 'club_settings'
  )
order by c.table_name, c.ordinal_position;

-- 4. Function signature, owner, SECURITY DEFINER flag, search_path/config and ACL.
with target_functions(function_name) as (
  values
    ('admin_update_user'),
    ('admin_reset_user_password'),
    ('admin_remove_user'),
    ('register_player'),
    ('remove_player'),
    ('start_match'),
    ('submit_score'),
    ('link_match_youtube'),
    ('unlink_match_youtube'),
    ('transfer_profile_refs'),
    ('internal_add_player'),
    ('log_match_audit'),
    ('get_player_monthly_trend'),
    ('get_player_recent_matches'),
    ('handle_new_user'),
    ('handle_auth_user_deleted'),
    ('prevent_privilege_change'),
    ('sync_match_ready'),
    ('is_platform_admin'),
    ('is_any_club_admin'),
    ('is_club_admin_or_sub'),
    ('is_active_club_member'),
    ('assert_active_caller'),
    ('assert_club_member'),
    ('assert_match_club_member')
)
select
  n.nspname as function_schema,
  p.proname as function_name,
  p.oid as function_oid,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  l.lanname as language_name,
  pg_get_userbyid(p.proowner) as function_owner,
  p.prosecdef as security_definer,
  p.provolatile as volatility_code,
  p.proconfig,
  p.proacl
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
join target_functions t on t.function_name = p.proname
where n.nspname = 'public'
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 5. Expanded function ACL, including default PUBLIC EXECUTE when proacl is null.
with target_functions(function_name) as (
  values
    ('admin_update_user'), ('admin_reset_user_password'), ('admin_remove_user'),
    ('register_player'), ('remove_player'), ('start_match'), ('submit_score'),
    ('link_match_youtube'), ('unlink_match_youtube'), ('transfer_profile_refs'),
    ('internal_add_player'), ('log_match_audit'), ('get_player_monthly_trend'),
    ('get_player_recent_matches'), ('handle_new_user'),
    ('handle_auth_user_deleted'), ('prevent_privilege_change'), ('sync_match_ready')
), function_acl as (
  select
    p.oid,
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).*
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join target_functions t on t.function_name = p.proname
  where n.nspname = 'public'
)
select
  nspname as function_schema,
  proname as function_name,
  identity_arguments,
  case when grantor = 0 then 'PUBLIC' else pg_get_userbyid(grantor) end as grantor,
  case when grantee = 0 then 'PUBLIC' else pg_get_userbyid(grantee) end as grantee,
  privilege_type,
  is_grantable
from function_acl
where privilege_type = 'EXECUTE'
order by proname, identity_arguments, grantee;

-- 6. Effective EXECUTE check for the API roles. These are catalog privilege
-- checks only; no target application function is invoked.
with target_functions(function_name) as (
  values
    ('admin_update_user'), ('admin_reset_user_password'), ('admin_remove_user'),
    ('register_player'), ('remove_player'), ('start_match'), ('submit_score'),
    ('link_match_youtube'), ('unlink_match_youtube'), ('transfer_profile_refs'),
    ('internal_add_player'), ('log_match_audit'), ('get_player_monthly_trend'),
    ('get_player_recent_matches'), ('handle_new_user'),
    ('handle_auth_user_deleted'), ('prevent_privilege_change'), ('sync_match_ready')
), target_roles(role_name) as (
  values ('anon'), ('authenticated')
)
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  r.role_name,
  case
    when to_regrole(r.role_name) is null then null
    else has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  end as has_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join target_functions t on t.function_name = p.proname
cross join target_roles r
where n.nspname = 'public'
order by p.proname, identity_arguments, r.role_name;

-- 7. Exact function definitions for repository-to-database drift comparison.
-- Review exported output as privileged operational metadata.
with target_functions(function_name) as (
  values
    ('admin_update_user'), ('admin_reset_user_password'), ('admin_remove_user'),
    ('register_player'), ('remove_player'), ('start_match'), ('submit_score'),
    ('link_match_youtube'), ('unlink_match_youtube'), ('transfer_profile_refs'),
    ('internal_add_player'), ('log_match_audit'), ('get_player_monthly_trend'),
    ('get_player_recent_matches'), ('handle_new_user'),
    ('handle_auth_user_deleted'), ('prevent_privilege_change'), ('sync_match_ready')
)
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join target_functions t on t.function_name = p.proname
where n.nspname = 'public'
order by p.proname, identity_arguments;

-- 8. Trigger inventory and function attachment.
select
  tn.nspname as table_schema,
  tc.relname as table_name,
  t.tgname as trigger_name,
  t.tgenabled as enabled_code,
  fn.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as function_arguments,
  pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class tc on tc.oid = t.tgrelid
join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
join pg_catalog.pg_namespace fn on fn.oid = p.pronamespace
where not t.tgisinternal
  and (
    (tn.nspname = 'public' and tc.relname in ('profiles', 'match_players', 'matches'))
    or (tn.nspname = 'auth' and tc.relname = 'users')
    or p.proname in (
      'handle_new_user', 'handle_auth_user_deleted',
      'prevent_privilege_change', 'sync_match_ready'
    )
  )
order by table_schema, table_name, trigger_name;

-- 9. RLS enablement and exact policies.
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  c.relreplident as replica_identity_code
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'matches', 'match_players', 'score_confirmations')
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'matches', 'match_players', 'score_confirmations')
order by tablename, policyname;

-- 10. Table grants for relevant API-facing tables.
select
  grantor,
  grantee,
  table_schema,
  table_name,
  privilege_type,
  is_grantable
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'matches', 'match_players', 'score_confirmations')
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- 11. Realtime publication membership.
select
  p.pubname as publication_name,
  p.puballtables,
  p.pubinsert,
  p.pubupdate,
  p.pubdelete,
  p.pubtruncate
from pg_catalog.pg_publication p
order by p.pubname;

select
  schemaname,
  tablename,
  pubname
from pg_catalog.pg_publication_tables
where schemaname = 'public'
  and tablename in ('profiles', 'matches', 'match_players', 'score_confirmations')
order by pubname, tablename;

-- 12. Constraints required for signature/body and RLS impact comparison.
select
  n.nspname as table_schema,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'clubs', 'club_members', 'matches',
    'match_players', 'score_confirmations'
  )
order by c.relname, con.conname;

-- 13. Enum labels used by the reviewed function signatures and policies.
select
  n.nspname as enum_schema,
  t.typname as enum_name,
  e.enumsortorder,
  e.enumlabel
from pg_catalog.pg_type t
join pg_catalog.pg_namespace n on n.oid = t.typnamespace
join pg_catalog.pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
  and t.typname in (
    'user_role', 'award_level', 'match_status',
    'player_position', 'team_side', 'match_type'
  )
order by t.typname, e.enumsortorder;
