-- ============================================================
-- 15_updates.sql
-- 게스트 소속(affiliation) 컬럼 + 게스트 생성 RPC 갱신
-- 참가율 집계 RPC에 affiliation 포함 (순위표 표시용)
-- ============================================================

alter table public.profiles
  add column if not exists affiliation text;

comment on column public.profiles.affiliation is
  '소속. 주로 게스트 수기 등록 시 입력. 일반 회원은 null/빈문자 가능.';

-- 게스트 생성: 이름 + 입상 + 소속. 동일 조합 활성 게스트면 재사용
create or replace function public.create_guest_profile(
  p_name text,
  p_award_level public.award_level default 'none',
  p_affiliation text default null
)
returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_aff text := nullif(trim(coalesce(p_affiliation, '')), '');
  v_row public.profiles;
begin
  perform public.assert_active_caller();

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception '게스트 이름은 1~30자로 입력해주세요.';
  end if;

  if p_award_level is null then
    raise exception '입상 구분을 선택해주세요.';
  end if;

  if v_aff is null or char_length(v_aff) < 1 or char_length(v_aff) > 40 then
    raise exception '소속을 1~40자로 입력해주세요.';
  end if;

  select * into v_row
  from public.profiles
  where is_guest = true
    and is_active = true
    and lower(trim(name)) = lower(v_name)
    and award_level = p_award_level
    and lower(trim(coalesce(affiliation, ''))) = lower(v_aff)
  order by created_at asc
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.profiles (id, name, award_level, role, is_active, is_guest, affiliation)
  values (gen_random_uuid(), v_name, p_award_level, 'user', true, true, v_aff)
  returning * into v_row;

  return v_row;
end;
$$;

-- 순위/집계에 소속 표시를 위해 affiliation 반환
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
    coalesce(pa.absences, 0),
    p.is_guest,
    nullif(trim(coalesce(p.affiliation, '')), '')
  from all_users u
  join public.profiles p on p.id = u.user_id
  left join per_player_results pr on pr.user_id = u.user_id
  left join per_player_days pd on pd.user_id = u.user_id
  left join per_absence pa on pa.user_id = u.user_id
  where auth.uid() is not null;
$$;
