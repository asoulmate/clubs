-- ============================================================
-- 02_functions.sql
-- 헬퍼 함수, 트리거, RPC 함수
-- 모든 쓰기 작업은 이 파일의 RPC 함수를 통해서만 수행되며,
-- 함수 내부에서 로그인 사용자의 실제 역할/참가 여부를 검증한다.
-- ============================================================

-- ------------------------------------------------------------
-- 헬퍼 함수
-- ------------------------------------------------------------

-- 현재 로그인 사용자의 역할 조회 (RLS 정책에서 사용해도 재귀가 발생하지 않도록 SECURITY DEFINER)
create or replace function public.get_my_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- 관리자 또는 서브 관리자 여부
create or replace function public.is_admin_or_sub()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.get_my_role() in ('admin', 'sub_admin'), false);
$$;

-- 현재 사용자가 해당 경기의 참가자인지 여부
create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_players
    where match_id = p_match_id and user_id = auth.uid()
  );
$$;

-- 설정값 조회
create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select value from public.app_settings where key = p_key;
$$;

-- 포지션 → 팀 변환
create or replace function public.position_team(p_position public.player_position)
returns public.team_side
language sql immutable
as $$
  select case when p_position in ('A1', 'A2') then 'A'::public.team_side else 'B'::public.team_side end;
$$;

-- 로그인 및 활성 사용자 검증 (모든 쓰기 RPC 진입 시 호출)
create or replace function public.assert_active_caller()
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_active boolean;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select is_active into v_active from public.profiles where id = auth.uid();

  if v_active is null then
    raise exception '사용자 프로필을 찾을 수 없습니다.';
  end if;

  if not v_active then
    raise exception '비활성화된 계정입니다. 관리자에게 문의해주세요.';
  end if;
end;
$$;

-- 스코어 값 검증 (범위, 동점 허용 여부는 app_settings로 관리)
create or replace function public.validate_score(p_team_a integer, p_team_b integer)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_max integer := coalesce((public.get_setting('score_max'))::integer, 99);
  v_allow_tie boolean := coalesce((public.get_setting('allow_tie'))::boolean, false);
begin
  if p_team_a is null or p_team_b is null then
    raise exception '양 팀의 점수를 모두 입력해주세요.';
  end if;
  if p_team_a < 0 or p_team_b < 0 then
    raise exception '점수는 0 이상이어야 합니다.';
  end if;
  if p_team_a > v_max or p_team_b > v_max then
    raise exception '점수는 최대 %점까지 입력할 수 있습니다.', v_max;
  end if;
  if p_team_a = p_team_b and not v_allow_tie then
    raise exception '동점은 허용되지 않습니다. 승부가 결정된 후 입력해주세요.';
  end if;
end;
$$;

-- 감사 로그 기록 헬퍼
create or replace function public.log_match_audit(
  p_match_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.match_audit_logs (match_id, action_type, before_data, after_data, changed_by, reason)
  values (p_match_id, p_action, p_before, p_after, auth.uid(), p_reason);
end;
$$;

-- 경기 스코어 상태 스냅샷 (감사 로그 before/after 용)
create or replace function public.match_snapshot(p_match public.matches)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'status', p_match.status,
    'team_a_score', p_match.team_a_score,
    'team_b_score', p_match.team_b_score,
    'score_submitted_by', p_match.score_submitted_by,
    'confirmed_by', p_match.confirmed_by
  );
$$;

-- ------------------------------------------------------------
-- 트리거: 회원가입 시 profiles 자동 생성
-- ------------------------------------------------------------
create or replace function public.transfer_profile_refs(
  p_from uuid,
  p_to uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.match_players set user_id = p_to where user_id = p_from;
  update public.match_players set registered_by = p_to where registered_by = p_from;
  update public.matches set created_by = p_to where created_by = p_from;
  update public.matches set score_submitted_by = p_to where score_submitted_by = p_from;
  update public.matches set confirmed_by = p_to where confirmed_by = p_from;
  update public.score_confirmations set user_id = p_to where user_id = p_from;
  update public.match_audit_logs set changed_by = p_to where changed_by = p_from;
  update public.app_settings set updated_by = p_to where updated_by = p_from;

  if to_regclass('public.unexcused_absences') is not null then
    update public.unexcused_absences set user_id = p_to where user_id = p_from;
    update public.unexcused_absences set registered_by = p_to where registered_by = p_from;
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_award text := new.raw_user_meta_data ->> 'award_level';
  v_name text;
  v_award_level public.award_level;
  v_require_approval boolean;
  v_guest_id uuid;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  );

  v_award_level := case
    when v_award in ('open', 'national_rookie', 'local_rookie', 'none')
      then v_award::public.award_level
    else 'none'::public.award_level
  end;

  v_require_approval := coalesce(
    (public.get_setting('require_signup_approval'))::boolean,
    false
  );

  select id into v_guest_id
  from public.profiles
  where is_guest = true
    and lower(trim(name)) = lower(trim(v_name))
  order by
    case when award_level = v_award_level then 0 else 1 end,
    created_at asc
  limit 1;

  insert into public.profiles (id, name, award_level, role, is_active, is_guest)
  values (
    new.id,
    v_name,
    v_award_level,
    'user',
    not v_require_approval,
    false
  );

  if v_guest_id is not null then
    perform public.transfer_profile_refs(v_guest_id, new.id);
    delete from public.profiles where id = v_guest_id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 트리거: 일반 사용자가 자신의 role / is_active 를 변경하는 것을 차단
-- (관리자 권한 검증은 DB에서 실제 역할을 조회하여 판단)
-- ------------------------------------------------------------
create or replace function public.prevent_privilege_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- SQL Editor / service_role 실행(auth.uid() 없음)은 허용
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role and public.get_my_role() <> 'admin' then
    raise exception '사용자 역할은 관리자만 변경할 수 있습니다.';
  end if;

  if new.is_active is distinct from old.is_active and not public.is_admin_or_sub() then
    raise exception '사용자 활성 상태는 관리자만 변경할 수 있습니다.';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_privilege_change
  before update on public.profiles
  for each row execute function public.prevent_privilege_change();

-- ------------------------------------------------------------
-- 트리거: 참가자 4명 완성 시 open → ready, 이탈 시 ready → open 자동 전환
-- ------------------------------------------------------------
create or replace function public.sync_match_ready()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid := coalesce(new.match_id, old.match_id);
  v_count integer;
begin
  select count(*) into v_count from public.match_players where match_id = v_match_id;

  if v_count = 4 then
    update public.matches set status = 'ready'
    where id = v_match_id and status = 'open';
  else
    update public.matches set status = 'open'
    where id = v_match_id and status = 'ready';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_sync_match_ready
  after insert or delete on public.match_players
  for each row execute function public.sync_match_ready();

-- ============================================================
-- RPC: 경기 생성 / 참가자 편성
-- ============================================================

-- 참가자 1명을 등록하는 내부 공통 함수 (검증 포함)
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
begin
  select * into v_target from public.profiles where id = p_user_id;

  if not found then
    raise exception '등록할 수 있는 사용자를 찾을 수 없습니다.';
  end if;
  if not v_target.is_active then
    raise exception '비활성화된 사용자는 경기에 등록할 수 없습니다.';
  end if;

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

-- 게스트 프로필 생성 (이름 + 입상). 동일 이름·입상 활성 게스트가 있으면 재사용
create or replace function public.create_guest_profile(
  p_name text,
  p_award_level public.award_level default 'none'
)
returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_row public.profiles;
begin
  perform public.assert_active_caller();

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception '게스트 이름은 1~30자로 입력해주세요.';
  end if;

  if p_award_level is null then
    raise exception '입상 구분을 선택해주세요.';
  end if;

  select * into v_row
  from public.profiles
  where is_guest = true
    and is_active = true
    and lower(trim(name)) = lower(v_name)
    and award_level = p_award_level
  order by created_at asc
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.profiles (id, name, award_level, role, is_active, is_guest)
  values (gen_random_uuid(), v_name, p_award_level, 'user', true, true)
  returning * into v_row;

  return v_row;
end;
$$;

-- 신규 경기 생성: 생성자를 A1로 자동 등록하고, 선택된 파트너/상대를 함께 등록
create or replace function public.create_match(
  p_match_date date,
  p_a2 uuid default null,
  p_b1 uuid default null,
  p_b2 uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_ids uuid[];
begin
  perform public.assert_active_caller();

  if p_match_date is null then
    raise exception '경기 날짜를 선택해주세요.';
  end if;

  -- 생성자 포함 중복 참가자 사전 검증
  v_ids := array_remove(array[auth.uid(), p_a2, p_b1, p_b2], null);
  if (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    raise exception '같은 사용자를 한 경기에 두 번 등록할 수 없습니다.';
  end if;

  insert into public.matches (match_date, created_by)
  values (p_match_date, auth.uid())
  returning id into v_match_id;

  -- 생성자는 자동으로 A팀 1번
  perform public.internal_add_player(v_match_id, auth.uid(), 'A1');

  if p_a2 is not null then perform public.internal_add_player(v_match_id, p_a2, 'A2'); end if;
  if p_b1 is not null then perform public.internal_add_player(v_match_id, p_b1, 'B1'); end if;
  if p_b2 is not null then perform public.internal_add_player(v_match_id, p_b2, 'B2'); end if;

  return v_match_id;
end;
$$;

-- 빈 슬롯에 참가자 등록 (본인 또는 대리 등록)
create or replace function public.register_player(
  p_match_id uuid,
  p_position public.player_position,
  p_user_id uuid default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_allow_proxy boolean := coalesce((public.get_setting('allow_proxy_registration'))::boolean, true);
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;

  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 참가자를 등록할 수 없습니다.';
  end if;
  -- 일반 사용자: open/ready만 / 관리자·서브: 확정 포함 모든 비취소 상태 허용
  if v_match.status not in ('open', 'ready') and not public.is_admin_or_sub() then
    raise exception '스코어 입력이 시작된 경기는 참가자를 변경할 수 없습니다.';
  end if;

  -- 대리 등록 허용 여부 검증 (관리자는 항상 가능)
  if v_target_id <> auth.uid() and not v_allow_proxy and not public.is_admin_or_sub() then
    raise exception '다른 사용자를 대신 등록하는 기능이 현재 허용되지 않습니다.';
  end if;

  perform public.internal_add_player(p_match_id, v_target_id, p_position);
end;
$$;

-- 슬롯에서 참가자 제거 (본인, 등록자, 또는 관리자)
create or replace function public.remove_player(
  p_match_id uuid,
  p_position public.player_position
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player public.match_players;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  select * into v_player from public.match_players
  where match_id = p_match_id and position = p_position;

  if not found then
    raise exception '해당 자리에 등록된 참가자가 없습니다.';
  end if;

  if not public.is_admin_or_sub() then
    -- 일반 사용자는 스코어 입력 전, 본인 슬롯 또는 본인이 등록한 슬롯만 제거 가능
    if v_match.status not in ('open', 'ready') then
      raise exception '스코어 입력이 시작된 경기는 참가자를 변경할 수 없습니다.';
    end if;
    if v_player.user_id <> auth.uid() and v_player.registered_by <> auth.uid() then
      raise exception '본인 또는 본인이 등록한 참가자만 제외할 수 있습니다.';
    end if;
  end if;

  delete from public.match_players where id = v_player.id;
end;
$$;

-- 관리자/서브 관리자: 슬롯 참가자 강제 변경 (p_user_id가 null이면 비우기)
create or replace function public.admin_set_player(
  p_match_id uuid,
  p_position public.player_position,
  p_user_id uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  if not public.is_admin_or_sub() then
    raise exception '관리자만 참가자를 강제로 변경할 수 있습니다.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '취소된 경기의 참가자는 변경할 수 없습니다.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('position', position, 'user_id', user_id)), '[]'::jsonb)
  into v_before from public.match_players where match_id = p_match_id;

  delete from public.match_players where match_id = p_match_id and position = p_position;

  if p_user_id is not null then
    perform public.internal_add_player(p_match_id, p_user_id, p_position);
  end if;

  perform public.log_match_audit(
    p_match_id, 'admin_set_player', v_before,
    jsonb_build_object('position', p_position, 'user_id', p_user_id)
  );
end;
$$;

-- ============================================================
-- RPC: 경기 진행 / 스코어 입력 / 확정
-- ============================================================

-- 경기 시작 (ready → in_progress, 참가자만)
create or replace function public.start_match(p_match_id uuid)
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
  if not public.is_match_participant(p_match_id) and not public.is_admin_or_sub() then
    raise exception '경기 참가자만 경기를 시작할 수 있습니다.';
  end if;
  if v_match.status <> 'ready' then
    raise exception '참가자 4명이 모두 편성된 경기만 시작할 수 있습니다.';
  end if;

  update public.matches set status = 'in_progress' where id = p_match_id;
end;
$$;

-- 스코어 입력 및 확정 요청
-- p_expected_version: 낙관적 잠금 (조회 시점의 version 값을 전달)
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
  v_confirm_mode text := coalesce(public.get_setting('confirm_mode') #>> '{}', 'double');
  v_player_count integer;
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

  select count(*) into v_player_count from public.match_players where match_id = p_match_id;
  if v_player_count < 4 then
    raise exception '참가자 4명이 모두 등록된 후 스코어를 입력할 수 있습니다.';
  end if;

  -- 낙관적 잠금: 화면에서 조회한 버전과 다르면 이미 다른 사용자가 수정한 것
  if v_match.version <> p_expected_version then
    raise exception '다른 사용자가 방금 이 경기를 수정했습니다. 새로고침 후 다시 확인해주세요.';
  end if;

  perform public.validate_score(p_team_a, p_team_b);

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

-- 상대 팀 참가자의 최종 확인 (submitted → confirmed)
create or replace function public.confirm_score(
  p_match_id uuid,
  p_expected_version integer
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_my_position public.player_position;
  v_submitter_position public.player_position;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match.status <> 'submitted' then
    raise exception '확정 대기 상태의 경기만 최종 확인할 수 있습니다.';
  end if;
  if v_match.version <> p_expected_version then
    raise exception '다른 사용자가 방금 이 경기를 수정했습니다. 새로고침 후 다시 확인해주세요.';
  end if;

  select mp.position into v_my_position from public.match_players mp
  where mp.match_id = p_match_id and mp.user_id = auth.uid();

  if v_my_position is null then
    raise exception '경기 참가자만 스코어를 확인할 수 있습니다.';
  end if;

  -- 제출자가 참가자인 경우, 반드시 상대 팀 참가자가 확인해야 함
  select mp.position into v_submitter_position from public.match_players mp
  where mp.match_id = p_match_id and mp.user_id = v_match.score_submitted_by;

  if v_submitter_position is not null
     and public.position_team(v_my_position) = public.position_team(v_submitter_position) then
    raise exception '상대 팀 참가자가 스코어를 확인해야 합니다.';
  end if;

  v_before := public.match_snapshot(v_match);

  insert into public.score_confirmations (match_id, user_id, team)
  values (p_match_id, auth.uid(), public.position_team(v_my_position))
  on conflict (match_id, user_id) do nothing;

  update public.matches
  set status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(p_match_id, 'confirm_score', v_before,
    jsonb_build_object('confirmed_by', auth.uid()));
end;
$$;

-- 경기 취소 (생성자: 스코어 제출 전까지 / 관리자·서브 관리자: 항상)
create or replace function public.cancel_match(
  p_match_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '이미 취소된 경기입니다.';
  end if;

  if not public.is_admin_or_sub() then
    if v_match.created_by <> auth.uid() then
      raise exception '경기를 만든 사용자 또는 관리자만 취소할 수 있습니다.';
    end if;
    if v_match.status not in ('open', 'ready', 'in_progress') then
      raise exception '스코어가 입력된 경기는 관리자만 취소할 수 있습니다.';
    end if;
  end if;

  v_before := public.match_snapshot(v_match);

  update public.matches
  set status = 'canceled', version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(p_match_id, 'cancel', v_before, null, p_reason);
end;
$$;

-- ============================================================
-- RPC: 관리자 전용
-- ============================================================

-- 확정 경기 포함 스코어 강제 수정 (수정 사유 필수, 감사 로그 기록)
create or replace function public.admin_update_score(
  p_match_id uuid,
  p_team_a integer,
  p_team_b integer,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player_count integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  if not public.is_admin_or_sub() then
    raise exception '확정된 경기는 관리자만 수정할 수 있습니다.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception '수정 사유를 입력해주세요.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 스코어를 입력할 수 없습니다.';
  end if;

  select count(*) into v_player_count from public.match_players where match_id = p_match_id;
  if v_player_count < 4 then
    raise exception '참가자 4명이 모두 등록된 후 스코어를 입력할 수 있습니다.';
  end if;

  perform public.validate_score(p_team_a, p_team_b);

  v_before := public.match_snapshot(v_match);

  update public.matches
  set team_a_score = p_team_a,
      team_b_score = p_team_b,
      score_submitted_by = coalesce(score_submitted_by, auth.uid()),
      score_submitted_at = coalesce(score_submitted_at, now()),
      status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(
    p_match_id, 'admin_update_score', v_before,
    jsonb_build_object('team_a_score', p_team_a, 'team_b_score', p_team_b),
    p_reason
  );
end;
$$;

-- 경기 초기화: 스코어와 확인 기록을 지우고 편성 상태로 되돌림 (사유 필수)
create or replace function public.admin_reset_match(
  p_match_id uuid,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player_count integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  if not public.is_admin_or_sub() then
    raise exception '경기 초기화는 관리자만 할 수 있습니다.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception '초기화 사유를 입력해주세요.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  v_before := public.match_snapshot(v_match);

  delete from public.score_confirmations where match_id = p_match_id;

  select count(*) into v_player_count from public.match_players where match_id = p_match_id;

  update public.matches
  set team_a_score = null,
      team_b_score = null,
      score_submitted_by = null,
      score_submitted_at = null,
      confirmed_by = null,
      confirmed_at = null,
      status = case when v_player_count = 4 then 'ready'::public.match_status else 'open'::public.match_status end,
      version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(p_match_id, 'admin_reset', v_before, null, p_reason);
end;
$$;

-- 사용자 역할/활성 상태 변경 (역할 변경: admin만 / 활성 변경: admin, sub_admin)
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role public.user_role default null,
  p_is_active boolean default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
begin
  perform public.assert_active_caller();

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if p_role is not null and p_role is distinct from v_target.role then
    if public.get_my_role() <> 'admin' then
      raise exception '사용자 역할은 관리자만 변경할 수 있습니다.';
    end if;
    if p_user_id = auth.uid() then
      raise exception '자기 자신의 역할은 변경할 수 없습니다.';
    end if;
    update public.profiles set role = p_role where id = p_user_id;
  end if;

  if p_is_active is not null and p_is_active is distinct from v_target.is_active then
    if not public.is_admin_or_sub() then
      raise exception '사용자 활성 상태는 관리자만 변경할 수 있습니다.';
    end if;
    if p_user_id = auth.uid() then
      raise exception '자기 자신을 비활성화할 수 없습니다.';
    end if;
    update public.profiles set is_active = p_is_active where id = p_user_id;
  end if;
end;
$$;

-- ============================================================
-- RPC: 통계 및 집계 (확정된 경기만 포함)
-- 집계는 전부 DB에서 수행하여 프런트로 전체 경기 데이터를 내려받지 않는다.
-- ============================================================

-- 기간별 개인 집계 (순위 부여는 프런트의 ranking 유틸에서 수행)
create or replace function public.get_player_stats(p_from date, p_to date)
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
  total_match_days bigint
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
  )
  select
    pp.user_id, p.name, p.award_level,
    pp.matches_played, pp.wins, pp.losses, pp.ties,
    coalesce(pp.points_for, 0), coalesce(pp.points_against, 0),
    pp.days_participated,
    (select cnt from total_days)
  from per_player pp
  join public.profiles p on p.id = pp.user_id
  where auth.uid() is not null;
$$;

-- 특정 사용자의 파트너별 집계
create or replace function public.get_partner_stats(p_user_id uuid, p_from date, p_to date)
returns table (
  partner_id uuid,
  partner_name text,
  partner_award public.award_level,
  matches_played bigint,
  wins bigint,
  losses bigint,
  ties bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    partner.user_id,
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
  join public.match_players partner
    on partner.match_id = me.match_id
   and partner.user_id <> me.user_id
   and public.position_team(partner.position) = public.position_team(me.position)
  join public.profiles pr on pr.id = partner.user_id
  where me.user_id = p_user_id
    and auth.uid() is not null
  group by partner.user_id, pr.name, pr.award_level
  order by count(*) desc, pr.name asc;
$$;

-- 특정 사용자의 월별 경기 추이 (최근 p_months개월)
create or replace function public.get_player_monthly_trend(p_user_id uuid, p_months integer default 12)
returns table (
  month text,
  matches_played bigint,
  wins bigint,
  losses bigint
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
        else m.team_b_score < m.team_a_score end) as losses
  from public.match_players mp
  join public.matches m on m.id = mp.match_id and m.status = 'confirmed'
  where mp.user_id = p_user_id
    and m.match_date >= (current_date - make_interval(months => p_months))::date
    and auth.uid() is not null
  group by to_char(m.match_date, 'YYYY-MM')
  order by month asc;
$$;

-- 특정 사용자의 최근 경기 목록
create or replace function public.get_player_recent_matches(p_user_id uuid, p_limit integer default 10)
returns table (
  match_id uuid,
  match_date date,
  my_team public.team_side,
  team_a_score integer,
  team_b_score integer,
  result text,
  partner_names text[],
  opponent_names text[]
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
    (select coalesce(array_agg(pr.name order by pr.name), '{}')
       from public.match_players t
       join public.profiles pr on pr.id = t.user_id
      where t.match_id = m.id
        and public.position_team(t.position) <> public.position_team(me.position)) as opponent_names
  from public.match_players me
  join public.matches m on m.id = me.match_id and m.status = 'confirmed'
  where me.user_id = p_user_id
    and auth.uid() is not null
  order by m.match_date desc, m.created_at desc
  limit p_limit;
$$;
