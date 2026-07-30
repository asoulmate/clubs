-- ============================================================
-- 36_match_fines.sql
-- 확정 경기 패자 벌금 자동 산정 + 클럽별 기능 설정
-- ============================================================

-- 신규 클럽 설정 템플릿
insert into public.app_settings (key, value, description)
values ('fine_enabled', 'true', '확정 경기 패자 벌금 집계 사용')
on conflict (key) do update
set description = excluded.description;

-- 기존 클럽에도 기본 활성화
insert into public.club_settings (club_id, key, value, description)
select c.id, 'fine_enabled', 'true', '확정 경기 패자 벌금 집계 사용'
from public.clubs c
on conflict (club_id, key) do nothing;

-- 벌금은 별도 데이터를 중복 저장하지 않고 확정 경기 결과에서 계산한다.
-- 일반 패배: 패자 1인당 2,500원
-- 정확히 6:0 또는 6:5 패배: 패자 1인당 3,500원
create or replace function public.get_match_fine_records(
  p_from date,
  p_to date,
  p_club_id uuid,
  p_user_id uuid default null,
  p_match_type text default null
)
returns table (
  match_id uuid,
  match_date date,
  match_type text,
  user_id uuid,
  name text,
  award_level public.award_level,
  team_a_score integer,
  team_b_score integer,
  amount integer,
  fine_reason text
)
language sql stable security definer
set search_path = public
as $$
  select
    m.id,
    m.match_date,
    m.match_type::text,
    mp.user_id,
    p.name,
    p.award_level,
    m.team_a_score,
    m.team_b_score,
    case
      when greatest(m.team_a_score, m.team_b_score) = 6
       and least(m.team_a_score, m.team_b_score) in (0, 5)
        then 3500
      else 2500
    end as amount,
    case
      when greatest(m.team_a_score, m.team_b_score) = 6
       and least(m.team_a_score, m.team_b_score) = 0
        then '6:0 패배'
      when greatest(m.team_a_score, m.team_b_score) = 6
       and least(m.team_a_score, m.team_b_score) = 5
        then '6:5 패배'
      else '일반 패배'
    end as fine_reason
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  join public.profiles p on p.id = mp.user_id
  where m.club_id = p_club_id
    and m.status = 'confirmed'
    and m.team_a_score is not null
    and m.team_b_score is not null
    and m.team_a_score <> m.team_b_score
    and m.match_date between p_from and p_to
    and (p_match_type is null or m.match_type::text = p_match_type)
    and (p_user_id is null or mp.user_id = p_user_id)
    and (
      (public.position_team(mp.position) = 'A' and m.team_a_score < m.team_b_score)
      or
      (public.position_team(mp.position) = 'B' and m.team_b_score < m.team_a_score)
    )
    and coalesce(
      (public.get_club_setting(p_club_id, 'fine_enabled'))::boolean,
      true
    )
    and (
      public.is_platform_admin()
      or public.is_active_club_member(p_club_id)
    )
  order by m.match_date desc, m.created_at desc, p.name asc;
$$;

revoke all on function public.get_match_fine_records(date, date, uuid, uuid, text) from public;
grant execute on function public.get_match_fine_records(date, date, uuid, uuid, text)
  to authenticated;

comment on function public.get_match_fine_records(date, date, uuid, uuid, text) is
  '기간·클럽·회원·경기유형별 패자 벌금 상세. 확정 경기 결과에서 자동 계산.';
