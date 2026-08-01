# 글로벌 identity readiness 조회 안내

## 목적

이 조회는 GR-01 migration을 만들기 전 운영/staging 데이터 규모와 위험을 집계하기 위한 읽기 전용 inventory다. identity schema를 만들거나 profile·경기·membership을 변경하지 않는다.

사용 파일: `supabase/checks/global_identity_readiness.sql`

## 실행 조건

- SG-1 적용 자체와 독립된 읽기 전용 조회지만 올바른 project인지 먼저 확인한다.
- 가능하면 staging clone에서 먼저 실행한다.
- SQL 파일을 한 번에 실행하지 않고 01~10 블록별로 실행한다.
- 결과에 이름, 이메일, UUID, token 등 개인정보가 나타나면 저장하지 말고 작업을 중단한다.
- 이 파일의 정상 결과만으로 GR-01 구현 gate가 통과되는 것은 아니다.

## 결과 파일과 판정

| 블록 | 파일명 | 확인 내용 | 위험 신호 |
|---|---|---|---|
| 01 | `GI_01_profile_population.csv` | guest/member와 active 상태별 profile 수 | 예상 운영 규모와 큰 차이 |
| 02 | `GI_02_auth_profile_summary.csv` | Auth와 profile의 aggregate 관계 | member-without-auth 또는 guest-with-auth가 1 이상 |
| 03 | `GI_03_membership_distribution.csv` | profile별 membership 수 분포 | membership 0 또는 예상 밖 다중 club 급증 |
| 04 | `GI_04_multiclub_guests.csv` | 다중 club guest 수 | 1 이상이면 기존 자동 guest 삭제의 영향이 큼 |
| 05 | `GI_05_duplicate_name_groups.csv` | 동명 후보 그룹 규모 | 후보가 많거나 한 그룹 크기가 큼 |
| 06 | `GI_06_guest_member_candidates.csv` | guest/member 유사 후보 품질 | exact metadata도 자동 merge 근거로 사용하지 않음 |
| 07 | `GI_07_profile_reference_counts.csv` | backfill 전 보존해야 할 FK 참조 수 | 알려진 table 누락 또는 query 오류 |
| 08 | `GI_08_identity_function_contracts.csv` | 가입·guest 함수 signature/owner/security/ACL | overload, owner, ACL이 preflight와 다름 |
| 09 | `GI_09_auth_user_triggers.csv` | 실제 auth.users trigger 연결 | `handle_new_user` 연결 누락·중복·예상 밖 함수 |
| 10 | `GI_10_existing_identity_objects.csv` | 기존 identity object 존재 여부 | 하나라도 true면 저장소 밖 수동 hotfix 여부 확인 |

## 결과 수신 후 비교 체크리스트

- profile 수와 향후 1:1 global player 생성 예상 수 일치
- Auth/profile 비정상 조합의 원인 분류
- membership 0 profile과 다중 club profile 처리 원칙 확인
- 다중 club guest를 자동 삭제하지 않는 전환 조건 확인
- 동명 후보 규모에 맞는 수동 검수 운영량 산정
- profile 참조 count를 GR-01/GR-02 전후 checksum 기준으로 고정
- 최종 `handle_new_user`, `transfer_profile_refs`, `create_guest_profile` signature와 저장소 정의 비교
- auth.users trigger가 실제로 호출하는 최종 함수 확인
- 저장소에 없는 identity object 또는 수동 hotfix 존재 여부 확인

## 금지 사항

- 동명 후보 이름이나 UUID를 CSV로 내보내기
- 후보를 SQL로 자동 병합하기
- `transfer_profile_refs()`를 수동 호출하기
- guest profile 또는 membership 삭제하기
- 기존 함수, trigger, RLS, ACL 변경하기
- 결과만 보고 운영 GR-01 migration을 즉시 적용하기
