begin;

-- This legacy RPC cannot identify a club. It previously deleted Auth users and
-- sessions, turning a club withdrawal into a platform-wide withdrawal.
-- Preserve the signature for compatibility, but fail closed.
create or replace function public.admin_remove_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_active_caller();

  if not public.is_admin_or_sub() then
    raise exception '관리자만 회원 탈퇴를 처리할 수 있습니다.';
  end if;

  raise exception '클럽을 지정하는 admin_withdraw_club_member_v2를 사용해주세요.';
end;
$$;

comment on function public.admin_remove_user(uuid) is
  'Blocked legacy global removal RPC. Use admin_withdraw_club_member_v2(club_id, user_id, reason).';

revoke execute on function public.admin_remove_user(uuid) from public, anon;
grant execute on function public.admin_remove_user(uuid) to authenticated;

commit;
