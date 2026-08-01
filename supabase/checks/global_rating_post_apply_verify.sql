-- ============================================================
-- Global rating foundation post-apply verification.
-- Every active statement is SELECT-only.
-- ============================================================

-- 01. Required tables.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'security_audit_events', 'global_players', 'player_aliases',
    'player_external_ids', 'player_identity_claims', 'player_identity_events',
    'identity_backfill_runs', 'rating_models', 'rating_model_versions',
    'rating_pools', 'rating_runs', 'rating_run_matches',
    'player_ratings', 'player_rating_history'
  )
order by table_name;

-- 02. Function security/search_path/signatures.
select p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer, p.proconfig as function_config, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_update_user_v2', 'admin_reset_user_password_v2',
    'admin_withdraw_club_member_v2', 'self_withdraw_club_v2',
    'merge_global_players_v2', 'split_profile_identity_v2',
    'review_identity_claim_v2', 'run_shadow_team_elo_v1',
    'get_shadow_rating_summary_v1'
  )
order by p.proname, identity_arguments;

-- 03. Feature flags remain OFF.
select key, value
from public.app_settings
where key = 'global_identity_guest_claim_enabled';

-- 04. Identity mapping completeness and orphan check.
select
  count(*) as profile_count,
  count(global_player_id) as linked_profile_count,
  count(*) filter (where global_player_id is null) as unlinked_profile_count,
  count(*) filter (where global_player_id is not null and gp.id is null) as orphan_count
from public.profiles p
left join public.global_players gp on gp.id = p.global_player_id;

-- 05. Latest backfill evidence.
select id, status, profile_count_before, unlinked_count_before,
  created_global_player_count, linked_profile_count, orphan_count_after,
  reference_counts_before = reference_counts_after as protected_counts_unchanged,
  mapping_checksum, started_at, completed_at
from public.identity_backfill_runs
order by started_at desc limit 5;

-- 06. Rating run reproducibility metadata.
select id, pool_id, model_version_id, cutoff_at, status, input_hash,
  identity_mapping_hash, included_match_count, excluded_match_count,
  started_at, completed_at
from public.rating_runs
order by started_at desc limit 20;

-- 07. Duplicate completed hashes should be absent when the engine reuses a run.
select pool_id, model_version_id, input_hash, count(*) as completed_run_count
from public.rating_runs
where status = 'completed'
group by pool_id, model_version_id, input_hash
having count(*) > 1;

-- 08. Current/history consistency for the latest materialized run.
select count(*) as inconsistent_current_rows
from public.player_ratings pr
left join lateral (
  select h.rating_after, h.uncertainty_after, h.games_after
  from public.player_rating_history h
  where h.run_id = pr.as_of_run_id
    and h.pool_id = pr.pool_id
    and h.global_player_id = pr.global_player_id
  order by h.sequence_no desc limit 1
) latest on true
where latest.rating_after is null
   or latest.rating_after <> pr.rating
   or latest.uncertainty_after <> pr.uncertainty
   or latest.games_after <> pr.games_played;
