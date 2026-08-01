-- ============================================================
-- Read-only verification for 38_security_baseline_foundation.sql
-- Run only after the phase 1 migration has been applied to staging.
-- Every active statement in this file is SELECT-only.
-- ============================================================

-- 01. club_members status constraint
select
  n.nspname as table_schema,
  c.relname as table_name,
  con.conname as constraint_name,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'club_members'
  and con.conname = 'club_members_status_check';

-- 02. audit table columns
select
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'security_audit_events'
order by ordinal_position;

-- 03. audit RLS and policies
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.polname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname = 'security_audit_events'
group by n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity;

-- 04. audit table privileges for application roles
select
  grantee,
  privilege_type,
  is_grantable
from information_schema.table_privileges
where table_schema = 'public'
  and table_name = 'security_audit_events'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

-- 05. audit constraints and indexes
select
  'constraint' as object_type,
  con.conname as object_name,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'security_audit_events'
union all
select
  'index' as object_type,
  indexname as object_name,
  indexdef as definition
from pg_indexes
where schemaname = 'public'
  and tablename = 'security_audit_events'
order by object_type, object_name;
