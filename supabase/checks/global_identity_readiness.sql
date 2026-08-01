-- ============================================================
-- Global player identity readiness inventory
--
-- Run only in Supabase SQL Editor after confirming the target project.
-- Every active statement in this file is SELECT-only.
-- Results are aggregate metadata and must not include names, emails, UUIDs,
-- passwords, hashes, tokens, or sessions.
-- ============================================================

-- 01. Profile population by account/guest and active state.
select
  is_guest,
  is_active,
  count(*) as profile_count
from public.profiles
group by is_guest, is_active
order by is_guest, is_active;

-- 02. Auth/profile relationship summary without exposing identifiers.
select
  count(*) filter (where not p.is_guest and u.id is not null) as member_with_auth_count,
  count(*) filter (where not p.is_guest and u.id is null) as member_without_auth_count,
  count(*) filter (where p.is_guest and u.id is null) as guest_without_auth_count,
  count(*) filter (where p.is_guest and u.id is not null) as guest_with_auth_count
from public.profiles p
left join auth.users u on u.id = p.id;

-- 03. Membership-count distribution for profiles.
with membership_counts as (
  select
    p.id,
    count(cm.club_id) as membership_count,
    count(cm.club_id) filter (where cm.status = 'active') as active_membership_count
  from public.profiles p
  left join public.club_members cm on cm.user_id = p.id
  group by p.id
)
select
  membership_count,
  active_membership_count,
  count(*) as profile_count
from membership_counts
group by membership_count, active_membership_count
order by membership_count, active_membership_count;

-- 04. Guest profiles spanning multiple clubs.
with guest_memberships as (
  select
    p.id,
    count(distinct cm.club_id) as club_count
  from public.profiles p
  join public.club_members cm on cm.user_id = p.id
  where p.is_guest
  group by p.id
)
select
  count(*) filter (where club_count = 1) as single_club_guest_count,
  count(*) filter (where club_count > 1) as multi_club_guest_count,
  coalesce(max(club_count), 0) as max_clubs_for_one_guest
from guest_memberships;

-- 05. Same-club normalized-name candidate volume. Names are not returned.
with candidate_groups as (
  select
    cm.club_id,
    lower(trim(p.name)) as normalized_name,
    count(*) as profile_count,
    count(*) filter (where p.is_guest) as guest_count,
    count(*) filter (where not p.is_guest) as member_count
  from public.profiles p
  join public.club_members cm on cm.user_id = p.id
  where cm.status in ('pending', 'active')
  group by cm.club_id, lower(trim(p.name))
  having count(*) > 1
)
select
  count(*) as duplicate_name_group_count,
  coalesce(sum(profile_count), 0) as profiles_in_duplicate_name_groups,
  count(*) filter (where guest_count > 0 and member_count > 0) as guest_member_candidate_group_count,
  coalesce(max(profile_count), 0) as largest_candidate_group_size
from candidate_groups;

-- 06. Guest/member candidate quality by award and affiliation, aggregate only.
with candidate_pairs as (
  select
    g.id as guest_id,
    m.id as member_id,
    g.award_level = m.award_level as same_award,
    lower(trim(coalesce(g.affiliation, ''))) =
      lower(trim(coalesce(m.affiliation, ''))) as same_affiliation
  from public.profiles g
  join public.club_members gcm on gcm.user_id = g.id
  join public.club_members mcm
    on mcm.club_id = gcm.club_id
   and mcm.user_id <> g.id
  join public.profiles m on m.id = mcm.user_id
  where g.is_guest
    and not m.is_guest
    and gcm.status in ('pending', 'active')
    and mcm.status in ('pending', 'active')
    and lower(trim(g.name)) = lower(trim(m.name))
)
select
  count(*) as guest_member_pair_count,
  count(*) filter (where same_award) as same_award_pair_count,
  count(*) filter (where same_affiliation) as same_affiliation_pair_count,
  count(*) filter (where same_award and same_affiliation) as exact_metadata_pair_count
from candidate_pairs;

-- 07. Profile reference volume that must remain unchanged during backfill.
select 'match_players.user_id' as reference_name, count(*) as row_count
from public.match_players
union all
select 'match_players.registered_by', count(*)
from public.match_players
union all
select 'score_confirmations.user_id', count(*)
from public.score_confirmations
union all
select 'tournament_entries.user_id', count(*)
from public.tournament_entries
union all
select 'tournament_entries.created_by', count(*)
from public.tournament_entries
union all
select 'match_bets.user_id', count(*)
from public.match_bets
order by reference_name;

-- 08. Current profile-related trigger/function contract metadata.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  r.rolname as owner,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  p.proacl as function_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname in (
    'handle_new_user',
    'transfer_profile_refs',
    'create_guest_profile'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 09. Trigger attached to auth.users for new-user profile creation.
select
  event_object_schema,
  event_object_table,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users'
order by trigger_name, event_manipulation;

-- 10. Detect whether global identity objects already exist.
select
  to_regclass('public.global_players') is not null as global_players_exists,
  to_regclass('public.player_aliases') is not null as player_aliases_exists,
  to_regclass('public.player_external_ids') is not null as player_external_ids_exists,
  to_regclass('public.player_identity_claims') is not null as player_identity_claims_exists,
  to_regclass('public.player_identity_events') is not null as player_identity_events_exists,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'global_player_id'
  ) as profiles_global_player_id_exists;
