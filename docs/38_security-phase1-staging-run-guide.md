# 38 Security Phase 1 staging 실행 안내

## 1. 적용 범위

이 안내는 `38_security_baseline_foundation.sql`을 **staging Supabase project에만** 적용하고 SG-1 gate의 증거를 수집하기 위한 것이다. 운영 project에서는 실행하지 않는다.

이번 migration은 다음 두 가지 additive 기반만 추가한다.

- `club_members.status` CHECK에 `withdrawn` 허용값 추가
- client가 직접 쓸 수 없는 append-only `security_audit_events` 기반 추가

이번 단계에서는 `withdrawn` 행을 실제로 만들지 않으며 기존 RPC, RLS, Realtime, 앱 코드, URL, `123456` 초기화 동작을 변경하지 않는다.

## 2. 실행 전 중단 조건

다음 중 하나라도 만족하지 않으면 실행하지 않는다.

- staging project임을 project 이름과 reference ID로 확인하지 못함
- staging backup 또는 복구 지점을 확인하지 못함
- 현재 적용 commit과 migration 파일 checksum을 기록하지 못함
- 다른 schema migration이나 대량 작업이 동시에 실행 중임
- `club_members`에 `pending`, `active`, `rejected` 외의 예상하지 못한 status가 있음
- 현재 constraint 이름과 정의가 사전 조회 결과와 다름

SQL Editor 결과에 이메일, 이름, password, hash, token, session은 포함하거나 저장하지 않는다.

## 3. 실행 순서

### 1) 대상과 기준 정보 기록

staging project 이름, reference ID, 실행자, 실행 예정 시각, 기준 commit을 `00_phase1_run_metadata.md`에 기록한다. 운영 project가 열려 있다면 탭을 닫고 staging project만 남긴다.

### 2) 적용 전 status count 저장

아래 읽기 전용 조회를 실행하고 `01_before_status_counts.csv`로 저장한다.

```sql
select status, count(*) as row_count
from public.club_members
group by status
order by status;
```

결과에는 `pending`, `active`, `rejected`만 있어야 한다. 행이 없는 status는 출력되지 않아도 정상이다. 다른 값이 있으면 중단한다.

### 3) 적용 전 constraint 저장

아래 읽기 전용 조회를 실행하고 `02_before_status_constraint.csv`로 저장한다.

```sql
select
  con.conname as constraint_name,
  con.convalidated as is_validated,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'club_members'
  and con.conname = 'club_members_status_check';
```

정확히 한 행이고 validated 상태이며 `pending`, `active`, `rejected`만 허용해야 한다. 0행, 복수 행 또는 다른 정의면 중단한다.

### 4) Phase 1 migration 적용

새 SQL Editor query에서 `supabase/migrations/38_security_baseline_foundation.sql`의 전체 내용을 원문 그대로 실행한다. 파일 일부를 재작성하거나 운영 DB용으로 수정하지 않는다.

이 migration은 transaction, 5초 lock timeout, 60초 statement timeout을 포함한다. 오류가 발생하면 transaction 전체가 rollback되어야 한다. 오류를 우회하기 위해 timeout을 늘리거나 constraint를 수동 삭제하지 않는다.

실행 성공 여부와 시각만 `03_phase1_apply_result.md`에 기록한다. SQL Editor가 오류를 반환하면 전체 오류 메시지를 저장하되 데이터 값이나 비밀이 포함되면 제거한다.

### 5) 읽기 전용 검증 실행

`supabase/checks/38_security_phase1_verify.sql`을 번호별 SELECT 블록으로 실행한다. 결과는 다음 이름으로 저장한다.

| 블록 | 파일명 | 정상 기준 |
|---|---|---|
| 01 | `04_after_status_constraint.csv` | 한 행, validated, 네 상태 `pending|active|rejected|withdrawn`만 허용 |
| 02 | `05_audit_columns.csv` | `security_audit_events` 예상 column과 default 존재 |
| 03 | `06_audit_rls.csv` | RLS enabled, policy count 0 |
| 04 | `07_audit_privileges.csv` | service_role SELECT만 존재하고 PUBLIC/anon/authenticated privilege 없음 |
| 05 | `08_audit_constraints_indexes.csv` | PK, UNIQUE, CHECK와 세 보조 index 존재 |

검증 SQL은 SELECT-only다. 결과가 없거나 정상 기준과 다르면 앱 테스트를 시작하지 말고 중단한다.

### 6) 적용 후 status count 비교

2)의 조회를 다시 실행해 `09_after_status_counts.csv`로 저장한다. `01_before_status_counts.csv`와 status별 row count가 완전히 같아야 하며 `withdrawn` 행은 0이어야 한다.

### 7) F1~F8 수행

`38_security-staging-test-plan.md`의 F1~F8을 수행해 `10_phase1_F1-F8.md`에 pass/fail과 증거 위치를 기록한다. F8의 경쟁 lock fixture는 staging 전용 합성 데이터와 별도 test window에서만 수행한다.

### 8) 기존 기능 회귀

같은 문서의 핵심 기능 1~6과 19~26을 기존 staging 계정과 합성 데이터로 확인하고 `11_existing_regression.md`에 기록한다. 특히 다음은 변경 전과 동일해야 한다.

- 로그인, 로그아웃, 가입, 가입 승인·거절
- 회원 목록과 profile 표시
- 결과·통계·선수 상세·CSV
- 승인된 대상의 `123456` 초기화, 기존 session 종료, 새 로그인
- 플랫폼 관리자 기능
- 같은 클럽의 `matches`·`match_players` Realtime 갱신

### 9) 24시간 관찰

적용 시각부터 24시간 동안 `12_observation_24h.md`에 다음을 기록한다.

- 시작·종료 시각
- API/RPC 오류 증가 여부
- schema lock 또는 timeout 발생 여부
- 가입·승인·회원 목록 오류 여부
- 기존 `123456` 흐름 오류 여부
- Realtime 또는 결과·통계 회귀 여부
- cross-club 데이터 또는 event 노출 여부
- 미해결 incident 수

중단 조건이 한 번이라도 발생하거나 미해결 incident가 1건 이상이면 SG-1을 통과하지 못한 것으로 기록한다.

## 4. SG-1 완료 판정

다음 조건을 모두 만족할 때만 SG-1 완료를 승인할 수 있다.

- migration이 staging에서 한 번 성공
- 적용 전후 기존 status count 동일
- 검증 01~05 정상
- F1~F8 전부 통과
- 핵심 기능 1~6·19~26 전부 통과
- 24시간 중단 조건 0건, 미해결 incident 0건
- 실행 증거에 개인정보와 비밀이 없음

SG-1 통과 전에는 보안 Phase 2 migration, 글로벌 identity migration 또는 관련 앱 전환 코드를 작성·적용하지 않는다.

## 5. 결과 파일 목록

```text
00_phase1_run_metadata.md
01_before_status_counts.csv
02_before_status_constraint.csv
03_phase1_apply_result.md
04_after_status_constraint.csv
05_audit_columns.csv
06_audit_rls.csv
07_audit_privileges.csv
08_audit_constraints_indexes.csv
09_after_status_counts.csv
10_phase1_F1-F8.md
11_existing_regression.md
12_observation_24h.md
```

결과는 운영 데이터 dump가 아니라 gate 판정에 필요한 최소 metadata와 합성 테스트 증거만 저장한다.
