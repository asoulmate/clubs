-- ============================================================
-- 30_admin_permission_fixes.sql
-- 1) 비밀번호 초기화: profiles.role(레거시) → 플랫폼 슈퍼 / 클럽 메인 관리자
-- 2) 관리자 스코어·초기화·참가자 변경: 클럽 스코프 + 단식 인원
-- 3) 회원 삭제/탈퇴: club_members.role 기준으로 판정
-- 29 실행 후 추가 실행
-- ============================================================

-- 어느 클럽이든 메인 관리자이거나 플랫폼 슈퍼
create or replace function public.is_any_club_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      where cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role = 'admin'
    );
$$;

-- 메인 관리자: 비밀번호를 123456 으로 초기화 (게스트 제외)
create or replace function public.admin_reset_user_password(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_target public.profiles;
begin
  perform public.assert_active_caller();

  if not public.is_any_club_admin() then
    raise exception '비밀번호 초기화는 관리자만 할 수 있습니다.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;
  if v_target.is_guest then
    raise exception '게스트 계정은 비밀번호를 초기화할 수 없습니다.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception '로그인 계정이 없어 비밀번호를 초기화할 수 없습니다.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  if to_regclass('auth.sessions') is not null then
    delete from auth.sessions where user_id = p_user_id;
  end if;

  begin
    if to_regclass('auth.refresh_tokens') is not null then
      delete from auth.refresh_tokens where user_id::text = p_user_id::text;
    end if;
  exception
    when others then
      null;
  end;
end;
$$;

-- 이름/입상 변경도 동일 헬퍼 사용 (기존 로직과 동일, 중복 정리)
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role public.user_role default null,
  p_is_active boolean default null,
  p_name text default null,
  p_award_level public.award_level default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_name text;
begin
  perform public.assert_active_caller();

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if p_role is not null then
    raise exception '클럽 역할은 관리자 화면의 클럽 권한 변경을 사용해주세요.';
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

  if p_name is not null then
    if not public.is_any_club_admin() then
      raise exception '이름 변경은 관리자만 할 수 있습니다.';
    end if;
    v_name := trim(p_name);
    if char_length(v_name) < 1 or char_length(v_name) > 30 then
      raise exception '이름은 1~30자로 입력해주세요.';
    end if;
    if v_name is distinct from v_target.name then
      update public.profiles set name = v_name where id = p_user_id;
    end if;
  end if;

  if p_award_level is not null and p_award_level is distinct from v_target.award_level then
    if not public.is_any_club_admin() then
      raise exception '입상 구분 변경은 관리자만 할 수 있습니다.';
    end if;
    update public.profiles set award_level = p_award_level where id = p_user_id;
  end if;
end;
$$;

-- 확정 경기 포함 스코어 강제 수정
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
  v_required integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  if p_reason is null or trim(p_reason) = '' then
    raise exception '수정 사유를 입력해주세요.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  if not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '확정된 경기는 관리자만 수정할 수 있습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 스코어를 입력할 수 없습니다.';
  end if;

  v_required := case when v_match.match_type = 'singles' then 2 else 4 end;
  select count(*) into v_player_count from public.match_players where match_id = p_match_id;
  if v_player_count < v_required then
    raise exception '참가자 %명이 모두 등록된 후 스코어를 입력할 수 있습니다.', v_required;
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

-- 경기 초기화
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
  v_required integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  if p_reason is null or trim(p_reason) = '' then
    raise exception '초기화 사유를 입력해주세요.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  if not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '경기 초기화는 관리자만 할 수 있습니다.';
  end if;

  v_before := public.match_snapshot(v_match);

  delete from public.score_confirmations where match_id = p_match_id;

  v_required := case when v_match.match_type = 'singles' then 2 else 4 end;
  select count(*) into v_player_count from public.match_players where match_id = p_match_id;

  update public.matches
  set team_a_score = null,
      team_b_score = null,
      score_submitted_by = null,
      score_submitted_at = null,
      confirmed_by = null,
      confirmed_at = null,
      status = case
        when v_player_count >= v_required then 'ready'::public.match_status
        else 'open'::public.match_status
      end,
      version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(p_match_id, 'admin_reset', v_before, null, p_reason);
end;
$$;

-- 참가자 강제 변경
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

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  if not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '관리자만 참가자를 강제로 변경할 수 있습니다.';
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

-- 게스트 삭제 / 회원 탈퇴: 대상의 클럽 역할 기준
create or replace function public.admin_remove_user(p_user_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_has_refs boolean;
  v_target_is_admin boolean;
  v_target_is_sub boolean;
begin
  perform public.assert_active_caller();

  if not public.is_admin_or_sub() then
    raise exception '사용자 삭제/탈퇴는 관리자만 할 수 있습니다.';
  end if;

  if p_user_id = auth.uid() then
    raise exception '자기 자신은 삭제/탈퇴할 수 없습니다.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if not v_target.is_guest then
    select exists (
      select 1 from public.club_members cm
      where cm.user_id = p_user_id and cm.status = 'active' and cm.role = 'admin'
    ) into v_target_is_admin;
    select exists (
      select 1 from public.club_members cm
      where cm.user_id = p_user_id and cm.status = 'active' and cm.role = 'sub_admin'
    ) into v_target_is_sub;

    if v_target_is_admin then
      raise exception '관리자 계정은 탈퇴 처리할 수 없습니다.';
    end if;
    if v_target_is_sub and not public.is_any_club_admin() then
      raise exception '서브 관리자 탈퇴는 관리자만 할 수 있습니다.';
    end if;
  end if;

  delete from public.match_players mp
  using public.matches m
  where mp.match_id = m.id
    and mp.user_id = p_user_id
    and m.status <> 'confirmed';

  if to_regclass('public.unexcused_absences') is not null then
    delete from public.unexcused_absences where user_id = p_user_id;
  end if;

  if v_target.is_guest then
    v_has_refs :=
      exists (select 1 from public.match_players where user_id = p_user_id or registered_by = p_user_id)
      or exists (
        select 1 from public.matches
        where created_by = p_user_id
           or score_submitted_by = p_user_id
           or confirmed_by = p_user_id
      )
      or exists (select 1 from public.score_confirmations where user_id = p_user_id)
      or exists (select 1 from public.match_audit_logs where changed_by = p_user_id)
      or exists (select 1 from public.app_settings where updated_by = p_user_id)
      or (
        to_regclass('public.unexcused_absences') is not null
        and exists (
          select 1 from public.unexcused_absences
          where user_id = p_user_id or registered_by = p_user_id
        )
      );

    if v_has_refs then
      update public.profiles
      set is_active = false,
          updated_at = now()
      where id = p_user_id;
      return 'guest_deactivated';
    end if;

    delete from public.profiles where id = p_user_id;
    return 'guest_deleted';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    update public.profiles
    set is_active = false,
        updated_at = now()
    where id = p_user_id;
    return 'member_deactivated';
  end if;

  if to_regclass('auth.sessions') is not null then
    delete from auth.sessions where user_id = p_user_id;
  end if;
  begin
    if to_regclass('auth.refresh_tokens') is not null then
      delete from auth.refresh_tokens where user_id::text = p_user_id::text;
    end if;
  exception
    when others then null;
  end;

  delete from auth.users where id = p_user_id;
  return 'member_withdrawn';
end;
$$;

grant execute on function public.is_any_club_admin() to authenticated;
grant execute on function public.admin_reset_user_password(uuid) to authenticated;
grant execute on function public.admin_update_user(uuid, public.user_role, boolean, text, public.award_level) to authenticated;
grant execute on function public.admin_update_score(uuid, integer, integer, text) to authenticated;
grant execute on function public.admin_reset_match(uuid, text) to authenticated;
grant execute on function public.admin_set_player(uuid, public.player_position, uuid) to authenticated;
grant execute on function public.admin_remove_user(uuid) to authenticated;
