-- ============================================================
-- 11_updates.sql
-- 상대별 승패·승률 집계 RPC
-- 01~10 실행 후 추가로 실행하세요.
-- ============================================================

-- 특정 사용자의 상대(반대 팀)별 집계
-- 복식이므로 한 경기에 상대 2명이 각각 +1경기(승/패는 내 팀 결과 기준)
create or replace function public.get_opponent_stats(p_user_id uuid, p_from date, p_to date)
returns table (
  opponent_id uuid,
  opponent_name text,
  opponent_award public.award_level,
  matches_played bigint,
  wins bigint,
  losses bigint,
  ties bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    opp.user_id,
    pr.name,
    pr.award_level,
    count(*) as matches_played,
    count(*) filter (where
      case when public.position_team(me.position) = 'A'
        then m.team_a_score > m.team_b_score
        else m.team_b_score > m.team_a_score end) as wins,
    count(*) filter (where
      case when public.position_team(me.position) = 'A'
        then m.team_a_score < m.team_b_score
        else m.team_b_score < m.team_a_score end) as losses,
    count(*) filter (where m.team_a_score = m.team_b_score) as ties
  from public.match_players me
  join public.matches m
    on m.id = me.match_id
   and m.status = 'confirmed'
   and m.match_date between p_from and p_to
  join public.match_players opp
    on opp.match_id = me.match_id
   and opp.user_id <> me.user_id
   and public.position_team(opp.position) <> public.position_team(me.position)
  join public.profiles pr on pr.id = opp.user_id
  where me.user_id = p_user_id
    and auth.uid() is not null
  group by opp.user_id, pr.name, pr.award_level
  order by count(*) desc, pr.name asc;
$$;
