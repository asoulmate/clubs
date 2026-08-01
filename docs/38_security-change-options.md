# 38 security change options

## 상태

아래 내용은 비교 검토안이다. 실행 가능한 migration이 아니며 어느 안도 운영 적용으로 승인되지 않았다. `운영 DB 확인 필요`, `제품 정책 확인 필요`, `staging 검증 필요` 표시는 선행 조건이다.

평가 척도:

- 보안 개선: 낮음 / 중간 / 높음
- 호환성: 높음은 현재 프런트와 signature 변경이 적음을 뜻함
- 권장 여부는 방향성일 뿐 적용 승인이 아님

## 1. `admin_update_user`

현재 동작: club ID 없이 전역 `profiles`의 이름·입상·활성을 수정한다. 호출자는 어느 클럽에서든 admin/sub인지 전역 helper로 판정한다. `p_role`은 거부된다.

| 안 | 내용 | 보안 개선 | 기존 기능 호환성 | 프런트 변경 | DB 변경 | 주요 위험/검증 | 권장 |
|---|---|---:|---:|---:|---:|---|---|
| A | 기존 signature 유지, 호출자와 대상자의 active 공통 club을 서버에서 추론 | 중간 | 높음 | 없음 | 함수 본문 | 공통 club이 여러 개면 현재 화면의 대상 club을 알 수 없음. 확정된 SEC-PROD-02 권한을 완전히 표현하기 어려움 | 단일 클럽만 확실한 임시안 |
| B | `admin_update_user_v2(p_club_id, ...)` 또는 overload 추가, 기존 함수를 wrapper로 유지 | 높음 | 중간~높음 | v2 사용 시 필요 | 신규 함수/기존 wrapper | wrapper가 club을 추론하면 우회 경로가 될 수 있음. PostgREST overload 해석 검증 필요 | **권장 후보** |
| C | 전역 profile 수정 RPC와 club membership 상태/역할 RPC를 분리 | 높음 | 중간 | 필요 | 함수 분리 | 제품 의미가 가장 명확하지만 UI와 운영 절차가 달라짐 | **장기 권장** |
| D | 기존 함수 유지, platform admin만 허용 | 높음 | 낮음 | UI 권한/오류 처리 영향 | 함수 본문 | 현재 club main admin의 이름·입상 편집과 활성화 기능 중단 | 현 운영 확인 전 비권장 |

선행 결정: `profiles.is_active` 의미, club main admin의 전역 이름·입상 편집 권한, 다중 클럽 회원 처리.

## 2. `admin_reset_user_password`

123456 초기화는 모든 안에서 유지한다. 현재 signature는 `(p_user_id uuid)`이며 관리자 화면도 club ID나 사유를 전달하지 않는다.

| 안 | 내용 | 보안 개선 | 호환성 | 프런트 변경 | DB 변경 | 장점 | 위험/검증 | 권장 |
|---|---|---:|---:|---:|---:|---|---|---|
| A | 기존 signature 유지, active 공통 club과 역할을 서버에서 계산 | 중간 | 높음 | 없음 | 함수 본문 | 화면 유지 | 공통 club이 여러 개면 어느 club 권한으로 수행하는지 불명확; 감사 사유 수집 어려움 | 단일 클럽 운영만 확인되면 임시 후보 |
| B | club ID와 사유를 받는 신규 v2 RPC, 기존 함수는 엄격한 호환 wrapper | 높음 | 중간 | 필요 | 신규 RPC·감사 구조 | 의도가 명확하고 감사 가능 | wrapper 정책을 잘못 두면 우회 가능; 기존 클라이언트 사용 조사 필요 | **권장 후보** |
| C | 단일 클럽 일반 회원은 해당 club main admin, 다중 클럽은 platform admin만 허용 | 높음 | 중간 | 경고/오류 표시만 필요할 수 있음 | 함수 검사 | 계정 영향 범위와 권한 일치 | 다중 클럽 현장 복구가 느려짐 | **권장 정책 후보** |
| D | 다중 클럽도 club main admin이 경고·사유·추가 확인·감사 후 허용 | 중간 | 중간 | 필요 | 감사·검사 | 현장 운영 편의 | 한 club admin 탈취가 모든 club 로그인에 영향 | 운영 필수 증거가 있을 때만 |

확정된 SEC-PROD-03/04에 따라 guest, 자기 자신, 다른 main admin에 대한 club 관리자 처리, platform admin 계정, 비활성·pending 대상은 일반 초기화 경로에서 차단한다. 감사 로그에는 비밀번호 값을 저장하지 않는다.

기존 signature wrapper 선택지:

1. 단일 active 공통 club이 정확히 하나일 때만 호출하고 그 외 거부
2. platform admin만 기존 wrapper 사용
3. 일정 전환 기간 후 wrapper 호출을 감사하면서 v2로 이동

어느 방식도 운영 DB 함수 사용처와 외부 클라이언트 확인 전 확정하지 않는다.

## 3. `admin_remove_user`

현재 의미: club membership 제거가 아니라 미확정 슬롯 정리 후 profile 비활성/삭제 또는 `auth.users` 삭제다. UI는 반환 문자열로 삭제·비활성·탈퇴 메시지를 고른다.

| 안 | 동작 | 보안 개선 | 호환성 | 프런트 변경 | DB 변경 | 기록/다중 클럽 영향 | 권장 |
|---|---|---:|---:|---:|---:|---|---|
| A | 대상 club membership만 종료 | 높음 | 낮음~중간 | 문구·반환 처리 필요 | club-scoped RPC | 다른 club과 auth 계정 보존. 탈퇴 후 접근은 SEC-PROD-10에 따라 전부 차단 | **SEC-PROD-06 확정 방향** |
| B | `profiles.is_active=false`로 플랫폼 전체 비활성 | 중간 | 높음 | 없음 가능 | 기존 함수 검사 | 모든 club 접근 차단, 기록 보존 | platform 관리자 전용 권장 |
| C | `auth.users` 삭제, 참조 profile 보존/비활성 | 중간 | 현재 동작과 가까움 | 없음 가능 | 기존 함수 검사 | 모든 club 로그인 제거. 다중 클럽에 매우 큰 영향 | platform 관리자 또는 명시적 전체 탈퇴만 |
| D | 참조 없는 guest/profile 완전 삭제 | 대상에 따라 중간 | 현재 guest 동작과 유사 | 없음 가능 | 범위 검사 | 다른 club 참조 검사 누락 시 데이터 손상 | 단일 club guest와 전체 참조 검증 시에만 |
| E | club removal RPC와 platform disable/delete RPC 분리 | 높음 | 중간 | 필요 | 신규 RPC | 의미·권한·감사 경계 명확 | 이행 비용 | **장기 권장** |

운영 적용 전 기존 반환값 계약과 `UsersTab` 메시지, auth 삭제 trigger, 확정/미확정 경기, tournament·bet·absence 참조를 모두 확인해야 한다.

## 4. `profiles.is_active` 분리

| 모델 | 설명 | 장점 | 기존 기능 영향 | 필요한 변경 | 권장 |
|---|---|---|---|---|---|
| A | 현행 유지: `profiles.is_active`가 전역 활성과 클럽 승인 역할을 혼합 | 변경 없음 | 한 club 관리자 작업이 전체 계정에 영향 | 없음 | 보안상 비권장, 당장 변경 금지 |
| B | `profiles.is_active`는 플랫폼 전체 정지, `club_members.status`는 가입 승인·거절만 | 현재 schema로 부분 표현 가능 | club별 일시 정지 상태가 없음 | 함수·UI 의미 정리 | 단기 정책 후보 |
| C | 플랫폼 상태와 club별 상태를 명시적으로 분리 (`club_members` 상태 확장 또는 별도 필드) | 의미 명확, 다중 클럽 안전 | 쿼리·RPC·UI·RLS 전반 변경 | schema additive 변경과 backfill | **장기 권장** |

이번 단계에서는 컬럼, enum/check constraint, 로직을 변경하지 않는다.

## 5. `match_players`와 `score_confirmations` RLS

| 안 | 보안 개선 | 호환성 | 프런트 변경 | DB 변경 | Realtime 영향 | staging 난이도 | 권장 |
|---|---:|---:|---:|---:|---|---:|---|
| A. parent `matches.club_id`의 active membership 또는 platform admin 기반 SELECT | 높음 | 높을 가능성 | 보통 없음 | 정책 교체 | `match_players` 이벤트 가시성이 RLS에 따라 달라질 수 있음 | 높음 | **권장 후보**, staging 필수 |
| B. child 직접 SELECT 금지, SECURITY DEFINER 조회 RPC로만 제공 | 높음 | 낮음 | 큼 | RPC·권한·정책 | 기존 postgres_changes 구독 구조와 충돌 | 매우 높음 | 현재 구조에는 비권장 |
| C. 안전 view/RPC를 조회에 쓰고 별도 Realtime 채널/브로드캐스트 설계 | 높음 | 낮음 | 큼 | view/RPC/Realtime | 가장 명시적이나 구조 변경 큼 | 매우 높음 | 장기 후보 |
| D. 기존 정책 유지, 노출 column/view만 제한 | 낮음~중간 | 중간 | 가능성 있음 | column grant/view | event row 노출은 별도 문제 | 중간 | 임시 완화안일 뿐 |

### 정책 교체 절차 후보

PostgreSQL permissive policy는 여러 정책이 OR로 결합된다. 안전한 신규 policy를 먼저 추가하고 기존 `USING(true)` policy를 남기면 보안 개선이 발생하지 않는다. 따라서 실제 적용 시에는 다음 중 하나가 필요하다.

- 한 transaction 안에서 새 policy 생성과 기존 과도 policy 제거를 수행하고 rollback 가능한 staging에서 먼저 검증
- restrictive policy 사용 가능성과 기존 policy 조합을 운영 PostgreSQL 버전에서 검증
- 짧은 maintenance window에 교체하고 즉시 postcheck/회귀 테스트

현재 검토 단계에서는 어떤 policy도 생성·삭제하지 않는다.

## 6. 경기 RPC의 클럽 범위

| 대상 | 최소 변경안 | 대안 | 호환성 위험 | 선행 확인 |
|---|---|---|---|---|
| `register_player` | 대상 match의 club membership 확인, 관리자 판정을 `is_club_admin_or_sub(match.club_id)`로 변경 | public wrapper가 club ID를 받도록 v2화 | 낮음~중간 | 대리 등록이 타 club 선수를 의도적으로 허용하는지 |
| `remove_player` | 같은 방식의 대상 club 검증 | 제거 권한을 별도 RPC로 분리 | 낮음 | 등록자가 club을 탈퇴한 뒤 제거 가능한지 |
| `start_match` | 참가자 또는 대상 club 관리자만 허용 | admin과 participant RPC 분리 | 낮음 | platform admin 예외 |
| `submit_score` | 참가자 또는 대상 club 관리자만 허용 | score admin 별도 유지 | 낮음~중간 | single/double 확인 방식 회귀 |
| YouTube 연결/해제 | active club member 또는 특정 역할로 제한 | 관리자 전용 RPC | 제품 정책에 따라 큼 | 현재 일반 회원도 사용하는지 |
| `internal_add_player` | 대상 선수의 해당 club active membership 검증 | 상위 RPC마다 검증 | create_match/lineup에 영향 | guest membership과 과거 편성 규칙 |

## 7. 통계 RPC NULL club

| 안 | 설명 | 보안 | 호환성 | 권장 |
|---|---|---:|---:|---|
| A | NULL이면 명시 오류, 기존 3-arg signature/default 유지 | 높음 | 숨은 2-arg 호출이 실패 | 현재 프런트가 항상 club ID를 보내므로 **권장 후보** |
| B | NULL이면 호출자의 active club이 정확히 하나일 때 추론 | 중간~높음 | 단일 클럽 구클라이언트 호환 | 다중 클럽 의미가 불명확 |
| C | NULL이면 호출자 본인 기록만 전 클럽 허용 | 중간 | 제품 의미 변경 | 글로벌 개인 기록 정책이 이번 범위 밖이므로 비권장 |
| D | 현행 유지 | 낮음 | 높음 | 비공개 타 club 데이터 노출 가능성으로 비권장 |

운영 RPC 로그/외부 클라이언트 사용처를 확인한 뒤 결정한다.

## 8. helper와 trigger EXECUTE

| 분류 | 대상 | 변경 후보 | 위험 | 상태 |
|---|---|---|---|---|
| 내부 helper | `transfer_profile_refs`, `internal_add_player`, `log_match_audit` | PUBLIC/anon/authenticated 직접 EXECUTE 회수, owner 내부 호출 유지 | owner/default privileges가 다르면 공개 RPC/trigger 실패 가능 | PREFLIGHT + STAGING REQUIRED |
| trigger 함수 | `handle_new_user`, `prevent_privilege_change`, `sync_match_ready`, auth 삭제 handler | 일반 role 직접 EXECUTE 회수 | trigger 실행은 보통 유지되지만 실제 owner 연결 확인 필요 | PREFLIGHT + STAGING REQUIRED |
| 공개 RPC | 본 문서의 프런트 직접 호출 함수 | 필요한 role에 명시 GRANT, PUBLIC 검토 | 누락 시 즉시 기능 중단 | 함수별로만 결정 |
| 사용처 불명 | 저장소 검색에서 확정 못한 SECURITY DEFINER | 권한 변경하지 않음 | 잠재 위험 잔존 | 운영 DB/로그 조사 필요 |

## 9. 권장 진행 순서

1. 읽기 전용 preflight로 실제 함수 OID·signature·owner·ACL·본문·정책·publication 확인
2. `security-product-decisions.md`의 SEC-PROD-01~14 확정 내용 재검증
3. 별도 staging을 운영 schema와 같은 상태로 준비
4. 변경 전 26개 회귀 테스트 baseline 기록
5. 한 문제씩 최소 변경하고 동일 테스트 반복
6. RLS/Realtime과 123456 초기화는 독립 배포 단위로 분리 검토
7. postcheck 및 rollback-safe 복구 절차 승인 후에만 운영 적용 검토
