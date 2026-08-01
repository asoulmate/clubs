# 글로벌 레이팅 실행 계획

## 1. 목적과 현재 위치

이 문서는 최초 `global-rating-foundation-plan.md`와 `global-rating-gap-analysis.md`를 이후 확정된 보안·제품 결정에 맞춰 실제 실행 순서로 연결한다. 기존 시스템을 멈추거나 기존 데이터를 재해석하지 않고, 먼저 재현 가능한 shadow 레이팅을 만든 뒤 별도 승인으로 공개한다.

현재 위치는 다음과 같다.

- 보안 preflight 결과 수신 및 정책 SEC-PROD-01~14 확정
- 구현 기술 결정 TECH-01~06 확정
- 보안 Phase 1 migration과 읽기 전용 검증 SQL 로컬 작성
- staging·운영 DB 적용 없음
- 애플리케이션 코드, 기존 migration, 기존 RPC·RLS·Realtime 변경 없음
- 글로벌 identity, 경기 revision, 레이팅 저장소 구현 없음

## 2. 적용 우선순위

문서 또는 과거 요청이 충돌하면 다음 순서로 적용한다.

1. 운영 중인 기존 기능과 데이터 보존
2. `security-product-decisions.md`의 확정 제품 정책
3. `38_security-implementation-plan.md`의 확정 기술 결정과 gate
4. `global-rating-foundation-plan.md`의 additive 구조
5. `global-rating-gap-analysis.md`의 P0/P1/P2 우선순위

특히 기존 `123456` 초기화는 승인된 범위에서 유지하며, 최초 계획에 있던 reset-email 강제 전환은 폐기한다. `profiles.is_active`는 플랫폼 계정 상태이고 클럽 상태는 `club_members.status`로 관리한다.

## 3. 가장 짧은 안전 경로

| Gate | 작업 | 완료 조건 | 이때 하지 않는 것 |
|---|---|---|---|
| SG-1 | 보안 Phase 1 staging 적용 | 검증 SQL, F1~F8, 핵심 기능 1~6·19~26 통과와 24시간 무사고 관찰 | 운영 적용, Phase 2, 글로벌 migration 작성 |
| SG-2 | target-club RPC와 profile 보호 기반 | cross-club 음성 테스트, 기존 반환 shape, profile 보호와 `123456` 회귀 통과 | identity 검색 공개, 기존 RPC 제거 |
| GR-1 | 글로벌 identity additive schema | profile별 독립 identity 생성 가능, 이름 기반 자동 병합 없음, merge/split 감사 가능 | 기존 profile/FK/URL 교체, 대량 자동 병합 |
| GR-2 | 안전한 1:1 backfill | profile 수와 mapping 수 일치, orphan 0, 재실행 중복 0, candidate만 생성 | 동명이인 확정 병합, NOT NULL 즉시 강제 |
| SG-3 | 경기 쓰기·child 접근 경계 | target-club 경기 RPC, child RLS, 허용 사용자 Realtime 회귀 통과 | public Realtime 즉시 제거, legacy RPC 제거 |
| GR-3 | 결과 revision·provenance | confirmed 경기 legacy snapshot, participant/score checksum 일치, append-only 검증 | 과거 세트·기권·출처 추정 |
| GR-4 | shadow 레이팅 저장·계산 | 동일 input hash 재계산 동일, 제외 사유 기록, 이전 run 보존 | 기존 순위 대체, 사용자 공개 |
| GR-5 | 제한된 조회 API와 베타 | 공개 범위, 개인정보, global/club·single/double 분리, UI 회귀 승인 | 공식 레이팅 선언 |

SG-1부터 SG-3까지는 보안 계획의 독립 배포·관찰 규칙을 그대로 따른다. GR 작업도 각 gate를 별도 migration과 별도 검증 묶음으로 나누며 한 운영 window에 합치지 않는다.

## 4. 최초 계획의 반영 관계

| 최초 계획 항목 | 실행 패키지 | 초기 shadow 레이팅 필수 여부 | 처리 원칙 |
|---|---|---|---|
| 글로벌 선수 identity | GR-1·GR-2 | 필수 | account/profile과 선수 실체 분리, 1:1 backfill 우선 |
| 결과 revision·participant snapshot | GR-3 | 필수 | confirmed 결과만 `legacy_unknown`으로 보존 |
| source/provenance | GR-3 | 필수 최소 구조 | 없는 과거 출처는 null/legacy로 명시 |
| rating model/version/run/history | GR-4 | 필수 | 먼저 shadow, 입력 hash와 이전 run 보존 |
| match dedupe | GR-3 최소 fingerprint | 필수 최소 구조 | 후보만 만들고 자동 삭제·병합 금지 |
| 세트·타이브레이크 상세 | GR-3 신규 경기용 | 공개 전 권장, 과거에는 비필수 | 과거 aggregate에서 추정 금지 |
| 교류전·대표 클럽 | 후속 GR-6 | 초기 내부 경기 shadow에는 비필수 | 기존 `matches.club_id` 유지 |
| 외부 대회·외부 ID·크롤러 | 후속 GR-7 | 초기 내부 경기 shadow에는 비필수 | 약관·출처·검수 정책 후 별도 도입 |
| 글로벌/클럽 베타 화면 | GR-5 | shadow에는 비필수 | 기존 결과 집계와 URL 유지, 별도 베타 탭 |

## 5. 데이터 불변 조건

1. `profiles.id`, `matches.id`, `match_players.user_id`와 기존 FK를 대량 치환하지 않는다.
2. 기존 confirmed 경기의 점수·참가자·상태를 수정하지 않고 새 snapshot에서 참조한다.
3. 동명, 동일 소속, 동일 입상 정보만으로 선수를 자동 병합하지 않는다.
4. `rejected`를 탈퇴나 일시정지 의미로 재사용하지 않는다.
5. 한 클럽의 관리 작업이 다른 클럽 membership, 경기, 로그인, 레이팅 identity를 변경하지 않게 한다.
6. 기존 통계와 글로벌 레이팅은 별도 제품으로 유지한다. shadow 결과가 기존 `buildRanking()` 또는 `get_player_stats()`를 덮어쓰지 않는다.
7. 레이팅 입력에는 확정되고 검증 가능한 revision만 포함하고, 제외된 경기도 사유를 남긴다.
8. identity merge/split이나 경기 정정 후에는 새 rating run을 만들고 이전 결과를 수정하지 않는다.

## 6. 각 gate의 증거

각 단계는 다음 자료가 모두 있어야 완료로 표시한다.

- 적용 전후 schema·constraint·함수 signature·ACL·RLS·publication diff
- migration 적용 시각, 기준 commit, 실행자와 대상 project
- 기존 행 수, FK orphan, confirmed score와 participant checksum
- 역할별 허용·거부 테스트 결과
- 기존 UI·URL·RPC 반환 shape·Realtime 회귀 결과
- 단계별 관찰 기간의 오류율과 미해결 incident 0건
- rollback 또는 기능 비활성 절차 확인

DB 결과 파일에는 개인정보, password, hash, token, session 값을 저장하지 않는다.

## 7. 현재 차단점과 다음 행동

현재 유일한 다음 실행 gate는 SG-1이다. 사용자가 staging에서 다음을 완료해 결과를 제공해야 한다.

1. 백업과 대상 project 확인
2. `supabase/migrations/38_security_baseline_foundation.sql` 적용
3. `supabase/checks/38_security_phase1_verify.sql` 결과 저장
4. `38_security-staging-test-plan.md`의 F1~F8과 핵심 기능 1~6·19~26 수행
5. 24시간 관찰 결과 기록

24시간 관찰은 개발 중단 시간이 아니다. 관찰 중에도 다음 단계의 비실행 schema 설계, RPC 계약, 영향 분석, 테스트 명세와 rollback 계획을 작성할 수 있다. 다만 현재 staging 상태를 흐리지 않기 위해 다음 migration의 실행·적용, 앱 cutover, RLS·권한 변경은 하지 않는다.

이 증거를 받기 전에는 Phase 2 실행 가능한 migration, 글로벌 identity migration, 애플리케이션 전환 코드를 작성하지 않는다. 문서 검토와 비실행 설계만 병행한다.

## 8. 완료 정의

첫 번째 실용 목표는 “공식 글로벌 순위”가 아니라 다음 조건을 만족하는 내부 shadow 레이팅이다.

- 각 profile이 검증 가능한 global player에 연결된다.
- 포함된 모든 경기에는 고정된 result revision과 participant identity snapshot이 있다.
- 모델과 파라미터, 입력 목록, 제외 사유, cutoff, input hash가 저장된다.
- 같은 입력으로 다시 계산하면 같은 결과가 나온다.
- identity나 결과 정정 전후 run을 모두 추적할 수 있다.
- 기존 앱 화면, URL, 통계, 권한과 `123456` 흐름에는 영향이 없다.

이 조건을 통과한 뒤에만 조회 API와 베타 UI를 별도 승인한다.
