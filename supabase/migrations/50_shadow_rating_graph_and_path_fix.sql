-- ============================================================
-- 50_shadow_rating_graph_and_path_fix.sql
-- 1) path RPC: STABLE→VOLATILE (temp table 사용으로 요청 실패하던 문제 수정)
-- 2) platform-wide opponent graph for overview + client path highlight
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Fixed path finder (volatile — temp tables / INSERT 허용)
create or replace function public.get_shadow_rating_path_v1(
  p_pool_id uuid,
  p_from uuid,
  p_to uuid
)
returns jsonb
language plpgsql volatile security definer
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
    match_count bigint not null,
    primary key (player_a, player_b)
  ) on commit drop;
  truncate pg_temp.shadow_edges;
  insert into pg_temp.shadow_edges(player_a, player_b, match_count)
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
    insert into pg_temp.shadow_bfs(player_id, parent_id, via_match_id, dist)
    select distinct on (nxt)
      nxt,
      parent_id,
      via_match_id,
      dist
    from (
      select
        case when e.player_a = b.player_id then e.player_b else e.player_a end as nxt,
        b.player_id as parent_id,
        b.dist + 1 as dist,
        (
          select h.match_id
          from public.player_rating_history h
          join public.player_rating_history o
            on o.run_id = h.run_id
           and o.match_id = h.match_id
           and o.team_side <> h.team_side
          where h.run_id = v_run_id
            and h.global_player_id = b.player_id
            and o.global_player_id = case
              when e.player_a = b.player_id then e.player_b
              else e.player_a
            end
          order by h.sequence_no desc
          limit 1
        ) as via_match_id
      from pg_temp.shadow_bfs b
      join pg_temp.shadow_edges e
        on e.player_a = b.player_id or e.player_b = b.player_id
      where b.dist = v_frontier
    ) cand
    where not exists (
      select 1 from pg_temp.shadow_bfs x where x.player_id = cand.nxt
    )
    order by nxt, dist
    on conflict do nothing;

    get diagnostics v_inserted = row_count;

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
    v_match_id := null;
    v_match_date := null;
    v_score_a := null;
    v_score_b := null;
    v_club_name := null;

    select via_match_id into v_match_id
    from pg_temp.shadow_bfs
    where player_id = v_path[i + 1];

    if v_match_id is not null then
      select m.match_date, m.team_a_score, m.team_b_score, c.name
      into v_match_date, v_score_a, v_score_b, v_club_name
      from public.matches m
      left join public.clubs c on c.id = m.club_id
      where m.id = v_match_id;
    end if;

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

-- Platform-wide graph (read-only)
create or replace function public.get_shadow_rating_graph_v1(p_pool_id uuid)
returns jsonb
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
    return jsonb_build_object('nodes', '[]'::jsonb, 'edges', '[]'::jsonb);
  end if;

  return (
    with names as (
      select p.global_player_id, min(p.name) as player_name
      from public.profiles p
      where p.global_player_id is not null
      group by p.global_player_id
    ),
    edges_raw as (
      select player_a, player_b, match_count
      from public._shadow_opponent_edges(v_run_id)
    ),
    edge_match as (
      select
        e.player_a,
        e.player_b,
        e.match_count,
        (
          select h.match_id
          from public.player_rating_history h
          join public.player_rating_history o
            on o.run_id = h.run_id
           and o.match_id = h.match_id
           and o.team_side <> h.team_side
          where h.run_id = v_run_id
            and h.global_player_id = e.player_a
            and o.global_player_id = e.player_b
          order by h.sequence_no desc
          limit 1
        ) as match_id
      from edges_raw e
    ),
    edge_detail as (
      select
        em.player_a,
        em.player_b,
        em.match_count,
        em.match_id,
        m.match_date,
        m.team_a_score,
        m.team_b_score,
        c.name as club_name
      from edge_match em
      left join public.matches m on m.id = em.match_id
      left join public.clubs c on c.id = m.club_id
    ),
    node_json as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'global_player_id', pr.global_player_id,
          'player_name', coalesce(n.player_name, '이름 없음'),
          'rating', pr.rating,
          'uncertainty', pr.uncertainty,
          'games_played', pr.games_played,
          'provisional', pr.provisional
        )
        order by pr.rating desc, coalesce(n.player_name, '')
      ), '[]'::jsonb) as nodes
      from public.player_ratings pr
      left join names n on n.global_player_id = pr.global_player_id
      where pr.pool_id = p_pool_id
    ),
    edge_json as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'from_id', ed.player_a,
          'to_id', ed.player_b,
          'match_count', ed.match_count,
          'match_id', ed.match_id,
          'match_date', ed.match_date,
          'team_a_score', ed.team_a_score,
          'team_b_score', ed.team_b_score,
          'club_name', ed.club_name
        )
        order by ed.match_count desc
      ), '[]'::jsonb) as edges
      from edge_detail ed
    )
    select jsonb_build_object(
      'nodes', (select nodes from node_json),
      'edges', (select edges from edge_json)
    )
  );
end;
$$;

revoke all on function public.get_shadow_rating_graph_v1(uuid) from public, anon;
grant execute on function public.get_shadow_rating_graph_v1(uuid) to authenticated;
grant execute on function public.get_shadow_rating_path_v1(uuid, uuid, uuid) to authenticated;

commit;
