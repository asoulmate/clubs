# 글로벌 레이팅 rollback runbook

## 기본 원칙

rollback은 신규 기능을 비활성화하고 기존 읽기·쓰기 경로로 돌아가는 방식이다. 생성된 감사, identity, rating run을 삭제하거나 기존 취약 권한을 무조건 다시 여는 down migration을 사용하지 않는다.

## 앱 우선 비활성화

다음 flag를 모두 false로 빌드·배포한다.

- `VITE_FEATURE_SCOPED_ADMIN_RPC`
- `VITE_FEATURE_IDENTITY_CLAIMS`
- `VITE_FEATURE_GUEST_CLAIM_CANDIDATES`
- `VITE_FEATURE_SHADOW_RATING_CALCULATION`
- `VITE_FEATURE_SHADOW_RATING_ADMIN`

기존 route와 결과·통계·관리자 탭은 유지된다.

## DB 기능 비활성화

별도 승인된 staging/운영 절차에서 다음을 수행한다.

- `security_scoped_admin_rpc_enabled=false`
- `global_identity_guest_claim_enabled=false`
- 모든 `rating_pools.enabled=false`

이 조치는 신규 claim 생성과 shadow 계산을 멈추지만 기존 감사·mapping·run을 삭제하지 않는다.

## 단계별 대응

### 38 실패

transaction 오류면 전체 rollback을 확인한다. 성공 적용 후에는 `withdrawn` 값을 아직 만들지 않았으므로 기존 앱을 계속 사용하고 다음 migration을 중단한다. audit table을 임의 삭제하지 않는다.

### 39 실패

DB/app scoped flag를 false로 유지한다. legacy wrapper를 사용한다. 이미 성공한 club withdrawal 또는 password reset 감사는 삭제하지 않는다. `123456` 문제는 기존 password/hash를 추정 복원하지 말고 승인된 재초기화 절차를 사용한다.

### 40 실패

같은-club 정상 기능이 깨지면 운영 적용을 중단하고 함수별 이전 definition rollback SQL을 배포 패키지에서 검토한다. cross-club를 다시 허용하는 전면 rollback은 금지한다.

### 41 실패

identity flags를 false로 둔다. 기존 앱은 profile ID를 계속 사용한다. 새 table과 nullable column을 삭제하지 않는다. mapping이 없는 profile은 기존 profile 경로로 표시한다.

### 42 실패

migration transaction 전체 rollback 여부를 확인한다. 성공 후 문제를 발견하면 mapping을 일괄 null 처리하거나 global player를 삭제하지 않는다. backfill run/checksum으로 영향 profile을 분류하고 개별 보상 migration을 준비한다.

### 잘못된 merge

`split_profile_identity_v2`로 잘못 연결된 profile을 새 독립 identity로 분리한다. 원시 profile/FK는 그대로이므로 대량 FK 복원은 하지 않는다. 새 rating run이 생성될 때까지 shadow 화면을 비활성화한다.

### 43·44 실패

pool을 disabled로 바꾸고 shadow UI flag를 false로 한다. 기존 순위는 별도 구조이므로 영향 없이 계속 제공한다. 잘못된 run은 삭제하지 않고 failed/무효 사유를 별도 기록하는 보상 migration을 준비한다.

## rollback 완료 조건

- 기존 로그인·가입·클럽 이동 정상
- 경기·점수·관리자·YouTube·결과·통계·CSV 정상
- 기존 URL 정상
- 승인된 `123456`와 session 종료 정상
- 신규 UI 미노출
- 신규 자동 claim·rating run 중단
- 기존 profile/FK/confirmed 기록 불변
- cross-club 노출 없음

운영 rollback은 백업, diff, 담당자 승인과 실제 incident 분석 없이 실행하지 않는다.
