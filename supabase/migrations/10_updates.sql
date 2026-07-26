-- ============================================================
-- 10_updates.sql
-- 메인 관리자(admin): 회원 이름·입상 변경, 비밀번호 초기화(123456)
-- 09 실행 후 추가로 실행하세요.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- 사용자 역할/활성/이름/입상 변경
--  - 역할·이름·입상: admin만
--  - 활성 상태: admin, sub_admin
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

  if p_role is not null and p_role is distinct from v_target.role then
    if public.get_my_role() <> 'admin' then
      raise exception '사용자 역할은 관리자만 변경할 수 있습니다.';
    end if;
    if p_user_id = auth.uid() then
      raise exception '자기 자신의 역할은 변경할 수 없습니다.';
    end if;
    if v_target.is_guest then
      raise exception '게스트의 역할은 변경할 수 없습니다.';
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

  if p_name is not null then
    if public.get_my_role() <> 'admin' then
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
    if public.get_my_role() <> 'admin' then
      raise exception '입상 구분 변경은 관리자만 할 수 있습니다.';
    end if;
    update public.profiles set award_level = p_award_level where id = p_user_id;
  end if;
end;
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

  if public.get_my_role() <> 'admin' then
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

  -- 기존 세션 무효화 (테이블이 있는 환경에서만)
  if to_regclass('auth.sessions') is not null then
    delete from auth.sessions where user_id = p_user_id;
  end if;

  -- refresh_tokens.user_id 타입이 환경마다 다를 수 있어 실패해도 초기화는 유지
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
