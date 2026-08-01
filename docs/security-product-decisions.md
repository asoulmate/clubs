# Security product decisions

## 문서 상태

이 문서는 구현 명세가 아니라 제품 정책 결정 목록이다. 저장소 코드만으로 확정할 수 없는 항목은 `미결정`으로 둔다. 운영 DB preflight, 운영자 결정, staging 회귀 테스트 전에는 어떤 안도 운영 적용 대상으로 확정하지 않는다.

## 1. 사용자 관리 범위

### 현재 확인된 구조

- `profiles`의 `name`, `award_level`, `is_active`, `is_guest`, `is_platform_admin`, 레거시 `role`은 사용자 단위 전역 값이다.
- 클럽별 역할과 가입 상태는 `club_members(club_id, user_id, role, status)`에 있다.
- 관리자 화면은 현재 클럽의 `club_members`를 조회하지만, `admin_update_user(p_user_id, ...)`는 club ID 없이 전역 `profiles`를 수정한다.
- `profiles.is_active=false`는 `assert_active_caller()`에서 모든 쓰기 RPC를 막고 `RequireAuth`에서 비활성 화면을 표시하므로 코드상 플랫폼 전체 계정 정지처럼 작동한다.
- `club_members.status`는 `pending|active|rejected`이며 클럽 가입 승인 상태로 사용된다.

### 결정이 필요한 질문

| 항목 | 선택안 | 장점 | 기존 운영 영향/위험 | 상태 |
|---|---|---|---|---|
| 클럽 관리자의 전역 프로필 수정 | A. 같은 클럽 main admin은 단일 클럽 회원·guest의 이름/입상 수정 허용 | 현재 UI와 단일 클럽 운영 유지 | membership 수와 대상 club을 DB에서 검증해야 함 | **확정(SEC-PROD-02), 미구현** |
|  | B. 다중 클럽 회원은 플랫폼 관리자만 수정 | 클럽 간 영향 차단 | 현장 수정에 플랫폼 개입 필요 | **확정(SEC-PROD-02), 미구현** |
|  | C. 회원 본인 수정 + 관리자 요청/감사 승인 | 책임과 감사성 개선 | 새 워크플로 필요 | 장기 권장 후보 |
| 계정 정지와 클럽 정지 | A. `profiles.is_active`를 플랫폼 전체 정지로 고정하고 클럽 상태는 membership에서 관리 | 의미가 명확하고 다중 클럽 안전 | schema·UI·RPC 변경 필요 | **확정(SEC-PROD-01), 미구현** |
|  | B. 기존처럼 club admin이 `profiles.is_active` 변경 | 현재 동작 유지 | 한 클럽 관리자가 전 플랫폼 접근을 막을 수 있음 | **적용 금지** |
| 다중 클럽 회원 관리 | A. 클럽 admin은 자기 club membership만 관리 | 최소 권한 | 현재 전역 수정/삭제 UI 의미 변경 필요 | **확정(SEC-PROD-01/06/07), 미구현** |
|  | B. 공통 클럽이 하나라도 있으면 전역 프로필 관리 | 구현 단순 | 다른 클럽에 연쇄 영향 | 권장하지 않음 |
|  | C. 다중 클럽 회원은 플랫폼 관리자만 전역 작업 | 안전하고 명확 | 운영자 개입 증가 | 전역 작업 권장안 |

### 확정 결정 SEC-PROD-01: 플랫폼 활성 상태와 클럽 상태 분리

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. `profiles.is_active`는 플랫폼 전체 계정의 활성·정지 상태다.
2. 일반 클럽의 `admin`과 `sub_admin`은 이를 변경할 수 없다.
3. 변경은 플랫폼 관리자 또는 별도로 승인된 플랫폼 복구 절차에서만 허용한다.
4. 클럽별 가입 승인·거절·이용 가능 여부는 `club_members.status`에서 관리한다.
5. 한 클럽의 관리 작업이 다른 클럽 이용에 영향을 주면 안 된다.
6. `rejected`를 클럽별 일시정지 의미로 재사용하지 않는다.

현재 운영 코드는 이 결정과 아직 일치하지 않는다. 아래 위치를 변경하기 전까지는 정책이 문서로만 확정된 상태이며, 코드·DB 동작이 바뀌었다고 간주하지 않는다.

### `profiles.is_active` 변경·참조 위치

아래 표는 저장소의 최종 실행 경로와 직접적인 UI 사용처를 중심으로 정리한다. 이전 migration에 남은 구 정의는 이력이며, 운영 본문은 preflight의 `08_function_definitions.csv`로 대조했다.

| 구분 | 위치 | 현재 동작 | 확정 정책과의 관계 |
|---|---|---|---|
| schema | `supabase/migrations/01_schema.sql` | `profiles.is_active boolean not null default true` | 전역 플랫폼 상태 컬럼으로 유지 가능 |
| 가입 trigger | `supabase/migrations/33_award_level_7_migrate.sql::handle_new_user` | 가입 승인 필요 시 profile을 `is_active=false`, membership을 `pending`으로 함께 생성 | **충돌**. 신규 정상 계정의 플랫폼 상태와 클럽 승인 상태가 결합됨 |
| 가입 승인 RPC | `supabase/migrations/17_multi_club.sql::approve_club_member` | 승인 시 membership을 `active`로 바꾸고 profile도 `is_active=true`로 변경 | **충돌**. 클럽 admin/sub가 플랫폼 정지를 해제할 수 있음 |
| 관리자 수정 RPC | `supabase/migrations/30_admin_permission_fixes.sql::admin_update_user` | `p_is_active`가 오면 전역 `is_admin_or_sub()`가 profile 값을 변경 | **충돌**. 어느 클럽 관리자든 플랫폼 전체 상태 변경 가능 |
| 관리자 탈퇴 RPC | `supabase/migrations/30_admin_permission_fixes.sql::admin_remove_user` | 참조가 있는 guest 또는 auth 계정이 없는 회원을 `is_active=false`; 일반 회원은 auth 계정 삭제 경로도 존재 | club 탈퇴와 플랫폼 비활성/계정 삭제가 결합되어 **충돌** |
| Auth 삭제 trigger | `supabase/migrations/09_updates.sql::handle_auth_user_deleted` | auth 사용자가 삭제되고 참조가 있으면 profile을 `is_active=false`로 보존 | 플랫폼 계정 종료의 기록 보존 의미로는 정책과 양립 가능. 플랫폼 전용 절차인지 확인 필요 |
| 신규 guest 생성 | `17_multi_club.sql::create_guest_profile` 계열 | guest profile을 `is_active=true`로 생성 | 로그인 계정 상태라기보다 경기 등록 가능 marker로도 쓰여 의미 정리가 필요 |
| 전역 쓰기 보호 trigger | `02_functions.sql::prevent_privilege_change`의 운영 정의 | `role`, `is_active` 변경을 전역 `is_admin_or_sub()`에 허용 | **충돌**. 플랫폼 관리자/승인 복구 절차만 허용하도록 향후 재설계 필요 |
| 로그인 route guard | `src/App.tsx::RequireAuth` | false면 모든 보호 화면 대신 `InactiveAccountPage` 표시 | 플랫폼 전체 정지 의미와 일치 |
| 공통 쓰기 guard | `02_functions.sql::assert_active_caller` | false면 대부분의 쓰기 RPC 거부 | 플랫폼 전체 정지 의미와 일치 |
| club membership helper | `17_multi_club.sql::is_active_club_member` | membership active와 profile active를 모두 요구 | 플랫폼 정지 사용자가 모든 club에서 차단되는 확정 정책과 일치 |
| 경기 등록 helpers | `internal_add_player`와 guest/absence 관련 함수 | 대상 profile이 false면 경기 등록 등 거부 | 플랫폼 정지에는 적절하나 guest의 의미는 별도 확인 필요 |
| profile 검색 | `src/services/profileService.ts::searchActiveProfiles` | false profile을 선수 검색에서 제외 | 플랫폼 정지 계정을 경기 등록에서 제외하는 정책과 일치 |
| 관리자 service | `src/services/adminService.ts::adminUpdateUser` | `p_is_active`를 기존 RPC로 전달 | 향후 클럽 UI에서는 전역 값 전달 금지 필요 |
| 관리자 UI | `src/components/admin/UsersTab.tsx::toggleActive` | club admin/sub 화면에서 “비활성화/승인·활성화” 버튼으로 전역 profile 토글 | **직접 충돌**. 가입 승인 버튼과 플랫폼 상태 UI를 분리해야 함 |
| 관리자 목록 표시 | `UsersTab.tsx` | profile false 또는 membership 비active면 같은 흐림 처리, “비활성” badge 표시 | 플랫폼 정지와 club 상태를 별도 badge/문구로 구분해야 함 |
| 선수 상세 | `src/pages/PlayerDetailPage.tsx` | false profile에 “비활성” 표시 | 플랫폼 정지 의미로 문구 검토 필요. 과거 기록 표시는 유지해야 함 |
| CSV export | `src/services/exportService.ts` | profile active를 1/0으로 export | 컬럼이 플랫폼 상태임을 명시해야 함. club 상태는 별도 열 필요 여부 검토 |
| 초기 multi-club backfill | `17_multi_club.sql` | 기존 profile active를 membership active/pending으로 변환 | 과거 일회성 이관 로직. 새 정책용 backfill 근거로 재사용 금지 |

### 기존 기능 영향

| 기존 기능 | 현재 결합 | 정책 적용 시 필요한 의미 | 회귀 위험 |
|---|---|---|---|
| 신규 가입 | 승인 필요이면 profile false + membership pending | profile은 정상 플랫폼 계정 상태, 대상 membership만 pending | 승인 전 다른 club 가입/이용, route guard 동작이 달라질 수 있음 |
| 가입 승인 | membership active + profile true | membership만 active. 플랫폼 정지 계정은 승인해도 로그인/쓰기 차단 유지 | 기존 “승인/활성화” 체감이 달라짐 |
| 가입 거절 | membership rejected | 그대로 유지. profile 상태는 변경하지 않음 | 낮음 |
| 사용자 활성화 버튼 | club admin이 전역 profile 토글 | 클럽 화면에서 제거하거나 membership 상태 작업으로 대체 | 기존 관리자 운영 절차 변경 |
| 다중 클럽 사용자 | A 관리자가 profile false로 하면 B도 차단 | A 작업은 A membership에만 영향 | 기존 전역 비활성에 의존한 운영이 있었다면 절차 재정의 필요 |
| 탈퇴 | auth/profile 전체 삭제·비활성과 club 의미 혼합 | club 탈퇴와 플랫폼 계정 종료를 분리 | 반환값, 확인 문구, 기록 보존, 다중 club 영향이 큼 |
| guest 삭제 | 참조가 있으면 전역 profile false | 대상 club membership 제거와 기록용 guest profile 상태를 구분 | guest가 여러 club에 속할 수 있는지 확인 필요 |
| 플랫폼 정지/복구 | 전용 UI/RPC가 명확하지 않음 | 플랫폼 관리자 또는 승인된 복구 절차만 수행 | 전용 운영 절차 없이는 복구 지연 가능 |

### 클럽별 일시정지 모델 비교

| 안 | 구조 | 장점 | 기존 기능 영향·위험 | 전환 난이도 | 현재 권장 상태 |
|---|---|---|---|---|---|
| A. `club_members.status`에 `suspended` 추가 | `pending/active/rejected/suspended` 단일 상태 machine | 조회 조건이 명확하고 한 열로 표시 가능 | 현재 CHECK constraint 교체, TypeScript union·모든 status 분기·가입 재신청·승인 RPC·RLS 수정 필요. 승인 lifecycle과 suspension이 한 축에 섞임 | 높음 | 실제 일시정지 요구가 확정되면 후보 |
| B. membership 활성 컬럼 추가 | 예: `is_enabled boolean not null default true`; status는 승인 lifecycle 유지 | 승인/거절과 일시정지를 독립적으로 표현, additive column 가능 | 모든 membership/RLS/RPC가 `status='active' AND is_enabled`를 일관되게 검사해야 함. 두 상태 조합의 불가능/애매한 경우 정의 필요 | 중간~높음 | 기능이 필요하다면 구조적으로 **권장 후보** |
| C. 세 상태 유지, 일시정지 보류 | 현재 `pending/active/rejected` 유지 | 이번 보안 baseline에서 schema/UI 회귀 최소화 | club별 일시정지 기능 없음. 필요 시 임의로 rejected를 쓰면 안 됨 | 낮음 | 요구가 확정되지 않은 현재 단계의 **안전한 기본안** |

클럽별 일시정지 기능은 현재 보류하는 것으로 확정한다. 운영 요구가 새로 승인될 때까지 C를 유지하며, 어떤 경우에도 `rejected`를 일시정지로 재사용하지 않는다. 향후 기능을 추진할 때는 B를 우선 후보로 다시 검토한다.

### 기존 기능을 보존하는 전환안

| 전환안 | 순서 | 호환성 | 위험 |
|---|---|---|---|
| 1. 원자적 전환 | signup/approve/admin/remove 함수와 UI를 한 배포 단위로 변경 | 최종 상태는 명확 | DB와 이전 앱 버전이 섞이면 승인·활성 흐름 실패. 운영에는 부적합 가능성 |
| 2. 단계적 호환 전환 | 플랫폼 상태 전용 복구 경로 준비 → 가입/승인을 membership-only로 전환 → club UI 전역 토글 제거/대체 → club 탈퇴와 platform 종료 분리 → 마지막에 DB trigger/RPC로 club 관리자 변경 차단 | 구 앱과 신 앱의 공존 기간을 설계할 수 있음 | 중간 상태에서 구 UI가 오류를 보거나 잘못된 문구를 표시할 수 있어 version별 staging 필요 |
| 3. 정책만 확정하고 일시정지 보류 | 전역 활성 경계만 바로잡고 club suspension은 만들지 않음 | 변경 범위 최소 | 클럽별 임시 차단 요구를 충족하지 못함 |

권장 검토 방향은 2와 3의 조합이다. 단, 실행 순서와 wrapper 동작은 이전 앱 버전 호환 테스트 후 확정한다. 현재는 구현하지 않는다.

### 확정 결정 SEC-PROD-02: 전역 이름·입상 정보 수정 범위

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

`profiles.name`과 `profiles.award_level`은 모든 클럽과 과거 경기·통계에 공통으로 표시되는 전역 정보다. 다음 권한 경계를 적용한다.

1. 플랫폼에서 활성 상태인 등록 회원은 자신의 이름·입상 정보를 수정할 수 있다.
2. 같은 클럽의 main `admin`은 대상이 그 클럽에만 가입한 회원이면 이름·입상 정보를 수정할 수 있다.
3. `sub_admin`은 다른 사용자의 전역 이름·입상 정보를 수정할 수 없다.
4. 둘 이상의 클럽에 가입한 회원은 플랫폼 관리자만 수정할 수 있다.
5. 플랫폼 관리자는 승인된 운영 절차에서 전역 이름·입상 정보를 정정할 수 있다.
6. 같은 클럽 main admin은 해당 클럽에만 속한 guest의 이름·입상 정보를 수정할 수 있다.
7. 다른 클럽 회원·guest는 수정할 수 없다.
8. 관리자 수정이 다른 클럽에 영향을 줄 가능성이 있으면 허용하지 않는다.

이 문서에서 `단일 클럽`은 대상 사용자에게 `pending` 또는 `active`인 membership이 정확히 하나이고 그 club이 호출 관리자의 대상 club인 경우를 뜻한다. `rejected` 이력은 관리 권한을 부여하지 않으며, 여러 비거절 membership이 있으면 다중 클럽으로 취급한다. 플랫폼 정지 상태의 본인 수정 허용 여부는 SEC-PROD-01의 전역 차단 원칙에 따라 허용하지 않는 방향으로 staging에서 검증한다.

#### 현재 호출 경로와 충돌

| 위치 | 현재 동작 | 확정 정책과의 관계 |
|---|---|---|
| `src/pages/SettingsPage.tsx::handleSave` | 로그인 사용자가 이름·입상을 입력하고 `updateMyProfile` 호출 | 본인 수정 기능으로 유지 대상 |
| `src/services/profileService.ts::updateMyProfile` | `profiles` 본인 행을 직접 UPDATE | signature 없는 정상 흐름. 플랫폼 active 조건과 보호 column 경계 보강 검토 필요 |
| `profiles_update_self` RLS | `id=auth.uid()`이면 UPDATE 허용 | 본인 이름·입상 수정은 유지하되 다른 보호 column 변경은 trigger/정책으로 차단해야 함 |
| `src/components/admin/UsersTab.tsx::AdminEditUserDialog` | 현재 club 목록에서 main admin에게 이름·입상 편집 버튼 표시 | 단일 클럽 대상에는 유지; 다중 클럽 대상에는 차단 안내 필요 |
| `src/services/adminService.ts::adminUpdateUser` | club ID 없이 기존 5-argument RPC 호출 | 단일/다중 club을 서버에서 안전하게 판단하거나 향후 명시적 club RPC 필요 |
| `admin_update_user` 운영 함수 | 호출자가 어느 club이든 main admin이면 모든 대상 profile 수정 가능 | **충돌**. 공통 club·대상 membership 수·대상 guest 범위 확인 없음 |
| profile·경기·통계 조회 | name/award를 전역 profile에서 조인 | 변경 즉시 모든 club과 과거 기록 표시에 반영됨. 정책 제한의 근거 |

#### 기존 기능 영향

| 대상 흐름 | 현재 | 확정 정책 적용 후 기대 | 영향 |
|---|---|---|---|
| 본인 설정 | 이름·입상 직접 수정 | 플랫폼 active 회원은 동일하게 성공 | 낮음 |
| 단일 클럽 일반 회원 편집 | 어느 club main admin도 RPC를 직접 호출하면 가능 | 같은 유일 club main admin만 성공 | 정상 UI는 유지, 권한 밖 호출만 차단 |
| 다중 클럽 회원 편집 | 어느 club main admin도 가능 | club admin/sub는 실패, 플랫폼 관리자만 성공 | 관리자 화면에 사유 안내 필요 |
| sub_admin 편집 | UI는 버튼 없음, DB 함수도 `is_any_club_admin` 때문에 보통 거부 | 명시적으로 계속 거부 | 낮음 |
| 단일 클럽 guest 편집 | main admin 가능 | 같은 유일 club main admin은 유지 | guest membership 검증 추가 필요 |
| 다른 club 대상 직접 RPC | 전역 admin 여부만으로 성공 가능 | 거부 | 보안 개선, 정상 기능 영향 없음 |
| 과거 경기·통계 | 최신 profile 이름·입상을 표시 | 동일 | 정정은 과거 화면에도 반영된다는 운영 인지 필요 |

#### 호환 전환 방안 비교

| 안 | 방식 | 프런트 호환 | 장점 | 위험 | 권장 상태 |
|---|---|---|---|---|---|
| A. 기존 signature에서 서버 추론 | 기존 `admin_update_user` 인자 유지. 대상의 비거절 membership이 정확히 하나이고 호출자가 그 club main admin인지 검사 | 높음 | 기존 단일 클럽 UI 수정 없이 유지 가능 | 현재 화면 club을 명시하지 못하며 multi-club는 전부 거부해야 안전 | **단기 권장 후보** |
| B. club ID를 받는 신규 RPC + 기존 wrapper | 명시적 club context로 검증하고 기존 함수는 단일 club만 허용하는 wrapper | 중간 | 의도가 명확하고 감사 확장 용이 | 프런트 변경과 PostgREST overload/wrapper 테스트 필요 | **장기 권장 후보** |
| C. 플랫폼 관리자만 관리자 편집 | 본인 외 정정은 platform 전용 | 낮음 | 가장 단순하고 안전 | 현재 club main admin 편집 기능 중단 | 기존 기능 보호 원칙상 비권장 |

단계적 전환 시 먼저 기존 signature에서 단일 club inference를 staging 검증하고, 향후 명시적 club context가 필요한 감사·UI 기능을 v2로 이동하는 방안을 우선 검토한다. 아직 함수나 프런트를 변경하지 않는다.

## 2. 123456 비밀번호 초기화 정책

### 유지 조건

`123456` 초기화 방식과 관리자 화면은 현재 운영 필수 기능이므로 삭제하거나 reset-email 방식으로 대체하지 않는다. 결정 대상은 실행 주체, 대상 범위, 감사 및 다중 클럽 조건이다.

### 확정 결정 SEC-PROD-03: 초기화 허용 주체와 대상

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. `123456` 초기화 기능과 초기화 후 기존 session·refresh token 종료 동작을 유지한다.
2. 같은 클럽 main `admin`은 그 클럽에만 가입된 플랫폼 active 일반 회원과 `sub_admin`을 초기화할 수 있다.
3. 호출자 `sub_admin`과 일반 회원은 초기화할 수 없다.
4. 다른 클럽 회원은 초기화할 수 없다.
5. 둘 이상의 비거절 membership을 가진 다중 클럽 회원은 플랫폼 관리자만 초기화할 수 있다.
6. 클럽 main admin은 다른 main admin을 초기화할 수 없다. main admin 대상은 플랫폼 관리자만 처리한다.
7. 플랫폼 관리자 계정 자체는 일반 `admin_reset_user_password` 대상에서 제외하고 별도로 승인된 플랫폼 복구 절차를 사용한다.
8. `pending`, `rejected`, 플랫폼 정지(`profiles.is_active=false`) 회원은 일반 클럽 초기화 대상이 아니다. 필요한 경우 먼저 승인된 상태 복구 절차를 완료한다.
9. guest는 auth 계정이 없으므로 초기화할 수 없다.
10. 관리자는 자기 자신을 이 기능으로 초기화할 수 없다.
11. 모든 성공 건은 실행 관리자, 대상 사용자, 대상 club, 실행 시각, 성공 결과, 사유, 다중 클럽 여부를 감사 로그에 남긴다.
12. 비밀번호 값 자체는 감사 로그에 저장하지 않는다.

`단일 클럽`과 `다중 클럽` 판정은 SEC-PROD-02와 동일하게 `pending` 또는 `active` membership을 기준으로 한다. rejected 이력은 관리 권한을 주지 않는다. 플랫폼 관리자가 다중 클럽 회원이나 main admin을 초기화할 때도 대상 club 또는 운영 context, 사유와 감사 기록이 필요하다.

### 현재 운영 흐름과 정책 충돌

| 위치 | 현재 동작 | 확정 정책과의 관계 |
|---|---|---|
| `src/components/admin/UsersTab.tsx::AdminEditUserDialog` | main admin 편집 dialog에서 비게스트 대상에게 초기화 버튼 표시 | caller 역할은 대체로 맞지만 대상의 multi-club, main admin, platform admin, 상태를 표시·차단하지 않음 |
| `UsersTab.tsx::handleResetPassword` | 확인창 후 user ID만 전달; 사유·club ID 없음 | 성공 사유와 명시적 club context를 전달할 수 없어 **충돌** |
| `src/services/adminService.ts::adminResetUserPassword` | `(p_user_id)` RPC 호출 | 기존 signature 유지 대상이지만 안전한 club 추론 또는 향후 v2가 필요 |
| 운영 `admin_reset_user_password(uuid)` | `is_any_club_admin()`이면 모든 비guest auth 사용자의 비밀번호 변경 가능 | 다른 club, multi-club, main/platform admin, 자기 자신, inactive/pending 보호가 없어 **충돌** |
| auth update | `crypt('123456', gen_salt('bf'))`로 갱신 | 유지 대상 |
| session 정리 | `auth.sessions`, `auth.refresh_tokens` 삭제 | 유지 대상 |
| 감사 | 전용 감사 INSERT 없음 | 확정 정책상 성공 로그 추가 필요 |

### 대상별 확정 matrix

| 대상 | 같은 단일 club main admin | platform admin | 그 외 caller |
|---|---|---|---|
| active 단일 club 일반 회원 | 허용 | 허용 | 금지 |
| active 단일 club `sub_admin` | 허용 | 허용 | 금지 |
| active 단일 club main `admin` | 금지 | 허용 | 금지 |
| 다중 club 일반 회원/`sub_admin`/main admin | 금지 | 허용 | 금지 |
| 다른 club 전용 회원 | 금지 | 허용된 platform 절차에서만 | 금지 |
| platform admin 계정 | 금지 | 일반 초기화 RPC에서는 금지 | 금지 |
| `pending`·`rejected` | 금지 | 상태 복구 절차 후 재판단 | 금지 |
| `profiles.is_active=false` | 금지 | 플랫폼 복구 절차 후 재판단 | 금지 |
| guest | 금지 | 금지 | 금지 |
| 자기 자신 | 금지 | 금지 | 금지 |

### 기존 기능을 보존하는 전환안

| 안 | 방식 | 기존 UI/signature 호환 | 감사 사유 | 위험 | 권장 상태 |
|---|---|---|---|---|---|
| A. 기존 signature에서 안전 추론 | `admin_reset_user_password(uuid)`가 대상의 유일 비거절 club과 caller main admin 여부를 계산 | 높음 | 기존 UI는 사유를 못 보내므로 시스템 사유만 가능 | 다중 club은 안전하게 거부 가능하지만 사용자 입력 사유 요구를 충족하지 못함 | 임시 호환 후보 |
| B. club ID·사유를 받는 신규 v2 + 기존 wrapper | 신규 함수가 명시적 context와 사유를 받고 기존 함수는 단일 club 안전 추론·legacy 감사 후 호출 | 중간 | 충족 | wrapper가 우회 경로가 되지 않도록 단계적 제한 필요 | **권장 후보** |
| C. 기존 signature 자체 변경 | 기존 함수에 인자를 추가 | 낮음 | 충족 | 현재 프런트와 외부 호출 즉시 중단 | 적용 금지 |

안전한 단계적 검토 순서는 감사 저장 구조 준비 → 신규 명시적 RPC와 UI의 사유 입력 → 기존 wrapper의 엄격한 단일 club 제한 → 모든 역할/대상 staging 테스트다. 실제 함수·UI는 아직 변경하지 않는다.

### 감사 요구사항

- 최소 필드: actor ID, target ID, target club ID 또는 platform context, attempted/completed timestamp, result, reason, multi-club 여부·개수.
- password, password hash, token, session 값은 기록하지 않는다.
- 성공 감사가 비밀번호 변경과 원자적으로 남아야 한다. 감사 INSERT 실패 시 초기화도 성공 처리하지 않는 방안을 검토한다.
- 실패 시도 로그는 함수 exception과 같은 transaction에서 롤백될 수 있으므로 별도 보안 감사 채널 또는 API gateway 로그가 필요하다. 이는 구현 전 기술 결정으로 남긴다.
### 확정 결정 SEC-PROD-05: 초기화 후 최초 로그인 비밀번호 변경

결정일: 2026-08-01  
상태: **현재 정책 확정, 향후 옵션은 미구현**

1. 현재는 관리자가 `123456`으로 초기화한 계정에 최초 로그인 비밀번호 변경을 강제하지 않는다.
2. 사용자는 `123456` 로그인 성공 후 기존과 같은 애플리케이션 흐름을 이용할 수 있다.
3. 향후 이 동작을 플랫폼 계정 정책 옵션으로 활성화·비활성화할 수 있도록 확장 가능성을 유지한다.
4. 이 옵션은 클럽 관리자가 정하는 클럽별 정책이 아니라 플랫폼 계정에 적용되는 정책이어야 한다.
5. 향후 옵션을 도입할 때 기본값과 기존 계정 적용 방식은 기존 운영 동작을 보존하도록 `강제 안 함`으로 시작한다.
6. 옵션이 활성화된 경우의 제한 경로, 변경 완료 판정, 관리자·복구 계정 예외는 별도 구현 결정과 staging 검증을 거쳐야 한다.

이번 단계에서는 `must_change_password` 상태, 플랫폼 설정값, UI, 인증 라우팅을 추가하지 않는다.

### 대상 유형별 검토 근거

| 대상 | 선택 가능한 정책 | 장점 | 기존 운영 영향 | 보안 위험 | 권장안 |
|---|---|---|---|---|---|
| 한 클럽 전용 일반 회원 | 같은 클럽 main admin 허용; platform admin 허용 | 현재 현장 복구 유지 | 사유 입력·로그가 추가되면 절차 증가 | 고정 임시 비밀번호 노출 및 계정 탈취 위험 | **확정**: 같은 클럽 main admin + 감사 + 세션 종료 |
| 다중 클럽 일반 회원 | A. platform admin만 허용 | 클럽 간 권한 충돌 차단 | 현장 처리 지연 | 낮음 | **확정** |
|  | B. 어느 소속 club main admin도 경고·사유·추가 확인 후 허용 | 운영 편의 | 모든 클럽 로그인에 영향 | 한 클럽 침해가 전체 계정에 전파 | **미채택** |
| `sub_admin` 대상 | A. 같은 클럽 main admin 허용 | 역할 계층과 부합 | 기존 admin 대상 처리 가능성 확인 필요 | 권한 계정 탈취 영향 증가 | **확정**: 단일 club만, multi는 platform |
| 다른 main admin 대상 | A. club admin에게 금지, platform admin만 허용 | 상호 관리자 계정 보호 | 현장 복구에 platform 개입 | 낮음 | **확정** |
|  | B. 유일한 다른 main admin만 추가 확인 후 허용 | 비상 운영 가능 | 주 관리자 수/승계 정책 필요 | 관리자 상호 탈취 가능 | 권장하지 않음 |
| 플랫폼 관리자 | club admin 금지; 별도 platform 복구 절차 | 최고 권한 보호 | 별도 운영 절차 필요 | 가장 낮음 | **확정** |
| 비활성 회원 | A. 승인된 플랫폼 복구 절차로 활성 상태를 먼저 복구한 뒤 필요하면 초기화 | 상태 의미 명확 | 복구 절차가 한 단계 추가됨 | 낮음 | **확정** |
|  | B. 같은 club main admin이 비활성 상태에서 바로 초기화 | 복구 간편 | 전역 비활성 의미와 충돌 | 비활성 계정 재노출 가능 | **미채택** |
| 가입 대기 회원 | 승인 전 금지 | 가입 승인과 인증 복구 분리 | 현재 관리 습관 확인 필요 | 낮음 | **확정** |
| 게스트 | 금지 | auth 계정이 없어 현재 함수와 일치 | 없음 | 없음 | **확정/현재 동작** |

### 확정된 공통 통제

- 호출 관리자 ID, 대상 ID, 대상 club ID, 시각, 결과, 사유, 다중 클럽 여부를 감사 로그에 기록한다.
- 비밀번호 값은 로그에 기록하지 않는다.
- 자기 자신 초기화는 금지한다.
- 초기화 직후 기존 세션·refresh token 종료는 현재 동작을 유지한다.
- 현재는 최초 변경을 강제하지 않는다. 향후 플랫폼 계정 정책 옵션을 도입하기 전까지 `must_change_password` 상태나 강제 라우팅을 추가하지 않는다.
- 실패 감사 로그는 같은 트랜잭션에서 exception과 함께 롤백될 수 있으므로 별도 로깅 구조 또는 외부 감사 채널 검토가 필요하다.

## 3. 삭제·탈퇴의 제품 의미

### 확정 결정 SEC-PROD-06: 클럽 탈퇴와 플랫폼 계정 종료 분리

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 관리자 UI의 일반적인 “탈퇴”는 현재 클럽에서의 탈퇴를 의미한다.
2. 클럽 탈퇴는 대상 클럽의 `club_members` 관계만 종료한다.
3. 대상 사용자의 `auth.users`, `profiles`, `profiles.is_active`, 다른 클럽 membership은 변경하지 않는다.
4. 한 클럽의 탈퇴 처리가 다른 클럽의 로그인·회원 상태·관리 권한·경기 이용에 영향을 주면 안 된다.
5. 탈퇴 전 참가한 확정 경기와 통계에 필요한 profile 및 경기 참조는 보존한다.
6. 해당 클럽의 미확정 경기 참가 슬롯 처리 범위는 그 클럽으로 한정한다. 다른 클럽 경기 슬롯은 변경하지 않는다.
7. 마지막 클럽에서 탈퇴해도 플랫폼 계정은 유지하며, 이후 다른 클럽 가입 또는 재가입 가능성을 보존한다.
8. 플랫폼 계정 정지·삭제는 클럽 탈퇴와 분리된 명시적인 플랫폼 절차에서만 수행한다.
9. guest도 클럽 탈퇴 처리만으로 전역 profile을 삭제하거나 비활성화하지 않는다. 참조 없는 고아 guest 정리는 별도 플랫폼 유지보수 정책으로 다룬다.
10. membership 관계는 SEC-PROD-13에 따라 `withdrawn` 상태로 보존하며 `rejected`를 탈퇴 의미로 재사용하지 않는다.
11. 본인 자진 탈퇴는 SEC-PROD-08의 전용 흐름과 권한을 따른다.

### 확정 결정 SEC-PROD-07: 클럽 탈퇴 처리 권한

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 같은 클럽의 main `admin`은 그 클럽의 일반 회원, `sub_admin`, guest에 대한 클럽 탈퇴를 처리할 수 있다.
2. `sub_admin`은 다른 회원의 클럽 탈퇴를 처리할 수 없다.
3. 일반 회원과 guest는 다른 회원의 클럽 탈퇴를 처리할 수 없다.
4. 다른 클럽의 main admin은 대상 회원을 탈퇴시킬 수 없다.
5. 클럽 main admin은 같은 클럽의 다른 main admin을 탈퇴시킬 수 없다.
6. main admin 대상 탈퇴는 플랫폼 관리자만 승인된 플랫폼 관리 절차에서 처리할 수 있다.
7. 플랫폼 관리자는 대상 club을 명시한 플랫폼 관리 절차에서 일반 회원, `sub_admin`, guest의 탈퇴도 처리할 수 있다.
8. 호출자와 대상의 관계, 대상 club, 대상 역할은 DB에서 다시 검증해야 하며 UI 노출 여부만 신뢰하지 않는다.
9. 자기 자신에 대한 관리자 탈퇴 RPC 호출은 금지한다. 회원 본인의 자진 탈퇴는 별도 전용 흐름으로 결정한다.
10. 성공한 관리 탈퇴는 actor, target, target club, 대상 역할, 시각, 사유, 결과를 감사 기록에 남겨야 한다. profile·auth·다른 club 상태는 기록 대상이 아니라 불변 조건으로 검증한다.

현재 `admin_remove_user(uuid)`는 club ID가 없고 전역 `is_admin_or_sub()`만 검사하므로 위 권한을 표현하지 못한다. 특히 sub_admin 허용, 타 club 대상 가능성, main admin 보호 부재가 확정 정책과 충돌한다. 구체적인 함수·권한·UI 변경은 아직 수행하지 않는다.

### 확정 결정 SEC-PROD-08: 회원 본인의 자진 탈퇴

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. active 일반 회원과 `sub_admin`은 자신이 선택한 클럽에서 자진 탈퇴할 수 있다.
2. 자진 탈퇴는 선택한 클럽의 membership에만 영향을 주며 플랫폼 계정, profile, 다른 클럽 membership은 유지한다.
3. 확정 경기, 통계, 과거 선수 표시를 위한 참조는 보존한다.
4. 실행 전 대상 클럽명, 다른 클럽에는 영향이 없다는 점, 대상 클럽의 미확정 경기 영향을 명확히 안내하고 재확인을 받아야 한다.
5. main admin은 관리자 승계 또는 플랫폼 관리자 처리 전에는 자진 탈퇴할 수 없다.
6. `pending` 사용자의 의사 철회는 탈퇴가 아니라 가입 신청 취소로 분리한다.
7. rejected 이력은 자진 탈퇴 대상으로 보지 않으며 탈퇴 상태로 재사용하지 않는다.
8. guest는 로그인 계정이 없으므로 본인 자진 탈퇴 대상이 아니다.
9. 자진 탈퇴 전용 경로는 `auth.uid()`와 대상 membership의 user ID가 같은지 DB에서 검증해야 한다. 관리자 탈퇴 RPC를 자기 자신에게 호출하는 우회는 계속 금지한다.
10. 탈퇴 성공 시 user ID, target club, 실행 시각, 결과를 감사 기록에 남기되 다른 club 정보나 민감 인증값은 기록하지 않는다.
11. 미확정 경기 슬롯을 자동 제거할지, 진행 상태에 따라 탈퇴를 차단할지는 다음 별도 제품 결정으로 남긴다. 해당 결정 전에는 구현하지 않는다.

현재 애플리케이션에는 회원 본인의 자진 탈퇴 UI나 전용 RPC가 없다. `UsersTab`의 관리자 전용 `removeUser`와 `admin_remove_user(uuid)`만 존재하며 함수는 자기 자신 호출을 거부한다. `club_members`에는 DELETE RLS 정책도 없어 클라이언트 직접 삭제 경로가 없다. 따라서 이 결정은 현재 기능을 즉시 바꾸지 않으며 향후 전용 경로가 필요하다.

### 확정 결정 SEC-PROD-09: 탈퇴 시 미확정 경기 처리

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 탈퇴 처리 전에 대상 클럽의 참가 경기 상태를 DB에서 검사한다.
2. `open` 또는 `ready` 경기의 대상 선수 슬롯은 제거하고 탈퇴를 진행한다. 슬롯 제거에 따른 `ready`/`open` 재계산은 기존 trigger 동작을 유지한다.
3. `in_progress` 또는 `submitted` 경기에 대상 선수가 있으면 탈퇴를 차단한다. 해당 경기를 확정·취소하거나 승인된 관리자 초기화 절차로 정리한 뒤 다시 처리한다.
4. `confirmed` 경기의 선수 슬롯, 점수, 확인, 감사 및 통계 참조는 변경하지 않는다.
5. `canceled` 경기는 탈퇴 차단 사유가 아니며, 대상 선수 슬롯을 제거하더라도 match 자체와 감사 기록은 보존한다.
6. 위 처리는 대상 클럽 경기로만 제한한다. 다른 클럽의 `open`, `ready`, `in_progress`, `submitted`, `confirmed`, `canceled` 경기와 선수 슬롯은 모두 변경하지 않는다.
7. 관리자 탈퇴와 본인 자진 탈퇴에 같은 경기 무결성 규칙을 적용한다.
8. 실행 전 제거될 `open`/`ready`/`canceled` 슬롯 수와 탈퇴를 차단하는 `in_progress`/`submitted` 경기 수를 사용자에게 안내한다.
9. 차단 상태가 하나라도 있으면 membership 종료와 슬롯 제거를 모두 수행하지 않는다. 허용되는 탈퇴는 슬롯 정리, membership 종료, 감사 기록이 하나의 원자적 작업이어야 한다.
10. 경기 ID·상태를 클라이언트가 전달한 값만 신뢰하지 않고 탈퇴 transaction 안에서 다시 조회한다.

현재 `admin_remove_user(uuid)`는 대상 사용자의 `confirmed`가 아닌 모든 경기 슬롯을 club 조건 없이 삭제한다. 따라서 `in_progress`·`submitted` 경기까지 제거할 수 있고 다른 클럽 슬롯에도 영향을 줄 수 있어 확정 정책과 충돌한다. 구체적인 SQL·RPC·trigger는 아직 변경하지 않는다.

### 확정 결정 SEC-PROD-10: 탈퇴 후 해당 클럽 접근 범위

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 클럽 탈퇴가 완료되면 해당 클럽에 대한 모든 사용자 접근을 차단한다.
2. 차단 범위에는 현재·과거 경기, 본인이 참가한 `confirmed` 경기, 개인·클럽 통계, 회원 목록과 profile join, 관리자 화면, CSV/export, 직접 URL, RPC, table 조회 및 Realtime event가 모두 포함된다.
3. 과거 확정 경기와 통계 산출에 필요한 DB 기록은 삭제하지 않고 보존하지만 탈퇴한 사용자에게 조회 권한을 부여하지 않는다.
4. 다른 클럽의 membership과 허용된 기능, 플랫폼 로그인, 전역 profile에는 영향을 주지 않는다.
5. 탈퇴 직전 열어 둔 화면과 기존 session에서도 후속 fetch·RPC·Realtime이 차단되어야 한다. 클라이언트 화면 숨김만으로 처리하지 않는다.
6. 재가입 신청이 `pending`인 동안에도 모든 접근 차단을 유지한다. 같은 클럽 membership이 다시 `active`가 된 뒤에만 현재 active 회원 정책에 따른 접근을 허용한다.
7. rejected 또는 종료된 membership 이력은 조회 권한을 부여하지 않는다.
8. 플랫폼 관리자는 승인된 플랫폼 관리 권한 범위에서 조회할 수 있다.
9. 탈퇴 사용자의 과거 기록 열람 요청이 필요해질 경우 일반 클럽 접근을 다시 열지 않고 별도 플랫폼 제공 절차로 결정한다.

이 결정은 기록 보존과 사용자 접근을 분리한다. SEC-PROD-06/09에 따라 과거 경기 row는 유지하지만, 탈퇴한 본인은 해당 클럽 데이터를 조회할 수 없다. 구체적인 RLS·RPC·Realtime 변경은 운영 preflight와 staging 증거를 바탕으로 별도 설계하며 아직 수행하지 않는다.

### 현재 동작과 확정 정책의 충돌

현재 `admin_remove_user`는 이름과 달리 club membership만 제거하지 않는다.

| 현재 동작 | 확정 정책과의 충돌 |
|---|---|
| club ID 없이 대상 user ID만 받음 | 어느 클럽의 탈퇴인지 명시하거나 안전하게 한정할 수 없음 |
| 어느 클럽의 `admin`/`sub_admin`이면 호출 가능 | 호출자와 대상의 같은-club 관계를 검증하지 않음 |
| 비회원 guest는 참조가 없으면 profile 삭제, 있으면 전역 비활성화 | 클럽 탈퇴가 플랫폼 profile 생명주기에 영향을 줌 |
| auth 회원은 `auth.users` 삭제 또는 profile 전역 비활성화 | 다른 클럽 로그인과 이용까지 종료될 수 있음 |
| 미확정 경기 슬롯 제거 | 대상 클럽 조건이 없으면 다른 클럽 경기까지 변경될 수 있음 |
| `guest_deleted`, `guest_deactivated`, `member_withdrawn`, `member_deactivated` 반환 | 기존 UI 문구가 클럽 탈퇴와 플랫폼 종료 의미를 혼합함 |

### 기존 기능을 보존하는 전환 방안

| 방안 | 설명 | 호환성 | 위험 | 판단 |
|---|---|---|---|---|
| A. 기존 one-argument RPC 내부에서 대상 club 추론 | 대상의 유일한 비거절 membership을 찾아 그 club만 종료 | 단일 club UI 변경이 작음 | 다중 club과 재가입 이력에서 모호하고 잘못된 club 처리 가능 | 임시 호환 후보 |
| B. club ID를 받는 신규 club-withdraw RPC와 기존 wrapper | 신규 경로는 club을 명시하고, 기존 RPC는 단일 club인 경우만 엄격히 위임 | 기존 호출을 단계적으로 보존 가능 | wrapper가 플랫폼 삭제 경로로 남지 않도록 제한 필요 | **권장 전환안** |
| C. 기존 RPC signature와 의미를 즉시 변경 | 기존 함수 이름은 유지하고 인자·반환 의미 변경 | 낮음 | 배포 순서에 따라 기존 UI가 중단됨 | 적용 금지 |

플랫폼 계정 종료는 신규 club 탈퇴 RPC와 권한·확인 문구·감사 기록을 공유하지 않는 별도 절차로 설계한다. 구체적인 SQL·함수·UI는 아직 변경하지 않는다.

## 4. Realtime 및 SELECT 범위

### 확정 결정 SEC-PROD-11: child RLS와 Realtime 전달 범위

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. `match_players`와 `score_confirmations`는 부모 `matches.club_id`에 active membership이 있는 사용자 또는 플랫폼 관리자만 조회할 수 있다.
2. pending, rejected, 탈퇴 사용자 및 다른 클럽의 active 회원은 해당 child row를 조회할 수 없다.
3. `matches`와 `match_players` Realtime event는 부모 경기 클럽의 active 회원 또는 플랫폼 관리자에게만 전달한다.
4. 권한 없는 client가 event payload를 받은 뒤 후속 SELECT에서만 차단되는 방식은 허용하지 않는다. event 자체가 전달되지 않아야 한다.
5. 사용자가 탈퇴하거나 membership이 active가 아니게 된 뒤에는 기존 subscription과 session에서도 신규 event가 전달되지 않아야 한다.
6. 다른 클럽의 match ID, player ID, position, score 확인 상태 등 payload metadata도 노출하지 않는다.
7. child table을 읽는 SECURITY DEFINER RPC도 같은 부모 club membership 경계를 직접 검증해야 한다. RLS 우회 함수가 더 넓은 데이터를 반환하면 안 된다.
8. `score_confirmations`는 Realtime publication에 추가하지 않는다. 기존 `matches`, `match_players` Postgres Changes는 TECH-04의 private Broadcast 병행 검증 기간에만 유지하고, DELETE event RLS 한계를 제거하기 위해 최종 cutover에서 client 의존과 public publication 노출을 종료한다.
9. `profiles`의 전역 공개 범위는 SEC-PROD-12에서 별도로 결정한다.
10. 기존 nested query, 경기 화면, 점수 확인, CSV와 두 browser Realtime 흐름은 staging에서 active 동일-club 사용자의 기능이 그대로 유지되는지 검증해야 한다.

운영 preflight에서 `match_players`와 `score_confirmations`의 authenticated SELECT 정책은 `USING (true)`이고, Realtime publication에는 `matches`와 `match_players`가 포함된 것으로 확인했다. 따라서 현재 정책은 확정 경계보다 넓다. 아직 RLS·publication·RPC·애플리케이션을 변경하지 않는다.

### 확정 결정 SEC-PROD-12: 전역 `profiles` 최소 공개 범위

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 인증 사용자는 자신의 profile을 조회할 수 있다.
2. 클럽 active 회원은 같은 클럽의 active 회원과 해당 클럽의 접근 가능한 경기 화면에 필요한 참가자 profile을 최소 필드로 조회할 수 있다.
3. 과거 탈퇴자·guest가 해당 클럽의 `confirmed` 경기 기록에 남아 있으면, 그 클럽 active 회원에게 경기 표시용 최소 필드만 제공한다. 탈퇴자 본인의 해당 클럽 접근은 SEC-PROD-10에 따라 계속 차단한다.
4. 일반 회원과 `sub_admin`에게 제공하는 최소 필드는 `id`, `name`, `award_level`, `is_guest`로 제한한다.
5. 같은 클럽 main admin은 회원·가입 신청 관리에 필요한 최소 필드와 `profiles.is_active`를 조회할 수 있다. pending/rejected 신청자의 profile도 해당 클럽 관리 화면 범위에서만 조회한다.
6. main admin에게 `profiles.is_active`를 보여 주더라도 SEC-PROD-01에 따라 변경 권한은 주지 않는다.
7. 일반 회원·클럽 관리자는 전역 `role`, `is_platform_admin`, `created_at`, `updated_at`을 다른 사용자에 대해 조회할 수 없다. 클럽 역할은 `club_members.role`을 사용한다.
8. pending, rejected, 탈퇴 사용자 또는 다른 클럽 회원은 그 상태만으로 해당 클럽의 profile directory 조회 권한을 얻지 않는다.
9. 플랫폼 관리자는 승인된 플랫폼 관리 화면과 절차에서 전체 profile 필드를 조회할 수 있다.
10. profile 조회 권한은 row와 column을 함께 제한해야 한다. 화면에서 숨기기만 하거나 client projection만 신뢰하지 않는다.
11. 이름·입상 수정 권한은 SEC-PROD-02를 따르며, 이번 결정은 SELECT 범위만 확정한다.

현재 `profiles_select_authenticated`는 authenticated 전체에 `USING (true)`이고 table privilege도 광범위해 다른 사용자의 모든 profile column을 직접 요청할 수 있다. PostgreSQL RLS는 row 범위만 다루므로 최소 column 공개에는 제한된 view/RPC 또는 column privilege 같은 별도 구조가 필요하다. 기존 nested query와 URL을 깨지 않는 구체 방안은 구현 단계에서 비교하며 아직 적용하지 않는다.

### 확정 결정 SEC-PROD-13: 탈퇴 membership 이력 저장 방식

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 클럽 탈퇴 시 `(club_id, user_id)`의 `club_members` 행을 삭제하지 않고 status를 `withdrawn`으로 변경해 보존한다.
2. `withdrawn`은 기존 status CHECK에 additive하게 추가할 새 값이며 `rejected`를 탈퇴 의미로 재사용하지 않는다.
3. `withdrawn` membership은 조회·쓰기·Realtime·관리자 권한을 포함한 어떤 클럽 접근 권한도 부여하지 않는다.
4. active membership 수, 단일/다중 클럽 판정, 관리자 권한 판정에서 `withdrawn`을 제외한다.
5. 등록 사용자가 같은 클럽에 재가입하면 기존 행을 `pending`으로 전환하고 승인 절차를 다시 거친다. 자동 active 복구는 허용하지 않는다.
6. 재가입 시 이전 `admin` 또는 `sub_admin` 역할을 복원하지 않고 `role='user'`로 초기화한다. 이후 역할 부여는 별도 승인된 관리자 절차를 따른다.
7. 탈퇴 시각, 실행 주체, 사유, 이전 역할, 처리 결과는 별도 감사 기록에 남긴다. membership 행의 `updated_at`만으로 감사 이력을 대체하지 않는다.
8. 재가입 시 이전 탈퇴 감사 기록을 덮어쓰거나 삭제하지 않는다.
9. guest 탈퇴도 membership 행을 `withdrawn`으로 보존한다. guest를 다시 등록하는 경우 기존 profile·경기 참조를 중복 생성하지 않도록 동일인 확인이 필요하다.
10. 플랫폼 계정·profile·과거 경기 보존과 다른 클럽 비간섭은 SEC-PROD-06을 그대로 따른다.

현재 `club_members.status`는 enum이 아니라 `pending`, `active`, `rejected`만 허용하는 text CHECK constraint이며, 기본키 `(club_id, user_id)` 때문에 이력 보존형 재가입은 기존 행의 안전한 상태 전환이 필요하다. 구체적인 constraint·RPC·RLS·UI 변경은 아직 수행하지 않는다.

### 확정 결정 SEC-PROD-14: 플랫폼 계정 영구 종료와 기록 익명화

결정일: 2026-08-01  
상태: **확정, 아직 미구현**

1. 복구 가능한 플랫폼 계정 정지는 SEC-PROD-01에 따라 `profiles.is_active=false`로 처리한다.
2. 영구 종료는 일반 클럽 탈퇴·정지와 분리된 명시적인 플랫폼 절차에서만 수행한다.
3. 영구 종료 시 Auth 계정, 기존 session, refresh token을 제거해 로그인을 종료한다.
4. 대상 사용자의 모든 club membership은 SEC-PROD-13의 `withdrawn`으로 전환한다. 어느 한 클럽의 관리자가 전역 영구 종료를 실행할 수 없다.
5. `profiles.id`와 profile row는 확정 경기의 참조 무결성을 위해 보존하되 `is_active=false`, `is_platform_admin=false`, 전역 `role='user'`로 만든다.
6. 이름은 비식별 표시명인 `탈퇴 회원`으로 바꾸고 `award_level='none'`으로 초기화한다. 다른 사용자 화면에는 익명화된 최소 표시만 제공한다.
7. 확정 경기의 참가 위치, 점수, 결과, 통계 원천, 감사 기록은 보존한다. 보존 기록에서 종료 사용자의 실제 이름·입상 정보를 다시 노출하지 않는다.
8. `open`, `ready`, `canceled` 경기 슬롯은 모든 클럽에서 SEC-PROD-09 규칙에 따라 정리한다. `in_progress` 또는 `submitted` 참가 경기가 하나라도 있으면 영구 종료를 차단하고 먼저 경기 상태를 정리한다.
9. 영구 종료의 Auth 제거, membership 전환, profile 익명화, 허용된 슬롯 정리, 감사 기록은 부분 성공이 없도록 원자성 또는 검증된 보상 절차를 가져야 한다.
10. 성공 감사에는 actor, target, 실행 시각, 사유, 영향받은 club 수, 결과를 기록한다. 기존 이름, 비밀번호, hash, token은 감사 로그에 남기지 않는다.
11. 영구 종료는 자동 복구하지 않는다. 다시 가입하는 경우 새 Auth 계정과 새 profile UUID를 사용하며 과거 익명 기록과 자동 연결하지 않는다.
12. 플랫폼 관리자 계정은 후속 플랫폼 관리자 승계와 최고 권한 복구 조건을 충족한 별도 절차 없이는 영구 종료할 수 없다.
13. 법적 완전 삭제 요청처럼 profile row와 경기 참조 자체를 제거해야 하는 예외는 이 일반 절차에 포함하지 않고 별도 법무·데이터 무결성 검토를 거친다.

현재 `admin_remove_user(uuid)`는 클럽 관리 화면에서 Auth 삭제 또는 profile 비활성화를 수행하고 실제 이름·입상 익명화와 전체 membership 정리를 보장하지 않는다. 따라서 확정된 플랫폼 영구 종료 절차로 사용할 수 없다. 구체적인 함수·schema·UI·Auth 관리 구현은 아직 수행하지 않는다.

### 현재 저장소 정책

| 테이블 | 저장소상 SELECT 정책 | 직접 사용 |
|---|---|---|
| `match_players` | authenticated `USING (true)` | 경기 nested 조회, 진행 중 선수 조회, CSV, Realtime |
| `score_confirmations` | authenticated `USING (true)` | 상대 팀 확인/확정 상태 표시 |
| `profiles` | authenticated `USING (true)` | 선수 이름·입상, 검색, 관리자 목록, 경기/결과 nested join |

운영 DB 정책은 preflight로 확인해야 한다.

### 정책 축소 시 기능 영향

| 기능 | `match_players` 축소 영향 | `score_confirmations` 축소 영향 | `profiles` 축소 영향 | 검증 포인트 |
|---|---|---|---|---|
| 현재 클럽 경기 목록 | nested player가 누락되거나 query 전체 오류 가능 | 직접 영향 낮음 | 참가자 profile join 누락 가능 | 날짜별 목록, 단식/복식 슬롯 모두 비교 |
| 선수 이름 표시 | player 행이 안 보이면 슬롯이 빈 것처럼 보일 수 있음 | 없음 | 이름/입상/소속 누락 | 게스트·비활성 과거 선수 포함 |
| 참가자 변경 | 변경 후 재조회와 Realtime 갱신 실패 가능 | 없음 | 등록 검색 결과 축소 | 본인·대리·관리자 편성 |
| Realtime 갱신 | 현재 전체 table 이벤트 구독. RLS 적용에 따라 이벤트 미수신 가능 | 현재 publication 미확인 | 직접 구독 없음 | INSERT/UPDATE/DELETE 각각 두 브라우저로 확인 |
| 상대 팀 확인 | 선수 팀 판정 데이터 누락 가능 | 확인 행이 안 보여 확정 UI 불일치 | 선수 이름 누락 | 제출자/상대 팀/관리자 시나리오 |
| 결과·선수 상세 | 통계 RPC는 SECURITY DEFINER이지만 직접/nested 조회와 결합 부분 확인 | 영향 제한적 | 파트너·상대 이름 반환 및 화면 조회 영향 | 과거 탈퇴·게스트 포함 |
| 플랫폼 관리자 | platform bypass가 정책마다 일관돼야 함 | 동일 | 전체 클럽 운영 화면 의도 확인 | 플랫폼 계정으로 모든 기능 회귀 |

### 확정된 조회 경계와 남은 결정

- SEC-PROD-10에 따라 탈퇴 사용자는 본인 참가 기록을 포함한 해당 클럽의 모든 데이터에 접근할 수 없다.
- 재가입 `pending` 및 rejected 상태도 해당 클럽 접근 권한을 주지 않으며 다시 active가 된 뒤에만 허용한다.
- 플랫폼 관리자는 승인된 플랫폼 관리 범위에서 탈퇴자 기록을 확인할 수 있다.
- SEC-PROD-12에 따라 active 회원에게는 접근 가능한 경기의 과거 참가자 `id`, 이름, 입상, guest 여부만 제공한다.
- SEC-PROD-11에 따라 권한 없는 client에는 Realtime event payload 자체를 전달하지 않는다.

확정 방향은 parent `matches.club_id`의 active membership에 맞춘 child RLS이지만, nested SELECT와 Realtime 회귀를 staging에서 입증하기 전에는 적용하지 않는다. `profiles`는 경기 기록 표시와 회원 디렉터리 요구가 달라 SEC-PROD-12에서 별도 결정한다.

## 5. 제품 결정 기록 템플릿

각 결정을 운영 적용 전에 아래 형식으로 기록한다.

| 결정 ID | 질문 | 선택안 | 결정자/일자 | 기존 기능 예외 | staging 증거 | 운영 승인 |
|---|---|---|---|---|---|---|
| SEC-PROD-01 | `profiles.is_active`의 공식 의미 | 플랫폼 전체 계정 활성·정지; club admin/sub 변경 금지; club 상태는 membership에서 관리 | 사용자 승인 / 2026-08-01 | 클럽별 일시정지는 현재 보류 확정 | 계획 보강, 실행 전 | 미구현 |
| SEC-PROD-02 | 회원 전역 이름·입상 정보 수정 주체 | 본인 허용; 같은 main admin은 단일 club 회원·guest만; multi-club는 platform admin만 | 사용자 승인 / 2026-08-01 | sub_admin·타 club 금지 | 계획 보강, 실행 전 | 미구현 |
| SEC-PROD-03 | 123456 초기화 허용 주체·대상 | 단일 club active 일반/sub는 같은 main admin; multi/main admin은 platform admin; 나머지 금지; 감사 필수 | 사용자 승인 / 2026-08-01 | platform admin 계정은 별도 복구 | 계획 보강, 실행 전 | 미구현 |
| SEC-PROD-04 | main admin 상호 초기화 허용 여부 | club main admin 상호 초기화 금지; platform admin만 대상 main admin 처리 | 사용자 승인 / 2026-08-01 | 자기 자신 금지 | SEC-PROD-03 테스트에 포함 | 미구현 |
| SEC-PROD-05 | 123456 초기화 후 최초 로그인 비밀번호 변경 | 현재 강제하지 않음; 향후 플랫폼 계정 정책 옵션으로 on/off 가능하게 확장 | 사용자 승인 / 2026-08-01 | 현재 기본값 off, club별 설정 아님 | 비강제 흐름 회귀 추가, 옵션 구현 전 별도 설계 | 현재 정책 유지, 옵션 미구현 |
| SEC-PROD-06 | “탈퇴”의 club/platform 범위 | club 탈퇴는 대상 membership만 종료; auth/profile/다른 club/과거 기록 유지; 플랫폼 종료는 별도 절차 | 사용자 승인 / 2026-08-01 | rejected 재사용 금지; 권한은 SEC-PROD-07/08 | 전용 회귀 추가, 실행 전 | 미구현 |
| SEC-PROD-07 | 클럽 탈퇴 처리 권한 | 같은 club main admin은 일반/sub/guest 처리; sub·타 club 금지; main admin 대상은 platform admin만 | 사용자 승인 / 2026-08-01 | 관리자 자기 처리 금지; 본인 흐름은 SEC-PROD-08 | 권한 matrix 추가, 실행 전 | 미구현 |
| SEC-PROD-08 | 회원 본인의 자진 탈퇴 | active 일반/sub 허용; main admin·guest 불가; pending은 신청 취소로 분리 | 사용자 승인 / 2026-08-01 | 다른 club·계정·과거 기록 유지; 경기 처리는 SEC-PROD-09 | 자진 탈퇴 회귀 추가, 실행 전 | 미구현 |
| SEC-PROD-09 | 탈퇴 시 미확정 경기 처리 | open/ready/canceled 슬롯 정리; in_progress/submitted이면 차단; confirmed 보존; 대상 club으로 한정 | 사용자 승인 / 2026-08-01 | 관리자·본인 동일 규칙, 원자 처리 | 상태별 회귀 추가, 실행 전 | 미구현 |
| SEC-PROD-10 | 탈퇴 후 해당 클럽 접근 범위 | 현재·과거 경기와 통계·회원·URL·RPC·Realtime을 포함한 모든 접근 차단 | 사용자 승인 / 2026-08-01 | 기록은 보존; 다른 club·플랫폼 계정 유지; 재가입 active 후 재허용 | 탈퇴 후 접근 회귀 추가, 실행 전 | 미구현 |
| SEC-PROD-11 | child RLS와 Realtime 전달 범위 | parent club active/platform만 child SELECT; Realtime은 private Broadcast+epoch로 권한 없는 client에 event 자체 미전달 | 사용자 승인 / 2026-08-01 | profiles 별도; score_confirmations publication 추가 없음 | TECH-04 및 child/Realtime 회귀, 실행 전 | 미구현 |
| SEC-PROD-12 | 전역 `profiles` 최소 공개 범위 | same-club/접근 가능 경기에는 id·이름·입상·guest만; main admin은 대상 club 운영상 is_active 추가; platform은 전체 | 사용자 승인 / 2026-08-01 | 탈퇴 본인 접근 차단; role/platform flag/timestamp 비공개 | profile 회귀 추가, 실행 전 | 미구현 |
| SEC-PROD-13 | 탈퇴 membership 이력 저장 방식 | 행을 보존하고 withdrawn additive 상태 사용; 재가입은 pending+user로 초기화 | 사용자 승인 / 2026-08-01 | rejected 재사용·자동 active·이전 관리자 역할 복원 금지 | membership 이력 회귀 추가, 실행 전 | 미구현 |
| SEC-PROD-14 | 플랫폼 계정 종료 시 기록 보존·익명화 | Auth/session 제거, 전 membership withdrawn, profile UUID 보존·익명화, confirmed 기록 보존, 신규 계정으로만 재가입 | 사용자 승인 / 2026-08-01 | in_progress/submitted 선처리; platform admin 별도 승계 | 영구 종료 회귀 추가, 실행 전 | 미구현 |
