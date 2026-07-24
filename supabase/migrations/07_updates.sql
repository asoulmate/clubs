-- ============================================================
-- 07_updates.sql
-- 무단 결석 기록 테이블 + 등록/삭제 RPC + 통계에 결석 수 반영
-- 01~06 실행 후 추가로 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- 테이블: 날짜별 무단 결석
-- ------------------------------------------------------------
create table if not exists public.unexcused_absences (
  id            uuid primary key default gen_random_uuid(),
  absence_date  date not null,
  user_id       uuid not null references public.profiles (id),
  registered_by uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  constraint uq_absence_date_user unique (absence_date, user_id)
);

comment on table public.unexcused_absences is '날짜별 무단 결석자. 확정 경기와 별도로 집계에 반영.';

create index if not exists idx_absences_date on public.unexcused_absences (absence_date);
create index if not exists idx_absences_user on public.unexcused_absences (user_id);

alter table public.unexcused_absences replica identity full;
alter publication supabase_realtime add table public.unexcused_absences;

alter table public.unexcused_absences enable row level security;

create policy "absences_select_authenticated"
  on public.unexcused_absences for select
  to authenticated
  using (true);

-- 쓰기는 RPC(SECURITY DEFINER)만 허용

-- ------------------------------------------------------------
-- 무단 결석 등록
-- ------------------------------------------------------------
create or replace function public.add_unexcused_absence(
  p_absence_date date,
  p_user_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
begin
  perform public.assert_active_caller();

  if p_absence_date is null then
    raise exception '결석 날짜를 선택해주세요.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception '회원가입된 사용자만 결석으로 등록할 수 있습니다.';
  end if;
  if not v_target.is_active then
    raise exception '비활성화된 사용자는 결석으로 등록할 수 없습니다.';
  end if;

  -- 해당 날짜에 이미 경기(취소 제외)에 편성되어 있으면 결석 등록 불가
  if exists (
    select 1
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = p_user_id
      and m.match_date = p_absence_date
      and m.status <> 'canceled'
  ) then
    raise exception '% 님은 해당 날짜 경기에 편성되어 있어 무단 결석으로 등록할 수 없습니다.', v_target.name;
  end if;

  begin
    insert into public.unexcused_absences (absence_date, user_id, registered_by)
    values (p_absence_date, p_user_id, auth.uid());
  exception
    when unique_violation then
      raise exception '% 님은 이미 해당 날짜에 무단 결석으로 등록되어 있습니다.', v_target.name;
  end;
end;
$$;

-- ------------------------------------------------------------
-- 무단 결석 삭제 (본인이 등록했거나 관리자)
-- ------------------------------------------------------------
create or replace function public.remove_unexcused_absence(
  p_absence_date date,
  p_user_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.unexcused_absences;
begin
  perform public.assert_active_caller();

  select * into v_row
  from public.unexcused_absences
  where absence_date = p_absence_date and user_id = p_user_id;

  if not found then
    raise exception '해당 무단 결석 기록을 찾을 수 없습니다.';
  end if;

  if not public.is_admin_or_sub() and v_row.registered_by <> auth.uid() then
    raise exception '본인이 등록한 결석 또는 관리자만 삭제할 수 있습니다.';
  end if;

  delete from public.unexcused_absences
  where absence_date = p_absence_date and user_id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- 통계: 무단 결석 수 포함 (반환 타입 변경 → drop 후 재생성)
-- 기간 내 확정 경기 참가자 + 결석자 모두 포함
-- ------------------------------------------------------------
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
  with confirmed as (
    select m.id, m.match_date, m.team_a_score, m.team_b_score
    from public.matches m
    where m.status = 'confirmed'
      and m.match_date between p_from and p_to
  ),
  total_days as (
    select count(distinct c.match_date) as cnt from confirmed c
  ),
  per_player as (
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
      sum(case when public.position_team(mp.position) = 'A' then c.team_b_score else c.team_a_score end) as points_against,
      count(distinct c.match_date) as days_participated
    from public.match_players mp
    join confirmed c on c.id = mp.match_id
    group by mp.user_id
  ),
  per_absence as (
    select a.user_id, count(*) as absences
    from public.unexcused_absences a
    where a.absence_date between p_from and p_to
    group by a.user_id
  ),
  all_users as (
    select user_id from per_player
    union
    select user_id from per_absence
  )
  select
    u.user_id,
    p.name,
    p.award_level,
    coalesce(pp.matches_played, 0),
    coalesce(pp.wins, 0),
    coalesce(pp.losses, 0),
    coalesce(pp.ties, 0),
    coalesce(pp.points_for, 0),
    coalesce(pp.points_against, 0),
    coalesce(pp.days_participated, 0),
    (select cnt from total_days),
    coalesce(pa.absences, 0)
  from all_users u
  join public.profiles p on p.id = u.user_id
  left join per_player pp on pp.user_id = u.user_id
  left join per_absence pa on pa.user_id = u.user_id
  where auth.uid() is not null;
$$;
