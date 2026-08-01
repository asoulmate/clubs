# Security function call map

## 범위와 판독 기준

이 문서는 기준 커밋 `d5b9746dc3f414c4c403030931ca4f1dc4778f87`의 저장소 SQL과 프런트엔드만 조사한 결과다. 운영 DB에는 접속하지 않았다. 따라서 owner, 실제 ACL, 실제 함수 본문과 migration 적용 순서는 `supabase/checks/38_security_preflight.sql`로 확인해야 한다.

`현재 예상 실행 권한`은 저장소에 보이는 `GRANT`와 PostgreSQL의 일반적인 함수 기본 권한을 바탕으로 한 예상일 뿐이다. 저장소에는 아래 함수의 `PUBLIC EXECUTE`를 명시적으로 회수한 기록이 없다. 운영 DB의 default privileges나 수동 SQL로 결과가 달라졌을 수 있다.

## 요약 분류

| 함수 | 분류 | 저장소상 최종 정의 | 직접 프런트 호출 |
|---|---|---|---|
| `admin_update_user` | 관리자 공개 RPC | `30_admin_permission_fixes.sql` | 있음 |
| `admin_reset_user_password` | 관리자 공개 RPC | `30_admin_permission_fixes.sql` | 있음 |
| `admin_remove_user` | 관리자 공개 RPC | `30_admin_permission_fixes.sql` | 있음 |
| `register_player` | 공개 경기 RPC | `08_updates.sql` | 있음 |
| `remove_player` | 공개 경기 RPC | `02_functions.sql` | 있음 |
| `start_match` | 공개 경기 RPC | `23_match_type_betting.sql` | 있음 |
| `submit_score` | 공개 경기 RPC | `23_match_type_betting.sql` | 있음 |
| `link_match_youtube` | 공개 경기 RPC | `12_updates.sql` | 있음 |
| `unlink_match_youtube` | 공개 경기 RPC | `12_updates.sql` | 있음 |
| `transfer_profile_refs` | 내부 helper | `08_updates.sql`에서 최종 재정의; `17_multi_club.sql`·`33_award_level_7_migrate.sql`의 가입 trigger 본문에서 호출 | 없음 |
| `internal_add_player` | 내부 helper | `23_match_type_betting.sql` | 없음 |
| `log_match_audit` | 내부 helper | `02_functions.sql` | 없음 |
| `get_player_monthly_trend` | 공개 통계 RPC | `17_multi_club.sql` | 있음 |
| `get_player_recent_matches` | 공개 통계 RPC | `17_multi_club.sql` | 있음 |

## 함수별 호출 및 보안 경계

| 함수 | signature / SECURITY DEFINER | 현재 예상 실행 권한 | 프런트 직접 호출 | 다른 RPC·trigger 호출 | 정상 기능에서의 역할 | 클럽 결정 및 호출자 확인 | 다른 클럽 접근 가능성 | 변경 영향과 검증 없이 변경하면 안 되는 이유 |
|---|---|---|---|---|---|---|---|---|
| `admin_update_user` | `(uuid, public.user_role, boolean, text, public.award_level) → void`; 예 | `authenticated` 명시 GRANT. PUBLIC 기본 권한 잔존 가능성은 preflight 필요 | `src/services/adminService.ts::adminUpdateUser`; `src/components/admin/UsersTab.tsx`의 편집·활성 전환 | 조사 범위에서 다른 RPC/trigger 호출 없음 | 이름, 입상 구분, 전역 `profiles.is_active` 수정. `p_role` 변경은 함수가 거부 | 클럽 ID를 받지 않는다. 이름/입상은 `is_any_club_admin()`, 활성은 `is_admin_or_sub()`로 어느 클럽이든 관리자/서브인지 검사 | 있음. 호출자와 대상이 같은 클럽인지 확인하지 않는다 | 사용자 편집·승인/활성 UI에 직접 영향. `is_active`의 플랫폼 정지/클럽 승인 의미가 미결정이고 다중 클럽 사용자의 전역 프로필에 영향을 주므로 제품 결정과 staging이 필요 |
| `admin_reset_user_password` | `(uuid) → void`; 예; `search_path=public, extensions` | `authenticated` 명시 GRANT. PUBLIC 여부 preflight 필요 | `src/services/adminService.ts::adminResetUserPassword`; `UsersTab.tsx::handleResetPassword` | 조사 범위에서 다른 RPC/trigger 호출 없음 | 비게스트 auth 사용자의 비밀번호를 `123456`으로 바꾸고 세션·refresh token 제거 | 클럽 ID 없음. `is_any_club_admin()`이면 통과. 대상 존재·비게스트·auth 계정 여부만 확인 | 있음. 공통 클럽, 대상 역할, 다중 클럽, 플랫폼 관리자 보호 검사가 없음 | 운영 필수 기능이며 함수와 화면을 유지해야 한다. 클럽 문맥을 signature 없이 추론하는 정책, 다중 클럽 처리, 감사 로그 방식이 미결정이므로 즉시 변경 금지 |
| `admin_remove_user` | `(uuid) → text`; 예 | `authenticated` 명시 GRANT. PUBLIC 여부 preflight 필요 | `src/services/adminService.ts::adminRemoveUser`; `UsersTab.tsx::removeUser` | 조사 범위에서 다른 RPC/trigger 호출 없음 | 미확정 경기 슬롯 제거 후 게스트 삭제/비활성, 회원 auth 계정 삭제 또는 프로필 비활성. 반환값으로 UI 메시지 결정 | 클럽 ID 없음. `is_admin_or_sub()`는 어느 클럽 관리자/서브도 허용. 대상이 어느 클럽 회원인지 확인하지 않음 | 있음. 다른 클럽 회원의 auth/profile과 전체 기록 관계에 영향 가능 | 클럽 membership 제거가 아니라 플랫폼 계정·profile 삭제/비활성 의미다. 다중 클럽과 기존 반환값/UI를 함께 검증하지 않고 변경하면 탈퇴 흐름과 기록 보존이 달라짐 |
| `register_player` | `(uuid, public.player_position, uuid DEFAULT NULL) → void`; 예 | 저장소에 대상별 명시 GRANT/REVOKE를 찾지 못함. PUBLIC 기본 권한 가능성 preflight 필요 | `src/services/matchService.ts::registerPlayer`; `RegisterSlotDialog.tsx` | `internal_add_player` 호출 | 본인 또는 대리 참가 등록. 취소 경기 차단, 상태·대리등록 설정 확인 | 경기 행은 읽지만 `club_id` membership 검증은 없다. 후기 상태/대리등록 예외에 전역 `is_admin_or_sub()` 사용. 대리 설정은 전역 `get_setting()` 사용 | 있음. 경기 UUID를 알면 다른 클럽 active 사용자를 등록할 가능성. 내부 helper도 대상 클럽 membership을 확인하지 않음 | 참가 가능 조건, 대리 등록, ready 전환 trigger, Realtime 갱신에 영향. 클럽별 설정과 전역 설정의 실제 운영 우선순위 확인 필요 |
| `remove_player` | `(uuid, public.player_position) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성 preflight 필요 | `src/services/matchService.ts::removePlayer`; `MatchCard.tsx` | 직접 DELETE 후 `sync_match_ready` table trigger가 동작 | 본인·등록자 또는 관리자에 의한 슬롯 제외 | 경기의 클럽 membership을 확인하지 않는다. 관리자 예외는 전역 `is_admin_or_sub()` | 있음. 다른 클럽 관리자 권한으로 타 클럽 슬롯 제거 가능성 | 본인/대리등록자 제거 규칙, 경기 상태, Realtime 이벤트와 연결되므로 클럽 검증만 최소 추가하더라도 동일 클럽 정상 시나리오 회귀 테스트 필요 |
| `start_match` | `(uuid) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성 preflight 필요 | `src/services/matchService.ts::startMatch`; `MatchCard.tsx` | `assert_active_caller`, `is_match_participant`, `assert_not_in_progress` 호출 | 배팅 경기의 `ready → in_progress` 전환 | 대상 경기 참가자이거나 전역 `is_admin_or_sub()`이면 통과. 명시적인 대상 클럽 membership 검사는 없음 | 관리자는 가능. 일반 사용자는 타 클럽 경기 참가자로 이미 들어가 있어야 가능 | 배팅 경기 전용 조건, 필요 인원, 진행 중 중복 방지와 연결. 대상 클럽 관리자 검사로 바꿀 때 플랫폼 관리자와 기존 서브관리자 흐름 검증 필요 |
| `submit_score` | `(uuid, integer, integer, integer) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성 preflight 필요 | `src/services/matchService.ts::submitScore`; `ScoreDialog.tsx` | `validate_score`, `match_snapshot`, `log_match_audit` 호출; `score_confirmations` 기록 | 점수 제출, 낙관적 잠금, 확인 기록 생성, single 모드 즉시 확정 | 참가자 또는 전역 `is_admin_or_sub()`. 설정은 대상 `matches.club_id`의 `confirm_mode`를 우선 사용 | 다른 클럽 관리자 가능성. 일반 사용자는 참가자여야 함 | 점수 확정 방식·무승부·필요 인원·version·상대 팀 확인과 결합. 권한 조건만 바꿔도 기존 관리자 대리 입력 회귀 검증 필수 |
| `link_match_youtube` | `(uuid, text, text DEFAULT NULL) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성 preflight 필요 | `src/services/youtubeService.ts::linkMatchYoutube`; `YoutubeLinkDialog.tsx`, 자동 연결 함수들 | 다른 helper 호출 없음 | 경기와 YouTube ID/제목 연결, 전역 video ID 중복 차단 | `assert_active_caller()`만 수행. 대상 경기 club membership/역할 확인 없음 | 있음. 로그인한 active 사용자가 타 클럽 경기 UUID를 알면 변경 가능성 | 수동·자동 연결과 클럽별 `youtube_enabled` UI 흐름에 영향. DB에서 허용 역할이 코드로 명시되지 않아 제품 정책 결정 필요 |
| `unlink_match_youtube` | `(uuid) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성 preflight 필요 | `src/services/youtubeService.ts::unlinkMatchYoutube`; `YoutubeLinkDialog.tsx` | 다른 helper 호출 없음 | 경기의 YouTube 연결 제거 | `assert_active_caller()`만 수행. 클럽/역할 검사 없음 | 있음 | 연결 함수와 같은 정책을 가져야 하는지, 참가자·일반회원·관리자 중 누구에게 허용할지 확인 전 변경 금지 |
| `transfer_profile_refs` | `(uuid, uuid) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성이 핵심 preflight 대상 | 직접 호출 없음 | `handle_new_user` trigger 함수가 게스트→가입자 병합 시 호출. 최신 계열은 경기·확인·감사·결석·클럽 관련 참조를 이동 | 신규 가입자와 동명 게스트의 참조 이전 | 함수 자체에 호출자/클럽 검증 없음. trigger의 SECURITY DEFINER 문맥을 전제로 함 | 직접 EXECUTE가 열려 있다면 임의 참조 이전 위험 | 가입, 게스트 병합, 과거 기록, 다중 클럽 membership에 광범위 영향. trigger 내부 호출은 유지하면서 외부 EXECUTE만 닫아야 하며 실제 ACL·owner 확인 필수 |
| `internal_add_player` | `(uuid, uuid, public.player_position) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성이 핵심 preflight 대상 | 직접 호출 없음 | `register_player`, `create_match`, `admin_set_player`, `create_match_lineup`에서 호출 | 선수 존재/활성, 진행 중 중복, unique 충돌 메시지를 공통 처리하고 슬롯 INSERT | 자체적으로 호출자 active/권한 또는 경기-대상 사용자 동일 클럽 membership을 확인하지 않음 | 직접 실행 권한이 열리면 높음. 공개 RPC 내부 사용 시에도 상위 RPC 검증에 의존 | 경기 생성·추첨·관리자 편성·일반 등록 모두 공유한다. 권한 회수는 내부 호출 유지 여부와 owner를 staging에서 확인해야 함 |
| `log_match_audit` | `(uuid, text, jsonb, jsonb, text DEFAULT NULL) → void`; 예 | 명시 GRANT/REVOKE 미발견; PUBLIC 가능성이 핵심 preflight 대상 | 직접 호출 없음 | `submit_score`, `confirm_score`, `cancel_match`, 관리자 점수 수정·초기화·편성 등에서 호출 | `auth.uid()`를 변경자로 경기 감사 로그 INSERT | 자체 권한·클럽 검증 없음. 상위 RPC가 검증했다고 가정 | 직접 실행이 열리면 타 경기 허위 감사 로그 삽입 가능성 | 점수·취소·관리자 기능의 감사 이력 공통 helper. 외부 권한만 닫고 상위 호출은 유지해야 하며 감사 로그 RLS와 owner 확인 필요 |
| `get_player_monthly_trend` | `(uuid, integer DEFAULT 12, uuid DEFAULT NULL) → TABLE(...)`; 예 | `authenticated` 명시 GRANT. PUBLIC 여부 preflight 필요 | `src/services/statsService.ts::fetchMonthlyTrend`; `PlayerDetailPage.tsx`는 항상 현재 club ID 전달 | 다른 RPC/trigger 호출 없음 | 선수 상세 월별 경기·승패·참여일 집계 | `p_club_id`가 있으면 platform admin 또는 active club member 검사. NULL이면 필터와 membership 검사를 모두 우회하는 조건 | 있음. 직접 RPC로 NULL 전달 시 모든 클럽의 확정 기록 집계 가능 | 프런트는 club ID를 전달하지만 기존 signature 기본값과 외부 호출자가 있을 수 있다. NULL 차단 시 숨은 클라이언트 호환성 확인 필요 |
| `get_player_recent_matches` | `(uuid, integer DEFAULT 10, uuid DEFAULT NULL) → TABLE(...)`; 예 | `authenticated` 명시 GRANT. PUBLIC 여부 preflight 필요 | `src/services/statsService.ts::fetchRecentMatches`; `PlayerDetailPage.tsx`는 현재 club ID 전달 | 다른 RPC/trigger 호출 없음 | 선수 상세 최근 경기, 파트너·상대 이름/입상 정보 조회 | monthly trend와 동일하게 NULL이면 전체 클럽 조회 조건이 됨 | 있음. 이름과 경기 점수까지 노출 가능 | 현재 UI 결과는 클럽 범위지만 직접 RPC 호환성과 반환 shape를 유지해야 한다. NULL 정책 결정과 staging 선수 상세 비교 필요 |

## 내부 호출 그래프

```text
auth.users INSERT trigger
  -> handle_new_user
     -> transfer_profile_refs

create_match / create_match_lineup / register_player / admin_set_player
  -> internal_add_player
     -> match_players INSERT
        -> sync_match_ready trigger

submit_score / confirm_score / cancel_match
admin_update_score / admin_reset_match / admin_set_player
  -> log_match_audit
     -> match_audit_logs INSERT
```

## 현재 정상 사용자 흐름과 보안 경계

| 정상 흐름 | 프런트 시작점 | 서비스/RPC 및 직접 조회 | 관련 helper·trigger·RLS |
|---|---|---|---|
| 로그인·로그아웃 | `LoginPage`, `authStore`, 레이아웃 | Supabase Auth `signInWithPassword`, `signOut`; `fetchMyProfile` | `profiles_select_authenticated`; 세션 후 `list_my_clubs` |
| 클럽 선택·진입·다중 클럽 전환 | `ClubSelectPage`, `ClubGate`, `clubStore` | `list_my_clubs`, `get_club_by_slug` | `clubs_select`, `club_members_select`, `club_settings_select` |
| 신규 가입 | `SignupPage` | Auth `signUp`에 `club_slug` metadata | `on_auth_user_created → handle_new_user → transfer_profile_refs`; profiles/club_members 생성 |
| 가입 승인·역할 변경 | `UsersTab` | `approve_club_member`, `set_club_member_role` | 대상 club ID가 RPC로 전달됨. `club_members` 정책은 조회에 사용 |
| 게스트 생성·검색 | 참가 등록 UI | `create_guest_profile`; `club_members`와 `profiles` 조인 검색 | RPC에 club ID 전달; `club_members_select`, `profiles_select_authenticated` |
| 경기 생성·복식 추첨 | 경기 생성 UI, draw UI | `create_match`, `create_match_lineup` | `internal_add_player`, `sync_match_ready`; matches/match_players Realtime |
| 참가 등록·제외 | `RegisterSlotDialog`, `MatchCard` | `register_player`, `remove_player` | `internal_add_player`, `sync_match_ready`; match_players Realtime |
| 경기 시작 | `MatchCard` | `start_match` | `is_match_participant`, `assert_not_in_progress`; matches Realtime |
| 점수 제출·상대 확인·확정 | `ScoreDialog`, `MatchCard` | `submit_score`, `confirm_score` | `score_confirmations_select_authenticated`; `log_match_audit`; matches Realtime |
| 관리자 점수 정정·초기화 | `MatchesTab` | `admin_update_score`, `admin_reset_match` | 대상 match의 club ID로 `is_club_admin_or_sub` 확인; `log_match_audit` |
| 경기 취소·삭제 | 경기/관리자 UI | `cancel_match`, `delete_match` | 최신 정의는 관리자 조건과 생성자 조건을 각각 사용; 감사 로그 및 cascade 영향 |
| YouTube 연결·해제 | `YoutubeLinkDialog`, 자동 연결 | `link_match_youtube`, `unlink_match_youtube` | active caller만 검사; matches Realtime로 화면 갱신 |
| 비밀번호 123456 초기화 | `UsersTab::handleResetPassword` | `admin_reset_user_password` | `is_any_club_admin`; auth.users 수정과 세션 제거. 감사 로그 없음 |
| 선수 상세·결과·통계 | `PlayerDetailPage`, 결과 페이지 | 통계 RPC, `get_player_monthly_trend`, `get_player_recent_matches` | 현재 UI는 club ID 전달; child table과 profiles 조회가 결과 이름 구성에 필요 |
| CSV 내보내기 | `ExportTab`, `exportService` | matches와 nested match_players/profiles, absences, bets 직접 SELECT | matches RLS와 child/profile RLS를 모두 통과해야 함 |
| 플랫폼 관리자 | `PlatformAdminPage` | `platform_*` RPC | `is_platform_admin()`; 클럽 생성·수정·삭제 정책은 별도 staging 필수 |

## RLS와 Realtime 관찰

- `matches_select_authenticated`는 `17_multi_club.sql`에서 대상 `matches.club_id`의 active membership 또는 platform admin으로 좁혀져 있다.
- `match_players_select_authenticated`, `score_confirmations_select_authenticated`, `profiles_select_authenticated`는 `03_rls.sql`의 `USING (true)`가 저장소상 최신이다. 자식 행 및 프로필이 모든 authenticated 사용자에게 보일 가능성이 있다.
- `useMatchesByDate`는 `matches`를 날짜로 필터링해 구독하고, `match_players`는 테이블 전체 이벤트를 필터 없이 구독한다. 이벤트를 받으면 `fetchMatchById()`로 다시 조회하여 현재 날짜·클럽인지 클라이언트에서 거른다.
- Realtime publication에는 저장소상 `matches`, `match_players`가 포함된다. `score_confirmations` publication 추가는 찾지 못했다.
- 자식 RLS를 parent match 기반으로 좁힐 때 nested SELECT, `fetchInProgressUserIds`, CSV 내보내기, 선수 상세, 상대 확인과 Realtime 이벤트 전달을 모두 검증해야 한다.

## 운영 DB에서 반드시 확인할 사항

1. 동일 signature 함수가 실제로 하나만 존재하는지와 저장소 최종 정의와의 drift
2. owner 및 `prosecdef`, 안전한 `search_path`
3. PUBLIC·anon·authenticated 실제 EXECUTE ACL
4. trigger가 실제 함수 OID와 연결되어 있는지
5. 세 자식/프로필 정책의 실제 적용 상태와 permissive/restrictive 속성
6. Realtime publication 및 replica identity
7. Supabase SQL Editor 수동 적용 이력과 `supabase_migrations.schema_migrations`의 일치 여부
