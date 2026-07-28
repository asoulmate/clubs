-- ============================================================
-- 27_admin_only_cancel_delete.sql
-- 경기 취소·삭제는 해당 클럽 관리자/서브만 가능 (일반 사용자 불가)
-- 26 실행 후 추가 실행
-- ============================================================

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

  if not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '관리자 또는 서브 관리자만 경기를 취소할 수 있습니다.';
  end if;

  v_before := public.match_snapshot(v_match);

  update public.matches
  set status = 'canceled', version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(p_match_id, 'cancel', v_before, null, p_reason);
end;
$$;

create or replace function public.delete_match(p_match_id uuid)
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

  if not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '관리자 또는 서브 관리자만 경기를 삭제할 수 있습니다.';
  end if;

  delete from public.matches where id = p_match_id;
end;
$$;

grant execute on function public.cancel_match(uuid, text) to authenticated;
grant execute on function public.delete_match(uuid) to authenticated;
