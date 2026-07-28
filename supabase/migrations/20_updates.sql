-- ============================================================
-- 20_updates.sql
-- 클럽 역할과 profiles.role 분리: 권한은 club_members + is_platform_admin 만 사용
-- ============================================================

-- 1) 레거시 profiles.role 로 관리자 판정하지 않음
create or replace function public.is_admin_or_sub()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      where cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role in ('admin', 'sub_admin')
    );
$$;

-- 2) 프로필 role 컬럼은 더 이상 권한 소스가 아님 → 전원 user 로 정리
--    (플랫폼 슈퍼는 is_platform_admin, 클럽 권한은 club_members.role)
update public.profiles
set role = 'user'
where role is distinct from 'user';

-- 3) 클럽 역할 변경 시 profiles.role 을 건드리지 않음 (이미 club_members만 갱신)
--    admin_update_user 의 p_role 은 무시하고 안내 (클럽 역할 API 사용)
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

  -- 역할은 set_club_member_role 사용. 레거시 p_role 전달 시 거부
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
    if not (
      public.is_platform_admin()
      or exists (
        select 1 from public.club_members cm
        where cm.user_id = auth.uid() and cm.status = 'active' and cm.role = 'admin'
      )
    ) then
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
    if not (
      public.is_platform_admin()
      or exists (
        select 1 from public.club_members cm
        where cm.user_id = auth.uid() and cm.status = 'active' and cm.role = 'admin'
      )
    ) then
      raise exception '입상 구분 변경은 관리자만 할 수 있습니다.';
    end if;
    update public.profiles set award_level = p_award_level where id = p_user_id;
  end if;
end;
$$;
