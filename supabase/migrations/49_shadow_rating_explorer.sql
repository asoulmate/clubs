-- ============================================================
-- 49_shadow_rating_explorer.sql
-- Platform-wide shadow rating leaderboard + ego network + path
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Viewer gate: platform admin for now.
-- Later: allow active authenticated callers when public release is ready.
create or replace function public.assert_shadow_rating_viewer()
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 글로벌 레이팅을 조회할 수 있습니다.';
  end if;
end;
$$;

-- Latest completed run for a pool (via player_ratings snapshot)
create or replace function public._shadow_latest_run_id(p_pool_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select pr.as_of_run_id
  from public.player_ratings pr
  where pr.pool_id = p_pool_id
  limit 1;
$$;

revoke all on function public._shadow_latest_run_id(uuid) from public, anon, authenticated;

-- Opponent undirected edges for a run
create or replace function public._shadow_opponent_edges(p_run_id uuid)
returns table (
  player_a uuid,
  player_b uuid,
  match_count bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    least(h.global_player_id, o.global_player_id) as player_a,
    greatest(h.global_player_id, o.global_player_id) as player_b,
    count(distinct h.match_id)::bigint as match_count
  from public.player_rating_history h
  join public.player_rating_history o
    on o.run_id = h.run_id
   and o.match_id = h.match_id
   and o.team_side <> h.team_side
   and o.global_player_id > h.global_player_id
  where h.run_id = p_run_id
  group by 1, 2;
$$;

revoke all on function public._shadow_opponent_edges(uuid) from public, anon, authenticated;

create or replace function public.get_shadow_rating_leaderboard_v1(p_pool_id uuid)
returns table (
  global_player_id uuid,
  player_name text,
  rating numeric,
  uncertainty numeric,
  provisional boolean,
  games_played integer,
  opponent_count bigint,
  linked_club_count bigint,
  last_calculated_at timestamptz,
  model_version text,
  run_id uuid,
  excluded_match_count integer
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  perform public.assert_shadow_rating_viewer();
  if p_pool_id is null then
    raise exception 'pool을 지정해야 합니다.';
  end if;

  v_run_id := public._shadow_latest_run_id(p_pool_id);
  if v_run_id is null then
    return;
  end if;

  return query
  with names as (
    select p.global_player_id, min(p.name) as player_name
    from public.profiles p
    where p.global_player_id is not null
    group by p.global_player_id
  ), club_counts as (
    select p.global_player_id, count(distinct cm.club_id) as linked_club_count
    from public.profiles p
    join public.club_members cm on cm.user_id = p.id
    where cm.status = 'active' and p.global_player_id is not null
    group by p.global_player_id
  ), opponent_counts as (
    select e.player_a as global_player_id, count(*)::bigint as opponent_count
    from public._shadow_opponent_edges(v_run_id) e
    group by e.player_a
    union all
    select e.player_b, count(*)::bigint
    from public._shadow_opponent_edges(v_run_id) e
    group by e.player_b
  ), opponent_agg as (
    select oc.global_player_id, sum(oc.opponent_count)::bigint as opponent_count
    from opponent_counts oc
    group by oc.global_player_id
  )
  select
    pr.global_player_id,
    coalesce(n.player_name, '이름 없음')::text,
    pr.rating,
    pr.uncertainty,
    pr.provisional,
    pr.games_played,
    coalesce(oa.opponent_count, 0),
    coalesce(cc.linked_club_count, 0),
    rr.completed_at,
    rv.version,
    rr.id,
    rr.excluded_match_count
  from public.player_ratings pr
  join public.rating_runs rr on rr.id = pr.as_of_run_id
  join public.rating_model_versions rv on rv.id = rr.model_version_id
  left join names n on n.global_player_id = pr.global_player_id
  left join club_counts cc on cc.global_player_id = pr.global_player_id
  left join opponent_agg oa on oa.global_player_id = pr.global_player_id
  where pr.pool_id = p_pool_id
  order by pr.rating desc, coalesce(n.player_name, '');
end;
$$;

create or replace function public.get_shadow_rating_ego_v1(
  p_pool_id uuid,
  p_player_id uuid,
  p_hops integer default 2
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_hops integer := greatest(1, least(coalesce(p_hops, 2), 2));
  v_center_name text;
  v_center_rating numeric;
  v_center_uncertainty numeric;
begin
  perform public.assert_shadow_rating_viewer();
  if p_pool_id is null or p_player_id is null then
    raise exception 'pool과 선수를 지정해야 합니다.';
  end if;

  v_run_id := public._shadow_latest_run_id(p_pool_id);
  if v_run_id is null then
    return jsonb_build_object('center', null, 'nodes', '[]'::jsonb, 'edges', '[]'::jsonb);
  end if;

  select min(p.name), pr.rating, pr.uncertainty
  into v_center_name, v_center_rating, v_center_uncertainty
  from public.player_ratings pr
  left join public.profiles p on p.global_player_id = pr.global_player_id
  where pr.pool_id = p_pool_id and pr.global_player_id = p_player_id
  group by pr.rating, pr.uncertainty;

  if v_center_rating is null then
    return jsonb_build_object('center', null, 'nodes', '[]'::jsonb, 'edges', '[]'::jsonb);
  end if;

  return (
    with recursive reach as (
      select p_player_id as player_id, 0 as hop
      union
      select
        case
          when e.player_a = r.player_id then e.player_b
          else e.player_a
        end as player_id,
        r.hop + 1 as hop
      from reach r
      join public._shadow_opponent_edges(v_run_id) e
        on e.player_a = r.player_id or e.player_b = r.player_id
      where r.hop < v_hops
    ),
    nodes_raw as (
      select player_id, min(hop) as hop
      from reach
      where player_id <> p_player_id
      group by player_id
    ),
    names as (
      select p.global_player_id, min(p.name) as player_name
      from public.profiles p
      where p.global_player_id is not null
      group by p.global_player_id
    ),
    vs_center as (
      select
        case when e.player_a = p_player_id then e.player_b else e.player_a end as other_id,
        e.match_count
      from public._shadow_opponent_edges(v_run_id) e
      where e.player_a = p_player_id or e.player_b = p_player_id
    ),
    node_json as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'global_player_id', nr.player_id,
          'player_name', coalesce(n.player_name, '이름 없음'),
          'rating', pr.rating,
          'uncertainty', pr.uncertainty,
          'hop', nr.hop,
          'games_vs_center', coalesce(vc.match_count, 0)
        )
        order by nr.hop, pr.rating desc nulls last, coalesce(n.player_name, '')
      ), '[]'::jsonb) as nodes
      from nodes_raw nr
      left join public.player_ratings pr
        on pr.pool_id = p_pool_id and pr.global_player_id = nr.player_id
      left join names n on n.global_player_id = nr.player_id
      left join vs_center vc on vc.other_id = nr.player_id
    ),
    edge_json as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'from_id', e.player_a,
          'to_id', e.player_b,
          'match_count', e.match_count
        )
        order by e.match_count desc
      ), '[]'::jsonb) as edges
      from public._shadow_opponent_edges(v_run_id) e
      where e.player_a in (select player_id from reach)
        and e.player_b in (select player_id from reach)
    )
    select jsonb_build_object(
      'center', jsonb_build_object(
        'global_player_id', p_player_id,
        'player_name', coalesce(v_center_name, '이름 없음'),
        'rating', v_center_rating,
        'uncertainty', v_center_uncertainty
      ),
      'nodes', (select nodes from node_json),
      'edges', (select edges from edge_json)
    )
  );
end;
$$;

create or replace function public.get_shadow_rating_path_v1(
  p_pool_id uuid,
  p_from uuid,
  p_to uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_path uuid[];
  v_cur uuid;
  v_prev uuid;
  v_frontier integer := 0;
  v_inserted integer;
  v_hops jsonb := '[]'::jsonb;
  v_nodes jsonb := '[]'::jsonb;
  i integer;
  v_match_id uuid;
  v_match_date date;
  v_score_a integer;
  v_score_b integer;
  v_rating numeric;
  v_uncertainty numeric;
  v_club_name text;
  v_player_name text;
  v_from_name text;
  v_to_name text;
begin
  perform public.assert_shadow_rating_viewer();
  if p_pool_id is null or p_from is null or p_to is null then
    raise exception 'pool과 두 선수를 지정해야 합니다.';
  end if;
  if p_from = p_to then
    select coalesce(min(p.name), '이름 없음'), pr.rating, pr.uncertainty
    into v_player_name, v_rating, v_uncertainty
    from public.player_ratings pr
    left join public.profiles p on p.global_player_id = pr.global_player_id
    where pr.pool_id = p_pool_id and pr.global_player_id = p_from
    group by pr.rating, pr.uncertainty;

    return jsonb_build_object(
      'found', true,
      'path', jsonb_build_array(p_from),
      'nodes', jsonb_build_array(jsonb_build_object(
        'global_player_id', p_from,
        'player_name', coalesce(v_player_name, '이름 없음'),
        'rating', v_rating,
        'uncertainty', v_uncertainty
      )),
      'hops', '[]'::jsonb
    );
  end if;

  v_run_id := public._shadow_latest_run_id(p_pool_id);
  if v_run_id is null then
    return jsonb_build_object('found', false, 'path', '[]'::jsonb, 'nodes', '[]'::jsonb, 'hops', '[]'::jsonb);
  end if;

  create temporary table if not exists pg_temp.shadow_edges (
    player_a uuid not null,
    player_b uuid not null,
    match_count bigint not null
  ) on commit drop;
  truncate pg_temp.shadow_edges;
  insert into pg_temp.shadow_edges
  select player_a, player_b, match_count
  from public._shadow_opponent_edges(v_run_id);

  create temporary table if not exists pg_temp.shadow_bfs (
    player_id uuid primary key,
    parent_id uuid,
    via_match_id uuid,
    dist integer not null
  ) on commit drop;
  truncate pg_temp.shadow_bfs;

  insert into pg_temp.shadow_bfs(player_id, parent_id, via_match_id, dist)
  values (p_from, null, null, 0);

  loop
    with candidates as (
      select
        case when e.player_a = b.player_id then e.player_b else e.player_a end as nxt,
        b.player_id as parent_id,
        b.dist + 1 as dist
      from pg_temp.shadow_bfs b
      join pg_temp.shadow_edges e
        on e.player_a = b.player_id or e.player_b = b.player_id
      where b.dist = v_frontier
    ),
    with_match as (
      select
        c.nxt,
        c.parent_id,
        c.dist,
        (
          select h.match_id
          from public.player_rating_history h
          join public.player_rating_history o
            on o.run_id = h.run_id
           and o.match_id = h.match_id
           and o.team_side <> h.team_side
          where h.run_id = v_run_id
            and h.global_player_id = c.parent_id
            and o.global_player_id = c.nxt
          order by h.sequence_no desc
          limit 1
        ) as via_match_id
      from candidates c
      where not exists (
        select 1 from pg_temp.shadow_bfs x where x.player_id = c.nxt
      )
    ),
    ins as (
      insert into pg_temp.shadow_bfs(player_id, parent_id, via_match_id, dist)
      select distinct on (nxt) nxt, parent_id, via_match_id, dist
      from with_match
      order by nxt, dist
      on conflict do nothing
      returning 1
    )
    select count(*)::integer into v_inserted from ins;

    exit when exists (select 1 from pg_temp.shadow_bfs where player_id = p_to);
    exit when coalesce(v_inserted, 0) = 0;
    v_frontier := v_frontier + 1;
    exit when v_frontier >= 12;
  end loop;

  if not exists (select 1 from pg_temp.shadow_bfs where player_id = p_to) then
    return jsonb_build_object('found', false, 'path', '[]'::jsonb, 'nodes', '[]'::jsonb, 'hops', '[]'::jsonb);
  end if;

  v_path := array[]::uuid[];
  v_cur := p_to;
  while v_cur is not null loop
    v_path := v_cur || v_path;
    select parent_id into v_prev from pg_temp.shadow_bfs where player_id = v_cur;
    v_cur := v_prev;
  end loop;

  for i in 1 .. coalesce(array_length(v_path, 1), 0) loop
    select coalesce(min(p.name), '이름 없음')
    into v_player_name
    from public.profiles p
    where p.global_player_id = v_path[i];

    select pr.rating, pr.uncertainty
    into v_rating, v_uncertainty
    from public.player_ratings pr
    where pr.pool_id = p_pool_id and pr.global_player_id = v_path[i];

    v_nodes := v_nodes || jsonb_build_array(jsonb_build_object(
      'global_player_id', v_path[i],
      'player_name', coalesce(v_player_name, '이름 없음'),
      'rating', v_rating,
      'uncertainty', v_uncertainty
    ));
  end loop;

  for i in 1 .. coalesce(array_length(v_path, 1), 1) - 1 loop
    select via_match_id into v_match_id
    from pg_temp.shadow_bfs
    where player_id = v_path[i + 1];

    select m.match_date, m.team_a_score, m.team_b_score, c.name
    into v_match_date, v_score_a, v_score_b, v_club_name
    from public.matches m
    left join public.clubs c on c.id = m.club_id
    where m.id = v_match_id;

    select coalesce(min(p.name), '이름 없음') into v_from_name
    from public.profiles p where p.global_player_id = v_path[i];
    select coalesce(min(p.name), '이름 없음') into v_to_name
    from public.profiles p where p.global_player_id = v_path[i + 1];

    v_hops := v_hops || jsonb_build_array(jsonb_build_object(
      'from_id', v_path[i],
      'to_id', v_path[i + 1],
      'from_name', v_from_name,
      'to_name', v_to_name,
      'match_id', v_match_id,
      'match_date', v_match_date,
      'team_a_score', v_score_a,
      'team_b_score', v_score_b,
      'club_name', v_club_name
    ));
  end loop;

  return jsonb_build_object(
    'found', true,
    'path', to_jsonb(v_path),
    'nodes', v_nodes,
    'hops', v_hops
  );
end;
$$;

revoke all on function public.assert_shadow_rating_viewer() from public, anon;
revoke all on function public.get_shadow_rating_leaderboard_v1(uuid) from public, anon;
revoke all on function public.get_shadow_rating_ego_v1(uuid, uuid, integer) from public, anon;
revoke all on function public.get_shadow_rating_path_v1(uuid, uuid, uuid) from public, anon;

grant execute on function public.assert_shadow_rating_viewer() to authenticated;
grant execute on function public.get_shadow_rating_leaderboard_v1(uuid) to authenticated;
grant execute on function public.get_shadow_rating_ego_v1(uuid, uuid, integer) to authenticated;
grant execute on function public.get_shadow_rating_path_v1(uuid, uuid, uuid) to authenticated;

commit;
