-- ============================================================
-- 16_updates.sql
-- 관리자: 게스트 삭제 / 회원 탈퇴
--  - 게스트: 미확정 경기·결석 정리 후, 참조 없으면 profiles 삭제 / 있으면 비활성
--  - 회원: 미확정 경기 편성 해제 후 auth.users 삭제 → 기존 트리거가 profiles 정리
-- ============================================================

create or replace function public.admin_remove_user(p_user_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_has_refs boolean;
  v_caller_role public.user_role;
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

  v_caller_role := public.get_my_role();

  if not v_target.is_guest then
    if v_target.role = 'admin' then
      raise exception '관리자 계정은 탈퇴 처리할 수 없습니다.';
    end if;
    if v_target.role = 'sub_admin' and v_caller_role <> 'admin' then
      raise exception '서브 관리자 탈퇴는 관리자만 할 수 있습니다.';
    end if;
  end if;

  -- 미확정(또는 취소) 경기의 편성에서 제거 — 확정 경기 기록은 유지
  delete from public.match_players mp
  using public.matches m
  where mp.match_id = m.id
    and mp.user_id = p_user_id
    and m.status <> 'confirmed';

  -- 등록자로만 남아 있는 미확정 슬롯의 registered_by 는 유지(FK). 결석은 삭제
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

  -- 정회원: Auth 계정 삭제 → on_auth_user_deleted 트리거가 profiles 비활성/삭제
  if not exists (select 1 from auth.users where id = p_user_id) then
    -- Auth 없이 profiles만 남은 경우
    update public.profiles
    set is_active = false,
        updated_at = now()
    where id = p_user_id;
    return 'member_deactivated';
  end if;

  delete from auth.sessions where user_id = p_user_id;
  begin
    delete from auth.refresh_tokens where user_id::text = p_user_id::text;
  exception
    when undefined_table then null;
    when others then null;
  end;

  delete from auth.users where id = p_user_id;
  return 'member_withdrawn';
end;
$$;

comment on function public.admin_remove_user(uuid) is
  '관리자/서브: 게스트 삭제 또는 회원 탈퇴. 확정 경기 기록은 보존.';
