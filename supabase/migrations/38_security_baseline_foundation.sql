-- ============================================================
-- 38_security_baseline_foundation.sql
-- Security baseline phase 1: additive foundations only.
--
-- This migration does not change existing RPC signatures, RLS policies,
-- Realtime publications, profile behavior, or the 123456 reset flow.
-- ============================================================

begin;

-- Fail instead of waiting long enough to disrupt an active application.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Preserve club membership history without reusing rejected as withdrawal.
-- Validate the broader constraint before replacing the existing one so an
-- unexpected row blocks the migration instead of being silently accepted.
alter table public.club_members
  add constraint club_members_status_check_v2
  check (status in ('pending', 'active', 'rejected', 'withdrawn'))
  not valid;

alter table public.club_members
  validate constraint club_members_status_check_v2;

alter table public.club_members
  drop constraint club_members_status_check;

alter table public.club_members
  rename constraint club_members_status_check_v2 to club_members_status_check;

comment on column public.club_members.status is
  'Club membership lifecycle: pending, active, rejected, withdrawn. withdrawn grants no club access.';

-- Successful security-sensitive operations will be recorded here by a
-- non-public internal helper in a later phase. Failed attempts are logged
-- outside the mutating transaction according to TECH-02.
create table public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique,
  action text not null,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  context_type text not null,
  club_id uuid,
  reason text not null,
  result text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint security_audit_events_action_check
    check (action in (
      'password_reset',
      'admin_club_withdrawal',
      'self_club_withdrawal',
      'platform_suspend',
      'platform_recover',
      'platform_terminate'
    )),
  constraint security_audit_events_context_check
    check (
      (context_type = 'club' and club_id is not null)
      or (context_type = 'platform' and club_id is null)
    ),
  constraint security_audit_events_reason_check
    check (char_length(trim(reason)) between 1 and 500),
  constraint security_audit_events_result_check
    check (result = 'success'),
  constraint security_audit_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.security_audit_events is
  'Append-only audit for successful security-sensitive account and membership operations.';

comment on column public.security_audit_events.correlation_id is
  'Idempotency and cross-log correlation identifier. One successful security action per value.';

comment on column public.security_audit_events.actor_user_id is
  'Historical actor identifier intentionally retained without a foreign key.';

comment on column public.security_audit_events.target_user_id is
  'Historical target identifier intentionally retained without a foreign key.';

comment on column public.security_audit_events.club_id is
  'Historical club context intentionally retained without a foreign key.';

comment on column public.security_audit_events.metadata is
  'Non-sensitive structured metadata only. Passwords, hashes, tokens, sessions, and prior real names are forbidden.';

create index security_audit_events_created_at_idx
  on public.security_audit_events (created_at desc);

create index security_audit_events_target_created_at_idx
  on public.security_audit_events (target_user_id, created_at desc);

create index security_audit_events_action_created_at_idx
  on public.security_audit_events (action, created_at desc);

alter table public.security_audit_events enable row level security;

-- No client RLS policy is created. Browser roles receive no direct access.
revoke all on table public.security_audit_events from public, anon, authenticated;
grant select on table public.security_audit_events to service_role;

commit;
