-- ============================================================
-- 09_updates.sql
-- Auth 사용자 강제 삭제 시 profiles 자동 정리
--  - 경기/로그 등 참조가 있으면 is_active=false (기록 보존)
--  - 참조가 없으면 profiles 행 삭제
-- 08 실행 후 추가로 실행하세요.
-- ============================================================

create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_has_refs boolean;
begin
  if not exists (select 1 from public.profiles where id = old.id) then
    return old;
  end if;

  v_has_refs :=
    exists (select 1 from public.match_players where user_id = old.id or registered_by = old.id)
    or exists (
      select 1 from public.matches
      where created_by = old.id
         or score_submitted_by = old.id
         or confirmed_by = old.id
    )
    or exists (select 1 from public.score_confirmations where user_id = old.id)
    or exists (select 1 from public.match_audit_logs where changed_by = old.id)
    or exists (select 1 from public.app_settings where updated_by = old.id)
    or (
      to_regclass('public.unexcused_absences') is not null
      and exists (
        select 1 from public.unexcused_absences
        where user_id = old.id or registered_by = old.id
      )
    );

  if v_has_refs then
    update public.profiles
    set is_active = false,
        updated_at = now()
    where id = old.id;
  else
    delete from public.profiles where id = old.id;
  end if;

  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();

-- ------------------------------------------------------------
-- (선택) 이미 Auth에서만 삭제된 고아 프로필 정리
-- 필요 시 아래 주석을 해제하고 실행하세요.
-- ------------------------------------------------------------
-- -- 참조 없는 고아 프로필 삭제
-- delete from public.profiles p
-- where p.is_guest = false
--   and not exists (select 1 from auth.users u where u.id = p.id)
--   and not exists (select 1 from public.match_players mp where mp.user_id = p.id or mp.registered_by = p.id)
--   and not exists (
--     select 1 from public.matches m
--     where m.created_by = p.id or m.score_submitted_by = p.id or m.confirmed_by = p.id
--   )
--   and not exists (select 1 from public.score_confirmations sc where sc.user_id = p.id)
--   and not exists (select 1 from public.match_audit_logs al where al.changed_by = p.id);
--
-- -- 참조가 있는 고아 프로필은 비활성화
-- update public.profiles p
-- set is_active = false
-- where p.is_guest = false
--   and p.is_active = true
--   and not exists (select 1 from auth.users u where u.id = p.id);
