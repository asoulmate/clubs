# GR-01 글로벌 선수 identity 설계

## 1. 문서 상태

- 기준일: 2026-08-01
- 상태: **비실행 설계 확정, SQL·앱 미구현**
- 선행 gate: SG-1 통과 후 보안 SG-2 구현·검증
- 적용 원칙: additive only, 기존 profile·FK·URL 유지, 자동 병합 금지

이 문서는 글로벌 레이팅의 첫 데이터 기반을 정의한다. 실행 가능한 SQL, RLS, 함수, GRANT/REVOKE 또는 애플리케이션 변경을 포함하지 않는다.

## 2. 현재 구조와 문제

현재 `profiles`는 세 역할을 동시에 담당한다.

- Auth 계정과 연결되는 플랫폼 profile
- 경기·대회가 참조하는 선수 식별자
- Auth 계정이 없는 클럽 guest

최종 `handle_new_user()`는 같은 클럽의 동명 guest를 찾고, 입상 단계가 달라도 가장 오래된 동명 guest를 선택할 수 있다. 이후 `transfer_profile_refs()`로 일부 참조를 새 Auth UUID로 이동하고 guest의 모든 membership과 profile을 삭제한다.

이 방식에는 다음 위험이 있다.

- 동명이인을 잘못 합칠 수 있음
- guest가 속한 다른 클럽 membership을 잃을 수 있음
- `transfer_profile_refs()` 이후 추가된 참조가 누락될 수 있음
- cascade FK로 대회·배팅 기록이 삭제될 수 있음
- 병합 근거, 승인자, 되돌리기 이력이 없음
- rating 계산에서 profile UUID와 실제 선수를 안정적으로 구분할 수 없음

## 3. 확정 identity 규칙

1. `profiles.id`는 계정·기존 화면·기존 FK 호환 식별자로 유지한다.
2. 실제 선수는 별도 `global_players.id`로 식별한다.
3. 하나의 profile은 한 시점에 최대 한 global player에 연결된다.
4. 하나의 global player에는 검수된 여러 profile이 연결될 수 있다.
5. 기존 profile은 초기 backfill에서 각각 독립된 global player를 받는다.
6. 이름, 소속, 입상, 클럽이 같아도 자동 병합하지 않는다.
7. guest와 신규 가입자가 유사하면 병합이 아니라 claim 후보만 만든다.
8. 승인된 merge는 기존 profile이나 경기 FK를 삭제·치환하지 않고 profile mapping을 동일 canonical player로 연결한다.
9. 잘못된 merge는 mapping을 분리할 수 있어야 하며 merge/split 전후와 사유를 append-only event로 남긴다.
10. `profiles.is_active`와 `club_members.status`는 global player의 상태와 혼합하지 않는다.

## 4. 논리 데이터 구조

실제 이름과 migration 번호는 SG-1·SG-2 통과 후 운영 catalog 재확인 결과로 확정한다.

### 4.1 `global_players`

| 필드 | 규칙 |
|---|---|
| `id` | UUID primary key |
| `display_name` | canonical 표시명, 1~30자; 이름 자체는 unique 아님 |
| `status` | 초기에는 `active`, `merged`만 사용 |
| `merged_into_id` | merged일 때만 다른 active canonical player를 가리키는 nullable self FK |
| `created_at`, `updated_at` | 생성·수정 시각 |

삭제를 정상 업무 흐름으로 제공하지 않는다. `merged_into_id` chain은 최종 active canonical로 resolve하며 self merge와 cycle을 차단한다.

`global_players.status`는 플랫폼 계정 정지나 클럽 탈퇴를 나타내지 않는다. 선수 identity의 canonical/merged 수명주기만 나타낸다.

### 4.2 `profiles.global_player_id`

- nullable FK로 먼저 추가하고 기존 profile 생성·조회 동작을 바꾸지 않는다.
- FK delete 동작은 `RESTRICT`를 원칙으로 해 mapping 손실을 막는다.
- backfill 완료 전까지 null을 허용한다.
- backfill 안정화만으로 즉시 NOT NULL을 강제하지 않는다.
- 기존 `profiles.id` 기반 URL, 경기, 대회, 통계 join은 그대로 유지한다.

### 4.3 `player_aliases`

| 필드 범주 | 규칙 |
|---|---|
| identity | `global_player_id` |
| 표시 정보 | 원본 `name`, 검색용 `normalized_name`, nullable `affiliation` |
| 근거 | `source_type`, nullable `source_profile_id`; GR-03에서 nullable `source_record_id` 추가 가능 |
| 유효 기간 | `valid_from`, nullable `valid_to` |
| 시각 | `created_at` |

`normalized_name`은 검색 후보 생성에만 사용하며 unique 또는 자동 merge 기준으로 사용하지 않는다. 동일한 alias가 여러 선수에게 존재할 수 있다.

### 4.4 `player_external_ids`

- provider와 external player ID의 조합만 unique로 관리한다.
- 최초 GR-01에서는 구조만 만들거나 후속 외부 데이터 단계로 지연할 수 있다.
- 브라우저 직접 쓰기는 허용하지 않는다.
- 검증 상태와 검수자·시각을 저장한다.
- 외부 ID가 있다고 자동으로 기존 profile을 병합하지 않는다.

### 4.5 `player_identity_claims`

| 필드 범주 | 규칙 |
|---|---|
| 유형 | guest claim, duplicate merge, split request, external ID link |
| 대상 | source profile/global player와 target global player |
| 상태 | `pending`, `approved`, `rejected`, `canceled` |
| 근거 | 최소화된 JSON metadata와 사유; password/token/민감 원문 금지 |
| 주체 | requester, reviewer, requested/reviewed 시각 |

동일한 open claim의 중복 생성을 막되 과거 rejected claim은 삭제하지 않는다. 승인과 거절은 플랫폼 데이터 관리자 또는 별도 승인된 검수 절차만 수행한다. 일반 클럽 관리자는 후보를 제안할 수 있어도 전역 merge를 확정하지 못한다.

### 4.6 `player_identity_events`

- `created`, `profile_linked`, `claim_requested`, `claim_approved`, `claim_rejected`, `merged`, `split`을 append-only로 기록한다.
- actor, source/target, before/after mapping, reason, correlation ID, timestamp를 기록한다.
- profile 이름이나 개인정보 전체 snapshot 대신 UUID와 필요한 최소 변경값만 저장한다.
- 직접 update/delete를 허용하지 않는다.

### 4.7 backfill 실행 기록

1:1 backfill은 실행 ID, 기준 시각, 대상 profile 수, 생성 player 수, 연결 수, skip/error 수와 checksum을 남긴다. 재실행 시 이미 연결된 profile에 두 번째 global player를 만들지 않아야 한다.

## 5. 생성·가입·claim 전환

### 5.1 최초 additive 단계

- schema와 nullable FK만 추가한다.
- 기존 `handle_new_user()`와 `create_guest_profile()` 동작은 아직 변경하지 않는다.
- 앱은 신규 table을 읽거나 표시하지 않는다.
- 이 단계는 구버전 앱에서도 완전히 동작해야 한다.

### 5.2 1:1 backfill

1. 각 기존 profile마다 독립 global player를 생성한다.
2. 현재 name과 affiliation을 `legacy_profile` alias로 복사한다.
3. profile을 생성된 global player에 연결한다.
4. 동명·유사 profile은 candidate만 산출하고 mapping을 합치지 않는다.
5. profile, membership, match, bet, tournament row는 수정하거나 삭제하지 않는다.

### 5.3 신규 guest 생성 전환

SG-2 이후 별도 배포에서 guest profile과 독립 global player를 같은 transaction으로 생성한다. 기존 `create_guest_profile()` signature와 반환 shape는 유지하거나 안전한 wrapper로 보존한다.

같은 클럽에 이름·입상·소속이 동일한 active guest가 이미 있을 때 기존 중복 방지 동작은 유지할 수 있지만, 다른 profile 또는 다른 클럽의 identity와 자동 병합하지 않는다.

### 5.4 신규 회원가입 전환

현재 동명 guest 자동 이전·삭제는 claim 검수 경로가 준비된 뒤에만 단계적으로 중단한다.

전환 후 신규 Auth profile에는 독립 global player를 생성한다. 같은 클럽의 유사 guest가 있으면 claim 후보를 만들되 다음 작업은 하지 않는다.

- `transfer_profile_refs()` 자동 호출
- guest membership 일괄 삭제
- guest profile 삭제
- 경기·배팅·대회 FK 자동 치환

승인 전에는 신규 계정과 guest 기록이 분리되어 보인다. claim 승인 후에는 두 profile이 같은 canonical global player를 가리켜 글로벌 집계에서 연결되지만 기존 클럽 기록과 profile URL은 보존된다.

이 변화는 기존 가입 직후 과거 guest 기록을 곧바로 새 profile에 보여주던 동작에 영향을 주므로, claim UI·안내·관리자 검수와 회귀 테스트가 준비되기 전에는 cutover하지 않는다.

## 6. 조회·수정 권한

- 브라우저에 base identity table 전체 SELECT를 직접 허용하지 않는다.
- 같은 클럽과 접근 가능한 경기에서 필요한 최소 표시 필드는 SEC-PROD-12의 제한 조회 계약을 사용한다.
- 본인은 자신의 claim과 mapping 상태를 조회할 수 있다.
- 일반 클럽 admin/sub_admin은 전역 merge/split, canonical 이름, 외부 ID를 확정하지 못한다.
- 플랫폼 데이터 관리자만 검수 RPC를 통해 merge/split/외부 ID 확정을 수행한다.
- 모든 변경 RPC는 caller active 상태, 명시적 대상, 허용 역할과 최신 claim 상태를 다시 검증한다.
- SECURITY DEFINER 함수는 고정 search path, 내부 helper 직접 EXECUTE 차단, 명시 grant 원칙을 따른다.

## 7. merge와 split

### merge

1. 두 identity와 관련 profile mapping을 lock한다.
2. 이미 merged인지, cycle이 생기는지, claim이 승인 가능한 최신 상태인지 확인한다.
3. source identity를 target canonical로 soft redirect한다.
4. 관련 profile mapping을 target canonical로 연결한다.
5. 원본 profile, 경기, membership, 대회와 기존 URL은 그대로 둔다.
6. before/after mapping과 승인 근거를 event로 남긴다.
7. 기존 rating을 overwrite하지 않고 새 run 필요 상태로 표시한다.

### split

1. 잘못 연결된 profile 목록을 명시한다.
2. 새 active global player를 만들거나 승인된 이전 identity로 mapping을 되돌린다.
3. 원시 profile/FK는 변경하지 않는다.
4. split event와 사유를 남긴다.
5. 영향받는 rating pool을 새 run으로 재계산한다.

merge/split은 event와 mapping 변경이 함께 성공하거나 함께 실패해야 한다.

## 8. 기존 기능 영향과 호환 방안

| 기능 | additive/backfill 영향 | cutover 영향 | 보존 방법 |
|---|---|---|---|
| 로그인·가입 승인 | 없음 | 자동 guest 이전이 claim 후보로 바뀜 | claim 준비 전 기존 trigger 미전환, 기존 Auth 흐름 유지 |
| 게스트 등록 | 없음 | global player 동시 생성 | 기존 RPC signature·반환 shape wrapper 유지 |
| 선수 목록·상세 URL | 없음 | 내부적으로 global 요약 추가 가능 | `profileId` URL과 club 기록 유지 |
| 경기 편성·결과 | 없음 | global ID는 조회 시 resolve | `match_players.user_id` 변경 없음 |
| 통계·기존 순위 | 없음 | 글로벌 요약과 별도 표시 | 기존 RPC·계산 유지 |
| 대회 기록 | 없음 | global 집계 시 mapping resolve | `tournament_entries.user_id` 변경 없음 |
| 다중 클럽 | mapping만 공유 | 같은 선수의 club별 기록 분리 | membership과 club scope 불변 |
| 탈퇴·계정 정지 | 없음 | identity는 보존 | account/membership 상태와 identity 상태 분리 |

## 9. 필수 테스트

### schema/backfill

- profile 1개당 정확히 한 global player가 생성된다.
- backfill 전후 profile, club membership, match player, bet, tournament row count와 FK checksum이 같다.
- backfill 재실행으로 global player나 alias가 중복 생성되지 않는다.
- mapping null, orphan, 한 profile의 복수 mapping이 없다.
- 동명 profile은 서로 다른 global player로 유지된다.

### 가입·guest

- 기존 앱 상태에서 additive schema가 가입과 guest 등록에 영향을 주지 않는다.
- cutover 전 기존 RPC signature와 반환 shape가 동일하다.
- cutover 후 동명 guest가 있어도 자동 삭제·FK 이동이 발생하지 않는다.
- 유사 guest가 없으면 불필요한 claim을 만들지 않는다.
- claim 승인 전 신규 회원과 guest의 club 기록이 섞이지 않는다.

### 권한

- 일반 사용자와 club admin/sub_admin이 direct table write 또는 전역 merge를 할 수 없다.
- club A 관리자가 club B의 claim 근거나 비공개 profile 정보를 조회하지 못한다.
- inactive, pending, rejected, withdrawn 사용자는 해당 club 권한을 얻지 못한다.
- 내부 helper 직접 RPC 호출은 거부된다.

### merge/split과 레이팅 준비

- merge 후 여러 profile이 같은 canonical player로 resolve되지만 원시 FK는 그대로다.
- merge cycle과 self merge가 차단된다.
- split 후 mapping이 복구되고 과거 event는 남는다.
- 잘못된 merge가 다른 클럽 membership이나 profile 상태를 변경하지 않는다.
- merge/split은 이전 rating row를 수정하지 않고 재계산 대상을 만든다.

## 10. 배포와 rollback

1. schema, 1:1 backfill, 신규 생성 dual-write, 가입 claim cutover를 각각 별도 단계로 배포한다.
2. 한 단계마다 staging 전체 회귀와 관찰 기간을 통과한다.
3. 신규 읽기는 mapping이 없을 때 기존 profile로 안전하게 fallback한다.
4. rollback은 신규 경로 비활성화와 기존 읽기 경로 복귀로 수행한다.
5. 생성된 identity와 event를 삭제하는 down migration은 사용하지 않는다.
6. guest 자동 이전을 중단한 뒤에는 취약한 자동 삭제 경로를 rollback으로 다시 열지 않는다. 대신 claim 운영을 중단하고 독립 profile 상태를 유지한다.

## 11. 구현 착수 gate

실행 가능한 GR-01 migration은 다음이 모두 충족된 뒤에만 작성한다.

- SG-1 staging F1~F8·기존 기능 회귀·24시간 관찰 통과
- SG-2 target-club와 profile 보호 설계가 staging에서 검증됨
- 운영 catalog의 profile 관련 constraint, trigger, function ACL drift 재확인
- backfill 대상 profile 수와 guest/auth/membership 분포를 개인정보 없이 집계
- merge 검수 주체와 claim 공개 범위 승인
- migration 번호와 rollback·관찰 window 승인

착수 전 aggregate inventory는 `global-identity-readiness-run-guide.md`와 `supabase/checks/global_identity_readiness.sql`을 사용한다.
