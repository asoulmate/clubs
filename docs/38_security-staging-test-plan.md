# 38 security staging test plan

## 목적과 상태

이 계획은 향후 별도 staging Supabase에서 변경 전 baseline과 변경 후 결과를 동일한 절차로 비교하기 위한 것이다. 현재 실행하지 않았으며 RLS/RPC가 검증되었다고 주장하지 않는다.

원칙:

1. 운영 데이터나 운영 인증 정보를 staging에 복사하지 않는다.
2. 아래 전용 계정과 합성 데이터만 사용한다.
3. 변경 전 기대 결과와 변경 후 기대 결과는 보안 음성 테스트를 제외하면 동일해야 한다.
4. 각 단계에서 브라우저 화면, 네트워크 응답, 관련 DB metadata/행 결과를 증거로 남긴다. 비밀번호와 token은 기록하지 않는다.
5. `운영 적용 차단=예`인 테스트가 하나라도 실패하면 운영 적용을 검토하지 않는다.

## 테스트 구성

| 식별자 | 구성 |
|---|---|
| `A_USER` | 클럽 A active 일반 회원, 다른 클럽 membership 없음 |
| `A_SUB` | 클럽 A active `sub_admin` |
| `A_ADMIN` | 클럽 A active main `admin` |
| `B_USER` | 클럽 B active 일반 회원, 다른 클럽 membership 없음 |
| `B_ADMIN` | 클럽 B active main `admin` |
| `AB_USER` | 클럽 A와 B 모두 active 일반 회원 |
| `PLATFORM_ADMIN` | `profiles.is_platform_admin=true`인 플랫폼 관리자 |
| `INACTIVE_USER` | `profiles.is_active=false`; membership 상태도 별도 기록 |
| `PENDING_USER` | 클럽 A `club_members.status=pending` |
| `A_GUEST` | auth 계정 없는 클럽 A active guest profile |

추가 데이터:

- 클럽 A/B에 단식·복식, 배팅·비배팅, 각 상태별 경기
- 확정 경기, YouTube 연결 경기, 취소 경기
- `AB_USER`, guest, 탈퇴/비활성 과거 선수가 포함된 확정 경기
- 점수 확인 mode `single`과 `double`, 대리 등록 on/off, 무승부 on/off 조합
- 두 브라우저 또는 서로 격리된 브라우저 profile로 Realtime 동시 검증

## 공통 증거

- UI screenshot와 URL/hash
- 사용자 역할, 대상 club, 수행 시각, 요청 RPC 이름과 성공/오류 코드
- 관련 테이블의 테스트 행 ID 및 상태 전후값(개인정보 제외)
- Realtime 수신 시각과 상대 브라우저 반영 시각
- 함수 signature/ACL/policy는 preflight·postcheck export로 별도 보존

## 회귀 테스트

| # | 테스트 | 사전조건 | 수행 계정 | 수행 절차 | 변경 전 기대 결과 | 변경 후 기대 결과 | DB에서 확인할 사항 | 실패 시 영향도 | 운영 적용 차단 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | 로그인·로그아웃 | 모든 테스트 계정 생성, 이메일 확인 상태 기록 | `A_USER` | 정상 비밀번호 로그인 → 새로고침 → 로그아웃 → 보호 URL 직접 접근 | 세션 복원, profile 조회, 로그아웃 후 로그인 이동 | 동일 | auth session 존재/종료, profile 읽기 가능. token 값은 출력 금지 | 치명적 | 예 |
| 2 | 클럽 선택 | A membership active | `A_USER` | 로그인 후 `/`에서 클럽 A 선택 | A가 표시되고 선택 가능 | 동일 | `list_my_clubs` 결과와 membership 상태 | 높음 | 예 |
| 3 | 여러 클럽 이동 | A/B membership active | `AB_USER` | A 진입 → B 진입 → A 재진입, 각 화면 새로고침 | 각 club 이름·역할·설정·데이터가 올바르게 전환 | 동일 | 각 club scoped 조회에 타 club 행이 섞이지 않음 | 치명적 | 예 |
| 4 | 회원가입 | 가입 허용 클럽 A, 새로운 이메일 | 신규 계정 | A signup URL로 가입, 이메일 확인/로그인 | profile과 A pending/active membership이 현재 설정대로 생성 | 동일 | `handle_new_user` trigger 연결, profile와 정확히 한 membership, guest 병합 여부 | 치명적 | 예 |
| 5 | 가입 승인 | `PENDING_USER` 존재 | `A_SUB`, `A_ADMIN` 각각 | 승인·거절 권한을 현재 UI대로 수행 | 현재 역할 정책대로 성공/실패, 승인 후 A 진입 가능 | 동일 | `club_members.status`, 역할, profile 전역 상태의 의도치 않은 변경 없음 | 높음 | 예 |
| 6 | 게스트 생성 | A active 회원, 고유 이름/입상/소속 | `A_USER` 또는 현재 허용 계정 | 참가자 검색에서 guest 생성 후 재검색 | A guest 생성·검색·재사용 규칙 유지 | 동일 | profile `is_guest`, A membership, 타 B membership 미생성 | 높음 | 예 |
| 7 | 경기 생성 | A active, 설정 조합 준비 | `A_USER` | 단식·복식과 배팅/비배팅 경기 생성 | 생성자가 A1, club/date/type/settings가 보존 | 동일 | matches.club_id, match_players, display_order, ready/open 상태 | 치명적 | 예 |
| 8 | 참가자 등록 | A open 경기, 빈 슬롯, 대리등록 on/off | `A_USER`, `A_ADMIN` | 본인 등록, 허용/비허용 대리 등록, guest 등록 | 현재 대리 설정과 역할에 따른 결과 | 동일 | position/user/registered_by, 중복 제약, target membership | 치명적 | 예 |
| 9 | 참가자 제외 | 본인/대리등록/관리자 슬롯과 open/ready/진행 상태 | `A_USER`, `A_SUB`, `A_ADMIN` | 각 슬롯 제외 시도 | 본인·등록자·관리자와 상태 규칙이 현재와 동일 | 동일 | match_players 삭제, ready/open trigger 전환 | 치명적 | 예 |
| 10 | 복식 편성 | A 선수 4명 이상, draw 조건 | `A_ADMIN` 또는 현재 허용 계정 | 추첨 후 `create_match_lineup` 실행 | A1/A2/B1/B2 정확히 생성 | 동일 | 4개 position, 중복 사용자 없음, `internal_add_player` 내부 호출 성공 | 치명적 | 예 |
| 11 | 경기 시작 | ready 배팅 경기와 비배팅 경기 | 참가자, `A_SUB`, `A_ADMIN` | 시작 버튼과 직접 UI 흐름 수행 | 배팅 ready만 현재 규칙대로 in_progress; 비배팅 메시지 유지 | 동일 | matches.status, 다른 진행 경기 중복 방지 | 치명적 | 예 |
| 12 | 점수 입력 | 필요 인원 충족, version 기록, single/double mode | 참가자, `A_ADMIN` | 유효/무효/동점/낙관적 충돌 점수 제출 | score 설정·version·confirm mode에 따른 현재 결과 | 동일 | scores, submitted_by/at, version, confirmation 초기화, audit | 치명적 | 예 |
| 13 | 상대 팀 점수 확인 | double mode submitted 경기, 양 팀 계정 | 상대 팀 참가자 | 제출자 확인 후 상대 팀에서 확인 | 상대 팀 확인이 기록되고 조건 충족 시 확정 | 동일 | score_confirmations의 user/team, 중복 제약 | 치명적 | 예 |
| 14 | 경기 확정 | single과 double mode 각각 준비 | 참가자들 | 제출/확인 전체 완료 | 현재 mode에 맞춰 confirmed, confirmed_by/at 기록 | 동일 | status, confirmations, version, audit | 치명적 | 예 |
| 15 | 관리자 점수 정정 | confirmed A 경기, 사유 준비 | `A_SUB`, `A_ADMIN` | 관리자 화면에서 점수 수정 | 현재 허용 역할만 성공, 사유와 새 점수 반영 | 동일 | 대상 club, scores, version, `admin_update_score` audit | 치명적 | 예 |
| 16 | 경기 초기화 | A submitted/confirmed 경기 | `A_SUB`, `A_ADMIN` | 사유 입력 후 초기화 | 점수·확인 제거, 인원에 따른 ready/open 복귀 | 동일 | scores null, confirmations 삭제, status/version, audit | 치명적 | 예 |
| 17 | 경기 취소·삭제 | 생성자 소유 미확정, confirmed, canceled 경기 | 생성자, `A_SUB`, `A_ADMIN` | 취소 후 삭제 및 권한 밖 시도 | 최신 관리자/생성자 정책과 cascade 동작 유지 | 동일 | matches 존재/삭제, child·audit cascade, 사유 | 치명적 | 예 |
| 18 | YouTube 연결·해제 | A youtube enabled, 연결되지 않은 video ID | 현재 UI에서 버튼이 보이는 역할들 | 수동 연결 → 해제 → 자동 연결 후보 수행 | 현재 허용 사용자와 중복/취소 규칙대로 동작 | 동일 | youtube fields/version, 타 match 중복 차단 | 높음 | 예 |
| 19 | 결과 집계 | A 확정 경기와 결석 데이터 | `A_USER` | 기간·단식/복식별 결과 화면 조회 | 순위, 승패, 득실, 참여일, 벌금 등 baseline과 동일 | 동일 | `get_player_stats` 반환 snapshot 비교 | 치명적 | 예 |
| 20 | 선수 상세 | A 선수에게 확정 경기·파트너·상대 존재 | `A_USER` | 선수 URL 직접/목록 진입, 월별·최근 경기 확인 | A 범위 수치·이름·순서 동일 | 동일 | monthly/recent RPC 결과 전체 열 비교, club ID 전달 확인 | 치명적 | 예 |
| 21 | CSV 내보내기 | A 기간 데이터, guest/과거 선수/배팅/결석 포함 | `A_SUB`, `A_ADMIN` | 관리자 데이터 탭에서 모든 export 수행 | 행 수, 헤더, 이름, 점수, 정렬이 baseline과 동일 | 동일 | nested matches/match_players/profiles 조회 성공, 타 club 미포함 | 높음 | 예 |
| 22 | 123456 초기화 | 각 대상 유형, 원래 비밀번호와 세션 준비 | `A_ADMIN`, `A_SUB`, `B_ADMIN`, `PLATFORM_ADMIN` | 정책 결정표에 따라 초기화 → 기존 세션 확인 → 123456 로그인 | 현재 baseline은 `is_any_club_admin` 허용 범위를 기록 | 승인된 새 정책의 성공/실패만 달라지고 123456 성공 흐름은 유지 | auth password 변경 여부(값 출력 금지), 세션 종료, 감사 로그 metadata | 치명적 | 예 |
| 23 | 플랫폼 관리자 기능 | platform 계정과 A/B club | `PLATFORM_ADMIN` | club 목록·생성·수정·기능 flag·삭제를 합성 club로 수행 | 현재 platform UI/RPC 동작 | 동일 | platform 권한, 대상 club 데이터, 타 club 영향 없음 | 치명적 | 예 |
| 24 | Realtime 경기·참가자 | 브라우저 1/2 모두 A active, 같은 날짜 화면 | `A_USER` 두 세션 + 관리자 | 한쪽에서 경기/선수 INSERT·변경·삭제, 다른 쪽 관찰 | 새로고침 없이 대상 A 화면 갱신; B 이벤트는 A에 표시 안 됨 | 동일하며 권한 밖 이벤트 자체 노출 여부도 기록 | publication, replica identity, RLS에 따른 event, 후속 fetch 성공 | 치명적 | 예 |
| 25 | 기존 URL 직접 접근 | 배포 base/hash 목록 준비 | guest, A/B 회원, admin | 로그인·signup·club index·results·player·settings·admin·platform URL 직접 열기/새로고침 | 기존 guard와 공유 링크 모두 정상 | 동일 | 네트워크 404 없음, 올바른 RLS/RPC 호출 | 치명적 | 예 |
| 26 | 모바일 주요 화면 | 실제 모바일 또는 viewport, 느린 네트워크 profile | `A_USER`, `A_ADMIN` | 로그인, club, 경기 등록/점수, 결과, 선수 상세, admin reset 확인 | 버튼·dialog·scroll·toast와 기능이 baseline과 동일 | 동일 | desktop과 같은 DB 결과, 중복 제출 없음 | 높음 | 예 |

## 보안 음성 테스트

아래는 변경 후에만 성공(즉, 요청 거부)해야 하며 기존 baseline의 취약 가능성은 실제 운영이 아닌 staging에서만 기록한다.

| ID | 시도 | 수행 계정 | 기대 결과 | 확인 사항 | 차단 |
|---|---|---|---|---|---|
| N1 | 자신의 `is_platform_admin`, `is_guest`, `is_active`, `role` 직접 UPDATE | `A_USER` | 거부, 네 값 불변 | 정상 name/award update는 별도 성공 | 예 |
| N2 | 클럽 B 경기 UUID로 참가 등록/제외 | `A_USER`, `A_ADMIN` | 거부 | match_players 불변, audit 위조 없음 | 예 |
| N3 | 클럽 B 경기 시작·점수 제출 | `A_ADMIN` | 거부 | status/version/score 불변 | 예 |
| N4 | 클럽 B YouTube 연결·해제 | A의 허용 역할 | 승인된 제품 정책대로 거부 | youtube fields 불변 | 예 |
| N5 | B 전용 회원 정보 수정·삭제 | `A_ADMIN`, `A_SUB` | 거부 | profile/auth/membership 불변 | 예 |
| N6 | B 전용 회원 123456 초기화 | `A_ADMIN` | 거부, 기존 비밀번호 유지 | 실패 감사 정책은 별도 결정 | 예 |
| N7 | 플랫폼 관리자 또는 다른 main admin 초기화 | `A_ADMIN` | 선택된 정책대로 거부 | auth/session 불변 | 예 |
| N8 | 다중 클럽 회원 초기화 | `A_ADMIN` | 선택된 다중 클럽 정책과 일치 | 전체 계정 영향·감사 확인 | 예 |
| N9 | helper 직접 RPC 실행 | `A_USER` | permission denied | 공개 상위 RPC는 계속 성공 | 예 |
| N10 | B의 `match_players`/`score_confirmations` 직접 SELECT·Realtime | `A_USER` | 행/이벤트 비노출 | A 데이터는 정상 | 예 |
| N11 | 통계 RPC에 NULL club ID | `A_USER` | 결정된 호환 정책대로 오류 또는 안전한 단일-club 추론 | B 데이터 비노출 | 예 |
| N12 | pending/rejected/inactive 계정의 club 데이터 접근 | 각 계정 | 제품 결정과 정확히 일치 | 화면과 직접 API 모두 동일 | 예 |

## SEC-PROD-01 전용 회귀 테스트: 플랫폼 활성과 클럽 상태 분리

다음 테스트는 확정된 제품 정책을 구현하는 미래 변경에 필수다. 현재 운영 DB에서는 실행하지 않았으며 모두 `미검증`이다.

| ID | 사전조건 | 수행 계정 | 절차 | 변경 전 baseline | 변경 후 기대 결과 | DB 확인 | 차단 |
|---|---|---|---|---|---|---|---|
| A1 | 가입 승인 필요인 클럽 A | 신규 사용자 | A로 가입 후 로그인·클럽 진입 시도 | 현재는 profile false + A pending, 전역 비활성 화면 가능 | profile은 플랫폼 active, A membership만 pending이며 A 데이터 접근 불가 | profile true, A status pending, 쓰기/조회 경계 | 예 |
| A2 | `AB_USER`는 A pending, B active | `AB_USER` | 로그인 후 A 진입 실패 확인, B 진입·경기 기능 수행 | 현재 profile false이면 B도 차단될 가능성 | A만 대기, B는 정상 이용 | profile true, A pending, B active | 예 |
| A3 | A pending 사용자 | `A_SUB`, `A_ADMIN` | A 가입 승인 | 현재 membership active와 profile true를 함께 갱신 | A membership만 active; profile 값은 변경되지 않음 | profile before=after, A status active | 예 |
| A4 | A pending 사용자 | `A_SUB`, `A_ADMIN` | A 가입 거절 | membership rejected | 동일, profile 값 불변 | A rejected, profile before=after | 예 |
| A5 | A/B active 다중 클럽 사용자 | `A_ADMIN`, `A_SUB` | 기존 활성 토글 UI 및 직접 `admin_update_user(p_is_active)` 시도 | 현재 전역 profile 변경 가능 | club 관리자 경로에서는 거부되고 profile/B membership 불변 | profile true, A/B membership 불변 | 예 |
| A6 | A/B active 다중 클럽 사용자 | `PLATFORM_ADMIN` | 승인된 플랫폼 정지 절차 수행 | 전용 절차 baseline 없음 | profile false가 되고 A/B 모두 로그인 보호 화면·쓰기 차단 | profile false, membership 행은 보존 | 예 |
| A7 | A6의 정지 사용자 | `PLATFORM_ADMIN` | 승인된 플랫폼 복구 수행 | 전용 절차 baseline 없음 | profile true 복구; 기존 membership 상태는 자동 변경되지 않음 | profile true, A/B status 원값 유지 | 예 |
| A8 | profile false, A pending, B active인 합성 fixture | `PLATFORM_ADMIN` | profile 복구 후 A/B 진입 | 현재 의미 혼합 | B만 이용 가능, A는 계속 pending | profile true, A pending, B active | 예 |
| A9 | A active/B active 사용자 | `A_ADMIN` | A club 탈퇴 처리 | 현재 auth/profile 전체 삭제·비활성 가능 | 승인된 club 탈퇴 의미에 따라 A만 영향, B/auth/profile 유지 | A membership 변화, B·auth·profile 불변 | 예 |
| A10 | 참조 있는 일반 회원의 플랫폼 전체 탈퇴 | 승인된 플랫폼 절차 | 전체 계정 종료 | 현재 admin_remove_user가 club UI에서 수행 | auth 종료 및 기록 profile 보존 정책대로 처리, 모든 club에서 동일 | auth/profile/membership/과거 기록 일관성 | 예 |
| A11 | 참조 있는 A guest | `A_ADMIN` | guest를 A에서 제거 | 현재 profile false로 전역 비활성 가능 | guest의 다중 club/기록 정책 결정과 일치하며 타 club 영향 없음 | target club membership과 과거 match 참조 | 예 |
| A12 | profile false 사용자 | 본인 | 로그인·직접 RPC·기존 URL 접근 | 전역 차단 | 동일하게 전역 차단 | `assert_active_caller`, route guard, RLS helper 결과 | 예 |
| A13 | profile true + A rejected | 본인 | A 재신청, B 이용 | 현재 재신청 RPC 존재 | A는 rejected→pending 규칙, B는 계속 정상 | profile 불변, A만 pending | 예 |
| A14 | 일시정지 schema 미도입 | A 관리자 | club별 일시정지 UI/직접 호출 탐색 | 기능 없음 | 기능 없음 유지; rejected를 정지로 사용하지 않음 | status가 세 허용값만 유지 | 예 |

### 일시정지 모델을 선택할 경우 추가 테스트

- `suspended` 상태안: active→suspended→active 전이, 재가입/승인과의 충돌, 모든 RLS와 `list_my_clubs`, URL gate, 과거 기록 조회를 검증한다.
- 별도 활성 컬럼안: `pending/rejected`와 enabled 조합의 허용·금지 matrix, 기존 행 default, 모든 `status='active'` 쿼리의 enabled 조건 반영을 검증한다.
- 보류안: 기존 세 상태만 존재하고 UI·RPC 어디에서도 rejected를 정지 의미로 표시하거나 변경하지 않는지 확인한다.

## SEC-PROD-02 전용 회귀 테스트: 전역 이름·입상 수정

| ID | 사전조건 | 수행 계정 | 절차 | 변경 전 baseline | 변경 후 기대 결과 | DB·화면 확인 | 차단 |
|---|---|---|---|---|---|---|---|
| P1 | 플랫폼 active 단일 club 회원 | `A_USER` | 설정에서 본인 이름·입상 변경 | 성공 | 동일하게 성공 | profile 두 필드만 변경, A 화면·통계 이름 반영 | 예 |
| P2 | `A_USER` | `A_ADMIN` | A 관리자 화면에서 이름·입상 수정 | 성공 | 동일하게 성공 | 대상의 비거절 membership은 A 하나, 다른 profile 필드 불변 | 예 |
| P3 | `A_USER` | `A_SUB` | UI 및 직접 RPC로 이름·입상 수정 | UI 버튼 없음, RPC 거부 예상 | 명시적으로 거부 | profile 불변 | 예 |
| P4 | `B_USER` | `A_ADMIN` | B 전용 회원 ID로 직접 관리자 RPC 호출 | 현재 성공 가능 | 거부 | B profile·membership·과거 표시 불변 | 예 |
| P5 | A/B active `AB_USER` | `A_ADMIN` | A 화면/직접 RPC로 수정 | 현재 성공 가능 | 거부하고 다중 club 안내 | 전역 profile 불변, A/B 표시 동일 | 예 |
| P6 | A/B active `AB_USER` | `PLATFORM_ADMIN` | 승인된 platform 정정 절차 수행 | platform admin은 가능 | 성공 | A/B 및 과거 기록에 동일한 새 값 반영 | 예 |
| P7 | A active + B pending 사용자 | `A_ADMIN` | 이름·입상 수정 | 현재 성공 가능 | 다중 비거절 membership이므로 거부 | A/B membership과 profile 불변 | 예 |
| P8 | A active + B rejected 이력 사용자 | `A_ADMIN` | 이름·입상 수정 | 현재 성공 가능 | 단일 비거절 club으로 판단하여 성공 | rejected 이력이 권한을 부여하지 않음 | 예 |
| P9 | A 전용 guest | `A_ADMIN` | guest 이름·입상 수정 | 성공 | 동일하게 성공 | guest flag·membership·과거 match 참조 유지 | 예 |
| P10 | B 전용 guest | `A_ADMIN` | 직접 RPC 수정 | 현재 성공 가능 | 거부 | guest profile 불변 | 예 |
| P11 | 여러 비거절 club에 속한 guest fixture | 각 club admin | 수정 시도 | 현재 성공 가능 | 거부, platform admin만 가능 | 모든 club 표시 불변 | 예 |
| P12 | 플랫폼 정지된 본인 | 정지 사용자 | 직접 profile UPDATE | 현재 RLS상 성공 가능성 | 전역 차단 원칙에 따라 거부 | name/award 불변 | 예 |
| P13 | 본인 이름 공백·31자, 잘못된 award | `A_USER` | UI 우회 직접 UPDATE 시도 | name constraint/enum으로 거부 | 동일 | constraint 오류, 기존 값 유지 | 예 |
| P14 | 단일 club 회원의 수정 전 과거 경기·통계 존재 | 본인, `A_ADMIN` | 승인된 수정 후 결과·선수 상세·CSV 조회 | 최신 profile 값 표시 | 동일 | 계산 수치·URL·경기 row 불변, 표시값만 변경 | 예 |
| P15 | 동시 본인/관리자 수정 | `A_USER`, `A_ADMIN` | 두 세션에서 순차·동시 저장 | 마지막 write 반영 가능 | 현재 baseline의 마지막 write 동작 유지 | 의도치 않은 다른 필드 overwrite 없음 | 예 |

## SEC-PROD-03/04/05 전용 회귀 테스트: 123456 초기화

모든 성공 테스트는 기존 비밀번호 값과 hash를 출력하지 않고, 초기화 후 별도 로그인 시도로만 `123456` 적용 여부를 확인한다.

| ID | 사전조건 | 수행 계정 | 절차 | 변경 전 baseline | 변경 후 기대 결과 | DB·감사 확인 | 차단 |
|---|---|---|---|---|---|---|---|
| R1 | A 전용 active 일반 회원 | `A_ADMIN` | 사유 입력 후 초기화 | 성공 | 성공, 기존 session 종료 | actor/target/A/reason/success/single-club 기록, password 미기록 | 예 |
| R2 | A 전용 active 일반 회원 | `A_SUB` | UI 우회 직접 RPC | 현재 `is_any_club_admin` 때문에 거부 예상 | 거부 | auth/session/profile/audit success 불변 | 예 |
| R3 | B 전용 active 일반 회원 | `A_ADMIN` | 대상 ID로 직접 RPC | 현재 성공 가능 | 거부 | B 계정·session 불변 | 예 |
| R4 | A 전용 active `sub_admin` | `A_ADMIN` | 사유 입력 후 초기화 | 성공 가능 | 성공 | 대상 role 불변, 성공 감사 | 예 |
| R5 | A 전용 active main admin | 다른 `A_ADMIN` fixture | 초기화 시도 | 현재 성공 가능 | 거부 | 대상 auth/session 불변 | 예 |
| R6 | A 전용 active main admin | `PLATFORM_ADMIN` | 승인된 사유로 초기화 | 성공 가능 | 성공 | platform actor와 target main role 감사 | 예 |
| R7 | A/B active 일반 회원 | `A_ADMIN` | A context에서 초기화 | 현재 성공 가능 | 거부 | A/B 전체 로그인 상태 불변 | 예 |
| R8 | A/B active 일반 회원 | `PLATFORM_ADMIN` | platform context·사유로 초기화 | 성공 가능 | 성공 | multi-club=true/count 기록, 전체 session 종료 | 예 |
| R9 | A active+B pending 회원 | `A_ADMIN` | 초기화 시도 | 현재 성공 가능 | 다중 비거절 membership으로 거부 | auth/session 불변 | 예 |
| R10 | platform admin 계정 | club admin 및 다른 platform admin | 일반 초기화 RPC 시도 | 현재 club admin도 성공 가능 | 모두 일반 RPC에서 거부, 별도 복구 절차 안내 | 최고 권한 계정 불변 | 예 |
| R11 | `profiles.is_active=false` 회원 | `A_ADMIN` | 초기화 시도 | caller만 active면 성공 가능 | 거부 | 먼저 platform 복구가 필요함을 확인 | 예 |
| R12 | A pending 회원 | `A_ADMIN` | 초기화 시도 | 현재 성공 가능 | 거부 | membership/profile/auth 불변 | 예 |
| R13 | A rejected 회원 | `A_ADMIN` | 초기화 시도 | 현재 성공 가능 | 거부 | rejected가 권한 근거로 쓰이지 않음 | 예 |
| R14 | A guest | `A_ADMIN`, `PLATFORM_ADMIN` | 초기화 시도 | 현재 함수가 거부 | 동일하게 거부 | auth 계정 생성 없음 | 예 |
| R15 | 자기 자신 | `A_ADMIN`, `PLATFORM_ADMIN` | 자신의 ID로 초기화 | 현재 성공 가능 | 거부 | caller session 유지, 감사 success 없음 | 예 |
| R16 | 유효하지 않은 target UUID | 허용 관리자 | 초기화 시도 | 사용자를 찾을 수 없음 | 동일한 안전 오류 | auth 변화 없음, 실패 로그 정책 별도 확인 | 예 |
| R17 | R1 성공 직후 | 대상 사용자 | 기존 session/API 사용 후 `123456`로 로그인 | session 제거·새 비밀번호 로그인 | 동일 | 기존 session 거부, 새 로그인 성공 | 예 |
| R18 | R1 성공 감사 | 감사 조회 권한 계정 | 감사 행 조회 | 현재 행 없음 | 요구 필드 존재, password/hash/token 문자열 없음 | 민감값 비포함 검사 | 예 |
| R19 | 감사 저장 실패를 강제한 staging fixture | `A_ADMIN` | 초기화 시도 | 해당 구조 없음 | 초기화 전체 실패 또는 승인된 원자성 정책과 일치 | 비밀번호와 감사가 불일치하지 않음 | 예 |
| R20 | R1 초기화 후 `123456` 로그인 | 대상 사용자 | 로그인 직후 기존 허용 화면과 기능 접근 | 비밀번호 변경 강제 화면 없음 | 동일하게 강제 화면 없이 기존 흐름 유지 | 강제 redirect·`must_change_password` 차단 없음 | 예 |

향후 플랫폼 계정 정책 옵션을 구현할 때는 옵션 off에서 R20을 그대로 통과해야 한다. 옵션 on의 강제 경로, 기존 계정 적용, 비밀번호 변경 완료 후 해제, 복구 계정 예외는 그 구현 단계에서 별도 테스트를 추가한다.

## SEC-PROD-06/07 전용 회귀 테스트: 클럽 탈퇴 범위와 권한

W1~W12의 승인된 주체는 아래 W13~W22 권한 matrix를 따라야 한다. 회원 본인의 자진 탈퇴는 아직 이 테스트 범위에 포함하지 않는다.

| ID | 대상/준비 | 행위 | 기대 결과 | 핵심 불변 조건 | 필수 |
|---|---|---|---|---|---|
| W1 | A만 active인 회원 | A 탈퇴 | A membership만 종료 | auth/profile/is_active 유지 | 예 |
| W2 | A/B active 다중 club 회원 | A 탈퇴 | A만 종료, B 계속 active | B 로그인·URL·RPC·경기 이용 정상 | 예 |
| W3 | A/B active 다중 club 회원 | A 탈퇴 | A의 미확정 슬롯만 승인된 규칙으로 처리 | B의 모든 경기 슬롯 불변 | 예 |
| W4 | A 확정 경기 이력이 있는 회원 | A 탈퇴 후 플랫폼 검증 계정으로 기록 확인 | 과거 경기와 이름·통계 원천 보존 | 탈퇴 본인은 접근 차단, confirmed match/player/profile 참조 불변 | 예 |
| W5 | 마지막 club A의 회원 | A 탈퇴 후 로그인 | 플랫폼 계정 로그인 유지, club 미가입 흐름 표시 | auth/profile 삭제·비활성 없음 | 예 |
| W6 | A 탈퇴 이력이 있는 회원 | A 재가입 신청 | 승인된 가입 흐름으로 pending 생성/복구 | `rejected`를 탈퇴 상태로 사용하지 않음 | 예 |
| W7 | A/B membership을 가진 guest | A 탈퇴 | A 관계만 종료 | guest profile과 B 관계·경기 기록 유지 | 예 |
| W8 | A에만 있고 참조 없는 guest | A 탈퇴 | A 관계 종료 | club 탈퇴 과정에서 profile 자동 삭제·비활성 금지 | 예 |
| W9 | B 전용 회원 | A context에서 탈퇴 시도 | 거부 | auth/profile/B membership 불변 | 예 |
| W10 | 탈퇴 처리 실패 fixture | A 탈퇴 시도 | 전체 rollback | membership과 경기 슬롯이 부분 변경되지 않음 | 예 |
| W11 | A 탈퇴 완료 사용자 | 기존 A 세션/화면에서 재조회 | A membership 필요 기능 차단 | B 및 플랫폼 계정 기능은 정상 | 예 |
| W12 | 별도 플랫폼 계정 종료 fixture | 플랫폼 종료 절차 실행 | 승인된 플랫폼 정책대로 전체 계정 처리 | club 탈퇴 RPC로는 같은 결과를 만들 수 없음 | 예 |
| W13 | A active 일반 회원 | `A_ADMIN`이 A 탈퇴 처리 | 성공 | A만 종료, 감사 actor/target/club/role/reason 기록 | 예 |
| W14 | A active `sub_admin` | `A_ADMIN`이 A 탈퇴 처리 | 성공 | target role만 관계 종료, profile/auth 유지 | 예 |
| W15 | A guest | `A_ADMIN`이 A 탈퇴 처리 | 성공 | guest profile과 기록 유지 | 예 |
| W16 | A 일반 회원 | `A_SUB`가 직접 RPC 시도 | 거부 | membership/auth/profile/경기 불변 | 예 |
| W17 | A 일반 회원 | 일반 회원 또는 guest가 직접 RPC 시도 | 거부 | 대상 전체 상태 불변 | 예 |
| W18 | B 전용 일반 회원 | `A_ADMIN`이 A context로 시도 | 거부 | B membership/auth/profile 불변 | 예 |
| W19 | A main admin | 다른 `A_ADMIN`이 탈퇴 처리 시도 | 거부 | 대상 main admin 권한과 계정 불변 | 예 |
| W20 | A main admin | `PLATFORM_ADMIN`이 대상 club·사유를 명시해 처리 | 성공 | 지정한 A 관계만 종료되고 감사 기록 생성 | 예 |
| W21 | A 일반/sub/guest | `PLATFORM_ADMIN`이 대상 club·사유를 명시해 처리 | 성공 | 지정한 A 관계만 종료 | 예 |
| W22 | 호출자 본인 | main admin 또는 platform admin이 관리자 RPC로 자기 자신 처리 시도 | 거부 | caller 권한·membership·session 불변 | 예 |
| W23 | A active 일반 회원 | 본인 자진 탈퇴에서 A 선택·재확인 | 성공 | A만 종료, auth/profile 유지 | 예 |
| W24 | A active `sub_admin` | 본인 자진 탈퇴에서 A 선택·재확인 | 성공 | A 역할만 종료, 플랫폼 계정 유지 | 예 |
| W25 | A/B active 회원 | 본인이 A 자진 탈퇴 | 성공 | B 로그인·membership·경기 이용 정상 | 예 |
| W26 | A main admin | 본인 자진 탈퇴 시도 | 승계/플랫폼 처리 안내와 함께 거부 | A 관리자 상태 불변 | 예 |
| W27 | A pending 사용자 | 자진 탈퇴 경로 접근 | 탈퇴 대신 가입 신청 취소 흐름으로 분리 | profile과 다른 club 불변 | 예 |
| W28 | A rejected 사용자 또는 guest | 자진 탈퇴 시도 | 대상 아님 또는 안전하게 거부 | membership/profile 불변 | 예 |
| W29 | A 회원 | B membership ID나 다른 user ID를 조작해 자진 탈퇴 시도 | 거부 | 호출자 본인의 선택한 membership 외 전부 불변 | 예 |
| W30 | 확정 경기 이력이 있는 A 회원 | A 자진 탈퇴 후 플랫폼 검증 계정으로 기록 확인 | 과거 기록과 이름 원천 보존 | 탈퇴 본인은 접근 차단, confirmed 경기 참조 불변 | 예 |
| W31 | A `open` 경기 참가 회원 | A 탈퇴 | 대상 슬롯 제거 후 성공 | match 유지, 인원에 맞는 상태 재계산 | 예 |
| W32 | A `ready` 경기 참가 회원 | A 탈퇴 | 대상 슬롯 제거 후 성공 | 기존 trigger에 따라 `open` 전환 | 예 |
| W33 | A `in_progress` 경기 참가 회원 | A 탈퇴 | 경기 정리 안내와 함께 거부 | 슬롯·membership 모두 불변 | 예 |
| W34 | A `submitted` 경기 참가 회원 | A 탈퇴 | 경기 정리 안내와 함께 거부 | 점수·확인·슬롯·membership 불변 | 예 |
| W35 | A `confirmed` 경기 참가 회원 | A 탈퇴 | 경기 row와 슬롯을 보존하고 탈퇴 성공 | 통계·점수·확인·감사 불변 | 예 |
| W36 | A `canceled` 경기 참가 회원 | A 탈퇴 | 대상 슬롯 정리 후 성공 | canceled match와 감사 기록 유지 | 예 |
| W37 | A/B 각 상태별 경기 참가 회원 | A 탈퇴 | A에 대해서만 상태별 규칙 적용 | B의 모든 match/player row 불변 | 예 |
| W38 | A에 `open`과 `submitted` 경기가 함께 있는 회원 | A 탈퇴 | 전체 거부 | open 슬롯도 선삭제되지 않고 membership 유지 | 예 |
| W39 | 허용되는 A 탈퇴 중 감사 저장 실패 fixture | A 탈퇴 | 전체 rollback | 슬롯·membership·감사가 부분 반영되지 않음 | 예 |

W31~W39는 관리자 탈퇴와 본인 자진 탈퇴 양쪽에서 반복한다. 탈퇴 확인 화면에는 제거 예정 슬롯과 차단 경기 수를 표시하되 다른 클럽 경기 정보는 노출하지 않는다.

### 탈퇴 후 접근 차단 테스트

| ID | 대상/준비 | 행위 | 기대 결과 | 핵심 불변 조건 | 필수 |
|---|---|---|---|---|---|
| W40 | A 탈퇴 완료 사용자 | A club 직접 URL·새로고침 | 접근 차단 또는 안전한 club 선택 화면 | A 데이터 응답 없음 | 예 |
| W41 | A 확정 경기 참가 후 탈퇴한 사용자 | A 결과·선수 상세·개인 통계 조회 | 모두 차단 | confirmed 기록은 DB에 보존 | 예 |
| W42 | A 탈퇴 완료 사용자 | A 회원 목록·profile join·검색 직접 요청 | 차단 | 다른 A 회원 정보 노출 없음 | 예 |
| W43 | A 탈퇴 완료 사용자 | A 통계 RPC와 table REST 직접 호출 | 차단 또는 빈 결과 | SECURITY DEFINER 우회 없음 | 예 |
| W44 | A 탈퇴 완료 사용자 | A CSV/export 실행 | 차단 | 파일 생성과 A row 노출 없음 | 예 |
| W45 | A 탈퇴 전 열린 두 번째 browser session | 탈퇴 완료 후 fetch·RPC·Realtime 관찰 | 즉시 권한 재평가되어 차단 | 신규 A event와 후속 row 노출 없음 | 예 |
| W46 | A 탈퇴+B active 사용자 | B URL·경기·통계·Realtime 이용 | 정상 | B 기능과 profile/login 불변 | 예 |
| W47 | A 재가입 `pending` 사용자 | A URL·RPC·Realtime 직접 시도 | 계속 차단 | pending이 조회 권한을 주지 않음 | 예 |
| W48 | A 재가입 후 다시 `active`가 된 사용자 | A 기능 접근 | 현재 active 회원 범위로 복구 | 과거 기록 삭제 없이 정상 조회 | 예 |
| W49 | A 탈퇴 사용자 기록 | `PLATFORM_ADMIN` 승인 관리 조회 | 플랫폼 정책 범위에서 성공 | 일반 사용자 경로와 권한 분리 | 예 |

W40~W49는 화면 표시뿐 아니라 실제 HTTP 응답, RLS 결과, SECURITY DEFINER RPC 반환, Realtime event 수신 여부를 함께 확인한다.

## SEC-PROD-11 전용 회귀 테스트: child RLS와 Realtime

| ID | 대상/준비 | 행위 | 기대 결과 | 핵심 불변 조건 | 필수 |
|---|---|---|---|---|---|
| CR1 | A active 사용자, A match | `match_players`·`score_confirmations` 조회 | 성공 | 기존 nested 경기·점수 화면 정상 | 예 |
| CR2 | B active 사용자, A match UUID | child table 직접 조회 | 차단 또는 빈 결과 | A row·ID·position·확인 상태 미노출 | 예 |
| CR3 | A pending/rejected 사용자 | A child table 직접 조회 | 차단 또는 빈 결과 | membership 상태가 권한을 주지 않음 | 예 |
| CR4 | A 탈퇴 사용자 | 본인이 참가했던 confirmed A match child 조회 | 차단 또는 빈 결과 | 원본 기록은 DB에 보존 | 예 |
| CR5 | `PLATFORM_ADMIN` | A/B child 관리 조회 | 승인된 범위에서 성공 | 일반 사용자 경로와 분리 | 예 |
| CR6 | A/B active browser 각각 subscription | A match/player INSERT·UPDATE·DELETE | A만 event 수신 | B에는 payload 자체 미전달 | 예 |
| CR7 | A active browser subscription 유지 중 A 탈퇴 | 탈퇴 후 A event 발생 | 신규 event 미수신 | 기존 session/subscription 우회 없음 | 예 |
| CR8 | A pending→active 전환 전후 | A event 발생 | 전에는 미수신, active 이후 수신 | 상태 전환 경계 정확 | 예 |
| CR9 | 권한 없는 사용자가 A match ID로 SECURITY DEFINER 조회 RPC 호출 | 직접 RPC 시도 | 거부 또는 데이터 없는 안전 응답 | RLS 우회로 child 데이터 미노출 | 예 |
| CR10 | A active 두 browser | 선수 등록·제외와 점수 제출·확인 | 기존 화면과 Realtime 갱신 정상 | 허용 사용자 기능 회귀 없음 | 예 |
| CR11 | A 관리자 CSV fixture | match/player/profile nested export | A 데이터만 정상 출력 | B 데이터 미포함, 기존 열·행 의미 유지 | 예 |
| CR12 | publication 확인 | 전환 전·병행·최종 preflight 재조회 | 병행 중 기존 구성 유지, Broadcast cutover 후 `matches`·`match_players` public 노출 종료 | `score_confirmations` 신규 추가 없음 | 예 |
| CR13 | A active raw websocket 연결 유지 | A membership을 withdrawn 처리 | 기존 topic에는 비데이터 재인증 신호 후 row event 중단 | JWT 만료 전에도 payload 미수신 | 예 |
| CR14 | CR13과 동시에 연결된 다른 A active client | channel epoch 회전 후 재가입 | 새 private topic 가입·화면 refresh 성공 | event 누락 후 최종 상태 일치 | 예 |
| CR15 | A 탈퇴 client | 새 epoch를 추측해 private topic 가입 | 거부 | 새 topic/event metadata 미노출 | 예 |
| CR16 | A/B active client | A match/player INSERT·UPDATE·DELETE | A만 최소 Broadcast 수신 | B와 old topic에는 payload 없음 | 예 |
| CR17 | A active client | offline 중 epoch 회전 후 복귀 | 현재 epoch로 한 번만 가입·전체 refresh | stale topic 재사용 없음 | 예 |
| CR18 | 병행 관찰 단계 | 같은 DB 변경을 Postgres Changes와 Broadcast로 관찰 | 진단상 양쪽 기록, UI 적용은 한 번 | 중복 row·toast·fetch 폭증 없음 | 예 |

Realtime 검증은 event를 받은 뒤 화면에서 숨기는지만 보지 않고 client callback에 payload가 도착했는지를 기록한다.

## SEC-PROD-12 전용 회귀 테스트: `profiles` 최소 공개

| ID | 대상/준비 | 행위 | 기대 결과 | 핵심 불변 조건 | 필수 |
|---|---|---|---|---|---|
| PF1 | A active 일반 회원 | 자신의 profile 조회 | 성공 | 자신의 정상 설정 화면 유지 | 예 |
| PF2 | A active 회원들 | A 회원 목록·경기 참가자 조회 | 최소 표시 필드 성공 | id/name/award/is_guest만 타인에게 제공 | 예 |
| PF3 | A active 회원, B 전용 사용자 UUID | B profile 직접 조회 | 차단 또는 빈 결과 | 이름·입상·role·상태 미노출 | 예 |
| PF4 | A active 회원, A 과거 confirmed 탈퇴자 | A 결과 화면 조회 | 최소 표시 필드로 경기 정상 표시 | 추가 profile column 미노출 | 예 |
| PF5 | A 탈퇴 사용자 | A 참가자 profile·directory 직접 조회 | 차단 | 본인 과거 경기 근거로 접근 복구되지 않음 | 예 |
| PF6 | A main admin, A active/pending/rejected 대상 | A 관리 화면 조회 | 최소 필드와 is_active 성공 | target club 신청·회원 범위로 한정 | 예 |
| PF7 | A main admin | 타인 profile UPDATE 또는 is_active 변경 시도 | 확정 권한에 따라 거부 | SELECT 추가가 UPDATE 권한을 주지 않음 | 예 |
| PF8 | A 일반/sub/main admin | 타인의 role/is_platform_admin/timestamps 직접 projection | 거부 또는 해당 column 미제공 | client UI 숨김에 의존하지 않음 | 예 |
| PF9 | `PLATFORM_ADMIN` | 승인된 전체 profile 관리 조회 | 성공 | 일반 사용자 경로와 분리 | 예 |
| PF10 | A 경기 목록·결과·선수 상세·CSV | 기존 화면과 export 실행 | 허용된 A 데이터 정상 | nested query 오류·이름 누락 없음 | 예 |
| PF11 | A guest가 포함된 open/confirmed 경기 | A active 회원이 조회 | guest 최소 표시 성공 | auth 없는 guest도 경기 표시 유지 | 예 |
| PF12 | anon 및 미인증 session | profile 직접 조회 | 차단 | 어떤 profile column도 노출되지 않음 | 예 |

PF2·PF6·PF8은 반환 row뿐 아니라 임의 column을 명시한 REST 요청으로 column 경계를 확인한다.

## SEC-PROD-13 전용 회귀 테스트: 탈퇴 membership 이력

| ID | 대상/준비 | 행위 | 기대 결과 | 핵심 불변 조건 | 필수 |
|---|---|---|---|---|---|
| MH1 | A active 일반 회원 | A 탈퇴 완료 | 같은 membership 행이 `withdrawn` | 행 삭제 없음, profile/auth 유지 | 예 |
| MH2 | A active `sub_admin` | A 탈퇴 완료 | `withdrawn` 및 감사에 이전 역할 기록 | 클럽 권한 즉시 소멸 | 예 |
| MH3 | A/B active 회원 | A 탈퇴 | A만 `withdrawn`, B active 유지 | 단일/다중 club 판정에서 A 제외 | 예 |
| MH4 | A withdrawn 사용자 | A URL·RPC·table·Realtime 접근 | 모두 차단 | withdrawn이 권한 helper를 통과하지 않음 | 예 |
| MH5 | A withdrawn 등록 사용자 | A 재가입 신청 | 같은 행이 `pending`, role `user` | 자동 active 금지, 중복 PK row 없음 | 예 |
| MH6 | 이전 A `sub_admin`/`admin` withdrawn 사용자 | A 재가입 신청·승인 | pending부터 시작하고 승인 후에도 role `user` | 이전 관리자 역할 자동 복원 없음 | 예 |
| MH7 | A withdrawn→pending 사용자 | 승인 전 A 접근 | 차단 | pending도 접근 권한 없음 | 예 |
| MH8 | A withdrawn→pending→active 사용자 | 승인 후 A 접근 | active 회원 범위로 복구 | 탈퇴 감사 기록 유지 | 예 |
| MH9 | A rejected 사용자 | 재가입 신청 | 기존 rejected 재신청 규칙으로 pending | withdrawn과 의미 혼합 없음 | 예 |
| MH10 | A withdrawn guest | A 관리 목록·경기 기록 확인 | active 목록에서는 제외, 과거 기록은 보존 | profile 중복·삭제 없음 | 예 |
| MH11 | A 탈퇴 감사 | 승인된 감사 조회 | actor/target/club/time/reason/old role/result 존재 | password/token 및 타 club 정보 없음 | 예 |
| MH12 | status 직접 조작 | 일반 사용자 또는 권한 없는 관리자 | 거부 | withdrawn→active 우회 불가 | 예 |

MH1~MH12는 `(club_id, user_id)` row 수, status, role, `updated_at`, 별도 감사 이력을 함께 비교한다.

## SEC-PROD-14 전용 회귀 테스트: 플랫폼 계정 영구 종료

| ID | 대상/준비 | 행위 | 기대 결과 | 핵심 불변 조건 | 필수 |
|---|---|---|---|---|---|
| PT1 | A/B active 일반 계정, 진행 중 경기 없음 | 승인된 플랫폼 영구 종료 | 성공 | Auth/session/token 제거, A/B withdrawn | 예 |
| PT2 | PT1 대상 profile | 종료 후 플랫폼 검증 조회 | UUID 유지, inactive/user/non-platform, 이름 `탈퇴 회원`, award none | 실제 이름·입상 미노출 | 예 |
| PT3 | confirmed 경기 이력이 있는 종료 계정 | A/B 결과·통계·CSV를 active 회원으로 조회 | 경기 수치 유지, 대상은 익명 표시 | profile FK와 집계 수치 유지 | 예 |
| PT4 | open/ready/canceled 슬롯이 있는 계정 | 영구 종료 | 모든 club에서 허용 슬롯 정리 후 성공 | match와 confirmed 기록 유지 | 예 |
| PT5 | in_progress 경기 참가 계정 | 영구 종료 시도 | 경기 정리 안내와 함께 전체 거부 | Auth/profile/membership/슬롯 불변 | 예 |
| PT6 | submitted 경기 참가 계정 | 영구 종료 시도 | 경기 정리 안내와 함께 전체 거부 | 점수·확인·계정 상태 불변 | 예 |
| PT7 | A main admin 계정 | 일반 platform 종료 시도 | 승계 조건 미충족 시 거부 | 클럽 관리자 공백 자동 생성 없음 | 예 |
| PT8 | platform admin 계정 | 일반 영구 종료 경로 시도 | 거부, 별도 최고 권한 절차 안내 | platform 접근과 계정 불변 | 예 |
| PT9 | club main/sub admin | 회원 UUID로 플랫폼 영구 종료 직접 시도 | 거부 | Auth/profile/다른 club 불변 | 예 |
| PT10 | PT1 종료 계정의 기존 browser/session | URL·RPC·Realtime 사용 | 모두 거부 | session·refresh token 재사용 불가 | 예 |
| PT11 | PT1과 같은 이메일로 신규 가입 | 신규 Auth/profile 생성 | 새 UUID로 정상 가입 절차 | 과거 익명 profile과 자동 연결 없음 | 예 |
| PT12 | 영구 종료 감사 | 승인된 감사 조회 | actor/target/time/reason/club count/result 존재 | 이름/password/hash/token 미기록 | 예 |
| PT13 | profile 익명화 또는 감사 저장 실패 fixture | 영구 종료 시도 | 전체 rollback 또는 검증된 보상 완료 | 부분 종료 계정 없음 | 예 |
| PT14 | 플랫폼 정지 계정 | 복구 가능한 정지·복구 수행 | 기존 UUID/name/award 유지 | 영구 종료와 혼합되지 않음 | 예 |
| PT15 | 동일 영구 종료 요청 | 같은 idempotency key로 반복 실행 | 하나의 종료 job과 최종 성공으로 수렴 | 중복 감사·슬롯 처리 없음 | 예 |
| PT16 | Auth 삭제 성공 후 complete 기록 실패 fixture | 같은 key로 재시도 | 이미 없는 Auth user를 성공으로 인정하고 completed | inactive/익명/withdrawn 유지 | 예 |
| PT17 | Storage object owner 계정 | 영구 종료 prepare | 소유권 정리 안내와 함께 차단 | public/Auth 상태 불변 | 예 |
| PT18 | 종료 orchestration network 관찰 | browser에서 요청 | service role secret 미노출 | bundle·response·console·외부 로그 검사 | 예 |

PT1~PT18은 Auth 관리 결과와 public schema 결과를 함께 확인하되 비밀번호·hash·token 값을 출력하거나 저장하지 않는다.

## Phase 1 additive foundation 적용 테스트

| ID | 준비 | 행위 | 기대 결과 | 필수 |
|---|---|---|---|---|
| F1 | migration 전 `club_members` status별 count 저장 | Phase 1 migration 적용 후 count 비교 | pending/active/rejected row와 count 완전 동일 | 예 |
| F2 | migration 적용 후 constraint 조회 | `38_security_phase1_verify.sql` 01 실행 | validated이며 네 상태만 포함 | 예 |
| F3 | 기존 앱 build와 staging session | 로그인·club 선택·회원 목록·가입 승인 | 기존 세 상태 흐름 동일 | 예 |
| F4 | anon/authenticated token | `security_audit_events` 직접 SELECT/INSERT/UPDATE/DELETE | 모두 거부 | 예 |
| F5 | 승인된 service maintenance context | audit table SELECT | 빈 결과 또는 기존 성공 감사만 조회 | 예 |
| F6 | staging transaction fixture | 허용되지 않은 임의 status 입력 | constraint 오류와 rollback | 예 |
| F7 | audit schema 검증 | verify 02~05 실행 | 11개 column, RLS on, policy 0, service_role SELECT만, 예상 constraint/index | 예 |
| F8 | `club_members`에 경쟁 lock을 둔 staging fixture | migration dry run | 5초 내 lock timeout으로 실패하고 전체 rollback | 예 |

Phase 1은 새 `withdrawn` 값을 실제로 생성하지 않는다. F1~F8과 기존 핵심 1~6·19~26이 통과하고 24시간 관찰하기 전에는 Phase 2를 시작하지 않는다.

## 변경 전·후 비교 방법

1. 변경 전 commit/schema에서 위 26개 회귀 테스트 결과를 JSON/표로 고정한다.
2. 함수 반환은 정렬과 timestamp 같은 변동 열을 분리하고 나머지 전체 열을 비교한다.
3. 변경 후 동일 fixture ID와 설정으로 다시 실행한다.
4. 보안상 의도된 거부 외에는 상태 코드, 사용자 메시지, 반환 shape, DB 상태가 같아야 한다.
5. Realtime은 단순 최종 화면뿐 아니라 event 수신/미수신과 후속 단건 fetch를 함께 기록한다.
6. 실패 시 변경 단위를 staging에서 되돌리고 원인을 분석한다. 취약한 권한을 다시 여는 SQL은 운영 복구안으로 사용하지 않는다.

## 미검증 표시

현재 다음은 모두 `미검증`이다.

- 대상 함수의 운영 ACL·owner·definition은 2026-08-01 preflight에서 확인했으나, 변경 후 상태는 미검증
- 인증 token을 사용한 RLS/RPC 역할별 테스트
- 123456 초기화 후 실제 로그인과 세션 제거
- 자식 RLS 변경 후 Supabase Realtime event 전달
- 확정된 다중 클럽 정책을 반영한 구현 결과와 club 간 비간섭 동작
- 모바일 실기기 및 배포 URL 회귀
