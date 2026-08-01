-- ============================================================
-- 39_security_scoped_rpc_foundation.sql
-- Additive security RPC foundation. Existing public RPC signatures remain.
-- Requires 38_security_baseline_foundation.sql.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.app_settings(key, value, description)
values (
  'security_scoped_admin_rpc_enabled', 'false'::jsonb,
  '명시적 club-context 관리자 RPC와 보호 profile 정책 cutover. 기본 OFF.'
)
on conflict(key) do nothing;

-- Protected account/identity columns may not be changed by browser callers.
-- Platform-account changes must use separately approved platform procedures.
create or replace function public.prevent_privilege_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- SQL migration/service operations have no end-user uid.
  if auth.uid() is null then
    return new;
  end if;

  if coalesce((public.get_setting('security_scoped_admin_rpc_enabled'))::boolean, false) = false then
    if new.role is distinct from old.role and public.get_my_role() <> 'admin' then
      raise exception '사용자 역할은 관리자만 변경할 수 있습니다.';
    end if;
    if new.is_active is distinct from old.is_active and not public.is_admin_or_sub() then
      raise exception '사용자 활성 상태는 관리자만 변경할 수 있습니다.';
    end if;
    return new;
  end if;

  if not public.is_platform_admin() and (
     new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.is_guest is distinct from old.is_guest
     or new.is_platform_admin is distinct from old.is_platform_admin
  ) then
    raise exception '보호된 플랫폼 계정 속성은 전용 플랫폼 절차에서만 변경할 수 있습니다.';
  end if;

  return new;
end;
$$;

create or replace function public.is_club_main_admin(p_club_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.club_members cm
      join public.profiles p on p.id = cm.user_id
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role = 'admin'
        and p.is_active
    );
$$;

create or replace function public.active_membership_count(p_user_id uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::integer
  from public.club_members cm
  where cm.user_id = p_user_id
    and cm.status = 'active';
$$;

create or replace function public.request_club_join(p_club_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not exists (select 1 from public.clubs where id = p_club_id) then
    raise exception '존재하지 않는 클럽입니다.';
  end if;
  insert into public.club_members(club_id, user_id, role, status)
  values (p_club_id, auth.uid(), 'user', 'pending')
  on conflict(club_id, user_id) do update
    set status = 'pending', role = 'user', updated_at = now()
  where club_members.status in ('rejected', 'withdrawn');
end;
$$;

create or replace function public.approve_club_member(
  p_club_id uuid, p_user_id uuid, p_approve boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();
  if not public.is_club_admin_or_sub(p_club_id) then
    raise exception '해당 클럽의 관리자/서브 관리자만 승인할 수 있습니다.';
  end if;
  update public.club_members
  set status = case when p_approve then 'active' else 'rejected' end,
      updated_at = now()
  where club_id = p_club_id and user_id = p_user_id and status = 'pending';
  if not found then raise exception '승인 대기 중인 회원을 찾을 수 없습니다.'; end if;

  -- Compatibility mode retains the current platform activation side effect.
  -- Scoped mode keeps platform account state independent from membership.
  if p_approve
     and coalesce((public.get_setting('security_scoped_admin_rpc_enabled'))::boolean, false) = false then
    update public.profiles set is_active = true where id = p_user_id;
  end if;
end;
$$;

create or replace function public.admin_update_user_v2(
  p_club_id uuid,
  p_user_id uuid,
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
  v_membership_count integer;
begin
  perform public.assert_active_caller();

  if p_club_id is null then
    raise exception '대상 클럽을 지정해야 합니다.';
  end if;
  if not public.is_club_main_admin(p_club_id) then
    raise exception '해당 클럽의 메인 관리자만 회원 정보를 수정할 수 있습니다.';
  end if;

  select p.* into v_target
  from public.profiles p
  join public.club_members cm on cm.user_id = p.id
  where p.id = p_user_id
    and cm.club_id = p_club_id
    and cm.status in ('pending', 'active');
  if not found then
    raise exception '대상 클럽의 사용자를 찾을 수 없습니다.';
  end if;

  v_membership_count := public.active_membership_count(p_user_id);
  if not public.is_platform_admin() and v_membership_count > 1 then
    raise exception '다중 클럽 회원의 전역 정보는 플랫폼 관리자만 수정할 수 있습니다.';
  end if;

  if p_name is not null then
    v_name := trim(p_name);
    if char_length(v_name) < 1 or char_length(v_name) > 30 then
      raise exception '이름은 1~30자로 입력해주세요.';
    end if;
    update public.profiles set name = v_name where id = p_user_id;
  end if;

  if p_award_level is not null then
    update public.profiles set award_level = p_award_level where id = p_user_id;
  end if;
end;
$$;

-- Existing signature stays available. It only infers a club when the context
-- is unambiguous; protected is_active changes are never accepted here.
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
  v_club_id uuid;
  v_target public.profiles;
  v_name text;
begin
  perform public.assert_active_caller();

  if coalesce((public.get_setting('security_scoped_admin_rpc_enabled'))::boolean, false) = false then
    select * into v_target from public.profiles where id = p_user_id;
    if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
    if p_role is not null then raise exception '클럽 역할은 관리자 화면의 클럽 권한 변경을 사용해주세요.'; end if;
    if p_is_active is not null and p_is_active is distinct from v_target.is_active then
      if not public.is_admin_or_sub() then raise exception '사용자 활성 상태는 관리자만 변경할 수 있습니다.'; end if;
      if p_user_id = auth.uid() then raise exception '자기 자신을 비활성화할 수 없습니다.'; end if;
      update public.profiles set is_active = p_is_active where id = p_user_id;
    end if;
    if p_name is not null then
      if not public.is_any_club_admin() then raise exception '이름 변경은 관리자만 할 수 있습니다.'; end if;
      v_name := trim(p_name);
      if char_length(v_name) < 1 or char_length(v_name) > 30 then raise exception '이름은 1~30자로 입력해주세요.'; end if;
      update public.profiles set name = v_name where id = p_user_id;
    end if;
    if p_award_level is not null then
      if not public.is_any_club_admin() then raise exception '입상 구분 변경은 관리자만 할 수 있습니다.'; end if;
      update public.profiles set award_level = p_award_level where id = p_user_id;
    end if;
    return;
  end if;
  if p_role is not null then
    raise exception '클럽 역할은 관리자 화면의 클럽 권한 변경을 사용해주세요.';
  end if;
  if p_is_active is not null then
    raise exception '플랫폼 활성 상태는 클럽 관리자 경로에서 변경할 수 없습니다.';
  end if;

  if public.is_platform_admin() then
    select cm.club_id into v_club_id
    from public.club_members cm
    where cm.user_id = p_user_id and cm.status in ('pending', 'active')
    order by (cm.status = 'active') desc, cm.created_at
    limit 1;
  else
    select (array_agg(cm.club_id order by cm.club_id))[1] into v_club_id
    from public.club_members cm
    join public.club_members caller
      on caller.club_id = cm.club_id
     and caller.user_id = auth.uid()
     and caller.status = 'active'
     and caller.role = 'admin'
    where cm.user_id = p_user_id
      and cm.status in ('pending', 'active')
    having count(*) = 1;
  end if;

  if v_club_id is null then
    raise exception '대상 클럽을 안전하게 확인할 수 없습니다. 명시적 클럽 경로를 사용해주세요.';
  end if;
  perform public.admin_update_user_v2(v_club_id, p_user_id, p_name, p_award_level);
end;
$$;

create or replace function public.admin_reset_user_password_v2(
  p_club_id uuid,
  p_user_id uuid,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_target public.profiles;
  v_membership public.club_members;
  v_active_clubs integer;
  v_correlation_id uuid := gen_random_uuid();
begin
  perform public.assert_active_caller();

  if p_club_id is null then
    raise exception '대상 클럽을 지정해야 합니다.';
  end if;
  if p_user_id = auth.uid() then
    raise exception '자기 자신의 비밀번호는 관리자 초기화할 수 없습니다.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception '초기화 사유를 1~500자로 입력해주세요.';
  end if;

  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;
  if v_target.is_guest then
    raise exception '게스트 계정은 비밀번호를 초기화할 수 없습니다.';
  end if;
  if v_target.is_platform_admin and not public.is_platform_admin() then
    raise exception '플랫폼 관리자 계정은 클럽 관리자가 초기화할 수 없습니다.';
  end if;
  if not v_target.is_active then
    raise exception '정지된 플랫폼 계정은 일반 초기화 경로를 사용할 수 없습니다.';
  end if;

  select * into v_membership
  from public.club_members
  where club_id = p_club_id and user_id = p_user_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception '대상 사용자는 해당 클럽의 active 회원이 아닙니다.';
  end if;

  v_active_clubs := public.active_membership_count(p_user_id);
  if not public.is_platform_admin() then
    if not public.is_club_main_admin(p_club_id) then
      raise exception '해당 클럽의 메인 관리자만 비밀번호를 초기화할 수 있습니다.';
    end if;
    if v_active_clubs <> 1 then
      raise exception '다중 클럽 회원은 플랫폼 관리자만 초기화할 수 있습니다.';
    end if;
    if v_membership.role = 'admin' then
      raise exception '클럽 메인 관리자는 플랫폼 관리자만 초기화할 수 있습니다.';
    end if;
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
  exception when others then
    null;
  end;

  insert into public.security_audit_events (
    correlation_id, action, actor_user_id, target_user_id,
    context_type, club_id, reason, metadata
  ) values (
    v_correlation_id, 'password_reset', auth.uid(), p_user_id,
    'club', p_club_id, trim(p_reason),
    jsonb_build_object('target_role', v_membership.role, 'active_club_count', v_active_clubs)
  );
end;
$$;

-- Legacy reset remains for compatible clients but only for an unambiguous
-- single shared club. Platform admins may safely choose any active target club.
create or replace function public.admin_reset_user_password(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_target public.profiles;
begin
  perform public.assert_active_caller();
  if coalesce((public.get_setting('security_scoped_admin_rpc_enabled'))::boolean, false) = false then
    if not public.is_any_club_admin() then raise exception '비밀번호 초기화는 관리자만 할 수 있습니다.'; end if;
    select * into v_target from public.profiles where id = p_user_id;
    if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
    if v_target.is_guest then raise exception '게스트 계정은 비밀번호를 초기화할 수 없습니다.'; end if;
    if not exists (select 1 from auth.users where id = p_user_id) then raise exception '로그인 계정이 없어 비밀번호를 초기화할 수 없습니다.'; end if;
    update auth.users
    set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')), updated_at = now()
    where id = p_user_id;
    if to_regclass('auth.sessions') is not null then delete from auth.sessions where user_id = p_user_id; end if;
    begin
      if to_regclass('auth.refresh_tokens') is not null then
        delete from auth.refresh_tokens where user_id::text = p_user_id::text;
      end if;
    exception when others then null;
    end;
    return;
  end if;
  if public.is_platform_admin() then
    select club_id into v_club_id
    from public.club_members
    where user_id = p_user_id and status = 'active'
    order by created_at
    limit 1;
  else
    select (array_agg(target.club_id order by target.club_id))[1] into v_club_id
    from public.club_members target
    join public.club_members caller
      on caller.club_id = target.club_id
     and caller.user_id = auth.uid()
     and caller.status = 'active'
     and caller.role = 'admin'
    where target.user_id = p_user_id
      and target.status = 'active'
    having count(*) = 1;
  end if;
  if v_club_id is null then
    raise exception '대상 클럽을 안전하게 확인할 수 없습니다. 명시적 클럽 초기화를 사용해주세요.';
  end if;
  perform public.admin_reset_user_password_v2(v_club_id, p_user_id, 'legacy compatible reset');
end;
$$;

create or replace function public.admin_withdraw_club_member_v2(
  p_club_id uuid,
  p_user_id uuid,
  p_reason text
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_membership public.club_members;
  v_correlation_id uuid := gen_random_uuid();
begin
  perform public.assert_active_caller();
  if p_club_id is null then
    raise exception '대상 클럽을 지정해야 합니다.';
  end if;
  if p_user_id = auth.uid() then
    raise exception '관리자 경로에서 자기 자신을 탈퇴 처리할 수 없습니다.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception '탈퇴 사유를 1~500자로 입력해주세요.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;

  select * into v_membership
  from public.club_members
  where club_id = p_club_id and user_id = p_user_id
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception '대상 사용자는 해당 클럽의 active 회원이 아닙니다.';
  end if;

  if not public.is_platform_admin() then
    if not public.is_club_main_admin(p_club_id) then
      raise exception '해당 클럽의 메인 관리자만 탈퇴 처리할 수 있습니다.';
    end if;
    if v_membership.role = 'admin' then
      raise exception '클럽 메인 관리자는 플랫폼 관리자만 탈퇴 처리할 수 있습니다.';
    end if;
  end if;

  if exists (
    select 1
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
    where m.club_id = p_club_id
      and mp.user_id = p_user_id
      and m.status in ('in_progress', 'submitted')
  ) then
    raise exception '진행 중이거나 확인 대기 중인 경기를 먼저 정리해주세요.';
  end if;

  delete from public.match_players mp
  using public.matches m
  where mp.match_id = m.id
    and m.club_id = p_club_id
    and mp.user_id = p_user_id
    and m.status in ('open', 'ready', 'canceled');

  update public.club_members
  set status = 'withdrawn', role = 'user', updated_at = now()
  where club_id = p_club_id and user_id = p_user_id;

  insert into public.security_audit_events (
    correlation_id, action, actor_user_id, target_user_id,
    context_type, club_id, reason, metadata
  ) values (
    v_correlation_id, 'admin_club_withdrawal', auth.uid(), p_user_id,
    'club', p_club_id, trim(p_reason),
    jsonb_build_object('previous_role', v_membership.role, 'is_guest', v_target.is_guest)
  );

  return 'club_withdrawn';
end;
$$;

create or replace function public.self_withdraw_club_v2(
  p_club_id uuid,
  p_reason text default 'self withdrawal'
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_membership public.club_members;
  v_correlation_id uuid := gen_random_uuid();
begin
  perform public.assert_active_caller();
  select * into v_membership
  from public.club_members
  where club_id = p_club_id and user_id = auth.uid()
  for update;
  if not found or v_membership.status <> 'active' then
    raise exception '해당 클럽의 active 회원이 아닙니다.';
  end if;
  if v_membership.role = 'admin' then
    raise exception '클럽 메인 관리자는 승계 후 탈퇴할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.matches m
    join public.match_players mp on mp.match_id = m.id
    where m.club_id = p_club_id and mp.user_id = auth.uid()
      and m.status in ('in_progress', 'submitted')
  ) then
    raise exception '진행 중이거나 확인 대기 중인 경기를 먼저 정리해주세요.';
  end if;

  delete from public.match_players mp
  using public.matches m
  where mp.match_id = m.id
    and m.club_id = p_club_id
    and mp.user_id = auth.uid()
    and m.status in ('open', 'ready', 'canceled');

  update public.club_members
  set status = 'withdrawn', role = 'user', updated_at = now()
  where club_id = p_club_id and user_id = auth.uid();

  insert into public.security_audit_events (
    correlation_id, action, actor_user_id, target_user_id,
    context_type, club_id, reason, metadata
  ) values (
    v_correlation_id, 'self_club_withdrawal', auth.uid(), auth.uid(),
    'club', p_club_id, left(coalesce(nullif(trim(p_reason), ''), 'self withdrawal'), 500),
    jsonb_build_object('previous_role', v_membership.role)
  );
  return 'club_withdrawn';
end;
$$;

-- Explicit platform account suspension/recovery remains separate from club state.
create or replace function public.platform_set_account_active_v2(
  p_user_id uuid,
  p_is_active boolean,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_correlation_id uuid := gen_random_uuid();
begin
  perform public.assert_active_caller();
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 계정 상태를 변경할 수 있습니다.';
  end if;
  if p_user_id = auth.uid() and not p_is_active then
    raise exception '자기 자신의 플랫폼 계정을 정지할 수 없습니다.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 then
    raise exception '사유를 1~500자로 입력해주세요.';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;

  update public.profiles set is_active = p_is_active, updated_at = now() where id = p_user_id;
  insert into public.security_audit_events (
    correlation_id, action, actor_user_id, target_user_id,
    context_type, reason, metadata
  ) values (
    v_correlation_id,
    case when p_is_active then 'platform_recover' else 'platform_suspend' end,
    auth.uid(), p_user_id, 'platform', trim(p_reason), '{}'::jsonb
  );
end;
$$;

-- Direct browser execution of internal and trigger helpers is not part of the API.
revoke execute on function public.prevent_privilege_change() from public, anon, authenticated;
revoke execute on function public.is_club_main_admin(uuid) from public, anon, authenticated;
revoke execute on function public.active_membership_count(uuid) from public, anon, authenticated;
revoke execute on function public.transfer_profile_refs(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.internal_add_player(uuid, uuid, public.player_position) from public, anon, authenticated;
revoke execute on function public.log_match_audit(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.sync_match_ready() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_auth_user_deleted() from public, anon, authenticated;

revoke execute on function public.admin_update_user_v2(uuid, uuid, text, public.award_level) from public, anon;
revoke execute on function public.admin_reset_user_password_v2(uuid, uuid, text) from public, anon;
revoke execute on function public.admin_withdraw_club_member_v2(uuid, uuid, text) from public, anon;
revoke execute on function public.self_withdraw_club_v2(uuid, text) from public, anon;
revoke execute on function public.platform_set_account_active_v2(uuid, boolean, text) from public, anon;
grant execute on function public.admin_update_user_v2(uuid, uuid, text, public.award_level) to authenticated;
grant execute on function public.admin_reset_user_password_v2(uuid, uuid, text) to authenticated;
grant execute on function public.admin_withdraw_club_member_v2(uuid, uuid, text) to authenticated;
grant execute on function public.self_withdraw_club_v2(uuid, text) to authenticated;
grant execute on function public.platform_set_account_active_v2(uuid, boolean, text) to authenticated;

commit;
