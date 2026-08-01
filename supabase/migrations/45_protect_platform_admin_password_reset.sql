begin;

-- Keep the legacy RPC available while the scoped-admin feature flag is OFF,
-- but never let a club administrator reset a platform administrator account.
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
    if not public.is_any_club_admin() then
      raise exception '비밀번호 초기화는 관리자만 할 수 있습니다.';
    end if;

    select * into v_target
    from public.profiles
    where id = p_user_id;

    if not found then
      raise exception '사용자를 찾을 수 없습니다.';
    end if;
    if v_target.is_guest then
      raise exception '게스트 계정은 비밀번호를 초기화할 수 없습니다.';
    end if;
    if v_target.is_platform_admin and not public.is_platform_admin() then
      raise exception '플랫폼 관리자 계정은 클럽 관리자가 초기화할 수 없습니다.';
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

  perform public.admin_reset_user_password_v2(
    v_club_id,
    p_user_id,
    'legacy compatible reset'
  );
end;
$$;

grant execute on function public.admin_reset_user_password(uuid) to authenticated;

commit;
