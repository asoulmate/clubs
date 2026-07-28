-- ============================================================
-- 25_absence_by_match_type.sql
-- 결과 집계(단식/복식)에서 무단 결석은
-- 해당 날짜에 그 유형(단식/복식) 경기가 1경기라도 있을 때만 카운트.
-- p_match_type이 null(전체)이면 기존처럼 기간 내 모든 결석을 집계.
-- 24 실행 후 추가 실행
-- ============================================================

create or replace function public.get_player_stats(
  p_from date,
  p_to date,
  p_club_id uuid,
  p_match_type text default null
)
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
  absences bigint,
  is_guest boolean,
  affiliation text
)
language sql stable security definer
set search_path = public
as $$
  with registered as (
    select m.id, m.match_date, m.status, m.team_a_score, m.team_b_score
    from public.matches m
    where m.status <> 'canceled'
      and m.club_id = p_club_id
      and m.match_date between p_from and p_to
      and (p_match_type is null or m.match_type = p_match_type)
  ),
  confirmed as (
    select r.id, r.match_date, r.team_a_score, r.team_b_score
    from registered r
    where r.status = 'confirmed'
  ),
  total_days as (
    select count(distinct r.match_date) as cnt from registered r
  ),
  -- 유형별 집계용: 해당 유형 경기가 열린 날짜
  match_type_days as (
    select distinct m.match_date
    from public.matches m
    where m.status <> 'canceled'
      and m.club_id = p_club_id
      and m.match_date between p_from and p_to
      and (p_match_type is null or m.match_type = p_match_type)
  ),
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
  per_player_days as (
    select mp.user_id, count(distinct r.match_date) as days_participated
    from public.match_players mp
    join registered r on r.id = mp.match_id
    group by mp.user_id
  ),
  -- 단식/복식 탭: 그날 해당 유형 경기가 1경기라도 있을 때만 결석 카운트
  -- 전체(null): 기간 내 모든 결석
  per_absence as (
    select a.user_id, count(*) as absences
    from public.unexcused_absences a
    where a.club_id = p_club_id
      and a.absence_date between p_from and p_to
      and (
        p_match_type is null
        or exists (
          select 1 from match_type_days d where d.match_date = a.absence_date
        )
      )
    group by a.user_id
  ),
  all_users as (
    select user_id from per_player_results
    union select user_id from per_player_days
    union select user_id from per_absence
  )
  select
    u.user_id, p.name, p.award_level,
    coalesce(pr.matches_played, 0), coalesce(pr.wins, 0), coalesce(pr.losses, 0), coalesce(pr.ties, 0),
    coalesce(pr.points_for, 0), coalesce(pr.points_against, 0),
    coalesce(pd.days_participated, 0),
    (select cnt from total_days),
    coalesce(pa.absences, 0),
    p.is_guest,
    nullif(trim(coalesce(p.affiliation, '')), '')
  from all_users u
  join public.profiles p on p.id = u.user_id
  left join per_player_results pr on pr.user_id = u.user_id
  left join per_player_days pd on pd.user_id = u.user_id
  left join per_absence pa on pa.user_id = u.user_id
  where auth.uid() is not null
    and (
      public.is_platform_admin()
      or exists (
        select 1 from public.club_members cm
        where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active'
      )
    );
$$;

comment on function public.get_player_stats(date, date, uuid, text) is
  '기간·클럽·경기유형별 집계. 무단결석은 해당 유형 경기가 있는 날짜에만 반영(유형 null이면 전체).';

grant execute on function public.get_player_stats(date, date, uuid, text) to authenticated;
