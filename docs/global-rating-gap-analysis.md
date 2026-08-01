# 글로벌 레이팅 Gap 분석

## 1. 판정 기준

- **구현됨**: 현재 스키마와 코드가 요구사항을 직접 충족한다.
- **부분 구현**: 일부 정보나 흐름은 있으나 글로벌 연결·감사·확장 조건이 부족하다.
- **미구현**: 해당 테이블, 컬럼, 함수 또는 화면이 없다.
- **취약**: 기능은 있으나 데이터 무결성 또는 권한 결함 때문에 그대로 신뢰하기 어렵다.

우선순위는 다음 기준을 적용했다.

- **P0**: 지금 기반을 고정하지 않으면 향후 선수/경기 원천데이터 재구축 또는 대규모 재연결 가능성이 높은 항목. 치명적 보안·무결성 문제도 포함.
- **P1**: 데이터 확보와 사용자 확산, 검수 운영, 초기 레이팅 제품화에 필요한 항목.
- **P2**: 충분한 데이터가 쌓인 뒤 모델 고도화 단계에서 구현할 항목.

분석 근거는 저장소 migration 기준이며 라이브 DB catalog는 별도 검증이 필요하다.

## 2. 요구사항별 Gap

| 요구사항 | 현재 구현 상태 | 관련 파일 또는 테이블 | 부족한 점 | 권장 개선 방법 | 우선순위 | 기존 데이터 영향 | 구현 위험도 |
|---|---|---|---|---|---|---|---|
| 선수 ID가 클럽별로 분리되지 않아야 함 | 부분 구현 | `profiles.id`, `club_members` | 로그인 회원은 전역 ID지만 `profiles`가 계정·게스트·선수 실체를 겸함. 클럽별 게스트는 분절됨 | 별도 `global_players`를 추가하고 `profiles.global_player_id`로 연결. 기존 ID와 URL은 유지 | P0 | 모든 profile에 1:1 초기 backfill 필요. 기존 FK는 유지 가능 | 중간 |
| 한 선수가 여러 클럽에 가입 | 구현됨 | `club_members(club_id,user_id)`, `list_my_clubs()` | 전역 `profiles.is_active`가 클럽 상태와 충돌 | 멤버십 상태는 `club_members.status`, 플랫폼 정지만 profile 상태로 분리 | P0 | 상태 의미 backfill·운영 규칙 정리가 필요 | 높음 |
| 클럽이 달라도 동일 선수를 하나로 연결 | 부분 구현 | 동일 `profiles.id`를 쓰는 가입 회원 | 게스트/중복 profile 간 canonical 연결이 없음 | 여러 profile이 하나의 `global_players.id`를 가리킬 수 있게 설계 | P0 | 자동 확정하지 말고 후보·검수 기반으로 점진 병합 | 높음 |
| 가입/미가입/게스트 구분 | 부분 구현 | `profiles.is_guest`, auth 계정 존재 여부 | invited/claimed/verified/source-only 상태가 없음 | `player_identity_status` 또는 claim 상태 테이블 추가. `is_guest`는 호환 필드로 유지 | P0 | 기존 guest는 `guest_unclaimed`, 회원은 `account_linked`로 backfill | 중간 |
| 게스트 가입 시 과거 기록 연결 | 취약 | `handle_new_user()`, `transfer_profile_refs()` | 이름 중심 자동 병합, 후속 테이블 미이전, 다른 클럽 membership 손실·cascade 삭제 위험 | 자동 FK 이전/삭제 중단. `player_identity_claims`에서 후보 생성 후 global identity mapping만 승인 변경 | P0 | 기존 자동 병합 결과 감사 및 의심 사례 추출 필요 | 높음 |
| 동명이인 분리와 중복 선수 병합 | 미구현 | 해당 구조 없음 | 이름이 유일키가 아니며 오병합 복구 불가 | `player_aliases`, `player_identity_claims`, 관리자 merge/split RPC 도입 | P0 | 초기에는 profile별 별도 global player로 안전 backfill | 높음 |
| 선수 병합 이력 | 미구현 | 해당 구조 없음 | 누가 왜 무엇을 병합/분리했는지 없음 | append-only `player_identity_events`에 merge/split/claim/reject와 before/after 저장 | P0 | 신규 이벤트부터 적용; 과거 자동 병합은 가능한 범위만 추정 표기 | 중간 |
| KATO/KATA/KTA 등 외부 선수 ID | 미구현 | 해당 컬럼/테이블 없음 | 공급자별 ID와 검수 상태를 저장 못함 | `player_external_ids(global_player_id, provider, external_player_id, verified_*)`, provider+ID unique | P0 | 기존 데이터 영향 없음. 추후 수동/가져오기 backfill | 낮음 |
| 다른 클럽 선수 검색·게스트 초대 | 미구현 | `searchActiveProfiles()`는 현재 클럽만 | 공개 범위·동의·초대 상태 없음 | 최소 공개 프로필 RPC, `club_player_invites`, identity claim 흐름 추가 | P1 | 기존 검색은 유지하고 별도 글로벌 검색 탭 추가 | 중간 |
| 선수별 상대·파트너·연결 클럽 수 | 부분 구현 | `get_partner_stats()`, `get_opponent_stats()` | 현재 클럽별 목록만 있고 distinct 연결 클럽 수 없음. duplicate guest에 취약 | global_player 기준 aggregate view/RPC 추가 | P1 | identity backfill 이후 재계산 가능 | 낮음 |
| 경기 원본을 승률/득실차 외에 보존 | 부분 구현 | `matches`, `match_players` | 현재 상태 행과 합산 점수만 존재; 원본 revision이 아님 | append-only `match_result_revisions`와 source snapshot 추가 | P0 | 기존 confirmed 행을 revision 1로 backfill | 높음 |
| 단식/복식 구분 | 구현됨 | `matches.match_type`, `requiredPlayerCount()` | text check 방식이며 외부 종목 세분화는 없음 | 기존 컬럼 유지. rating discipline mapping을 별도 테이블로 관리 | P1 | 없음 | 낮음 |
| 복식 팀과 선수 4명을 개별 ID로 저장 | 구현됨 | `match_players.position` A1/A2/B1/B2 | 선수 identity가 profile에 직접 묶임; 대표 클럽이 없음 | 기존 `user_id` 유지 + 조회 시 global_player 연결. `representing_club_id` nullable 추가 | P0 | 기존 행은 match owner club 또는 null로 backfill 정책 결정 | 중간 |
| 세트별 점수 | 미구현 | `matches.team_a_score/team_b_score`만 존재 | 경기 형식과 세트 원본 복원 불가 | `match_sets(result_revision_id,set_number,set_type,score,tiebreak_score,completed)` 추가 | P0 | 기존 점수는 legacy aggregate로 표시하고 세트 backfill을 추정하지 않음 | 중간 |
| 타이브레이크/매치 타이브레이크 구분 | 미구현 | 해당 구조 없음 | 6:5, 7:6 등의 의미 구분 불가 | `set_type`과 별도 tiebreak 점수 컬럼 추가 | P0 | 과거 데이터는 unknown/legacy로 유지 | 중간 |
| 정상 종료·기권·워크오버·취소·미완료 구분 | 부분 구현 | `matches.status='canceled'` | workflow status와 경기 outcome이 섞여 있고 retirement/WO/incomplete 없음 | `outcome_type`을 결과 revision에 추가. 기존 `status`는 workflow 호환 유지 | P0 | confirmed는 기본 `normal`로 자동 단정하지 말고 legacy_unknown 허용 | 중간 |
| 경기 출처와 입력자 | 부분 구현 | `created_by`, `registered_by`, `score_submitted_by`, YouTube 필드 | 일반화된 source, 원본 ID/URL/원문이 없음 | `source_records` + `match_sources`, 수동 입력도 하나의 source로 기록 | P0 | 기존 수동 경기는 `manual_legacy`, YouTube는 source record로 backfill | 중간 |
| 제출·확인·확정·정정 상태 | 부분 구현 | `match_status`, `score_confirmations`, admin RPC | 정정 검수 상태와 revision별 승인 없음 | 기존 status 유지 + revision status(draft/submitted/verified/rejected/superseded) 추가 | P1 | 기존 confirmed를 verified revision으로 backfill하되 품질 등급은 legacy | 중간 |
| 수정 전후 이력 | 부분 구현 | `match_audit_logs`, `match_snapshot()` | snapshot 범위가 좁고 삭제 시 cascade, 일반 편성/출처 변경 누락 | append-only revision/event 테이블. 기존 audit는 UI 호환용으로 유지 | P0 | 기존 로그는 이관 또는 참조; 삭제하지 않음 | 높음 |
| 동일 경기 중복 등록 방지 | 미구현 | YouTube ID unique만 존재 | 날짜·선수·점수·외부 ID 기반 dedupe 없음 | versioned fingerprint와 `duplicate_match_candidates`; 자동 삭제 대신 검수 상태 | P0 | 기존 경기 전체 fingerprint backfill 후 후보만 생성 | 중간 |
| 클럽 내부전/교류전 구분 | 미구현 | `matches.club_id` 하나 | 한 경기의 소유 클럽만 있고 참가 클럽/대표 소속 없음 | `matches.match_kind` 추가, `match_clubs(match_id,club_id,role)` bridge. `club_id`는 owner/URL용으로 유지 | P0 | 기존 경기는 internal + owner club bridge로 backfill | 중간 |
| 외부 대회 canonical 정보 | 미구현 | `tournament_entries`에 대회명·월 반복 저장 | 같은 대회/회차를 묶을 수 없음 | `tournaments`, `tournament_editions` 추가 후 entry에 nullable FK | P1 | 문자열·월 기반 후보 매칭, 자동 확정 금지 | 중간 |
| 우승·준우승·3위 | 구현됨 | `tournament_entries.placement` | 사용자 입력형이며 source/검수 없음 | 기존 placement 유지 + source/review 필드 연결 | P1 | 없음 | 낮음 |
| 8·16·32·64강 진출 | 미구현 | placement check에 값 없음 | 라운드 도달 저장 불가 | `round_reached_code`와 대회 draw size를 edition/entry에 추가 | P1 | 과거 notes에서 자동 추정하지 않음 | 낮음 |
| 대진표 상대전적 | 미구현 | 대회 entry와 `matches` 연결 없음 | 외부 대회 경기 단위 행이 없음 | 외부 대회 경기도 기존 `matches` 확장 구조에 저장하고 edition/round/source 연결 | P1 | 기존 entry는 경기 없이 참가 사실만 유지 | 높음 |
| 네이버 밴드 경기 결과 | 미구현 | 해당 구조 없음 | source adapter 대상/원문 저장소 없음 | `source_records.source_type='naver_band'`; 크롤링은 별도 단계 | P1 | 없음 | 중간 |
| YouTube에서 확인된 결과 | 부분 구현 | `youtube_video_id/title/matched_at` | 영상 연결만 있고 결과 원문·검수·신뢰도 없음 | 기존 필드 유지 + YouTube source record와 review 연결 | P1 | 기존 영상 ID/title backfill | 낮음 |
| 데이터 출처 URL·원본 텍스트/식별자 | 미구현 | YouTube ID 일부 | 공급자 공통 표현 없음 | `source_records(source_type,source_url,external_id,raw_text,raw_payload,content_hash)` | P0 | 기존 YouTube/수동 데이터 backfill | 중간 |
| 검수 여부와 신뢰도 | 미구현 | `score_confirmations`는 참가자 확인만 | 외부 source 품질 검수가 아님 | `review_status`, `confidence`, `reviewed_by/at`, review events | P0 | 기존 confirmed 수동 경기는 `legacy_confirmed`, confidence null | 중간 |
| 중복 탐지 정보 | 미구현 | YouTube unique index | 알고리즘 버전, fingerprint, 후보 판정 없음 | `match_fingerprints`, `duplicate_match_candidates`, reviewer decision | P0 | 전체 기존 경기 비파괴 backfill | 중간 |
| 선수 테이블에 현재 점수 하나만 저장하는지 | 저장형 레이팅 자체가 없음 | `computePlayerScore()`는 클라이언트 일시 계산 | 현재/과거 레이팅 모델 없음 | rating 테이블을 별도 추가하고 profile에 단일 score를 넣지 않음 | P1 | 기존 데이터 영향 없음 | 낮음 |
| 클럽 레이팅과 글로벌 레이팅 분리 | 미구현 | 통계 RPC는 `p_club_id`만 지원 | rating pool 개념 없음 | `rating_pools(scope_type,club_id,discipline,model_version_id)` | P1 | identity/match foundation 이후 계산 | 중간 |
| 단식/복식 레이팅 분리 | 미구현 | `matches.match_type`은 존재 | 저장·변경 이력이 없음 | rating pool의 `discipline`으로 분리 | P1 | 기존 match_type으로 입력 분리 가능 | 낮음 |
| 레이팅 모델 버전 | 미구현 | 해당 구조 없음 | 파라미터·코드 버전·적용 기간 재현 불가 | `rating_models`, `rating_model_versions(parameters,input_schema_version)` | P1 | 없음 | 중간 |
| 선수별 레이팅 변경 이력 | 미구현 | 해당 구조 없음 | 현재값만 추가하면 재현·감사 불가 | `player_rating_history` append-only, match/run/revision FK | P1 | 계산 시작 시점부터 생성 | 중간 |
| 경기 전후 레이팅 추적 | 미구현 | 해당 구조 없음 | match 단위 delta 없음 | history에 before/after와 sequence 저장 | P1 | 재계산 run이 생성 | 중간 |
| deviation/volatility 저장 | 미구현 | 해당 구조 없음 | Glicko-2 등 적용 불가 | nullable generic `uncertainty`, `volatility`, model state JSONB | P2 | 없음 | 낮음 |
| 과거 경기 전체 재계산 | 부분 가능/불신뢰 | confirmed `matches`, `match_players` | mutable current rows, 삭제 가능한 audit, identity/revision/source 고정 없음 | immutable revision + rating run + input snapshot/hash | P0 | 기존 confirmed를 legacy revision으로 backfill | 높음 |
| 일반 사용자·클럽 관리자·플랫폼 관리자 권한 분리 | 취약 | `club_members.role`, `is_platform_admin`, RLS/RPC | self-update privilege escalation, 전역 admin helper, target club 검증 누락 | 컬럼 쓰기 whitelist, RPC target scope 통일, function ACL audit | P0 | 데이터 변경보다 권한 migration 중심 | 높음 |
| 다른 클럽 비공개 데이터 차단 | 취약 | `match_players`, `score_confirmations` RLS; nullable club 통계 RPC | 모든 authenticated SELECT 또는 null scope 우회 | parent `matches.club_id` 기반 RLS, club_id 필수 RPC, Realtime scope | P0 | 조회 결과만 제한; 기존 행 영향 없음 | 높음 |
| service role key가 클라이언트에 없어야 함 | 구현됨 | `src/lib/supabase.ts`, `.env.example` | YouTube 키는 공개 번들 키임 | 현 상태 유지, CI secret scan·YouTube referrer 제한 | P1 | 없음 | 낮음 |
| 확정 이후 일반 사용자 임의 수정 차단 | 부분 구현/취약 | `submit_score()`, `admin_update_score()` | 정상 경로는 차단하지만 공개 helper/function ACL과 cross-club RPC가 우회면을 만듦 | 내부 helper execute 회수, 확정 revision append-only, admin correction 전용 RPC | P0 | 기존 UI 유지 가능 | 높음 |
| 선수 병합·경기 정정 권한 | 부분 구현 | admin score RPC만 있음 | identity 권한 없음, 일부 admin RPC가 전역 대상 | identity는 플랫폼/데이터 steward + 이중 검수, 경기 정정은 해당 클럽 admin과 플랫폼 steward | P0 | 역할 추가·권한 backfill 필요 | 높음 |
| 기존 공유 URL·관리자 URL 유지 | 구현됨 | `src/App.tsx`, `HashRouter` | 글로벌 화면 도입 시 ID 전환 위험 | 기존 `#/c/{slug}/players/{profileId}`를 resolver로 유지하고 새 글로벌 URL은 추가만 함 | P0 | redirect/resolver만 추가, 기존 링크 변경 없음 | 중간 |
| 클럽별 설정이 DB 검증에 반영 | 취약 | `club_settings`, `validate_score()`, `register_player()` | allow_tie/score_max/proxy는 global `app_settings`를 읽음 | match.club_id로 `get_club_setting()` 사용, fallback만 app_settings | P1 | 설정값 backfill 불필요 | 낮음 |
| 감사·migration drift 검증 | 미구현 | 수동 SQL Editor 방식, `supabase/migrations` | 운영 DB 적용 상태·함수 ACL을 CI가 검증하지 않음 | Supabase CLI migration history, schema dump diff, DB contract tests | P1 | 운영 DB baseline 채택 절차 필요 | 중간 |

## 3. 우선순위 요약

### P0: 데이터 수집 확대 전에 고정

1. `profiles.is_platform_admin` self-update 차단과 전체 함수 ACL 정리.
2. RPC/RLS를 경기의 실제 `club_id`와 대상 membership 기준으로 재작성.
3. 별도 `global_players`와 검수 가능한 identity claim/merge history 도입.
4. 동명 게스트 자동 FK 이전·삭제 중단.
5. `match_result_revisions`, `match_sets`, outcome, source/review/dedupe 구조 추가.
6. `matches.club_id`를 유지하면서 `match_clubs`와 참가자의 대표 클럽을 추가.
7. 기존 confirmed 경기의 비파괴 legacy revision/fingerprint backfill.

### P1: 데이터 확보와 초기 확산

- 글로벌 선수 검색·초대와 관리자 검수 UI.
- 외부 선수 ID, 대회/회차/라운드, source import staging.
- 클럽/글로벌·단식/복식 rating pool, 모델 버전, rating run/history.
- 연결 그래프 지표와 품질 대시보드.
- migration drift/권한 회귀 자동 테스트.

### P2: 데이터 축적 후

- Glicko-2/TrueSkill/계층형 모델 비교.
- deviation, volatility, 시간 감쇠, 클럽 bias, 복식 파트너 상호작용 고도화.
- 모델 성능 평가와 A/B 또는 shadow rating 운영.
