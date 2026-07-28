-- ============================================================
-- 23_match_type_betting.sql
-- 1) 경기 유형(단식/복식) — 단식은 A1·B1 두 명만 편성
-- 2) 배팅 경기 지정 + 배팅 마감 시간 (경기 당일을 넘길 수 없음)
-- 3) 경기 시작 버튼은 배팅 경기에서만 사용
-- 4) 배팅 금액 500/1000원으로 변경 (기존 2000원 기록은 유지)
-- 5) 결과 집계 단식/복식 분리 (get_player_stats p_match_type)
-- 6) 클럽 설정: 경기 만들기 기본 유형(default_match_type)
-- 22 실행 후 추가로 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- 1. matches 컬럼 추가
-- ------------------------------------------------------------
alter table public.matches
  add column if not exists match_type text not null default 'doubles';

alter table public.matches
  add column if not exists is_betting boolean not null default false;

alter table public.matches
  add column if not exists betting_deadline timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_matches_match_type' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint chk_matches_match_type check (match_type in ('singles', 'doubles'));
  end if;
end $$;

comment on column public.matches.match_type is '단식(singles: A1·B1 2명) / 복식(doubles: 4명)';
comment on column public.matches.is_betting is 'true면 배팅 경기. 경기 시작 버튼은 배팅 경기에서만 사용';
comment on column public.matches.betting_deadline is '배팅 마감 시각. 경기 당일(KST)을 넘길 수 없음';

-- ------------------------------------------------------------
-- 2. 배팅 금액 500/1000
--    테이블 제약은 기존 2000원 기록의 정산(UPDATE)을 위해 2000을 계속 허용하고,
--    신규 배팅의 500/1000 제한은 place_match_bet RPC에서 강제한다.
-- ------------------------------------------------------------
comment on table public.match_bets is
  '경기 승패 배팅. 신규 배팅 금액은 500/1000 (RPC에서 강제, 2000은 과거 기록 호환). 확정 시 result 정산.';

-- ------------------------------------------------------------
-- 3. 설정: 경기 만들기 기본 유형
--    (app_settings는 신규 클럽 생성 시 복사되는 템플릿)
-- ------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('default_match_type', '"doubles"',
   '경기 만들기 기본 유형: "doubles"(복식) 또는 "singles"(단식)')
on conflict (key) do nothing;

insert into public.club_settings (club_id, key, value, description)
select c.id, 'default_match_type', '"doubles"', '경기 만들기 기본 유형: doubles(복식)/singles(단식)'
from public.clubs c
on conflict (club_id, key) do nothing;

-- ------------------------------------------------------------
-- 4. 참가자 등록 공통: 단식 경기는 A1/B1만 허용
-- ------------------------------------------------------------
create or replace function public.internal_add_player(
  p_match_id uuid,
  p_user_id uuid,
  p_position public.player_position
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_match_type text;
begin
  select match_type into v_match_type from public.matches where id = p_match_id;
  if v_match_type is null then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match_type = 'singles' and p_position in ('A2', 'B2') then
    raise exception '단식 경기는 팀당 1명(A팀 1번, B팀 1번)만 등록할 수 있습니다.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;

  if not found then
    raise exception '등록할 수 있는 사용자를 찾을 수 없습니다.';
  end if;
  if not v_target.is_active then
    raise exception '비활성화된 사용자는 경기에 등록할 수 없습니다.';
  end if;

  perform public.assert_not_in_progress(p_user_id, p_match_id);

  begin
    insert into public.match_players (match_id, user_id, position, registered_by)
    values (p_match_id, p_user_id, p_position, auth.uid());
  exception
    when unique_violation then
      if exists (select 1 from public.match_players where match_id = p_match_id and user_id = p_user_id) then
        raise exception '해당 사용자는 이미 이 경기에 등록되어 있습니다.';
      else
        raise exception '이미 다른 사용자가 해당 자리에 등록되었습니다.';
      end if;
  end;
end;
$$;

-- ------------------------------------------------------------
-- 5. 편성 완료 자동 전환: 단식 2명 / 복식 4명
-- ------------------------------------------------------------
create or replace function public.sync_match_ready()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid := coalesce(new.match_id, old.match_id);
  v_count integer;
  v_required integer;
begin
  select case when m.match_type = 'singles' then 2 else 4 end
  into v_required
  from public.matches m where m.id = v_match_id;

  -- 경기 삭제 cascade 중이면 조용히 통과
  if v_required is null then
    return coalesce(new, old);
  end if;

  select count(*) into v_count from public.match_players where match_id = v_match_id;

  if v_count >= v_required then
    update public.matches set status = 'ready'
    where id = v_match_id and status = 'open';
  else
    update public.matches set status = 'open'
    where id = v_match_id and status = 'ready';
  end if;

  return coalesce(new, old);
end;
$$;

-- ------------------------------------------------------------
-- 6. 경기 생성: 유형·배팅·마감시간
-- ------------------------------------------------------------
drop function if exists public.create_match(date, uuid, uuid, uuid, uuid);

create or replace function public.create_match(
  p_match_date date,
  p_club_id uuid,
  p_a2 uuid default null,
  p_b1 uuid default null,
  p_b2 uuid default null,
  p_match_type text default null,
  p_is_betting boolean default false,
  p_betting_deadline timestamptz default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_ids uuid[];
  v_type text;
  v_is_betting boolean := coalesce(p_is_betting, false);
  v_day_end timestamptz;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if p_match_date is null then
    raise exception '경기 날짜를 선택해주세요.';
  end if;

  -- 유형: 미지정이면 클럽 설정 기본값 → 복식
  v_type := coalesce(
    nullif(trim(coalesce(p_match_type, '')), ''),
    public.get_club_setting(p_club_id, 'default_match_type') #>> '{}',
    'doubles'
  );
  if v_type not in ('singles', 'doubles') then
    raise exception '경기 유형은 단식 또는 복식만 선택할 수 있습니다.';
  end if;
  if v_type = 'singles' and (p_a2 is not null or p_b2 is not null) then
    raise exception '단식 경기는 상대 선수 1명(B팀 1번)만 지정할 수 있습니다.';
  end if;

  -- 배팅 경기: 마감 시간 필수, 현재 이후 ~ 경기 당일(KST) 자정 전까지
  if v_is_betting then
    if p_betting_deadline is null then
      raise exception '배팅 경기는 배팅 마감 시간을 입력해야 합니다.';
    end if;
    if p_betting_deadline <= now() then
      raise exception '배팅 마감 시간은 현재 시각 이후로 설정해주세요.';
    end if;
    v_day_end := ((p_match_date + 1)::timestamp at time zone 'Asia/Seoul');
    if p_betting_deadline >= v_day_end then
      raise exception '배팅 마감 시간은 경기 당일을 넘길 수 없습니다.';
    end if;
  end if;

  v_ids := array_remove(array[auth.uid(), p_a2, p_b1, p_b2], null);
  if (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    raise exception '같은 사용자를 한 경기에 두 번 등록할 수 없습니다.';
  end if;

  insert into public.matches (match_date, created_by, status, club_id, match_type, is_betting, betting_deadline)
  values (
    p_match_date, auth.uid(), 'open', p_club_id, v_type, v_is_betting,
    case when v_is_betting then p_betting_deadline else null end
  )
  returning id into v_match_id;

  perform public.internal_add_player(v_match_id, auth.uid(), 'A1');
  if p_a2 is not null then perform public.internal_add_player(v_match_id, p_a2, 'A2'); end if;
  if p_b1 is not null then perform public.internal_add_player(v_match_id, p_b1, 'B1'); end if;
  if p_b2 is not null then perform public.internal_add_player(v_match_id, p_b2, 'B2'); end if;

  return v_match_id;
end;
$$;

-- ------------------------------------------------------------
-- 7. 경기 시작: 배팅 경기에서만 사용
-- ------------------------------------------------------------
create or replace function public.start_match(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player record;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if not v_match.is_betting then
    raise exception '배팅 경기가 아닌 경기는 시작 절차 없이 바로 스코어를 입력합니다.';
  end if;
  if not public.is_match_participant(p_match_id) and not public.is_admin_or_sub() then
    raise exception '경기 참가자만 경기를 시작할 수 있습니다.';
  end if;
  if v_match.status <> 'ready' then
    raise exception '참가자가 모두 편성된 경기만 시작할 수 있습니다.';
  end if;

  for v_player in
    select user_id from public.match_players where match_id = p_match_id
  loop
    perform public.assert_not_in_progress(v_player.user_id, p_match_id);
  end loop;

  update public.matches set status = 'in_progress' where id = p_match_id;
end;
$$;

-- ------------------------------------------------------------
-- 8. 스코어 입력: 필요 인원(단식 2 / 복식 4) + 확정 방식은 클럽 설정 우선
-- ------------------------------------------------------------
create or replace function public.submit_score(
  p_match_id uuid,
  p_team_a integer,
  p_team_b integer,
  p_expected_version integer
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_is_participant boolean;
  v_my_position public.player_position;
  v_confirm_mode text;
  v_player_count integer;
  v_required integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  v_is_participant := public.is_match_participant(p_match_id);
  if not v_is_participant and not public.is_admin_or_sub() then
    raise exception '경기 참가자만 스코어를 입력할 수 있습니다.';
  end if;

  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 스코어를 입력할 수 없습니다.';
  end if;
  if v_match.status = 'confirmed' then
    raise exception '확정된 경기는 관리자만 수정할 수 있습니다.';
  end if;

  v_required := case when v_match.match_type = 'singles' then 2 else 4 end;
  select count(*) into v_player_count from public.match_players where match_id = p_match_id;
  if v_player_count < v_required then
    raise exception '참가자 %명이 모두 등록된 후 스코어를 입력할 수 있습니다.', v_required;
  end if;

  -- 낙관적 잠금: 화면에서 조회한 버전과 다르면 이미 다른 사용자가 수정한 것
  if v_match.version <> p_expected_version then
    raise exception '다른 사용자가 방금 이 경기를 수정했습니다. 새로고침 후 다시 확인해주세요.';
  end if;

  perform public.validate_score(p_team_a, p_team_b);

  -- 확정 방식: 클럽 설정 우선, 없으면 글로벌 → double
  v_confirm_mode := coalesce(
    public.get_club_setting(v_match.club_id, 'confirm_mode') #>> '{}',
    public.get_setting('confirm_mode') #>> '{}',
    'double'
  );

  v_before := public.match_snapshot(v_match);

  -- 재제출 시 기존 확인 기록은 초기화 (스코어가 바뀌면 다시 확인해야 함)
  delete from public.score_confirmations where match_id = p_match_id;

  update public.matches
  set team_a_score = p_team_a,
      team_b_score = p_team_b,
      score_submitted_by = auth.uid(),
      score_submitted_at = now(),
      status = 'submitted',
      confirmed_by = null,
      confirmed_at = null,
      version = version + 1
  where id = p_match_id;

  -- 제출자가 참가자라면 자기 팀 확인으로 기록
  if v_is_participant then
    select mp.position into v_my_position from public.match_players mp
    where mp.match_id = p_match_id and mp.user_id = auth.uid();

    insert into public.score_confirmations (match_id, user_id, team)
    values (p_match_id, auth.uid(), public.position_team(v_my_position));
  end if;

  -- 단일 확정 모드에서는 제출 즉시 확정
  if v_confirm_mode = 'single' then
    update public.matches
    set status = 'confirmed',
        confirmed_by = auth.uid(),
        confirmed_at = now(),
        version = version + 1
    where id = p_match_id;
  end if;

  perform public.log_match_audit(
    p_match_id, 'submit_score', v_before,
    jsonb_build_object('team_a_score', p_team_a, 'team_b_score', p_team_b, 'confirm_mode', v_confirm_mode)
  );
end;
$$;

-- ------------------------------------------------------------
-- 9. 배팅 등록/변경: 배팅 경기 + 마감 전 + 500/1000원
-- ------------------------------------------------------------
create or replace function public.place_match_bet(
  p_match_id uuid,
  p_amount integer,
  p_predicted_team public.team_side
)
returns public.match_bets
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_row public.match_bets;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  perform public.assert_club_member(v_match.club_id);

  if not v_match.is_betting then
    raise exception '배팅 경기로 개설된 경기에만 배팅할 수 있습니다.';
  end if;
  if v_match.status in ('confirmed', 'canceled') then
    raise exception '확정되었거나 취소된 경기에는 배팅할 수 없습니다.';
  end if;
  if v_match.betting_deadline is not null and now() > v_match.betting_deadline then
    raise exception '배팅이 마감되었습니다.';
  end if;

  if p_amount not in (500, 1000) then
    raise exception '배팅 금액은 500원 또는 1000원만 가능합니다.';
  end if;

  if p_predicted_team not in ('A', 'B') then
    raise exception '승리 팀을 A 또는 B로 선택해주세요.';
  end if;

  select * into v_row from public.match_bets
  where match_id = p_match_id and user_id = auth.uid();

  if found then
    if v_row.result is not null then
      raise exception '이미 정산된 배팅은 변경할 수 없습니다.';
    end if;
    update public.match_bets
    set amount = p_amount,
        predicted_team = p_predicted_team,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.match_bets (match_id, club_id, user_id, amount, predicted_team)
    values (p_match_id, v_match.club_id, auth.uid(), p_amount, p_predicted_team)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- 배팅 취소: 마감 후에는 불가 (결과를 보고 취소하는 것 방지)
create or replace function public.cancel_match_bet(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_row public.match_bets;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  perform public.assert_club_member(v_match.club_id);

  if v_match.status in ('confirmed', 'canceled') then
    raise exception '확정되었거나 취소된 경기의 배팅은 취소할 수 없습니다.';
  end if;
  if v_match.betting_deadline is not null and now() > v_match.betting_deadline then
    raise exception '배팅 마감 후에는 배팅을 취소할 수 없습니다.';
  end if;

  select * into v_row from public.match_bets
  where match_id = p_match_id and user_id = auth.uid();

  if not found then
    raise exception '배팅 내역이 없습니다.';
  end if;
  if v_row.result is not null then
    raise exception '이미 정산된 배팅은 취소할 수 없습니다.';
  end if;

  delete from public.match_bets where id = v_row.id;
end;
$$;

-- ------------------------------------------------------------
-- 10. 결과 집계: 단식/복식 분리 (p_match_type: null=전체)
-- ------------------------------------------------------------
drop function if exists public.get_player_stats(date, date, uuid);

create function public.get_player_stats(
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
  per_absence as (
    select a.user_id, count(*) as absences
    from public.unexcused_absences a
    where a.club_id = p_club_id and a.absence_date between p_from and p_to
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

-- ------------------------------------------------------------
-- 11. 권한
-- ------------------------------------------------------------
grant execute on function public.create_match(date, uuid, uuid, uuid, uuid, text, boolean, timestamptz) to authenticated;
grant execute on function public.get_player_stats(date, date, uuid, text) to authenticated;
grant execute on function public.place_match_bet(uuid, integer, public.team_side) to authenticated;
grant execute on function public.cancel_match_bet(uuid) to authenticated;
