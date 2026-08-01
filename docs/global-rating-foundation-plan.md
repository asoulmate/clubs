# 글로벌 레이팅 기반 구축 계획

## 문서 적용 상태

- 기준일: 2026-08-01
- 이 문서는 최초 글로벌 레이팅 구조 계획을 보존하되, 보안·제품 정책은 `security-product-decisions.md`의 SEC-PROD-01~14와 `38_security-implementation-plan.md`의 TECH-01~06을 우선 적용한다.
- 현재 구현 상태는 `38_security_baseline_foundation.sql`의 **로컬 작성 완료, staging·운영 DB 미적용**이다. 이 파일은 전체 보안 baseline이 아니라 additive Phase 1 기반이다.
- Phase 1 staging 적용, F1~F8 회귀, 24시간 관찰이 끝나기 전에는 다음 실행 가능한 migration을 작성하거나 적용하지 않는다.
- 아래 `39`~`46` 파일명은 최초 계획의 논리적 순서를 나타내는 예시다. 보안 baseline 후속 migration과 번호 충돌을 피하기 위해 실제 파일 번호는 각 gate 통과 후 당시 마지막 migration 번호를 기준으로 배정한다.
- 기존 애플리케이션 기능, URL, RPC signature, `123456` 초기화 흐름을 전환 검증 전에 변경하지 않는다.

## 1. 목표와 비목표

### 목표

- 기존 `profiles`, `club_members`, `matches`, `match_players`와 URL을 유지하면서 글로벌 선수 연결 계층을 추가한다.
- 앞으로 들어오는 경기부터 원본 점수·종료 방식·출처·검수·중복 정보를 잃지 않는다.
- 기존 확정 경기를 삭제하거나 임의 추정하지 않고 legacy 입력으로 보존한다.
- 클럽/글로벌, 단식/복식, 모델 버전별 레이팅을 재현 가능하게 계산할 저장 구조를 준비한다.
- RLS와 SECURITY DEFINER RPC를 클럽 경계와 최소 권한 원칙에 맞춘다.

### 이번 기반 단계의 비목표

- Glicko-2, TrueSkill 또는 계층형 모델의 최종 선정과 공식 점수 공개.
- KATO/KATA/KTA, 네이버 밴드, YouTube 크롤러/API 수집 구현.
- 기존 테이블·컬럼·URL 삭제 또는 이름 변경.
- 과거 합산 점수에서 세트·타이브레이크·기권 여부를 추정 생성.
- 중복 후보를 자동 삭제하거나 동명 선수를 자동 병합.

## 2. 설계 원칙

1. **Additive only**: 새 테이블과 nullable FK를 추가하고 기존 읽기·쓰기 경로를 유지한다.
2. **Identity와 account 분리**: 로그인 profile과 실제 테니스 선수 실체를 같은 개념으로 취급하지 않는다.
3. **Raw first**: 파생 통계보다 source와 result revision을 먼저 보존한다.
4. **Append-only audit**: 병합, 검수, 결과 정정, 레이팅 변화를 이벤트로 남긴다.
5. **No destructive dedupe**: 중복은 후보·판정으로 관리하고 원본 행을 지우지 않는다.
6. **Scope explicit**: 모든 변경 RPC는 target club/match와 호출자 권한을 직접 대조한다.
7. **Compatibility projection**: 기존 `matches.team_a_score/team_b_score/status`는 현재 UI용 projection으로 계속 유지한다.
8. **Reproducibility**: 레이팅 결과는 모델 버전, 입력 revision, identity snapshot, 실행 시각과 hash로 재현할 수 있어야 한다.

## 3. 권장 DB 구조

아래 테이블과 컬럼은 **권장 신규 구조**이며 현재 저장소에는 없다.

### 3.1 글로벌 선수 identity

| 구조 | 주요 컬럼 | 용도 |
|---|---|---|
| `global_players` | `id`, `display_name`, `status`, `merged_into_id`, `created_at`, `updated_at` | 실제 선수의 canonical identity. 삭제 대신 active/merged 상태 사용 |
| `profiles.global_player_id` | nullable FK → `global_players.id` | 기존 profile/account/guest를 글로벌 선수에 연결. 기존 `profiles.id`와 모든 FK 유지 |
| `player_aliases` | `global_player_id`, `name`, `normalized_name`, `affiliation`, `source_record_id`, `valid_from/to` | 이름·소속 변형과 출처 보존. 이름을 unique로 만들지 않음 |
| `player_external_ids` | `global_player_id`, `provider`, `external_player_id`, `verification_status`, `verified_by/at` | KATO/KATA/KTA 등. `(provider, external_player_id)` unique |
| `player_identity_claims` | source/target identity, `claim_type`, `status`, `evidence`, `requested_by`, `reviewed_by/at` | 게스트 claim, 중복 병합, 분리 요청의 검수 workflow |
| `player_identity_events` | `event_type`, source/target, before/after JSONB, `reason`, `actor_id`, `created_at` | merge/split/claim/reject의 append-only 감사 이력 |

권장 병합 방식은 기존 `match_players.user_id`를 대량 수정하는 것이 아니다. 여러 `profiles`가 같은 `global_player_id`를 가리키게 하고, 레이팅 입력 시 global identity로 resolve한다. 잘못 병합했을 때 mapping을 되돌릴 수 있고 원시 profile/경기 참조도 보존된다.

`global_players.merged_into_id`는 soft redirect 용도이며 원본 행을 삭제하지 않는다. merge cycle을 막는 검증 함수가 필요하다.

### 3.2 경기 원본·revision·출처

| 구조 | 주요 컬럼 | 용도 |
|---|---|---|
| `matches.match_kind` | internal/interclub/external/imported 등 | 기존 `club_id`는 owner와 URL scope로 유지하면서 경기 성격 추가 |
| `match_clubs` | `match_id`, `club_id`, `role`(owner/host/visitor/participant) | 한 경기에 여러 클럽 연결 |
| `match_players.representing_club_id` | nullable FK → `clubs.id` | 교류전에서 참가자의 대표 클럽. 기존 선수 FK 유지 |
| `match_result_revisions` | `match_id`, `revision_no`, `workflow_status`, `outcome_type`, legacy aggregate scores, `supersedes_id`, 제출/검수자·시각·사유 | 결과 제출·확정·정정을 append-only로 보존 |
| `match_result_participants` | `revision_id`, `position`, `profile_id`, `global_player_id_snapshot`, `representing_club_id` | revision 확정 당시 참가자와 identity snapshot |
| `match_sets` | `revision_id`, `set_number`, `set_type`, 양 팀 점수, 양 팀 tiebreak 점수, `completed` | 정규 세트, 타이브레이크, 매치 타이브레이크 원본 |
| `source_records` | `source_type`, `source_url`, `external_id`, `raw_text`, `raw_payload`, `content_hash`, 수집/입력자·시각, review 상태·confidence | manual, YouTube, Naver Band, KATO/KATA/KTA 등 공통 provenance |
| `match_sources` | `match_id`, `source_record_id`, `is_primary`, `linked_by/at` | 한 경기와 여러 증거 연결 |
| `match_fingerprints` | `match_id`, `algorithm_version`, `fingerprint`, `computed_at` | 버전별 중복 탐지 키 |
| `duplicate_match_candidates` | 두 match/source, score, status, reason, reviewer | 자동 삭제 없는 중복 검수 queue |

`outcome_type` 권장 초기 값은 `normal`, `retired`, `walkover`, `canceled`, `incomplete`, `legacy_unknown`이다. 기존 `matches.status` enum은 workflow/UI 호환을 위해 유지한다. 새 outcome을 기존 status enum에 억지로 합치지 않는다.

`match_result_revisions.workflow_status`는 `draft`, `submitted`, `verified`, `rejected`, `superseded`처럼 결과 revision의 검수 상태만 표현한다. 현재 match 화면의 open/ready/in_progress/submitted/confirmed/canceled 흐름은 그대로 둔다.

### 3.3 외부 대회

| 구조 | 주요 컬럼 | 용도 |
|---|---|---|
| `tournaments` | canonical 이름, 주최 단체, external ID | 대회 자체 |
| `tournament_editions` | `tournament_id`, 시작/종료일, 장소, 부문, draw size, source | 연도·회차·부문 |
| `tournament_entries.tournament_edition_id` | nullable FK | 기존 월·대회명은 호환용으로 유지하면서 정규화 연결 |
| `tournament_entries.round_reached_code` | champion/runner_up/SF/QF/R16/R32/R64/participant 등 | 현재 placement보다 넓은 라운드 표현 |
| `tournament_entries.source_record_id`, review 필드 | source/review FK | 외부 근거와 검수 |

대진표에서 얻은 개별 상대전적은 별도 통계 행으로 만들지 말고, `matches.match_kind='external'` 경기와 `source_records`로 입력해야 글로벌 레이팅 입력을 재사용할 수 있다.

### 3.4 레이팅 저장 구조

| 구조 | 주요 컬럼 | 용도 |
|---|---|---|
| `rating_models` | `code`, `name`, 설명 | glicko2/trueskill/hierarchical 등 논리 모델 |
| `rating_model_versions` | `model_id`, semantic version, `parameters`, `input_schema_version`, code commit, active 기간 | 모델·파라미터 재현 |
| `rating_pools` | `scope_type` global/club, nullable `club_id`, `discipline` singles/doubles, `model_version_id` | 글로벌/클럽 및 종목 분리 |
| `rating_runs` | pool/version, cutoff, status, `input_hash`, identity version, 시작/완료 시각, 오류 | 전체/증분 계산 실행 |
| `rating_run_matches` | `run_id`, `match_id`, `revision_id`, included, exclusion reason, sequence | 어떤 결과를 왜 포함했는지 고정 |
| `player_ratings` | pool + global player unique, rating, uncertainty/deviation, volatility, games, as-of run | 현재값 materialization |
| `player_rating_history` | run/match/revision/player, before/after rating·uncertainty·volatility | 선수별·경기별 변경 이력 |

모델별 추가 상태는 초기에 nullable 공통 컬럼과 제한된 JSONB `model_state`를 함께 둘 수 있다. 핵심 조회 필드(rating, uncertainty, volatility)는 JSONB에만 숨기지 않는다.

## 4. 기존 테이블을 유지하며 확장하는 방법

### 4.1 `profiles`와 선수 URL

- `profiles.id`를 변경하지 않는다.
- `profiles.global_player_id`를 nullable로 추가한 뒤 backfill 완료 후 신규 profile에는 trigger/RPC로 자동 생성·연결한다.
- 기존 `#/c/{slug}/players/{profileId}`는 계속 profile ID를 받는다. 화면 내부에서 global player를 resolve해 해당 클럽 기록과 글로벌 요약을 분리 표시한다.
- 새 글로벌 공유 URL이 필요하면 `#/players/global/{globalPlayerId}`를 **추가**하되 기존 경로를 redirect하거나 제거하지 않는다.

### 4.2 `matches`와 스코어 UI

- 기존 `matches.team_a_score`, `team_b_score`, `status`, `version`을 유지한다.
- 새 결과 입력은 transaction 안에서 revision/sets를 기록하고 기존 컬럼도 projection으로 갱신한다.
- 과도기에는 legacy RPC와 v2 RPC를 병행하고 feature flag로 새 UI를 제한한다.
- 확정 경기 정정은 기존 행 overwrite만 하지 않고 새 revision을 추가한 뒤 current projection을 갱신한다.
- 기존 CSV 컬럼은 유지하고 revision/source/set CSV를 별도 dataset으로 추가한다.

### 4.3 클럽과 교류전

- `matches.club_id`를 삭제·rename하지 않는다. owner club 및 기존 RLS/URL 기준으로 유지한다.
- 모든 기존 match에 `match_clubs(role='owner')` 한 행을 추가한다.
- 기존 경기는 `match_kind='internal'`로 backfill하되, 실제 교류전이 섞였을 가능성을 별도 품질 flag로 남긴다.
- 참가자 대표 클럽은 명확한 경우에만 backfill하고 다중 membership이면 null/검수 대상으로 둔다.

### 4.4 `tournament_entries`

- `tournament_month`, `tournament_name`, `placement`, `notes`를 유지한다.
- 정규화 FK와 확장 라운드·source/review 컬럼을 nullable로 추가한다.
- UI와 기존 API는 기존 필드만으로도 계속 동작하게 한다.

## 5. 필요한 논리 작업 패키지

아래 파일명은 최초 계획의 추적성을 유지하기 위한 예시다. 실제 migration 번호는 보안 단계와 충돌하지 않도록 구현 시점에 다시 정한다. 각 migration은 transaction, 사전 검증, 적용 후 assertion을 포함해야 한다.

### `SECURITY-BASELINE` — 가장 먼저

- 전체 범위와 배포 순서는 `38_security-implementation-plan.md`를 단일 기준으로 사용한다.
- 현재 로컬의 `38_security_baseline_foundation.sql`은 `withdrawn` 허용 기반과 append-only 보안 감사 저장소만 추가하며, 기존 RPC·RLS·Realtime·앱 동작은 바꾸지 않는다.
- 이후 단계에서 target-club RPC, profile 최소 공개, child RLS·Realtime, ACL 축소를 각각 검증하고 전환한다.
- `profiles.is_active`는 플랫폼 전체 계정 상태로만 사용하고 클럽 가입·탈퇴 상태와 분리한다.
- 승인된 대상의 기존 `123456` 초기화와 session·refresh token 종료는 유지한다. reset-email 방식으로 임의 전환하지 않는다.
- 기존 migration, 테이블·컬럼·URL·RPC signature를 파괴적으로 변경하지 않는다.

### `GR-01` — 글로벌 선수 identity (최초 예시명 `39_global_player_identity.sql`)

- `global_players`, `player_aliases`, `player_external_ids`, `player_identity_claims`, `player_identity_events` 생성.
- `profiles.global_player_id` nullable 추가와 인덱스.
- identity 생성/claim 검수 RPC 및 RLS.
- 신규 회원·게스트 생성 시 global player 자동 연결. 기존 이름 기반 auto transfer는 후보 생성으로 변경.

### `GR-02` — 글로벌 선수 backfill (최초 예시명 `40_global_player_backfill.sql`)

- 모든 기존 profile마다 독립된 global player를 생성하는 안전한 1:1 backfill.
- 이름·입상·소속 유사도는 merge가 아니라 claim 후보만 생성.
- backfill batch/run ID와 count를 별도 운영 로그에 기록.
- `global_player_id` 누락 검증. 즉시 NOT NULL로 강제하지 말고 운영 안정화 후 별도 validation을 검토.

### `GR-03` — 경기 provenance/revision (최초 예시명 `41_match_provenance_revisions.sql`)

- `match_result_revisions`, `match_result_participants`, `match_sets`, `source_records`, `match_sources` 생성.
- `matches.match_kind` nullable/default, current revision FK를 nullable로 추가.
- result v2 submit/verify/correct RPC와 append-only trigger/ACL/RLS.
- 기존 score RPC는 내부적으로 v2 기록을 병행하되 반환 signature를 유지.

### `GR-04` — 기존 경기 backfill (최초 예시명 `42_match_legacy_backfill.sql`)

- 기존 confirmed 경기당 revision 1 생성.
- `outcome_type='legacy_unknown'`, source type `manual_legacy` 사용.
- 당시 현재 참가자를 revision participant snapshot으로 복사.
- YouTube ID/title이 있으면 별도 source record와 link 생성.
- 세트 행은 만들지 않고 aggregate score만 보존.
- backfill 전후 confirmed match 수, participant 수, score checksum 검증.

### `GR-05` — 중복 후보·교류전 기반 (최초 예시명 `43_match_dedupe_interclub.sql`)

- `match_fingerprints`, `duplicate_match_candidates`, `match_clubs` 생성.
- `match_players.representing_club_id` nullable 추가.
- 기존 match owner bridge backfill과 fingerprint v1 계산.
- 중복은 candidate만 생성하고 자동 merge/delete하지 않음.

### `GR-06` — 외부 대회 기반 (최초 예시명 `44_external_competition.sql`)

- `tournaments`, `tournament_editions` 생성.
- `tournament_entries`에 nullable 정규화/source/review/round 컬럼 추가.
- 기존 문자열 기반 대회 묶음은 후보만 생성하고 관리자가 승인.

### `GR-07` — 레이팅 저장·shadow 실행 (최초 예시명 `45_rating_storage.sql`)

- rating model/version/pool/run/input/current/history 테이블 생성.
- rating worker/service account용 최소 권한과 조회 RLS.
- 초기 모델은 `shadow` 상태로만 등록하고 사용자 순위 UI는 변경하지 않음.

### `GR-08` — 레이팅 조회 API (최초 예시명 `46_rating_read_api.sql`)

- 공개 범위가 정해진 current/history 조회 RPC 또는 view.
- 기존 `get_player_stats()`와 `buildRanking()`은 유지.
- 클럽·글로벌, 단식·복식 레이팅을 별도 endpoint로 추가.

## 6. 기존 데이터 backfill 방법

### 6.1 사전 inventory

운영 DB에서 다음을 읽기 전용으로 기록한다.

- 테이블별 행 수, FK orphan, null/중복, enum/constraint, RLS 정책, 함수 signature와 `proacl`.
- profile별 auth 계정 유무, guest 여부, club membership 수.
- 동명 guest/회원 후보, 동일 guest의 다중 클럽 membership.
- confirmed 경기 수, 참가자 수가 단식 2/복식 4와 다른 경기, 점수 null/동점/범위 이상.
- 같은 날짜·유형·선수 조합 중복 후보.
- YouTube ID 중복/누락, tournament 이름 변형.

백업은 Supabase DB backup 또는 `pg_dump`로 수행하되 비밀과 개인정보가 분석 로그에 출력되지 않게 한다.

### 6.2 identity backfill

1. profile 1개당 global player 1개를 생성한다.
2. `profiles.global_player_id`를 연결한다.
3. 현재 name/affiliation을 alias로 복사하고 origin을 `legacy_profile`로 표시한다.
4. 동명·동소속·입상 동일 여부는 merge 조건이 아니라 candidate score에만 사용한다.
5. 기존 로그인 회원과 게스트를 자동 병합하지 않는다.
6. 검수 승인 시 profile mapping만 동일 global player로 바꾸고 identity event를 남긴다.

### 6.3 경기 revision backfill

1. 확정 경기의 현재 점수와 참가자만 legacy revision으로 복사한다.
2. 세트, outcome, source가 없다는 사실을 `legacy_unknown`/null로 명시한다.
3. 취소/미확정 경기는 필요하면 draft snapshot으로 두되 공식 레이팅 입력에서는 제외한다.
4. audit log를 revision으로 과도하게 재구성하지 않는다. 완전한 snapshot이 아니므로 원본 audit를 그대로 보존·연결한다.
5. 정정 이력이 있는 경기는 quality flag를 부여해 검수 우선순위를 높인다.

### 6.4 interclub·source backfill

- 기존 `matches.club_id`를 owner `match_clubs`로 복사한다.
- 기존 YouTube 필드를 source record로 복사하되 URL은 video ID에서 정규 생성할 수 있음을 명시한다.
- 대표 클럽이 모호한 참가자는 null로 둔다.
- fingerprint는 version과 normalization rule을 함께 저장한다.
- candidate 생성 후 자동 삭제·자동 확정은 하지 않는다.

## 7. RLS와 권한 변경 계획

### 7.1 즉시 보안 baseline

- profile self update는 허용 컬럼 whitelist를 DB에서 강제한다.
- `is_platform_admin`, `is_guest`, account-level active 상태는 플랫폼 관리자 전용 RPC 외 변경 불가.
- `club_members.status/role`은 해당 클럽 관리자 RPC에서만 변경.
- 모든 SECURITY DEFINER 함수는 기본적으로 PUBLIC EXECUTE를 회수하고 공개 API만 명시 grant.
- 내부 helper는 가능한 한 private schema로 이동하는 후속 계획을 세우되, 첫 migration에서 이름/호출부를 무리하게 바꾸지 않고 ACL부터 닫는다.
- 모든 match RPC는 먼저 match를 lock/read하고 `match.club_id`로 `assert_club_member` 또는 `is_club_admin_or_sub`를 호출한다.
- 사용자 관리 RPC는 caller와 target이 같은 club에 속하는지, caller가 그 club에서 필요한 역할인지 확인한다.
- 승인된 대상의 관리자 `123456` 초기화는 유지하되 target club, 대상 상태·역할·다중 클럽 조건과 감사를 강제한다. reset-email 방식으로 임의 전환하지 않는다.

### 7.2 테이블별 새 정책

| 영역 | SELECT | WRITE |
|---|---|---|
| global player 공개 필드 | 로그인 사용자에게 최소 필드, 또는 제품 공개 정책에 따라 제한 | 본인 claim 요청; canonical 변경은 플랫폼 데이터 관리자 |
| external IDs | 검증된 공개 ID만 필요한 범위 | 플랫폼 데이터 관리자/검수 RPC |
| identity claims/events | 요청자, 관련 본인, 검수자 | append-only RPC; 직접 update/delete 금지 |
| match revisions/sets/participants | parent match를 볼 수 있는 사용자 | 제출은 참가자/해당 클럽 관리자, verified/supersede는 정해진 검수자 |
| source records | 연결 match의 scope와 source privacy에 따름 | 입력자 draft, 검수자 verify; 원문은 필요시 관리자 전용 |
| dedupe candidates | 해당 클럽 관리자와 플랫폼 데이터 관리자 | 판정 RPC만 허용 |
| rating current | 공개 정책에 따라 global/club 범위 | 계산 worker 또는 제한된 server-side 함수만 |
| rating history/run inputs | 관리자·감사 범위 | 계산 worker만 append |

rating 계산에 service role을 브라우저에 넣지 않는다. 계산은 Supabase Edge Function, 별도 서버/작업자 또는 안전한 DB job에서 수행하고 클라이언트는 읽기 API만 사용한다.

## 8. 필요한 화면 변경

기존 화면과 URL을 유지하며 다음을 추가한다.

### P0/P1 운영 화면

- 관리자 사용자 탭에 “선수 연결 상태”와 동명이인 경고.
- 별도 “선수 식별 검수” 탭: guest claim, merge/split 후보, 외부 ID, 근거, 승인/거절.
- 경기 입력 dialog에 선택적 세트 입력, 종료 방식, 출처를 추가. 기존 단일 점수 입력은 빠른 입력으로 유지.
- 관리자 경기 정정 dialog는 과거값 overwrite 대신 새 revision 생성과 사유·근거 입력.
- 중복 경기 검수 queue: 두 원본 비교, 동일/별개/보류 판정. 삭제 버튼 대신 supersede/link.
- 교류전 생성 시 match kind, 상대 클럽, 참가자 대표 클럽 선택.
- 외부 대회 화면에 edition, round reached, source/review 상태.

### P2 레이팅 화면

- 기존 “결과 집계” 순위는 그대로 둔다.
- 별도 “레이팅(베타)” 탭을 추가해 글로벌/클럽, 단식/복식, 모델 버전과 기준일 표시.
- uncertainty가 큰 신규 선수, 경기 수, 마지막 갱신, provisional 상태를 표시.
- 선수 상세에 레이팅 변화 그래프를 추가하되 기존 `#/c/{slug}/players/{profileId}`를 유지.

## 9. 단계별 구현 순서

### 0단계 — 운영 DB 확인과 긴급 보안

1. 라이브 schema/RLS/function ACL inventory.
2. self privilege escalation 재현 여부 확인과 즉시 차단.
3. 내부 SECURITY DEFINER 실행 권한 회수.
4. cross-club RPC/RLS 수정.
5. 기존 로그인·경기·관리자·공유 URL 회귀 테스트.

### 1단계 — 글로벌 선수 identity

1. additive identity schema.
2. profile 1:1 safe backfill.
3. 신규 guest/signup을 claim 후보 방식으로 전환.
4. 관리자 merge/split 검수와 이벤트 로그.
5. 기존 선수 화면은 profile resolver로 호환.

### 2단계 — 원천 경기와 provenance

1. revision/source/set schema.
2. 기존 score RPC dual-write.
3. legacy confirmed 경기 backfill.
4. 정정 UI를 revision 방식으로 전환.
5. 중복 fingerprint와 검수 queue.

### 3단계 — 교류전과 외부 데이터 수용

1. match clubs/representing club.
2. 글로벌 선수 검색·초대.
3. tournament/edition/round/source.
4. 수동 import staging과 검수 UI.
5. 크롤러/API는 구조와 운영 절차가 안정된 뒤 별도 작업.

### 4단계 — shadow rating

1. 모델/version/pool/run/history schema.
2. 단순 기준 모델을 shadow로 전체 재계산.
3. 입력 제외 사유·identity 변경 재계산·중복 제외 검증.
4. 운영 순위에는 노출하지 않고 관리자 품질 대시보드로 비교.

### 5단계 — 베타 공개와 모델 고도화

1. 글로벌/클럽, 단식/복식 베타 화면.
2. Glicko-2/TrueSkill/계층형 모델 offline 비교.
3. deviation/volatility, 시간 감쇠, 복식 상호작용 검증.
4. 정책·설명·이의 제기와 정정 재계산 절차 확정 후 공식화.

## 10. 테스트 계획

### 10.1 migration/데이터 보존

- 01~현재 migration + 신규 migration을 빈 DB에 순서대로 적용.
- 운영 schema snapshot에서 staging clone을 만들고 migration 적용.
- 기존 테이블별 row count, confirmed score checksum, match participant count, club membership count 전후 비교.
- 신규 backfill 재실행 시 중복이 생기지 않는 idempotency 테스트.
- 기존 컬럼/constraint/function signature 중 호환 대상이 유지되는지 contract 테스트.

### 10.2 RLS/RPC 권한 매트릭스

다음 persona로 모든 SELECT/RPC를 자동 테스트한다.

- anon
- club A 일반 사용자
- club A sub_admin
- club A admin
- club B 일반 사용자/관리자
- 두 클럽 회원
- guest profile
- inactive account
- platform admin

필수 음성 테스트:

- 일반 사용자가 `is_platform_admin`, `is_guest`, account active를 수정할 수 없음.
- club A admin이 club B match/profile/password를 변경할 수 없음.
- match UUID를 직접 넘겨도 타 클럽 register/remove/start/submit/link가 실패.
- 내부 helper RPC 호출이 permission denied.
- 타 클럽 `match_players`, confirmations, revision, raw source가 조회되지 않음.
- null club ID로 글로벌 비공개 기록을 우회할 수 없음.

### 10.3 identity

- 동명 두 선수를 자동 병합하지 않음.
- guest claim 승인 시 과거 경기가 global player에 집계되지만 원시 profile/FK는 유지.
- merge 후 split하면 매핑과 집계가 복구되고 이벤트 이력이 남음.
- KATO/KATA/KTA provider+external ID 중복이 차단됨.
- 하나의 회원이 여러 클럽에 있어도 global player는 하나.

### 10.4 경기와 source

- 단식 2명/복식 4명, set/tiebreak/match-tiebreak validation.
- normal/retired/walkover/incomplete/canceled별 필수 필드.
- 제출→검수→확정→정정 시 revision이 append되고 이전 revision이 변하지 않음.
- legacy aggregate 경기의 기존 UI/CSV가 동일하게 표시됨.
- 동일 source ID와 유사 fingerprint는 candidate를 만들되 원본을 삭제하지 않음.
- interclub match가 양 클럽 scope와 대표 선수 정보를 보존.

### 10.5 레이팅

- 동일 model version/input hash로 전체 재계산 결과가 결정적.
- identity merge/split, 결과 정정, 중복 제외 후 새 run이 생성되고 이전 run은 보존.
- 단식/복식과 global/club pool이 섞이지 않음.
- 제외된 canceled/incomplete/unverified 경기가 run input에 사유와 함께 남음.
- rating history의 before/after가 current rating과 일치.

### 10.6 프런트/배포 회귀

- `#/c/{slug}`, results, player, admin, settings, `/platform`, auth 링크 유지.
- 오래된 player profile URL이 계속 열림.
- 모바일/데스크톱 주요 흐름.
- `npm run typecheck`, `npm run build`, 새 단위/통합 테스트를 CI에서 실행.
- GitHub Pages base `/clubs/`와 Supabase redirect URL 유지.

## 11. 롤백 방법

롤백은 데이터 삭제형 down migration이 아니라 **기능 비활성 + 이전 읽기 경로 복귀**로 설계한다.

- 각 단계에 feature flag를 둔다: identity review, result v2, external import, rating beta.
- dual-write 단계에서 실패하면 새 쓰기만 중지하고 기존 `matches` projection 경로를 계속 사용한다.
- 신규 nullable 컬럼과 테이블은 남겨 두고 애플리케이션 읽기만 이전 버전으로 되돌린다.
- 함수/RLS 변경은 이전 정의를 별도 rollback SQL로 준비하되, 보안 취약 권한을 다시 여는 rollback은 하지 않는다.
- backfill 행은 `backfill_run_id`/origin으로 식별하고 재처리할 수 있게 하며, 실패 시 삭제 대신 invalid/aborted 상태로 둔다.
- rating run은 실패 상태로 보존하고 current pointer를 직전 성공 run으로 유지한다.
- 배포 전 DB backup과 schema snapshot을 만들되 복원은 전체 장애 시 최후 수단으로 사용한다.

## 12. 구현 전에 확인할 위험사항

1. 라이브 DB에 01~37이 모두 적용됐는지, 수동 hotfix가 있는지.
2. 함수별 실제 EXECUTE ACL과 Supabase API 노출 상태.
3. `profiles.is_platform_admin` self-update가 운영에서 실제 재현되는지.
4. 기존 동명 guest 자동 병합으로 이미 잘못 연결되거나 삭제된 기록이 있는지.
5. guest가 여러 클럽 membership, bet, tournament entry를 가진 사례 수.
6. 확정 경기 중 참가자 수·점수·상태가 비정상인 legacy 행.
7. 외부 ID와 대회 데이터의 이용약관, 개인정보, 공개 범위.
8. 클럽 간 글로벌 선수 검색에 대한 사용자 동의와 비공개 클럽 정책.
9. 현재 `is_active`를 계정 정지와 가입 승인 중 어느 의미로 실제 운영하는지.
10. 클럽별 score/동점/proxy 설정이 운영자 기대와 실제 DB 검증에서 얼마나 어긋나는지.
11. 삭제된 경기/클럽의 backup·감사 요구사항.
12. 레이팅 결과 정정, 이의 제기, provisional 표시와 공식화 주체.

## 13. 최종 요약

### 13.1 현재 구조에서 가장 위험한 문제 5개

1. `profiles_update_self`와 trigger 불일치로 `is_platform_admin` self-escalation 가능성이 있다.
2. 내부 SECURITY DEFINER helper의 실행 권한이 충분히 회수되지 않아 데이터 변조 우회면이 될 수 있다.
3. 일부 경기·사용자 관리 RPC와 child-table RLS가 target club을 확인하지 않아 클럽 간 권한 경계가 깨질 수 있다.
4. 동명 게스트 자동 병합이 잘못된 선수 연결, 다른 클럽 membership 손실, 배팅·대회 기록 cascade 삭제를 일으킬 수 있다.
5. 세트·종료 방식·source·revision·dedupe가 없어 앞으로 수집한 경기를 신뢰 가능한 글로벌 레이팅 원천으로 재구성하기 어렵다.

### 13.2 가장 먼저 구현할 P0 항목

첫 작업은 `38_security-implementation-plan.md`의 보안 baseline 단계여야 한다. 현재는 그중 additive Phase 1만 로컬에 작성됐으며 아직 staging에 적용되지 않았다. Phase 1 gate 이후 target-club RPC와 profile 보호를 먼저 완성하고, 글로벌 identity가 기존보다 넓은 조회·변경 권한을 만들지 않는 상태에서 `global_players`와 identity claim 구조를 추가한다. 보안 경계가 불확실한 상태에서 글로벌 선수 검색이나 외부 데이터 수집을 먼저 열지 않는다.

### 13.3 예상되는 데이터 migration 문제

- 같은 이름·입상·소속이라도 다른 사람일 수 있고, 다른 값이어도 같은 사람일 수 있어 자동 병합 기준이 없다.
- 기존 자동 게스트 병합이 이미 원본 profile을 삭제했을 수 있어 완전 복원이 불가능할 수 있다.
- `transfer_profile_refs()`가 후속 테이블을 다루지 않아 guest 관련 데이터가 분산되거나 삭제됐을 수 있다.
- 과거 점수는 두 정수뿐이라 set/outcome을 backfill할 수 없다.
- 기존 `matches.club_id`만으로 실제 교류전과 참가자의 대표 클럽을 확정할 수 없다.
- 수동 SQL migration 운영으로 저장소와 라이브 DB schema/function ACL이 다를 수 있다.

### 13.4 구현을 여러 단계로 나눈 권장 순서

1. 라이브 DB inventory와 긴급 보안 baseline.
2. 글로벌 선수 identity 1:1 backfill과 검수형 merge/split.
3. 경기 revision·set·source·review·dedupe 및 legacy backfill.
4. 교류전, 글로벌 검색/초대, 외부 선수 ID와 대회 구조.
5. rating storage와 shadow 재계산.
6. 베타 공개 후 모델 비교·고도화.

### 13.5 현재 다음 실행 단계

1. `38_security_baseline_foundation.sql`을 staging에만 적용한다.
2. `38_security_phase1_verify.sql`, F1~F8, 기존 핵심 기능 1~6·19~26을 검증한다.
3. 24시간 동안 오류율, lock, 가입·승인·회원 목록, 기존 `123456` 흐름의 회귀가 없는지 관찰한다.
4. 증거와 승인을 기록한 뒤 보안 Phase 2의 target-club 신규 RPC 작업을 시작한다.
5. 글로벌 레이팅 작업은 `global-rating-execution-plan.md`의 gate에 따라 GR-01부터 착수한다.
