-- ============================================================
-- 05_updates.sql
-- 기능 보완 업데이트 (01~04 실행 후 추가로 실행)
--  1. 경기 삭제 RPC: 관리자·서브 관리자는 모든 경기,
--     경기 개설자는 확정 전 경기를 삭제 가능
--  2. 월별 경기 추이에 참가 일수(days_participated) 추가
-- ============================================================

-- ------------------------------------------------------------
-- 1. 경기 삭제
--    (참가자·스코어 확인·감사 로그는 FK cascade로 함께 삭제됨)
-- ------------------------------------------------------------
create or replace function public.delete_match(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  if not public.is_admin_or_sub() then
    -- 일반 사용자는 자신이 개설한 경기만, 확정 전까지 삭제 가능
    if v_match.created_by <> auth.uid() then
      raise exception '경기를 만든 사용자 또는 관리자만 삭제할 수 있습니다.';
    end if;
    if v_match.status = 'confirmed' then
      raise exception '확정된 경기는 관리자만 삭제할 수 있습니다.';
    end if;
  end if;

  delete from public.matches where id = p_match_id;
end;
$$;

-- ------------------------------------------------------------
-- 2. 월별 경기 추이에 참가 일수 추가
--    (반환 타입이 변경되므로 기존 함수를 삭제 후 재생성)
-- ------------------------------------------------------------
drop function if exists public.get_player_monthly_trend(uuid, integer);

create function public.get_player_monthly_trend(p_user_id uuid, p_months integer default 12)
returns table (
  month text,
  matches_played bigint,
  wins bigint,
  losses bigint,
  days_participated bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    to_char(m.match_date, 'YYYY-MM') as month,
    count(*) as matches_played,
    count(*) filter (where
      case when public.position_team(mp.position) = 'A'
        then m.team_a_score > m.team_b_score
        else m.team_b_score > m.team_a_score end) as wins,
    count(*) filter (where
      case when public.position_team(mp.position) = 'A'
        then m.team_a_score < m.team_b_score
        else m.team_b_score < m.team_a_score end) as losses,
    count(distinct m.match_date) as days_participated
  from public.match_players mp
  join public.matches m on m.id = mp.match_id and m.status = 'confirmed'
  where mp.user_id = p_user_id
    and m.match_date >= (current_date - make_interval(months => p_months))::date
    and auth.uid() is not null
  group by to_char(m.match_date, 'YYYY-MM')
  order by month asc;
$$;
