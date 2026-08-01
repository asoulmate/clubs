-- ============================================================
-- 44_shadow_rating_engine.sql
-- Deterministic team-average Elo shadow calculation and admin read APIs.
-- No existing ranking, profile, match, URL, or result API is replaced.
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

create or replace function public.run_shadow_team_elo_v1(
  p_pool_id uuid,
  p_cutoff_at timestamptz default now()
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pool public.rating_pools;
  v_version public.rating_model_versions;
  v_run_id uuid;
  v_existing_run uuid;
  v_input_hash text;
  v_identity_hash text;
  v_initial numeric;
  v_k numeric;
  v_initial_uncertainty numeric;
  v_min_uncertainty numeric;
  v_provisional_games integer;
  v_match record;
  v_player jsonb;
  v_team_a uuid[];
  v_team_b uuid[];
  v_team_a_rating numeric;
  v_team_b_rating numeric;
  v_expected_a numeric;
  v_actual_a numeric;
  v_delta numeric;
  v_before_rating numeric;
  v_before_uncertainty numeric;
  v_before_games integer;
  v_after_rating numeric;
  v_after_uncertainty numeric;
  v_after_games integer;
  v_player_id uuid;
  v_team text;
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 shadow 레이팅을 계산할 수 있습니다.';
  end if;

  select * into v_pool from public.rating_pools where id = p_pool_id;
  if not found then raise exception '레이팅 pool을 찾을 수 없습니다.'; end if;
  if not v_pool.enabled then raise exception '해당 shadow 레이팅 pool은 비활성 상태입니다.'; end if;
  select * into v_version from public.rating_model_versions where id = v_pool.model_version_id;
  if not found or v_version.status <> 'shadow' then raise exception 'shadow 모델 버전을 찾을 수 없습니다.'; end if;

  v_initial := coalesce((v_version.parameters->>'initial_rating')::numeric, 1500);
  v_k := coalesce((v_version.parameters->>'k_factor')::numeric, 32);
  v_initial_uncertainty := coalesce((v_version.parameters->>'initial_uncertainty')::numeric, 350);
  v_min_uncertainty := coalesce((v_version.parameters->>'minimum_uncertainty')::numeric, 60);
  v_provisional_games := coalesce((v_version.parameters->>'provisional_games')::integer, 10);

  insert into public.rating_runs(pool_id, model_version_id, cutoff_at, status, created_by)
  values (v_pool.id, v_version.id, p_cutoff_at, 'running', auth.uid())
  returning id into v_run_id;

  with candidates as (
    select m.*,
      case when m.match_type = 'singles' then 2 else 4 end as required_players
    from public.matches m
    where m.match_type = v_pool.discipline
      and m.created_at <= p_cutoff_at
      and (v_pool.scope_type = 'global' or m.club_id = v_pool.club_id)
  ), prepared as (
    select c.*,
      count(mp.id)::integer as participant_count,
      count(p.global_player_id)::integer as mapped_count,
      count(distinct p.global_player_id)::integer as distinct_identity_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'profile_id', mp.user_id,
            'global_player_id', p.global_player_id,
            'position', mp.position,
            'team', public.position_team(mp.position)
          ) order by mp.position
        ) filter (where mp.id is not null),
        '[]'::jsonb
      ) as players
    from candidates c
    left join public.match_players mp on mp.match_id = c.id
    left join public.profiles p on p.id = mp.user_id
    group by c.id, c.club_id, c.match_date, c.created_by, c.status,
      c.team_a_score, c.team_b_score, c.score_submitted_by,
      c.score_submitted_at, c.confirmed_by, c.confirmed_at, c.version,
      c.created_at, c.updated_at, c.match_type, c.is_betting,
      c.betting_deadline, c.display_order, c.youtube_video_id,
      c.youtube_title, c.youtube_matched_at, c.required_players
  )
  insert into public.rating_run_matches(
    run_id, match_id, sequence_no, included, exclusion_reason, input_payload
  )
  select v_run_id, p.id,
    row_number() over(order by p.match_date, p.created_at, p.id)::integer,
    p.status = 'confirmed'
      and p.team_a_score is not null and p.team_b_score is not null
      and p.participant_count = p.required_players
      and p.mapped_count = p.required_players
      and p.distinct_identity_count = p.required_players,
    case
      when p.status = 'canceled' then 'canceled'
      when p.status <> 'confirmed' then 'not_confirmed'
      when p.team_a_score is null or p.team_b_score is null then 'missing_score'
      when p.participant_count <> p.required_players then 'invalid_participant_count'
      when p.mapped_count <> p.required_players then 'missing_identity_mapping'
      when p.distinct_identity_count <> p.required_players then 'duplicate_identity_in_match'
      else null
    end,
    jsonb_build_object(
      'schema_version', v_version.input_schema_version,
      'match_id', p.id,
      'club_id', p.club_id,
      'match_date', p.match_date,
      'match_type', p.match_type,
      'match_version', p.version,
      'team_a_score', p.team_a_score,
      'team_b_score', p.team_b_score,
      'players', p.players
    )
  from prepared p;

  select md5(coalesce(string_agg(
    sequence_no::text || ':' || match_id::text || ':' || included::text || ':' ||
    coalesce(exclusion_reason, '') || ':' || input_payload::text,
    '|' order by sequence_no
  ), '')) into v_input_hash
  from public.rating_run_matches where run_id = v_run_id;

  select md5(coalesce(string_agg(p.id::text || ':' || p.global_player_id::text, '|' order by p.id), ''))
  into v_identity_hash from public.profiles p;

  select id into v_existing_run
  from public.rating_runs
  where pool_id = v_pool.id and model_version_id = v_version.id
    and status = 'completed' and input_hash = v_input_hash
  order by completed_at desc limit 1;
  if v_existing_run is not null then
    delete from public.rating_runs where id = v_run_id;
    return v_existing_run;
  end if;

  create temporary table if not exists pg_temp.rating_work_state (
    global_player_id uuid primary key,
    rating numeric not null,
    uncertainty numeric not null,
    games integer not null
  ) on commit drop;
  truncate pg_temp.rating_work_state;

  for v_match in
    select * from public.rating_run_matches
    where run_id = v_run_id and included
    order by sequence_no
  loop
    select
      array_agg((x->>'global_player_id')::uuid order by x->>'position')
        filter (where x->>'team' = 'A'),
      array_agg((x->>'global_player_id')::uuid order by x->>'position')
        filter (where x->>'team' = 'B')
    into v_team_a, v_team_b
    from jsonb_array_elements(v_match.input_payload->'players') x;

    insert into pg_temp.rating_work_state(global_player_id, rating, uncertainty, games)
    select player_id, v_initial, v_initial_uncertainty, 0
    from unnest(v_team_a || v_team_b) player_id
    on conflict(global_player_id) do nothing;

    select avg(rating) into v_team_a_rating
    from pg_temp.rating_work_state where global_player_id = any(v_team_a);
    select avg(rating) into v_team_b_rating
    from pg_temp.rating_work_state where global_player_id = any(v_team_b);

    v_expected_a := 1 / (1 + power(10::numeric, (v_team_b_rating - v_team_a_rating) / 400));
    v_actual_a := case
      when (v_match.input_payload->>'team_a_score')::integer > (v_match.input_payload->>'team_b_score')::integer then 1
      when (v_match.input_payload->>'team_a_score')::integer < (v_match.input_payload->>'team_b_score')::integer then 0
      else 0.5 end;
    v_delta := round(v_k * (v_actual_a - v_expected_a), 6);

    for v_player in select value from jsonb_array_elements(v_match.input_payload->'players') loop
      v_player_id := (v_player->>'global_player_id')::uuid;
      v_team := v_player->>'team';
      select rating, uncertainty, games
      into v_before_rating, v_before_uncertainty, v_before_games
      from pg_temp.rating_work_state where global_player_id = v_player_id;
      v_after_games := v_before_games + 1;
      v_after_rating := round(v_before_rating + case when v_team = 'A' then v_delta else -v_delta end, 6);
      v_after_uncertainty := round(greatest(
        v_min_uncertainty,
        v_initial_uncertainty / sqrt((v_after_games + 1)::numeric)
      ), 6);
      update pg_temp.rating_work_state
      set rating = v_after_rating, uncertainty = v_after_uncertainty, games = v_after_games
      where global_player_id = v_player_id;
      insert into public.player_rating_history(
        run_id, pool_id, match_id, sequence_no, global_player_id, team_side,
        rating_before, rating_after, uncertainty_before, uncertainty_after,
        games_before, games_after
      ) values (
        v_run_id, v_pool.id, v_match.match_id, v_match.sequence_no, v_player_id, v_team,
        v_before_rating, v_after_rating, v_before_uncertainty, v_after_uncertainty,
        v_before_games, v_after_games
      );
    end loop;
  end loop;

  delete from public.player_ratings where pool_id = v_pool.id;
  insert into public.player_ratings(
    pool_id, global_player_id, rating, uncertainty, games_played,
    provisional, as_of_run_id, updated_at
  )
  select v_pool.id, global_player_id, round(rating, 6), round(uncertainty, 6), games,
    games < v_provisional_games, v_run_id, now()
  from pg_temp.rating_work_state;

  update public.rating_runs
  set status = 'completed', input_hash = v_input_hash,
      identity_mapping_hash = v_identity_hash,
      included_match_count = (select count(*) from public.rating_run_matches where run_id = v_run_id and included),
      excluded_match_count = (select count(*) from public.rating_run_matches where run_id = v_run_id and not included),
      completed_at = now()
  where id = v_run_id;
  return v_run_id;
end;
$$;

create or replace function public.list_shadow_rating_pools_v1()
returns table (
  pool_id uuid, pool_name text, scope_type text, club_id uuid,
  discipline text, model_code text, model_version text, enabled boolean
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 shadow pool을 조회할 수 있습니다.'; end if;
  return query
  select rp.id, rp.name, rp.scope_type, rp.club_id, rp.discipline,
    rm.code, rv.version, rp.enabled
  from public.rating_pools rp
  join public.rating_model_versions rv on rv.id = rp.model_version_id
  join public.rating_models rm on rm.id = rv.model_id
  where rv.status = 'shadow'
  order by rp.scope_type, rp.discipline, rp.name;
end;
$$;

create or replace function public.get_shadow_rating_summary_v1(p_club_id uuid, p_pool_id uuid)
returns table (
  global_player_id uuid, player_name text, rating numeric, uncertainty numeric,
  provisional boolean, games_played integer, opponent_count bigint,
  linked_club_count bigint, last_calculated_at timestamptz,
  model_version text, run_id uuid, excluded_match_count integer
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 shadow 레이팅을 조회할 수 있습니다.'; end if;
  if p_club_id is null or p_pool_id is null then raise exception '클럽과 pool을 지정해야 합니다.'; end if;
  return query
  with target_players as (
    select p.global_player_id, min(p.name) as player_name
    from public.profiles p
    join public.club_members cm on cm.user_id = p.id
    where cm.club_id = p_club_id and cm.status = 'active'
      and p.global_player_id is not null
    group by p.global_player_id
  ), club_counts as (
    select p.global_player_id, count(distinct cm.club_id) as linked_club_count
    from public.profiles p join public.club_members cm on cm.user_id = p.id
    where cm.status = 'active' and p.global_player_id is not null
    group by p.global_player_id
  ), opponent_counts as (
    select h.global_player_id, count(distinct other.global_player_id) as opponent_count
    from public.player_rating_history h
    join public.player_rating_history other
      on other.run_id = h.run_id and other.match_id = h.match_id
     and other.team_side <> h.team_side
    where h.run_id = (select pr.as_of_run_id from public.player_ratings pr
      where pr.pool_id = p_pool_id limit 1)
    group by h.global_player_id
  )
  select pr.global_player_id, tp.player_name, pr.rating, pr.uncertainty,
    pr.provisional, pr.games_played, coalesce(oc.opponent_count, 0),
    coalesce(cc.linked_club_count, 0), rr.completed_at,
    rv.version, rr.id, rr.excluded_match_count
  from public.player_ratings pr
  join target_players tp on tp.global_player_id = pr.global_player_id
  join public.rating_runs rr on rr.id = pr.as_of_run_id
  join public.rating_model_versions rv on rv.id = rr.model_version_id
  left join club_counts cc on cc.global_player_id = pr.global_player_id
  left join opponent_counts oc on oc.global_player_id = pr.global_player_id
  where pr.pool_id = p_pool_id
  order by pr.rating desc, tp.player_name;
end;
$$;

create or replace function public.get_shadow_rating_exclusions_v1(p_run_id uuid)
returns table (exclusion_reason text, match_count bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then raise exception '플랫폼 관리자만 제외 사유를 조회할 수 있습니다.'; end if;
  return query select rrm.exclusion_reason, count(*)
  from public.rating_run_matches rrm
  where rrm.run_id = p_run_id and not rrm.included
  group by rrm.exclusion_reason order by count(*) desc, rrm.exclusion_reason;
end;
$$;

revoke execute on function public.run_shadow_team_elo_v1(uuid, timestamptz) from public, anon;
revoke execute on function public.list_shadow_rating_pools_v1() from public, anon;
revoke execute on function public.get_shadow_rating_summary_v1(uuid, uuid) from public, anon;
revoke execute on function public.get_shadow_rating_exclusions_v1(uuid) from public, anon;
grant execute on function public.run_shadow_team_elo_v1(uuid, timestamptz) to authenticated;
grant execute on function public.list_shadow_rating_pools_v1() to authenticated;
grant execute on function public.get_shadow_rating_summary_v1(uuid, uuid) to authenticated;
grant execute on function public.get_shadow_rating_exclusions_v1(uuid) to authenticated;

commit;
