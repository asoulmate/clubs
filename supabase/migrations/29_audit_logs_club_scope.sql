-- ============================================================
-- 29_audit_logs_club_scope.sql
-- 수정 이력(match_audit_logs)은 해당 클럽 관리자/서브만 조회
-- (다른 클럽 이력이 섞여 보이지 않도록)
-- 28 실행 후 추가 실행
-- ============================================================

drop policy if exists "audit_logs_select_admin" on public.match_audit_logs;

create policy "audit_logs_select_club_admin"
  on public.match_audit_logs for select
  to authenticated
  using (
    exists (
      select 1
      from public.matches m
      where m.id = match_audit_logs.match_id
        and (
          public.is_platform_admin()
          or public.is_club_admin_or_sub(m.club_id)
        )
    )
  );

comment on policy "audit_logs_select_club_admin" on public.match_audit_logs is
  '경기의 club_id 기준으로 해당 클럽 관리자/서브(또는 플랫폼 슈퍼)만 조회. 화면에서는 추가로 현재 클럽만 필터.';
