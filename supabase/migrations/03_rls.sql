-- ============================================================
-- 03_rls.sql
-- Row Level Security 정책
--
-- 설계 원칙:
--  * 조회(SELECT)는 로그인 사용자에게 허용
--  * 쓰기(INSERT/UPDATE/DELETE)는 테이블 직접 접근을 차단하고
--    SECURITY DEFINER RPC 함수를 통해서만 수행
--    → 클라이언트가 상태를 임의로 confirmed로 바꾸거나
--      확정 경기를 수정하는 것을 DB 차원에서 원천 차단
--  * 역할 검사는 클라이언트 전달 값이 아닌 get_my_role()로
--    DB에 저장된 실제 역할을 조회하여 판단
-- ============================================================

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.score_confirmations enable row level security;
alter table public.match_audit_logs enable row level security;
alter table public.app_settings enable row level security;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------

-- 로그인 사용자는 프로필 목록 조회 가능
-- (과거 경기 기록 표시를 위해 비활성 사용자도 조회 가능하되,
--  검색 화면에서는 is_active = true 필터를 기본 적용)
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- 본인 프로필 수정 (이름, 입상 구분만)
-- role / is_active 변경은 trg_prevent_privilege_change 트리거가 차단
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- INSERT는 회원가입 트리거(handle_new_user, SECURITY DEFINER)만 수행
-- DELETE 정책 없음 (탈퇴 대신 비활성화)

-- ------------------------------------------------------------
-- matches: 조회만 허용, 쓰기는 RPC 전용
-- ------------------------------------------------------------

create policy "matches_select_authenticated"
  on public.matches for select
  to authenticated
  using (true);

-- INSERT/UPDATE/DELETE 정책 없음
--  → create_match, submit_score, confirm_score, cancel_match,
--    admin_update_score, admin_reset_match RPC로만 변경 가능

-- ------------------------------------------------------------
-- match_players: 조회만 허용, 쓰기는 RPC 전용
-- ------------------------------------------------------------

create policy "match_players_select_authenticated"
  on public.match_players for select
  to authenticated
  using (true);

-- INSERT/UPDATE/DELETE 정책 없음
--  → register_player, remove_player, admin_set_player RPC로만 변경 가능
--  → 빈 슬롯 검증·중복 차단·대리 등록 설정은 RPC와 UNIQUE 제약이 보장

-- ------------------------------------------------------------
-- score_confirmations: 조회만 허용
-- ------------------------------------------------------------

create policy "score_confirmations_select_authenticated"
  on public.score_confirmations for select
  to authenticated
  using (true);

-- ------------------------------------------------------------
-- match_audit_logs: 관리자/서브 관리자만 조회
-- ------------------------------------------------------------

create policy "audit_logs_select_admin"
  on public.match_audit_logs for select
  to authenticated
  using (public.is_admin_or_sub());

-- ------------------------------------------------------------
-- app_settings: 전체 조회 가능, 변경은 관리자만
-- ------------------------------------------------------------

create policy "app_settings_select_authenticated"
  on public.app_settings for select
  to authenticated
  using (true);

create policy "app_settings_insert_admin"
  on public.app_settings for insert
  to authenticated
  with check (public.get_my_role() = 'admin');

create policy "app_settings_update_admin"
  on public.app_settings for update
  to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
