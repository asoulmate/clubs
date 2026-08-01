-- ============================================================
-- 42_global_player_backfill.sql
-- Idempotent 1:1 profile -> global player backfill.
-- No profile, membership, match, tournament, or bet row is deleted/rekeyed.
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists public.identity_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null default 'profile_1_to_1' check (run_kind = 'profile_1_to_1'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  profile_count_before bigint not null,
  unlinked_count_before bigint not null,
  created_global_player_count bigint not null default 0,
  linked_profile_count bigint not null default 0,
  orphan_count_after bigint,
  reference_counts_before jsonb not null,
  reference_counts_after jsonb,
  mapping_checksum text,
  error_message text
);

alter table public.identity_backfill_runs enable row level security;
revoke all on public.identity_backfill_runs from public, anon, authenticated;
grant select on public.identity_backfill_runs to service_role;

do $$
declare
  v_run_id uuid;
  v_profile record;
  v_global_id uuid;
  v_profile_count bigint;
  v_unlinked_count bigint;
  v_created bigint := 0;
  v_linked bigint;
  v_orphans bigint;
  v_before jsonb;
  v_after jsonb;
  v_checksum text;
begin
  select count(*), count(*) filter (where global_player_id is null)
  into v_profile_count, v_unlinked_count
  from public.profiles;

  v_before := jsonb_build_object(
    'profiles', (select count(*) from public.profiles),
    'club_members', (select count(*) from public.club_members),
    'match_players', (select count(*) from public.match_players),
    'tournament_entries', (select count(*) from public.tournament_entries),
    'match_bets', (select count(*) from public.match_bets)
  );

  insert into public.identity_backfill_runs(
    profile_count_before, unlinked_count_before, reference_counts_before
  ) values (v_profile_count, v_unlinked_count, v_before)
  returning id into v_run_id;

  for v_profile in
    select id, name, affiliation
    from public.profiles
    where global_player_id is null
    order by id
    for update
  loop
    insert into public.global_players(display_name)
    values (v_profile.name)
    returning id into v_global_id;

    update public.profiles
    set global_player_id = v_global_id
    where id = v_profile.id and global_player_id is null;

    if found then
      v_created := v_created + 1;
      insert into public.player_aliases(
        global_player_id, name, normalized_name, affiliation,
        source_type, source_profile_id
      ) values (
        v_global_id, v_profile.name, lower(trim(v_profile.name)),
        nullif(trim(coalesce(v_profile.affiliation, '')), ''),
        'legacy_profile', v_profile.id
      ) on conflict do nothing;

      insert into public.player_identity_events(
        correlation_id, event_type, target_global_player_id, profile_id,
        after_state, reason
      ) values (
        v_run_id, 'profile_linked', v_global_id, v_profile.id,
        jsonb_build_object('global_player_id', v_global_id), 'profile 1:1 backfill'
      );
    else
      delete from public.global_players where id = v_global_id;
    end if;
  end loop;

  select count(*) into v_linked from public.profiles where global_player_id is not null;
  select count(*) into v_orphans
  from public.profiles p
  left join public.global_players gp on gp.id = p.global_player_id
  where p.global_player_id is null or gp.id is null;

  v_after := jsonb_build_object(
    'profiles', (select count(*) from public.profiles),
    'club_members', (select count(*) from public.club_members),
    'match_players', (select count(*) from public.match_players),
    'tournament_entries', (select count(*) from public.tournament_entries),
    'match_bets', (select count(*) from public.match_bets)
  );

  select md5(coalesce(string_agg(id::text || ':' || global_player_id::text, ',' order by id), ''))
  into v_checksum from public.profiles;

  if v_before <> v_after then
    raise exception 'identity backfill changed protected row counts: before %, after %', v_before, v_after;
  end if;
  if v_orphans <> 0 or v_linked <> v_profile_count then
    raise exception 'identity backfill validation failed: linked %, profiles %, orphans %',
      v_linked, v_profile_count, v_orphans;
  end if;

  update public.identity_backfill_runs
  set status = 'completed', completed_at = now(),
      created_global_player_count = v_created,
      linked_profile_count = v_linked,
      orphan_count_after = v_orphans,
      reference_counts_after = v_after,
      mapping_checksum = v_checksum
  where id = v_run_id;
end;
$$;

commit;
