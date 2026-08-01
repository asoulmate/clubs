# 글로벌 레이팅 staging 적용 runbook

## 원칙

- staging에만 적용한다.
- 01~37 운영 schema와 preflight 결과가 저장소 기대와 다르면 중단한다.
- migration은 번호별 독립 window로 적용한다.
- 다음 단계 구현은 병행할 수 있지만 다음 DB 적용은 현재 단계 관찰 gate 후에 한다.
- 개인정보, password, hash, token, session을 결과 파일로 저장하지 않는다.

## 0. 적용 전

1. staging project name/reference ID와 backup/restore point 확인
2. 기준 branch/commit 대신 현재 미커밋 diff checksum 기록
3. `38_security_preflight.sql` 재실행 및 함수/RLS/ACL/publication drift 비교
4. 기존 핵심 기능 baseline과 test persona 준비
5. 모든 앱 feature flag false 확인

## 1. Migration 38

`38_security-phase1-staging-run-guide.md`를 그대로 수행한다.

- `38_security_baseline_foundation.sql`
- `38_security_phase1_verify.sql`
- F1~F8와 핵심 1~6·19~26
- 24시간 관찰

통과 전 39를 적용하지 않는다.

## 2. Migration 39

적용 후 DB flag `security_scoped_admin_rpc_enabled=false`를 확인한다. 앱 flag도 false로 유지한다.

검증:

- 기존 이름·입상·활성화 UI와 legacy `123456` 정상
- 기존 session 제거와 새 `123456` 로그인 정상
- v2 reset 허용·거부 matrix R1~R20
- v2 탈퇴 W/MH matrix
- 감사 성공 행에 password/hash/token 없음
- helper/trigger의 anon/authenticated effective execute false

최소 48시간 관찰 후 별도 window에서 앱 `VITE_FEATURE_SCOPED_ADMIN_RPC=true`와 DB flag를 함께 활성화한다. 먼저 staging test club에서 v2 UI를 검증한다.

## 3. Migration 40

검증:

- 같은 club의 create/register/remove/start/submit/confirm/cancel/YouTube 흐름 동일
- club A 계정이 club B match UUID로 모든 mutation 실패
- proxy 등록 설정이 match club 설정을 사용
- admin/sub 권한이 target match club에 한정
- monthly/recent RPC에 NULL club을 넘기면 안전 오류
- 결과·통계·선수 상세·CSV 반환 shape 동일

cross-club 거부 외 정상 동작 차이가 있으면 중단한다.

## 4. Migration 41

적용 후 `global_identity_guest_claim_enabled=false`를 확인한다.

검증:

- 신규 identity table RLS enabled, browser table privilege 없음
- 기존 회원가입·guest 등록 흐름 동일
- 신규 profile에는 독립 `global_player_id` 생성
- 기존 profile은 아직 null이어도 기존 화면 정상
- identity/claim 탭은 앱 flag false로 보이지 않음

## 5. Migration 42

적용 전 `global_identity_readiness.sql`을 실행한다. 적용 후:

- profile count = linked profile count
- orphan 0
- 보호 row count before/after 동일
- mapping checksum 존재
- 재실행 시 `created_global_player_count=0`
- 동명 profile의 global player ID가 서로 다름
- 기존 URL·경기·통계·대회·배팅 정상

identity backfill 결과를 24시간 관찰한다.

## 6. Identity claim cutover

플랫폼 관리자 검수 persona와 rollback 준비 후에만:

1. 앱 `VITE_FEATURE_IDENTITY_CLAIMS=true`
2. staging에서 검수 탭 확인
3. DB `global_identity_guest_claim_enabled=true`
4. 앱 `VITE_FEATURE_GUEST_CLAIM_CANDIDATES=true`
5. 합성 동명 guest로 신규 가입

자동 FK 이동·guest 삭제가 없어야 한다. 승인 전 기록은 분리되고 승인 후 두 profile mapping만 같아야 한다. split 후 mapping 복구와 event 보존을 확인한다.

## 7. Migration 43·44

43과 44를 별도 적용하고 `global_rating_post_apply_verify.sql` 01~03을 실행한다. pool은 disabled여야 한다.

합성·검증된 staging 경기에서만 대상 pool `enabled=true`로 바꾼 뒤:

1. `VITE_FEATURE_SHADOW_RATING_ADMIN=true`
2. `VITE_FEATURE_SHADOW_RATING_CALCULATION=true`
3. 플랫폼 관리자로 global singles/doubles 각각 실행
4. 동일 입력으로 재실행하고 동일 run ID/input hash 확인
5. `global_rating_post_apply_verify.sql` 04~08 실행

확인:

- confirmed만 포함
- canceled/not_confirmed/invalid participant/missing mapping 제외 사유
- singles/doubles 혼합 없음
- 기존 결과 순위와 통계 불변
- history 마지막 값과 current 값 일치
- 일반 사용자와 club admin 직접 RPC 거부

## 8. 운영 진입 금지 조건

- SQL runtime 오류 또는 migration rollback
- 기존 기능 회귀 1건
- cross-club row/event 1건
- `123456` 또는 session 종료 회귀 1건
- backfill protected count 차이
- 자동 동명이인 merge/guest 삭제
- rating 비결정성 또는 history 불일치
- 개인정보·비밀 로그 노출
- unresolved incident 1건 이상

모든 결과는 현재 `STAGING REQUIRED`다. 이 runbook 작성만으로 운영 적용을 승인하지 않는다.
