-- ============================================================
-- 08_updates.sql
-- 1) 신규 가입 승인 설정 (require_signup_approval)
-- 2) 게스트 프로필 (비밀번호 없는 수기 등록 선수)
-- 3) 회원가입 시 동명 게스트 → 실계정 연동
-- 4) 확정 경기에서도 관리자/서브관리자 참가자 등록 허용
-- 01~07 실행 후 추가로 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- profiles: auth.users FK 해제 + 게스트 구분 컬럼
-- (게스트는 auth 계정 없이 profiles 에만 존재)
-- ------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  add column if not exists is_guest boolean not null default false;

comment on column public.profiles.is_guest is
  'true면 비밀번호 미설정 게스트. 이후 동명 회원가입 시 실계정으로 연동됨.';

create index if not exists idx_profiles_guest_name
  on public.profiles (lower(trim(name)))
  where is_guest = true;

-- ------------------------------------------------------------
-- 설정: 신규 가입 승인 필요 여부
-- ------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('require_signup_approval', 'false',
   'true면 신규 가입 시 is_active=false로 생성되며, 관리자/서브관리자 활성화 후 이용 가능')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 게스트 프로필의 FK 참조를 신규 auth 사용자 id로 이전
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

-- ------------------------------------------------------------
-- 트리거: 회원가입 시 프로필 생성 + 게스트 연동 + 가입 승인
-- ------------------------------------------------------------
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

  -- 동일 이름 게스트 중 입상 구분이 일치하는 것을 우선 연동
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

-- ------------------------------------------------------------
-- 게스트 생성 (이름 + 입상 구분). 동일 이름·입상 게스트가 있으면 재사용
-- ------------------------------------------------------------
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

  -- 동일 이름·입상·활성 게스트가 있으면 재사용 (중복 프로필 방지)
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

-- ------------------------------------------------------------
-- 참가자 등록: 관리자/서브는 확정 경기 포함 비취소 경기에서 등록 가능
-- ------------------------------------------------------------
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

  if v_target_id <> auth.uid() and not v_allow_proxy and not public.is_admin_or_sub() then
    raise exception '다른 사용자를 대신 등록하는 기능이 현재 허용되지 않습니다.';
  end if;

  perform public.internal_add_player(p_match_id, v_target_id, p_position);
end;
$$;

-- ------------------------------------------------------------
-- 관리자 강제 변경: 취소 경기만 차단 (확정 경기는 허용)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 참가자 등록 공통: 게스트도 등록 가능하도록 메시지 정리
-- (06_updates의 assert_not_in_progress 검증 유지)
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
begin
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
