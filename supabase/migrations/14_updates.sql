-- ============================================================
-- 14_updates.sql
-- 참가율: 경기가 '등록된' 날짜(취소 제외)를 전체일로 산정
--  - total_match_days = 기간 내 경기 등록일(distinct match_date, canceled 제외)
--  - days_participated = 그 중 개인이 참가한 날 수
--  - 승/패/득점 등 성적 지표는 기존처럼 확정(confirmed) 경기만
-- ============================================================

drop function if exists public.get_player_stats(date, date);

create function public.get_player_stats(p_from date, p_to date)
returns table (
  user_id uuid,
  name text,
  award_level public.award_level,
  matches_played bigint,
  wins bigint,
  losses bigint,
  ties bigint,
  points_for bigint,
  points_against bigint,
  days_participated bigint,
  total_match_days bigint,
  absences bigint
)
language sql stable security definer
set search_path = public
as $$
  with registered as (
    -- 오늘의 경기에 등록된 날 (취소된 경기만 있는 날은 제외)
    select m.id, m.match_date, m.status, m.team_a_score, m.team_b_score
    from public.matches m
    where m.status <> 'canceled'
      and m.match_date between p_from and p_to
  ),
  confirmed as (
    select r.id, r.match_date, r.team_a_score, r.team_b_score
    from registered r
    where r.status = 'confirmed'
  ),
  total_days as (
    select count(distinct r.match_date) as cnt from registered r
  ),
  -- 성적(확정 경기)
  per_player_results as (
    select
      mp.user_id,
      count(*) as matches_played,
      count(*) filter (where
        case when public.position_team(mp.position) = 'A'
          then c.team_a_score > c.team_b_score
          else c.team_b_score > c.team_a_score end) as wins,
      count(*) filter (where
        case when public.position_team(mp.position) = 'A'
          then c.team_a_score < c.team_b_score
          else c.team_b_score < c.team_a_score end) as losses,
      count(*) filter (where c.team_a_score = c.team_b_score) as ties,
      sum(case when public.position_team(mp.position) = 'A' then c.team_a_score else c.team_b_score end) as points_for,
      sum(case when public.position_team(mp.position) = 'A' then c.team_b_score else c.team_a_score end) as points_against
    from public.match_players mp
    join confirmed c on c.id = mp.match_id
    group by mp.user_id
  ),
  -- 참가일: 등록된(비취소) 경기에 이름을 올린 날
  per_player_days as (
    select
      mp.user_id,
      count(distinct r.match_date) as days_participated
    from public.match_players mp
    join registered r on r.id = mp.match_id
    group by mp.user_id
  ),
  per_absence as (
    select a.user_id, count(*) as absences
    from public.unexcused_absences a
    where a.absence_date between p_from and p_to
    group by a.user_id
  ),
  all_users as (
    select user_id from per_player_results
    union
    select user_id from per_player_days
    union
    select user_id from per_absence
  )
  select
    u.user_id,
    p.name,
    p.award_level,
    coalesce(pr.matches_played, 0),
    coalesce(pr.wins, 0),
    coalesce(pr.losses, 0),
    coalesce(pr.ties, 0),
    coalesce(pr.points_for, 0),
    coalesce(pr.points_against, 0),
    coalesce(pd.days_participated, 0),
    (select cnt from total_days),
    coalesce(pa.absences, 0)
  from all_users u
  join public.profiles p on p.id = u.user_id
  left join per_player_results pr on pr.user_id = u.user_id
  left join per_player_days pd on pd.user_id = u.user_id
  left join per_absence pa on pa.user_id = u.user_id
  where auth.uid() is not null;
$$;

comment on function public.get_player_stats(date, date) is
  '기간별 개인 집계. 참가율 분모(total_match_days)는 경기가 등록된 날(canceled 제외), 분자는 개인 참가일.';
