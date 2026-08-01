# 38 security preflight 실행 안내

## 목적과 제한

이 문서는 [38_security_preflight.sql](C:/Users/202212/Documents/morning-star-gpt/supabase/checks/38_security_preflight.sql)의 16개 읽기 전용 조회를 운영자가 Supabase SQL Editor에서 직접 실행하고 결과를 보관하는 절차다.

- Codex는 운영·로컬 Supabase에 연결하거나 SQL을 실행하지 않는다.
- 이 단계에서는 함수, 정책, 권한, trigger, schema, 데이터 또는 애플리케이션을 변경하지 않는다.
- 16개 문장을 한 번에 실행하지 않는다. 아래 순서대로 한 문장씩 선택하여 실행하고, 각 결과를 별도 파일로 저장한다.
- 오류가 발생해도 이를 고치기 위한 SQL을 실행하지 않는다. 오류 메시지 자체를 결과로 보관하고 다음 조회의 실행 가능 여부를 판단한다.

## 실행 전 확인

1. Supabase Dashboard 상단의 조직명, 프로젝트명과 Project ID가 조사 대상 운영 프로젝트와 일치하는지 두 번 확인한다.
2. Database backups에서 최근 정상 백업 시각과 보존 상태를 확인한다. 읽기 전용 조회라도 잘못된 프로젝트에서 작업하는 것을 막기 위한 운영 절차다.
3. SQL Editor에서 새 query tab을 만들고 이름을 `38_security_preflight_read_only_YYYYMMDD`처럼 지정한다.
4. 원본 파일 첫 줄이 다음 경고인지 확인한다.

   `READ-ONLY PREFLIGHT. THIS FILE MUST NOT MODIFY DATABASE OBJECTS OR DATA.`

5. 각 블록에서 선택한 문장이 `SELECT` 또는 `WITH ... SELECT`로 시작하는지 확인한다. `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, `TRUNCATE`, `CALL`, `DO`가 활성 SQL로 보이면 실행하지 않는다.
6. 결과는 사용자 profile 행, 이메일, token, session, password hash를 조회하지 않아야 한다. 예상하지 못한 개인정보나 token이 나타나면 export와 공유를 중단한다.
7. 함수 정의 결과는 운영 metadata다. 원본은 접근 제한 폴더에 저장하고 외부 전달본은 secret-like literal이 없는지 검사한다. 현재 저장소 함수에 있는 고정 문자열 `123456`은 사용자 비밀번호 행이 아니지만 공개 장소에 결과 파일을 올리지는 않는다.

## 결과 저장 형식

- 기본 형식: SQL Editor의 `Download CSV`, UTF-8, 첫 행 column header 포함
- 파일 인코딩: UTF-8
- 파일 내용: 정렬·열 이름을 바꾸지 않은 원본 결과
- 결과가 0행이면 header만 있는 CSV를 저장하고 같은 이름의 `.note.txt`에 `0 rows`를 기록한다.
- SQL 오류가 나면 CSV를 임의로 만들지 말고 같은 이름의 `.error.txt`에 실행 시각, 프로젝트 ID, statement 번호, 전체 오류 메시지를 저장한다.
- 함수 정의처럼 줄바꿈이 포함된 열은 CSV quoting을 유지한다. Excel에서 열었다가 다시 저장하지 말고 SQL Editor가 내려준 원본을 보관한다.
- 권장 폴더: `38_security_preflight_<project-id>_<YYYYMMDD-HHmm>/`
- 결과 파일에는 사용자 이메일이나 비밀번호를 파일명에 넣지 않는다.

## 번호별 실행 순서

아래 번호는 preflight 파일의 활성 SQL 문장 순서와 정확히 일치한다.

| 번호 | 확인 목적 | 실행할 SQL 범위 | 정상 결과 | 저장 파일명 | 결과 없음·오류 의미 |
|---:|---|---|---|---|---|
| 01 | 접속 DB·schema·role·PostgreSQL 버전 확인 | `-- 1. Server...` 아래 첫 번째 `select current_database() ...` 한 문장 | 정확히 1행. 대상 DB 이름, `current_schema`, 실행 role, server version 표시 | `01_environment.csv` | 오류는 기본 catalog 조회도 불가능한 상태이므로 즉시 중단. 프로젝트가 틀리면 이후 실행 금지 |
| 02 | 관련 schema owner와 ACL 확인 | 01 다음 `select ... from pg_catalog.pg_namespace` | `public`, `auth`, `extensions`, `supabase_migrations` 중 존재하는 schema가 행으로 표시 | `02_schema_owners_acl.csv` | 일부 schema 없음은 운영 구조 차이. `public` 또는 `auth` 없음은 프로젝트/권한 오선택 가능성으로 중단 |
| 03 | 적용 migration 식별자 확인 | `-- 2. Migration metadata` 아래 `select version from supabase_migrations.schema_migrations` | 적용된 version이 오름차순으로 표시 | `03_migration_history.csv` | relation/column 없음은 수동 SQL Editor 또는 다른 migration 체계 가능성. 오류를 저장하고 migration 적용 여부를 다른 metadata와 비교 |
| 04 | 관련 table과 column 구조 확인 | `-- 3. Related table/column inventory` 전체 SELECT | 관련 public table의 column, type, nullability, default가 표시 | `04_table_columns.csv` | 특정 table/column 0행은 저장소와 운영 drift 또는 migration 미적용 가능성 |
| 05 | 함수 signature·owner·SECURITY DEFINER·설정·raw ACL 확인 | `-- 4. Function signature...`의 `WITH target_functions ... SELECT` | 존재하는 각 overload가 별도 행. identity arguments, owner, `security_definer`, `proconfig`, `proacl` 표시 | `05_function_signatures_security.csv` | 대상 함수 누락은 migration 미적용/drift. 예상 밖 overload는 수동 hotfix 또는 구 signature 잔존 가능성 |
| 06 | 기본 권한까지 펼친 함수 EXECUTE ACL 확인 | `-- 5. Expanded function ACL` 전체 WITH 조회 | 함수·signature·grantee별 EXECUTE 행. `proacl IS NULL`인 기본 PUBLIC 권한도 펼쳐짐 | `06_function_acl_expanded.csv` | 0행은 대상 함수 누락 또는 catalog 접근 문제. helper에 PUBLIC/anon/authenticated가 보이면 검토 필요하나 아직 REVOKE 금지 |
| 07 | anon/authenticated의 유효 EXECUTE 확인 | `-- 6. Effective EXECUTE check` 전체 WITH 조회 | 각 함수/signature에 anon·authenticated `has_execute=true/false` 또는 role 부재 시 null | `07_function_execute_effective.csv` | null은 해당 DB role 부재 가능성. 예상 공개 RPC false 또는 helper true는 모두 drift 후보이며 즉시 변경하지 않음 |
| 08 | 실제 함수 본문과 저장소 definition 비교 | `-- 7. Exact function definitions` 전체 WITH 조회 | 각 함수 overload별 `function_definition` 전문 | `08_function_definitions.csv` | 누락은 함수 부재. export에 예상 밖 secret/token이 있으면 공유 중단 후 제한된 원본 보관 |
| 09 | trigger와 실제 연결 함수 확인 | `-- 8. Trigger inventory` 전체 SELECT | profiles/matches/match_players/auth.users 관련 trigger, 연결 function OID 의미, enabled 상태와 definition 표시 | `09_triggers.csv` | trigger 누락·disabled·예상 밖 함수 연결은 가입, 권한 보호, ready 전환 회귀 위험. 변경 금지 |
| 10 | RLS 활성화·강제 여부와 replica identity 확인 | `-- 9. RLS enablement` 아래 첫 번째 SELECT | 4개 table 각각 `rls_enabled`, `rls_forced`, replica identity code 표시 | `10_rls_table_status.csv` | table 누락 또는 RLS false는 중요 drift. 즉시 ALTER하지 말고 결과 기록 |
| 11 | RLS policy 이름·role·조건·permissive 확인 | 10 다음 `select ... from pg_catalog.pg_policies` | profiles/matches/match_players/score_confirmations의 모든 정책이 개별 행 | `11_rls_policies.csv` | table별 0행은 RLS가 켜졌다면 조회 전면 차단 가능, 꺼졌다면 전면 노출 가능. 실제 상태와 함께 판단 |
| 12 | 관련 table의 API role grant 확인 | `-- 10. Table grants` 전체 SELECT | PUBLIC/anon/authenticated/service_role의 table privilege가 행으로 표시 | `12_table_privileges.csv` | 0행 또는 예상 밖 write grant는 drift 후보. RLS와 grant를 함께 해석해야 하며 권한 변경 금지 |
| 13 | publication 설정 확인 | `-- 11. Realtime publication membership` 아래 첫 번째 SELECT | publication별 all-tables 및 event 종류 표시 | `13_realtime_publications.csv` | `supabase_realtime` 누락은 Realtime 비활성/구조 차이 가능성 |
| 14 | 관련 table의 publication 포함 여부 확인 | 13 다음 `select ... from pg_catalog.pg_publication_tables` | 저장소 예상상 `matches`, `match_players`가 `supabase_realtime`에 표시 | `14_realtime_tables.csv` | 0행/누락은 현재 Realtime 흐름과 운영 DB 불일치. 예상 밖 profiles/confirmations 포함도 검토 필요 |
| 15 | PK/FK/UNIQUE/CHECK 등 constraint 확인 | `-- 12. Constraints` 전체 SELECT | 관련 table의 constraint 이름, type, validated 상태, definition 표시 | `15_constraints.csv` | 핵심 FK/unique/check 누락은 함수/RLS 검토 전에 schema drift로 분류 |
| 16 | 함수 signature와 상태 조건에 쓰는 enum 확인 | `-- 13. Enum labels` 전체 SELECT | 관련 enum의 label과 순서가 표시 | `16_enums.csv` | enum 또는 label 누락·추가는 저장소와 운영 drift. signature/함수 본문 비교 전에 해결 방식 결정 필요 |

## SQL Editor 실행 방법

각 번호마다 다음 절차를 반복한다.

1. 원본 preflight 파일에서 해당 statement 하나만 SQL Editor의 새 tab에 붙여넣는다.
2. 붙여넣은 범위가 세미콜론 하나로 끝나는지 확인한다.
3. 활성 SQL 첫 단어가 `SELECT` 또는 `WITH`인지 확인한다.
4. Run을 누른다.
5. 결과 grid의 행 수와 오류 유무를 기록한다.
6. Download CSV로 위 표의 파일명에 저장한다.
7. 다음 번호로 이동한다. 오류가 있어도 임의 수정 SQL은 실행하지 않는다.

## 최종 결과 파일 목록

```text
01_environment.csv
02_schema_owners_acl.csv
03_migration_history.csv
04_table_columns.csv
05_function_signatures_security.csv
06_function_acl_expanded.csv
07_function_execute_effective.csv
08_function_definitions.csv
09_triggers.csv
10_rls_table_status.csv
11_rls_policies.csv
12_table_privileges.csv
13_realtime_publications.csv
14_realtime_tables.csv
15_constraints.csv
16_enums.csv
```

오류나 0행 결과가 있으면 해당 번호에 `.error.txt` 또는 `.note.txt`가 추가될 수 있다.

## 저장소 migration과 운영 DB 비교 체크리스트

### A. 기준과 완전성

- [ ] 결과 폴더의 Project ID와 대상 운영 프로젝트가 일치한다.
- [ ] 01~16 결과 또는 대응하는 error/note 파일이 모두 있다.
- [ ] 결과에 사용자 행, 이메일, token, session, password hash가 없다.
- [ ] 기준 저장소 commit이 `d5b9746dc3f414c4c403030931ca4f1dc4778f87`이다.
- [ ] migration history와 `supabase/migrations/01_schema.sql`부터 `37_club_fine_flag.sql`까지의 적용 관계를 비교했다.

### B. 함수 signature와 overload

- [ ] 아래 저장소상 signature가 운영 DB에 정확히 존재한다.

| 함수 | 저장소상 검토 signature |
|---|---|
| `admin_update_user` | `(uuid, public.user_role, boolean, text, public.award_level) → void` |
| `admin_reset_user_password` | `(uuid) → void` |
| `admin_remove_user` | `(uuid) → text` |
| `register_player` | `(uuid, public.player_position, uuid) → void` |
| `remove_player` | `(uuid, public.player_position) → void` |
| `start_match` | `(uuid) → void` |
| `submit_score` | `(uuid, integer, integer, integer) → void` |
| `link_match_youtube` | `(uuid, text, text) → void` |
| `unlink_match_youtube` | `(uuid) → void` |
| `transfer_profile_refs` | `(uuid, uuid) → void` |
| `internal_add_player` | `(uuid, uuid, public.player_position) → void` |
| `log_match_audit` | `(uuid, text, jsonb, jsonb, text) → void` |
| `get_player_monthly_trend` | `(uuid, integer, uuid) → TABLE(...)` |
| `get_player_recent_matches` | `(uuid, integer, uuid) → TABLE(...)` |

- [ ] 같은 이름의 예상하지 못한 overload가 없는지 확인했다.
- [ ] 구 signature가 남아 PostgREST 호출이 모호해질 가능성을 확인했다.
- [ ] 인자 이름, 기본값, 순서, enum schema, 반환 TABLE 열과 타입을 function definition으로 비교했다.
- [ ] 저장소에는 있으나 운영 DB에 없는 함수와 운영 DB에만 있는 함수를 별도 목록으로 만들었다.

### C. 함수 보안 속성

- [ ] owner가 함수별로 예상 role인지 확인했다. owner가 다르면 내부 helper 호출과 trigger 실행 영향으로 분류했다.
- [ ] `SECURITY DEFINER` 여부가 저장소 최종 정의와 일치한다.
- [ ] `proconfig`의 `search_path`가 저장소의 `public` 또는 `public, extensions` 설정과 일치한다.
- [ ] `search_path`가 null이거나 쓰기 가능한 예상 밖 schema를 먼저 포함하는 함수를 표시했다.
- [ ] `proacl` 원본과 펼친 ACL 결과가 일치한다.
- [ ] PUBLIC, anon, authenticated의 유효 EXECUTE를 함수별로 비교했다.
- [ ] 프런트 공개 RPC의 authenticated 실행이 유지되는지 확인했다.
- [ ] `transfer_profile_refs`, `internal_add_player`, `log_match_audit`와 trigger 함수의 외부 EXECUTE 여부를 표시했다. 아직 REVOKE하지 않는다.

### D. 함수 본문 drift

- [ ] 운영 `pg_get_functiondef`와 migration의 마지막 `CREATE OR REPLACE` 정의를 비교했다.
- [ ] 클럽 membership/role 검사가 저장소와 같은지 확인했다.
- [ ] `admin_reset_user_password`가 123456 초기화와 세션 제거를 현재 저장소처럼 수행하는지 확인했다. 변경하지 않는다.
- [ ] 운영 본문에만 있는 조건·감사·hotfix 주석 또는 저장소에만 있는 조건을 목록화했다.
- [ ] 함수 definition 차이가 수동 SQL Editor hotfix로 의심되는지 migration history와 대조했다.

### E. trigger

- [ ] `auth.users` 신규 가입 trigger가 실제 `handle_new_user` OID에 연결되어 있다.
- [ ] auth 사용자 삭제 trigger와 handler를 확인했다.
- [ ] `profiles` 권한 변경 방지 trigger가 실제 `prevent_privilege_change`에 연결되어 있다.
- [ ] `match_players` ready 동기화 trigger가 실제 `sync_match_ready`에 연결되어 있다.
- [ ] 동일 event에 중복 trigger, disabled trigger 또는 운영 전용 trigger가 없는지 확인했다.

### F. RLS와 table grant

- [ ] 4개 대상 table의 RLS enable/force 상태를 비교했다.
- [ ] 정책 이름, command, role, `qual`, `with_check`, permissive/restrictive가 저장소와 일치한다.
- [ ] `matches_select_authenticated`가 대상 match의 club membership을 사용하는지 확인했다.
- [ ] `match_players`, `score_confirmations`, `profiles`에 저장소상 `USING(true)` 정책이 실제로 존재하는지 확인했다.
- [ ] 동일 table에 추가 permissive policy가 있어 조건이 OR로 넓어지는지 확인했다.
- [ ] table grant와 RLS를 함께 비교하여 anon/authenticated의 실제 접근 후보를 분류했다.
- [ ] 저장소 migration에 없는 운영 정책·grant를 수동 hotfix 후보로 표시했다.

### G. Realtime

- [ ] `supabase_realtime` publication 설정을 확인했다.
- [ ] `matches`와 `match_players` 포함 여부가 저장소와 일치한다.
- [ ] `profiles`, `score_confirmations` 등 예상 밖 table 포함 여부를 확인했다.
- [ ] `match_players` replica identity와 DELETE event에 필요한 정보가 현재 프런트 흐름과 맞는지 확인했다.
- [ ] publication 차이는 RLS 변경과 분리하여 staging Realtime 테스트 대상으로 기록했다.

### H. schema·constraint·enum drift

- [ ] 관련 column type/null/default가 migration과 일치한다.
- [ ] PK, FK, UNIQUE, CHECK constraint 이름과 definition이 일치한다.
- [ ] `club_members.status` check와 대상 enum label/순서가 일치한다.
- [ ] 저장소에 없는 운영 DB 객체와 운영에 없는 저장소 객체를 각각 목록화했다.
- [ ] 차이를 `정상 운영 hotfix`, `미적용 migration`, `구 객체 잔존`, `원인 미상`으로 분류하되 임의 수정하지 않았다.

## 결과 수신 후 판단 상태

각 차이는 다음 중 하나로 표시한다.

- `일치`
- `운영 DB 확인 필요`
- `수동 hotfix 의심`
- `제품 정책 확인 필요`
- `staging 검증 필요`
- `변경 금지`

Preflight 결과만으로 migration을 작성하거나 권한을 바꾸지 않는다. 제품 정책 결정과 staging baseline 준비가 다음 선행 단계다.

## 결과 수신 전 금지사항

- 보안 migration 또는 실행 가능한 SQL 작성
- 함수 `CREATE OR REPLACE`
- `GRANT`·`REVOKE`
- RLS 생성·삭제·변경
- 프런트엔드와 관리자 RPC signature 변경
- `profiles.is_active` 의미 확정
- 다중 클럽 비밀번호 정책 확정
- Realtime 구조 변경
- commit, push, PR 생성
