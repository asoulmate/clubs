# 38 Security Baseline 구현·전환 계획

## 문서 상태

- 기준일: 2026-08-01
- 기준 정책: `security-product-decisions.md`의 SEC-PROD-01~14
- 기준 운영 관찰: `supabase/checks/38_security_preflight.sql`의 사용자 실행 결과 04~16
- 상태: **Phase 1 로컬 구현 작성, DB 미실행**
- 이 문서에는 실행 가능한 SQL이 없다.

이번 Phase 1에서는 신규 migration을 로컬에만 작성한다. 애플리케이션 코드, 기존 migration, 운영 DB, 기존 RLS·함수·권한은 변경하지 않고 commit, push, PR도 수행하지 않는다. 특히 `123456` 초기화 값과 기존 URL·RPC는 전환 검증 전까지 유지한다.

2026-08-01 Phase 1 승인 후 `supabase/migrations/38_security_baseline_foundation.sql`과 읽기 전용 검증 파일을 로컬에 작성했다. 아직 staging·운영 DB에는 실행하지 않았으며 기존 애플리케이션 코드는 변경하지 않았다.

## 1. 목표와 완료 조건

목표는 기존 정상 기능을 유지하면서 클럽 간 권한 전파, 전역 계정 상태 오용, 과도한 함수 EXECUTE, 광범위한 child/profile SELECT와 Realtime 노출을 단계적으로 제거하는 것이다.

완료로 판단하려면 다음 조건을 모두 만족해야 한다.

1. 기존 26개 핵심 기능 회귀와 모든 필수 보안 테스트가 staging에서 통과한다.
2. 같은 클럽의 기존 허용 흐름, 반환 shape, URL, Realtime 화면 갱신이 유지된다.
3. 다른 클럽·pending·rejected·withdrawn·비활성 사용자의 직접 REST/RPC/Realtime 우회가 차단된다.
4. `123456` 초기화와 기존 session·refresh token 종료가 유지된다.
5. 운영 함수 signature, ACL, trigger 연결, RLS, publication을 배포 직전과 직후 다시 비교한다.
6. 한 단계 실패 시 아직 검증되지 않은 다음 단계로 진행하지 않는다.

## 2. 변경 불변 조건

| 영역 | 반드시 유지할 동작 |
|---|---|
| 인증 | 기존 로그인·로그아웃·가입 URL과 Auth 흐름 |
| 비밀번호 복구 | 승인된 대상의 `123456` 초기화와 기존 session·refresh token 종료 |
| 플랫폼 상태 | `profiles.is_active`는 플랫폼 전체 정지·복구 의미 |
| 클럽 상태 | 가입 승인·거절·탈퇴는 `club_members`에서만 처리 |
| 경기 | 단식·복식, 배팅·비배팅, 참가·제외, 시작, 제출·확인·확정, 관리자 정정·초기화 |
| 기록 | confirmed 경기, 통계 원천, 감사와 과거 참가자 참조 |
| 실시간 | 허용된 같은 클럽 사용자의 `matches`·`match_players` 화면 갱신 |
| 데이터 출력 | 결과, 선수 상세, CSV의 기존 열·정렬·수치 |
| 다중 클럽 | 한 클럽 변경이 다른 클럽 membership·경기·로그인에 영향 없음 |

## 3. 현재 운영 기준선

사용자가 제공한 preflight 결과를 구현 전 기준으로 고정한다.

- 대상 함수 25개에 overload 없음, owner는 `postgres`, 모두 SECURITY DEFINER이며 search path가 설정되어 있다.
- ACL 확인 대상 18개는 PUBLIC, anon, authenticated, postgres, service_role 모두 EXECUTE가 있고 anon/authenticated의 effective execute도 모두 true다.
- trigger 7개는 모두 활성 상태이며 저장소 예상 연결과 일치한다.
- 네 대상 table은 RLS enabled, force RLS는 아니다.
- `match_players`, `score_confirmations`, `profiles`의 authenticated SELECT는 `USING (true)`다.
- anon/authenticated/service_role의 대상 table privilege는 광범위하다.
- Realtime publication에는 `matches`, `match_players`가 포함된다.
- `club_members.status`는 enum이 아니라 `pending|active|rejected` text CHECK다.

이 기준과 다른 운영 상태가 배포 직전에 발견되면 작업을 중단하고 차이를 먼저 분류한다.

## 4. 구현 단위별 대상 명세

### 4.1 Additive 데이터 기반

미래의 신규 migration에서만 다음 기반을 추가한다. 기존 migration은 수정하지 않는다.

| 대상 | 미래 변경 명세 | 기존 호환 조건 |
|---|---|---|
| `club_members.status` CHECK | `withdrawn`을 additive하게 허용 | 기존 세 상태와 기본값 유지 |
| 보안 감사 저장소 | 비밀번호 초기화, 관리자 탈퇴, 자진 탈퇴, 플랫폼 영구 종료 event를 구분 | password/hash/token 저장 금지 |
| 감사 필드 | actor, target, target club/platform context, action, reason, result, timestamp, metadata 최소화 | 기존 `match_audit` 의미와 혼합하지 않음 |
| profile 최소 공개 경로 | row와 column을 함께 제한할 view/RPC 또는 column privilege 구조 | 기존 nested query의 이름·입상 표시를 대체할 수 있어야 함 |

`must_change_password`, club suspension column/status, `score_confirmations` publication 추가는 이번 baseline에 포함하지 않는다.

### 4.2 공통 권한 helper

| helper 범주 | 미래 책임 | 금지 사항 |
|---|---|---|
| 플랫폼 active 확인 | 호출자의 `profiles.is_active=true` 검증 | club 승인과 혼합 금지 |
| active membership 확인 | 명시된 club ID에서 `status='active'` 검증 | rejected/withdrawn/pending 허용 금지 |
| club 역할 확인 | 명시된 club ID의 main admin/sub_admin 역할 검증 | 전역 `is_any_club_admin()`만으로 대상 작업 승인 금지 |
| platform admin 확인 | `is_platform_admin=true`와 active 상태 검증 | 일반 club admin으로 대체 금지 |
| 대상 membership 개수 | pending/active만 비거절 관계로 계산 | rejected/withdrawn을 multi-club 수에 포함 금지 |

기존 helper signature를 즉시 없애지 않는다. 새 공개 경로가 명시적 club context helper를 사용하도록 전환한 뒤, 기존 helper 호출처와 외부 EXECUTE를 별도로 잠근다.

### 4.3 사용자 profile 수정

대상은 `admin_update_user`, `adminService.ts`, `UsersTab.tsx`, `profileService.ts`, `SettingsPage.tsx`, `prevent_privilege_change`다.

- 본인의 이름·입상 수정은 기존 설정 화면과 직접 self-update 흐름을 유지한다.
- main admin의 타인 수정은 대상 club을 명시하는 신규 경로로 전환한다.
- 단일 비거절 club 회원 또는 같은 단일 club guest만 main admin이 수정할 수 있다.
- 다중 club 대상은 플랫폼 관리자 경로만 허용한다.
- sub_admin과 타 club 관리자는 타인의 전역 profile을 수정하지 못한다.
- club 관리자 경로에서 `profiles.is_active` 인자를 제거하거나 무시·거부하고, 기존 토글 UI를 membership 상태 UI와 분리한다.
- legacy `admin_update_user`는 즉시 signature를 바꾸지 않고, 새 UI 전환 기간에는 엄격한 단일-club wrapper로만 남긴다.
- `prevent_privilege_change`는 role/is_active뿐 아니라 플랫폼 관리자 flag 등 보호 column의 self 변경을 차단하는지 별도 검증한다.

검증 묶음: P1~P15, A1~A14, 핵심 기능 2·3·22·25·26.

### 4.4 `123456` 비밀번호 초기화

대상은 `admin_reset_user_password`, `adminService.ts`, `UsersTab.tsx`다.

- `123456` 값과 성공 후 session·refresh token 종료는 변경하지 않는다.
- 신규 명시 경로는 target club과 사유를 받는다.
- 단일 club active 일반 회원/sub_admin은 같은 club main admin 또는 플랫폼 관리자만 처리한다.
- 다중 club·main admin 대상은 플랫폼 관리자만 처리한다.
- guest, pending, rejected, withdrawn, platform inactive, platform admin 계정, 자기 자신은 일반 경로에서 차단한다.
- 최초 로그인 비밀번호 변경 강제는 현재 off이며 관련 schema/UI를 추가하지 않는다.
- 성공 감사가 저장되지 않으면 비밀번호 변경도 성공으로 확정하지 않는 원자성 설계를 우선 검증한다.
- 실패 감사는 DB exception rollback과 분리된 채널이 필요하므로 구현 전 로깅 방식 기술 결정을 완료한다.
- legacy one-argument RPC는 신규 UI 전환 전까지 유지하되 단일 club을 안전하게 추론할 수 없는 대상은 거부한다.

검증 묶음: R1~R20, 핵심 기능 22, N6~N9.

### 4.5 클럽 탈퇴·자진 탈퇴

대상은 `admin_remove_user`, `adminService.ts`, `UsersTab.tsx`, 신규 self-withdraw service/UI, 가입 신청 경로다.

- 관리자 탈퇴 신규 경로는 target club과 사유를 명시한다.
- 같은 club main admin은 일반 회원/sub_admin/guest만 처리한다.
- sub_admin, 타 club 관리자, 자기 자신은 관리자 경로에서 차단한다.
- main admin 대상은 플랫폼 관리자 절차만 허용한다.
- 일반 회원/sub_admin의 자진 탈퇴는 관리자 RPC와 분리된 본인 전용 경로를 사용한다.
- 탈퇴는 membership을 삭제하지 않고 `withdrawn`으로 바꾸며 profile/auth/다른 club은 유지한다.
- 재가입은 같은 row를 `pending`, role `user`로 전환하며 이전 관리자 역할을 복원하지 않는다.
- `open`·`ready`·`canceled`의 target-club 슬롯만 정리한다.
- `in_progress`·`submitted`가 하나라도 있으면 전체 탈퇴를 차단한다.
- `confirmed` row와 통계 원천은 보존한다.
- 슬롯 정리, membership 변경, 감사 성공은 하나의 원자적 단위로 검증한다.
- 탈퇴 직후 해당 club URL·REST·RPC·Realtime 전체 접근을 차단한다.
- legacy `admin_remove_user(uuid)`의 전역 auth/profile 삭제 의미는 신규 경로 전환 전까지 운영 baseline으로만 기록하고, 새 UI가 전환된 뒤 안전 wrapper 또는 폐기 후보로 분리한다.

검증 묶음: W1~W49, MH1~MH12, A9~A13, N5.

### 4.6 플랫폼 정지·복구·영구 종료

대상은 플랫폼 관리자 전용 신규 절차와 `RequireAuth`, profile/session 처리다.

- 정지·복구만 `profiles.is_active`를 변경할 수 있다.
- 정지는 기존 Auth/profile/membership을 보존한다.
- 영구 종료는 일반 club RPC와 분리한다.
- 영구 종료 전 모든 club의 `in_progress`·`submitted` 참가를 검사하고 있으면 차단한다.
- 허용 시 Auth/session/token 제거, 전 membership withdrawn, profile 비활성·비플랫폼·user 전환, 이름 `탈퇴 회원`, award `none`, 허용 슬롯 정리, 감사를 수행한다.
- confirmed 기록과 profile UUID는 보존한다.
- 재가입은 새 Auth/profile UUID이며 과거 익명 profile과 자동 연결하지 않는다.
- platform admin 종료는 승계·복구 절차 없이는 거부한다.

검증 묶음: A6~A8, PT1~PT18, 핵심 기능 23.

### 4.7 경기 변경 RPC의 target-club 경계

기존 역할과 정상 기능을 유지하면서 전역 관리자 판정을 대상 경기의 club 판정으로 바꾼다.

| 대상 | 미래 최소 변경 | 호환 검증 |
|---|---|---|
| `register_player` | match club active membership과 대리 대상 membership 확인 | 본인·대리·guest, ready trigger |
| `remove_player` | 본인/등록자 예외 유지, 관리자 예외는 target club로 한정 | open/ready 전환, 탈퇴 직후 처리 |
| `start_match` | 참가자 또는 target club의 기존 허용 관리자 | 배팅 여부, 중복 진행 차단 |
| `submit_score`·`confirm_score` | 참가자 또는 target club 관리자 | single/double mode, version, audit |
| `create_match_lineup`·관리자 편성 | target club 관리자와 선수 membership | 단식/복식 position·중복 |
| `link_match_youtube`·`unlink_match_youtube` | 현재 일반 active 사용자 기능을 target club active 회원으로만 한정 | 수동·자동 연결, 중복 video ID |
| `internal_add_player` | 직접 외부 호출 차단, 상위 검증 후 내부 사용 | 생성·추첨·등록의 모든 호출 그래프 |

검증 묶음: 핵심 기능 7~18, N1~N4, Realtime 24.

### 4.8 통계 RPC

대상은 `get_player_stats`, `get_player_monthly_trend`, `get_player_recent_matches`와 관련 서비스다.

- 모든 club별 화면 호출은 명시적 club ID를 요구한다.
- NULL club은 전역 데이터 fallback으로 사용하지 않고 안전 오류로 처리하는 안을 우선한다.
- 호출자는 target club active 회원 또는 플랫폼 관리자여야 한다.
- 탈퇴·pending·rejected·withdrawn 사용자는 해당 club 통계를 조회하지 못한다.
- 반환 column, 정렬, 기간, 단식/복식 계산은 유지한다.
- 기존 UI가 이미 club ID를 전달하는지 빌드·network trace로 다시 확인한다.

검증 묶음: 핵심 기능 19·20·21, W41·W43·W44, PF10.

### 4.9 RLS, profile 최소 공개와 Realtime

| 대상 | 확정 경계 | 전환 조건 |
|---|---|---|
| `matches` | target club active/platform | 기존 목록·직접 URL 회귀 |
| `match_players` | 부모 match club active/platform | nested query와 Realtime 모두 통과 |
| `score_confirmations` | 부모 match club active/platform | 제출자·상대 팀 확인 화면 통과 |
| `profiles` | self, same-club 최소 필드, 접근 가능한 경기 표시 최소 필드, main admin 운영 필드, platform 전체 | row+column 강제 수단 필요 |
| Realtime | 권한 없는 client에 payload 자체 미전달 | 두 browser callback 증거 필요 |

`profiles`는 RLS만으로 column 경계를 만들 수 없으므로 기존 `.select('*')`를 유지한 채 정책만 좁히지 않는다. 먼저 제한된 조회 계약으로 서비스와 nested query를 전환하고, staging에서 모든 표시·CSV를 확인한 뒤 광범위한 table SELECT를 축소한다.

Realtime은 TECH-04에 따라 staging 병행 기간에만 기존 `matches`, `match_players` Postgres Changes를 유지한다. private Broadcast parity와 channel epoch 검증 후 client 의존과 두 table의 public publication 노출을 종료한다. `score_confirmations`는 publication에 추가하지 않으며 replica identity 변경도 이번 baseline에 포함하지 않는다.

검증 묶음: CR1~CR18, PF1~PF12, W40~W49, 핵심 기능 1·4~26.

### 4.10 함수 EXECUTE와 table privilege

preflight에서 확인된 광범위 권한은 기능 전환과 분리된 마지막 잠금 단계에서 축소한다.

| 분류 | 미래 원칙 | 필수 검증 |
|---|---|---|
| 공개 UI RPC | anon 금지, 필요한 authenticated 또는 platform 경로만 명시 | 실제 UI network 호출 전체 |
| 내부 helper | PUBLIC/anon/authenticated 직접 EXECUTE 회수 | owner 함수·trigger 내부 호출 유지 |
| trigger 함수 | 일반 role 직접 EXECUTE 회수 | 7개 trigger 모두 정상 실행 |
| table privilege | RLS와 API 사용에 필요한 최소 권한만 유지 | REST CRUD와 Realtime 회귀 |
| default privilege | 신규 함수가 PUBLIC EXECUTE를 자동 상속하지 않도록 관리 | 신규 함수 ACL preflight |

ACL 축소 실패를 해결하기 위해 PUBLIC EXECUTE나 `USING (true)`를 운영 rollback으로 다시 여는 것은 금지한다. 원인을 staging에서 해결한 다음 다시 배포한다.

## 5. 권장 배포 순서와 gate

각 단계는 독립 배포 후보이며 한 번에 합치지 않는다.

| 단계 | 내용 | 진입 gate | 완료 gate | 중단 조건 |
|---|---|---|---|---|
| 0 | 운영 preflight 재확인·staging 복제·baseline 고정 | 백업과 올바른 project 확인 | 04~16 결과와 26개 baseline 저장 | 운영 drift, fixture 부족 |
| 1 | additive `withdrawn`·감사·제한 조회 기반 | 단계 0 통과 | 기존 앱 무변경 회귀 100% | schema lock/성능/기존 query 변화 |
| 2 | 명시적 club-context 신규 RPC 병행 | 단계 1 통과 | 신규/legacy 계약 비교 완료 | 반환 shape·권한 matrix 불일치 |
| 3 | 관리자 profile·123456 UI/service 전환 | 단계 2 통과 | P/R/A 테스트 통과 | 123456·세션 종료 회귀 |
| 4 | 관리자/본인 탈퇴와 재가입 전환 | 단계 3 통과 | W/MH 테스트 통과 | 타 club 영향·부분 transaction |
| 5 | 경기·통계 RPC target-club 강화 | 단계 4 통과 | 핵심 경기/통계와 N 테스트 통과 | 같은 club 정상 흐름 실패 |
| 6 | profile 최소 조회 계약 전환 | 단계 5 통과 | PF·CSV·nested query 통과 | 이름 누락·관리 화면 중단 |
| 7 | child RLS·Realtime 축소 | 단계 6 통과 | CR 및 두 browser event 증거 | 허용 event 미수신/타 club payload 수신 |
| 8 | legacy wrapper 제한·ACL/table privilege 축소 | 단계 7 통과 | 함수별 ACL과 전체 회귀 통과 | trigger/helper 내부 호출 실패 |
| 9 | 플랫폼 영구 종료 기능 | 단계 8 안정화 | PT 테스트와 별도 운영 승인 | auth/profile 부분 종료 위험 |

현재 진행 상태: Phase 1 신규 migration과 SELECT-only 검증 SQL을 로컬 작성했다. staging 또는 운영 적용은 아직 하지 않았다. Phase 2는 Phase 1을 staging에 적용하고 24시간 관찰 gate를 통과하기 전에는 시작하지 않는다.

글로벌 레이팅 기반은 `global-rating-execution-plan.md`의 SG/GR gate를 따른다. Phase 1 gate 전에는 다음 실행 가능한 글로벌 migration을 작성하지 않으며, 실제 migration 번호는 보안 후속 migration과 충돌하지 않도록 착수 시점에 배정한다.

운영 배포는 단계별 staging 증거, 백업 확인, 담당자 승인 없이 진행하지 않는다.

## 6. 호환 전환 규칙

1. 기존 함수 signature를 직접 바꾸지 않고 명시적 context를 받는 신규 경로를 먼저 추가한다.
2. 프런트가 신규 경로로 완전히 전환되기 전 legacy RPC를 제거하지 않는다.
3. legacy wrapper는 신규 경로보다 넓은 권한을 가져서는 안 된다. context를 안전하게 추론하지 못하면 거부한다.
4. 기존 반환 shape와 사용자 메시지는 신규 서비스 adapter에서 유지하고, 의미가 바뀌는 탈퇴 메시지만 명확히 교체한다.
5. DB additive 단계는 이전 앱에서도 동작해야 한다. 이전 앱이 새 status를 잘못 처리하면 UI 전환 전 `withdrawn` 생성을 시작하지 않는다.
6. URL과 route guard는 유지하고 권한 실패 시 안전한 기존 안내 화면 또는 club 선택 화면으로 이동한다.
7. 기존 Realtime channel 이름과 화면 refresh 계약은 허용 사용자에게 유지한다.

## 7. rollback 원칙

| 시점 | 허용 rollback | 금지 rollback |
|---|---|---|
| additive 기반 직후 | 사용하지 않는 신규 경로 중단, 이전 앱 유지 | 기존 migration 수정·데이터 강제 삭제 |
| 신규 RPC 병행 중 | 프런트 feature 사용 중단, legacy 안전 wrapper 유지 | 취약한 legacy 본문으로 복귀 |
| 탈퇴/상태 전환 후 | 처리 중단 후 row·감사 증거로 개별 복구 검토 | withdrawn 이력 삭제, 타 club 일괄 변경 |
| RLS/ACL 축소 후 | 호환 query/RPC 수정 배포, 해당 단계 중단 | `USING (true)`, PUBLIC/anon EXECUTE 전면 재개 |
| 영구 종료 기능 | 신규 실행 즉시 중단, 보상 절차와 감사로 상태 확인 | 익명화된 profile을 추측값으로 복원 |

rollback은 항상 “이전 기능이 정상이며 취약 권한은 다시 열리지 않는 상태”를 목표로 한다. 이를 만족할 수 없으면 운영 적용 전 단계에서 중단한다.

## 8. 증거 저장 규칙

각 배포 후보마다 다음을 별도 폴더에 보존한다.

- 기준 commit과 migration 목록
- preflight 04~16 재조회 결과
- 함수 signature/owner/security/search_path/ACL 전후 비교
- 정책명, command, role, permissive, USING/WITH CHECK 전후 비교
- publication과 replica identity 비교
- staging 테스트 ID별 pass/fail, 실행 계정 역할, 대상 club, network 결과
- Realtime callback 수신/미수신 기록
- DB row 전후 snapshot은 개인정보를 제거한 fixture ID로만 저장
- password, hash, token, session 값은 저장하지 않음

## 9. 구현 착수 전 기술 결정

제품 정책 SEC-PROD-01~14와 구현 기술 결정 TECH-01~06이 모두 확정됐다.

| ID | 기술 결정 | 상태 |
|---|---|---|
| TECH-01 | 명시적 신규 RPC와 legacy wrapper 병행 방식 | **확정 / 2026-08-01** |
| TECH-02 | 감사 table 구조와 실패 시도 외부 로깅 채널 | **확정 / 2026-08-01** |
| TECH-03 | `profiles` column 최소 공개 수단 | **확정 / 2026-08-01** |
| TECH-04 | 탈퇴 직후 기존 Realtime subscription 차단 검증 방식 | **확정 / 2026-08-01** |
| TECH-05 | Auth 제거와 public transaction 사이의 보상 절차 | **확정 / 2026-08-01** |
| TECH-06 | 단계별 feature cutover와 운영 관찰 기간 | **확정 / 2026-08-01** |

### 확정 기술 결정 TECH-01: 명시적 신규 RPC와 legacy wrapper

1. target club과 사유가 필요한 보안 작업은 이를 인자로 받는 신규 RPC를 사용한다.
2. 기존 `admin_update_user`, `admin_reset_user_password`, `admin_remove_user`의 이름과 signature는 이번 baseline에서 삭제하거나 직접 변경하지 않는다.
3. legacy RPC는 단일 대상 club을 서버에서 안전하게 추론할 수 있을 때만 신규 권한 경계와 동일한 내부 경로로 위임한다.
4. 대상이 다중 club이거나, 비거절 membership이 없거나, 어느 club 작업인지 모호하면 legacy RPC는 상태를 변경하지 않고 안전하게 거부한다.
5. 신규 UI와 service는 명시적 club context RPC로 전환한다. legacy wrapper를 신규 화면의 정상 경로로 사용하지 않는다.
6. legacy wrapper는 신규 RPC보다 넓은 권한, 대상 유형, 상태 전환 또는 반환 데이터를 제공해서는 안 된다.
7. 기존 URL은 유지하며 UI 전환 전·후 반환 shape와 사용자 안내를 adapter에서 호환한다.
8. PostgREST overload 모호성을 피하기 위해 기존 이름에 인자만 추가하는 overload보다 별도 명시적 함수명을 우선한다.
9. 정확한 신규 함수명은 구현 diff 검토에서 확정하되 관리자 profile 수정, 비밀번호 초기화, club 탈퇴, 본인 탈퇴, 플랫폼 영구 종료를 서로 다른 공개 계약으로 분리한다.
10. legacy wrapper 제거는 이번 baseline 범위에 포함하지 않는다. 운영 사용량과 신규 UI 전환 증거를 별도 승인받기 전까지 signature를 유지한다.

TECH-01 검증 gate:

- 기존 클라이언트가 기존 signature를 호출해도 PostgREST 함수 선택 오류가 없어야 한다.
- 신규 클라이언트는 target club과 사유를 명시해야 한다.
- 단일 club의 기존 허용 흐름은 legacy와 신규 경로의 최종 DB 상태가 같아야 한다.
- 다중 club·타 club·권한 밖 대상은 두 경로 모두 같은 불변 상태로 거부되어야 한다.
- legacy wrapper를 직접 호출해 신규 정책을 우회할 수 없어야 한다.

### 확정 기술 결정 TECH-02: 보안 감사 저장과 실패 시도 로깅

1. 비밀번호 초기화, 관리자 club 탈퇴, 본인 자진 탈퇴, 플랫폼 정지·복구·영구 종료는 경기 감사와 분리된 전용 append-only 보안 감사 저장소에 기록한다.
2. DB 내부에서 끝나는 작업은 성공 감사와 실제 상태 변경을 같은 transaction에서 원자적으로 처리한다. 감사 저장이 실패하면 상태 변경도 성공으로 확정하지 않는다.
3. 감사 저장소에는 일반 사용자, anon, authenticated의 직접 INSERT·UPDATE·DELETE 권한을 주지 않는다.
4. 감사 기록은 외부 직접 EXECUTE가 불가능한 내부 helper를 통해서만 작성한다. 공개 RPC가 검증된 action context를 내부 helper에 전달한다.
5. 감사 조회는 이번 baseline에서 플랫폼 관리자 전용 명시 경로로 제한한다. 클럽 관리자에게 감사 table 직접 SELECT를 주지 않는다.
6. 예상된 권한 거부와 DB exception은 같은 transaction의 audit INSERT도 rollback시킬 수 있으므로, 실패 시도는 DB 성공 감사와 분리된 서버/API/Supabase 로그 채널에 기록한다.
7. 외부 실패 로그에는 correlation ID, actor ID 또는 인증 주체, action, target ID, target club/platform context, timestamp, 결과 code를 남긴다.
8. password, password hash, token, session 값, 초기화된 비밀번호 값, 종료 전 실제 이름은 DB 감사와 외부 실패 로그 모두에 기록하지 않는다.
9. 성공 DB 감사와 외부 요청 로그는 correlation ID로 연결하되 어느 한 로그가 민감값을 통해 다른 로그를 복원하게 해서는 안 된다.
10. 감사 row의 UPDATE·DELETE 경로와 자동 삭제 정책은 이번 baseline에 만들지 않는다. 법적 보존 기간이 별도로 승인될 때까지 append-only로 유지한다.
11. service_role 또는 DB owner를 사용한 유지보수는 일반 애플리케이션 경로와 분리하고 별도 운영 증거를 남긴다.
12. Auth Admin API가 포함된 플랫폼 영구 종료는 단일 DB transaction 예외다. TECH-05의 idempotent 작업 상태와 보상 절차를 사용하고 completed 전환과 최종 성공 감사를 함께 확정한다.

TECH-02 검증 gate:

- 성공 상태 변경마다 정확히 한 개의 성공 감사가 존재해야 한다.
- 감사 INSERT 실패 fixture에서는 비밀번호·membership·profile·Auth 관련 상태가 성공으로 남지 않아야 한다.
- 권한 거부·exception 시도는 DB rollback 여부와 무관하게 외부 로그에서 correlation ID로 확인되어야 한다.
- anon/authenticated가 감사 row를 직접 생성·수정·삭제·전체 조회할 수 없어야 한다.
- 로그 export에서 password/hash/token/session/종료 전 이름 문자열이 검출되지 않아야 한다.
- 플랫폼 관리자 조회 경로가 action·기간·target으로 필요한 감사를 확인할 수 있어야 한다.

### 확정 기술 결정 TECH-03: `profiles` 최소 공개 수단

1. base `profiles`의 authenticated table-level 전체 SELECT는 최종 cutover에서 제거한다.
2. 일반 표시용 `id`, `name`, `award_level`, `is_guest`만 column SELECT 대상으로 제한하고 row 범위는 RLS로 self·같은 active club·접근 가능한 경기 참가자에 한정한다.
3. 본인의 전체 profile은 고정 반환 계약의 self 전용 RPC로 조회한다.
4. main admin의 회원·신청 관리 목록은 target club 전용 RPC로 조회하며 최소 표시 필드와 `is_active`만 반환한다.
5. 플랫폼 관리자 전체 조회도 별도 platform RPC로 분리한다.
6. 기존 `.select('*')`는 명시적 최소 field 또는 역할별 전용 RPC로 먼저 전환한다.
7. 일반 조회에 view를 기본 수단으로 사용하지 않는다. view owner의 RLS 우회와 PostgREST nested 관계 손실 위험을 피한다.
8. SECURITY DEFINER 조회 RPC는 caller·target club을 직접 검증하고 고정 search path, 고정 반환 column, 최소 EXECUTE를 적용한다.
9. self 이름·입상 UPDATE는 유지하되 SELECT 범위와 분리하고 보호 column trigger 검증을 유지한다.
10. profile SELECT 축소는 모든 service와 nested query 전환이 staging에서 끝난 뒤에만 적용한다.

TECH-03 검증 gate:

- PF1~PF12가 모두 통과해야 한다.
- 임의 REST projection으로 타인의 role, platform flag, timestamp, is_active를 일반 회원이 읽을 수 없어야 한다.
- main admin은 target club의 필요한 is_active만 보고 변경은 할 수 없어야 한다.
- 경기 목록·결과·선수 상세·guest 표시·CSV에 이름 누락이 없어야 한다.
- 이전 앱의 `.select('*')`가 남아 있으면 table-level SELECT를 축소하지 않는다.

### 확정 기술 결정 TECH-04: private Broadcast와 channel epoch 회전

공식 Supabase 문서상 Postgres Changes의 DELETE event에는 RLS가 적용되지 않으며, private channel authorization 결과는 연결 동안 캐시된다. 따라서 Postgres Changes RLS만으로는 SEC-PROD-10/11의 즉시 차단을 만족할 수 없다.

1. 최종 Realtime 경로는 `matches`·`match_players` Postgres Changes 직접 구독이 아니라 club별 private Broadcast를 사용한다.
2. topic은 club ID와 서버 관리 channel epoch를 포함한다. epoch는 active membership이 제거되거나 권한 경계가 바뀔 때 회전한다.
3. epoch 회전 직전 기존 topic에는 데이터가 없는 재인증 신호만 보내고, 이후 모든 경기 event는 새 topic에만 보낸다.
4. active client는 재인증 신호를 받으면 권한 있는 REST/RPC로 새 epoch를 조회하고 기존 channel을 제거한 뒤 새 private channel에 가입한다.
5. withdrawn·rejected·pending·타 club 사용자는 새 epoch 조회와 새 private channel 가입이 모두 거부되어야 한다.
6. 오래 열린 client가 기존 topic을 유지해도 epoch 회전 이후 row ID나 변경 payload를 받지 못해야 한다.
7. Broadcast payload는 UI가 재조회하는 데 필요한 최소 action과 식별자만 포함하고 profile·점수 등 전체 row를 복제하지 않는다.
8. INSERT·UPDATE·DELETE 모두 같은 private Broadcast 계약을 사용하며 client는 event 수신 후 RLS 적용 fetch로 화면을 갱신한다.
9. staging 병행 기간에는 기존 Postgres Changes와 Broadcast를 동시에 관찰하되 UI 상태 변경은 한 경로만 적용한다.
10. Broadcast parity와 epoch 회전 검증 후 client의 Postgres Changes 의존을 제거하고, DELETE metadata 노출을 막기 위해 `matches`·`match_players`의 public publication 노출도 종료한다. `score_confirmations`는 publication에 추가하지 않는다.
11. JWT claim에 club membership을 넣지 않고 현재 DB membership을 private channel join 시 검사한다.
12. JWT 만료를 기다리거나 client의 자발적 unsubscribe만으로 탈퇴 직후 차단을 보장하지 않는다.

TECH-04 검증 gate:

- raw websocket을 유지한 탈퇴 client가 epoch 회전 후 INSERT·UPDATE·DELETE payload를 하나도 받지 않아야 한다.
- 탈퇴 client가 추측한 새 topic에 가입하려 해도 거부되어야 한다.
- 같은 club active client는 재가입 후 누락 없이 화면을 refresh해야 한다.
- 다른 club client에는 target club row ID나 변경 payload가 전달되지 않아야 한다.
- channel 중복·재연결·offline 복귀 상황에서 중복 UI 적용이나 무한 재가입이 없어야 한다.
- Broadcast cutover 전후의 최종 화면과 DB 상태가 기존 Realtime baseline과 같아야 한다.

근거 문서:

- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase database changes with Broadcast](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)

### 확정 기술 결정 TECH-05: 플랫폼 영구 종료 보상 절차

Auth Admin API와 public schema 변경을 하나의 DB transaction으로 묶을 수 없으므로 trusted server의 idempotent state machine과 재시도 가능한 보상 절차를 사용한다.

1. 영구 종료 orchestration은 browser가 아니라 JWT를 검증하는 trusted server/Edge Function에서 실행한다. service role secret을 client에 노출하지 않는다.
2. 요청마다 idempotency key와 correlation ID를 발급한다.
3. prepare 단계는 플랫폼 권한, target, Storage ownership, 진행 중 경기, platform admin 승계 조건을 검증하고 종료 작업 row를 만든다.
4. prepare 성공 즉시 `profiles.is_active=false`와 모든 접근 차단 상태를 먼저 확정해 기존 JWT가 남아 있어도 public RLS/RPC를 통과하지 못하게 한다.
5. public finalize 단계는 허용 슬롯 정리, 전 membership withdrawn, profile 익명화, 감사 준비를 하나의 DB transaction으로 처리한다.
6. Auth 단계는 server-side Auth Admin API로 session·refresh 경로를 종료하고 soft delete가 아닌 영구 Auth user 삭제를 실행한다.
7. Auth 삭제 성공 후 작업을 completed로 확정하고 최종 성공 감사를 남긴다.
8. public finalize 후 Auth 삭제가 실패하면 계정은 inactive·익명 상태로 유지하고 작업을 retryable failure로 기록한다. 실제 이름이나 membership을 자동 복원하지 않는다.
9. Auth 삭제 후 completed 기록이 실패하면 idempotent 재실행이 이미 삭제된 Auth user를 성공 상태로 인식하고 public 상태와 감사를 마무리한다.
10. 같은 idempotency key 재호출은 중복 슬롯 삭제·중복 감사·중복 profile 생성 없이 안전해야 한다.
11. Storage object owner 때문에 Auth 삭제가 불가능하면 prepare에서 차단하고 소유권 정리를 먼저 안내한다.
12. 신규 가입은 새 Auth/profile UUID를 사용하며 종료 job이 과거 익명 profile과 자동 병합하지 않는다.

TECH-05 검증 gate:

- prepare, public finalize, Auth delete, complete 각 지점의 강제 실패 fixture를 실행한다.
- 어느 실패 지점에서도 로그인 가능한데 membership/profile만 부분 종료된 상태가 없어야 한다.
- 이미 삭제된 Auth user에 같은 idempotency key를 재실행해 completed로 수렴해야 한다.
- 기존 JWT로 REST/RPC/Realtime 우회가 불가능해야 한다.
- service role secret이 browser bundle, network response, 로그에 없어야 한다.
- Auth 삭제 전 Storage ownership 검사가 실제 차단 조건과 일치해야 한다.

근거 문서:

- [Supabase Auth Admin deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
- [Supabase user deletion considerations](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)

### 확정 기술 결정 TECH-06: cutover와 관찰 기간

1. 한 운영 window에는 5절의 한 단계만 배포한다. DB 기반, app 전환, RLS/Realtime, ACL, 영구 종료를 한 번에 합치지 않는다.
2. 모든 단계는 staging 전체 회귀와 담당자 승인을 먼저 통과한다.
3. 운영 적용은 사용량이 낮고 담당자가 즉시 관찰 가능한 시간에 수행한다.
4. additive 기반 단계는 운영 24시간 관찰 후 다음 단계로 진행한다.
5. profile·123456·관리자 RPC 전환은 각각 최소 48시간 관찰한다.
6. 탈퇴, RLS/profile 최소 공개, Broadcast, ACL 축소는 각각 최소 72시간 관찰한다.
7. 플랫폼 영구 종료는 앞 단계가 최소 7일 안정화되고 별도 운영 승인을 받은 뒤 마지막에 활성화한다.
8. 신규 app 경로는 staging과 운영 test club에서 먼저 확인하되 실제 사용자 권한을 넓히는 feature flag는 사용하지 않는다.
9. legacy wrapper는 신규 경로 cutover 후에도 이번 baseline 동안 유지하며 직접 호출량과 거부율을 관찰한다.
10. 다음 중 하나라도 발생하면 현재 단계를 즉시 중단한다: cross-club row/event 1건, 허용된 `123456` 실패 1건, 감사 누락 1건, Auth 부분 종료 1건, confirmed 기록 변형 1건, 핵심 기능 치명적 회귀 1건.
11. 성능 경고 기준은 baseline 대비 p95 API 또는 Realtime 화면 반영 시간이 30% 이상 악화되거나 error rate가 1%를 넘는 경우다.
12. rollback은 7절 원칙을 따르며 PUBLIC EXECUTE, anon 권한, `USING (true)`를 다시 여는 방식은 사용하지 않는다.

TECH-06 완료 gate:

- 각 window의 시작·종료 시각, 배포 대상, baseline commit, preflight diff, 테스트 결과, 지표, 승인자를 기록한다.
- 관찰 기간 동안 중단 조건이 한 번도 발생하지 않아야 한다.
- 다음 단계 승인 전 현재 단계의 unresolved incident가 0건이어야 한다.
- legacy 호출량과 신규 경로 성공률을 민감값 없이 확인할 수 있어야 한다.

## 10. 현재 결론

- 구현 대상과 순서가 정의됐지만 구현 승인은 아직 없다.
- 기존 migration을 수정하지 않는다.
- 실행 가능한 migration, 함수, RLS, GRANT/REVOKE를 아직 작성하지 않는다.
- 운영 DB에서 어떤 SQL도 실행하지 않는다.
- 제품 정책과 구현 기술 결정은 모두 확정됐다. 다음 단계는 승인된 경우에만 staging용 신규 migration과 애플리케이션 변경을 별도 작업으로 시작하는 것이다.
