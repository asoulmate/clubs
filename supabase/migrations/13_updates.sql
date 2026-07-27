-- ============================================================
-- 13_updates.sql
-- 최근 경기 RPC: 파트너·상대 입상 구분 배열 추가
-- ============================================================

create or replace function public.get_player_recent_matches(p_user_id uuid, p_limit integer default 10)
returns table (
  match_id uuid,
  match_date date,
  my_team public.team_side,
  team_a_score integer,
  team_b_score integer,
  result text,
  partner_names text[],
  partner_awards public.award_level[],
  opponent_names text[],
  opponent_awards public.award_level[]
)
language sql stable security definer
set search_path = public
as $$
  select
    m.id,
    m.match_date,
    public.position_team(me.position) as my_team,
    m.team_a_score,
    m.team_b_score,
    case
      when m.team_a_score = m.team_b_score then 'tie'
      when (public.position_team(me.position) = 'A') = (m.team_a_score > m.team_b_score) then 'win'
      else 'loss'
    end as result,
    (select coalesce(array_agg(pr.name order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and t.user_id <> me.user_id
        and public.position_team(t.position) = public.position_team(me.position)) as partner_names,
    (select coalesce(array_agg(pr.award_level order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and t.user_id <> me.user_id
        and public.position_team(t.position) = public.position_team(me.position)) as partner_awards,
    (select coalesce(array_agg(pr.name order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and public.position_team(t.position) <> public.position_team(me.position)) as opponent_names,
    (select coalesce(array_agg(pr.award_level order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and public.position_team(t.position) <> public.position_team(me.position)) as opponent_awards
  from public.match_players me
  join public.matches m on m.id = me.match_id and m.status = 'confirmed'
  where me.user_id = p_user_id
    and auth.uid() is not null
  order by m.match_date desc, m.created_at desc
  limit p_limit;
$$;
