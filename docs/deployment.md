# 배포 가이드 (GitHub Pages + Supabase)

## 1. Supabase 설정

### 1-1. 데이터베이스

SQL Editor에서 순서대로 실행:

1. `supabase/migrations/01_schema.sql`
2. `supabase/migrations/02_functions.sql`
3. `supabase/migrations/03_rls.sql`
4. `supabase/migrations/04_seed.sql`
5. `supabase/migrations/05_updates.sql` (경기 삭제, 월별 추이 참가일)
6. `supabase/migrations/06_updates.sql` (경기 중 선수 중복 편성 차단)
7. `supabase/migrations/07_updates.sql` (무단 결석 기록·집계)
8. `supabase/migrations/08_updates.sql` ~ `10_updates.sql` (게스트·가입승인 등)
9. `supabase/migrations/11_updates.sql` (상대별 승률 집계)
10. `supabase/migrations/12_updates.sql` (유튜브 영상 연동)
11. `supabase/migrations/13_updates.sql` (최근 경기 파트너·상대 입상)
12. `supabase/migrations/14_updates.sql` (참가율: 경기 등록일 기준)
13. `supabase/migrations/15_updates.sql` (게스트 소속)
14. `supabase/migrations/16_updates.sql` (게스트 삭제·회원 탈퇴)
15. `supabase/migrations/17_multi_club.sql` (멀티 클럽: clubs / club_members / club_settings)
16. `supabase/migrations/18_updates.sql` (회원가입용 공개 클럽 목록)
17. `supabase/migrations/19_updates.sql` (morning-star 클럽명 → 모닝스타)
18. `supabase/migrations/20_updates.sql` (권한: club_members + is_platform_admin만 사용)
19. `supabase/migrations/21_updates.sql` (잘못 남은 플랫폼 슈퍼 플래그 정리 예시)
20. `supabase/migrations/22_betting.sql` (경기 승패 배팅)
21. `supabase/migrations/23_match_type_betting.sql` ~ `30_admin_permission_fixes.sql`
22. `supabase/migrations/31_create_match_lineup.sql` (균형 추첨 편성 경기 생성)
23. `supabase/migrations/32_award_level_7.sql` (입상 7단계 enum 추가)
24. `supabase/migrations/33_award_level_7_migrate.sql` (기존 등급 이관 + 가입 트리거)
25. `supabase/migrations/34_tournament_entries.sql` (회원별 대회 참가 현황)
26. `supabase/migrations/35_club_delete_and_order.sql` (클럽 생성순 정렬 + 플랫폼 클럽 삭제)
27. `supabase/migrations/36_match_fines.sql` (클럽별 패자 벌금 설정·기간 집계)
28. `supabase/migrations/37_club_fine_flag.sql` (패자 벌금을 clubs 기능 플래그로 이동)
21. `supabase/migrations/23_match_type_betting.sql` (단식/복식, 배팅 경기 지정·마감 시간, 배팅 500/1000, 집계 분리)
22. `supabase/migrations/24_betting_lock_on_start.sql` (경기 시작·스코어 입력 후 배팅 변경 잠금)
23. `supabase/migrations/25_absence_by_match_type.sql` (단식/복식 집계: 해당 유형 경기 있는 날만 무단결석 반영)
24. `supabase/migrations/26_match_display_order.sql` (당일 경기 표시 순서 변경)
25. `supabase/migrations/27_admin_only_cancel_delete.sql` (경기 취소·삭제: 관리자/서브만)
26. `supabase/migrations/28_platform_create_club_admin.sql` (플랫폼 클럽 생성 시 생성자=클럽 관리자)
27. `supabase/migrations/29_audit_logs_club_scope.sql` (수정 이력: 클럽별 조회)
28. `supabase/migrations/30_admin_permission_fixes.sql` (비밀번호 초기화·관리자 스코어 권한: club_members/플랫폼 슈퍼)
29. `supabase/migrations/38_security_baseline_foundation.sql` ~ `47_guest_global_identity_linking.sql` (보안·글로벌 신원·Shadow Elo 등)
30. `supabase/migrations/48_tie_default_and_ranking_mode.sql` (동점 기본 허용 + 순위 집계 방식 ranking_mode)
31. `supabase/migrations/49_shadow_rating_explorer.sql` (플랫폼 전체 리더보드·ego 네트워크·연결 경로 RPC)
32. `supabase/migrations/50_shadow_rating_graph_and_path_fix.sql` (경로 RPC 수정 + 전체 연결 그래프)

### 1-2. 최초 관리자 지정

첫 계정 가입 후 SQL Editor에서 플랫폼 슈퍼관리자를 지정합니다.
(`17_multi_club.sql` 이관 시 기존 `role='admin'` 은 자동으로 `is_platform_admin=true` 로 승격됩니다.)

```sql
update public.profiles set is_platform_admin = true
where id = (select id from auth.users where email = '관리자이메일@example.com');
```

클럽 내 역할(admin / sub_admin / user)은 `club_members.role` 로 관리합니다.
플랫폼 관리 화면(`/platform`)에서 클럽을 생성한 뒤, 각 클럽 URL `#/c/{slug}` 로 진입합니다.

### 1-3. Auth URL 설정

**Authentication → URL Configuration**:

```text
Site URL:
https://asoulmate.github.io/clubs/

Redirect URLs:
https://asoulmate.github.io/clubs/**
http://localhost:5173/**        (로컬 개발용)
```

HashRouter를 사용하므로 이메일 인증·비밀번호 재설정 링크가 `.../clubs/#/update-password` 형태로 리다이렉트된다.
클럽 앱 경로는 `#/c/{slug}/...` 형태이다. (예: `#/c/morning-star`)

### 1-4. 이메일 인증 (선택)

**Authentication → Sign In / Up → Email**에서 `Confirm email`을 끄면 가입 즉시 로그인된다 (소규모 모임 운영 시 편리).

## 2. GitHub 저장소 설정

1. **Settings → Pages → Source**: `GitHub Actions` 선택
2. **Settings → Secrets and variables → Actions → New repository secret**:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://프로젝트ref.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API의 publishable(anon) key |
| `YOUTUBE_API_KEY` | (선택) YouTube Data API v3 키 — 자동/후보 매칭용. HTTP referrer 제한 권장 |

> publishable key는 어차피 빌드 결과물에 공개되는 값이며, 모든 데이터 접근은 RLS로 보호된다.
> **service_role 키는 절대 GitHub에 등록하지 않는다.**
> `YOUTUBE_API_KEY`도 `VITE_`로 빌드에 들어가므로 브라우저에 노출됩니다. Google Cloud에서 API 키 제한(YouTube Data API + referrer)을 걸어주세요.

## 3. 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 자동으로:

1. 의존성 설치 (`npm ci`)
2. TypeScript 검사 + 빌드 (`npm run build`) — 이때 `VITE_BASE_PATH=/clubs/`가 저장소 이름으로 자동 주입됨
3. `dist`를 GitHub Pages에 배포

배포 주소: `https://asoulmate.github.io/clubs/`

## 4. 로컬 개발

```bash
npm install
copy .env.example .env    # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, (선택) VITE_YOUTUBE_API_KEY 입력
npm run dev               # http://localhost:5173
npm run build             # 타입 검사 + 프로덕션 빌드
npm run preview           # 빌드 결과 미리보기
```

## 5. PWA (홈 화면 추가 → 주소창 없는 독립 앱)

`public/` 의 파일이 빌드 결과물 루트로 그대로 복사되어 배포된다.

| 파일 | 역할 |
|---|---|
| `public/manifest.webmanifest` | 앱 이름·아이콘·`display: standalone`. `start_url`/`scope`/아이콘 경로를 모두 상대 경로로 두어 `/clubs/` 같은 하위 경로 배포에서도 그대로 동작한다 |
| `public/sw.js` | 서비스워커. 문서 요청은 네트워크 우선(배포 직후에도 최신 화면), 해시 파일명 자산은 캐시 우선, Supabase 등 외부 요청은 가로채지 않는다 |
| `public/icons/*` | 설치 아이콘 (`192`/`512`, maskable, `apple-touch-icon`, favicon) |

서비스워커는 `src/registerServiceWorker.ts` 에서 **프로덕션 빌드에서만** `import.meta.env.BASE_URL` 기준으로 등록한다. 개발 서버(`npm run dev`)에서는 등록되지 않으므로 캐시 때문에 헷갈릴 일이 없다.

### 5-1. 설치 방법 안내

- **Android/Chrome**: 주소창 메뉴 → `앱 설치` (또는 자동 표시되는 설치 배너)
- **iOS/Safari**: 공유 버튼 → `홈 화면에 추가` (iOS 는 Safari 에서만 가능)

설치 후에는 주소창·탭 없이 실행되고, `@media (display-mode: standalone)` 규칙이 상단 상태바 영역만큼 여백을 확보한다.

### 5-2. 아이콘 변경

`scripts/generate-pwa-icons.mjs` 가 외부 의존성 없이 PNG 를 생성한다. 색상·모양을 바꾼 뒤 재생성하고 결과물을 커밋한다.

```bash
node scripts/generate-pwa-icons.mjs
```

### 5-3. 검증

`npm run build && npm run preview` 후 DevTools → Application 탭에서 확인한다.

- Manifest: 오류 없음, `start_url`/`scope` 가 배포 경로(`/clubs/`)로 해석되는지
- Service Workers: `activated and is running`
- 오프라인 체크 후 새로고침 → 앱 화면이 뜨는지 (데이터는 Supabase 연결이 필요하므로 목록은 비어 보일 수 있다)

## 6. 문제 해결

| 증상 | 원인/해결 |
|---|---|
| 배포 후 JS/CSS 404 | `VITE_BASE_PATH`가 저장소 이름과 다름. 워크플로는 저장소 이름을 자동 사용하므로 fork 후 이름 변경 시 재배포 |
| 새로고침 시 404 | HashRouter(#/...) 주소인지 확인. `#` 없는 주소는 GitHub Pages가 처리하지 못함 |
| 이메일 링크가 localhost로 감 | Supabase Site URL/Redirect URLs에 실제 Pages 주소 등록 |
| "환경변수가 설정되지 않았습니다" | GitHub Secrets 미등록 또는 로컬 `.env` 누락 |
| 실시간 반영 안 됨 | `01_schema.sql`의 `alter publication supabase_realtime ...` 실행 여부 확인 |
| 설치 메뉴가 안 보임 | HTTPS(또는 localhost)인지, `manifest.webmanifest`·`sw.js`가 200으로 내려오는지 확인. iOS 는 Safari 에서만 `홈 화면에 추가` 가능 |
| 홈 화면 앱에 주소창이 보임 | 아이콘을 다시 추가해야 한다. 기존 아이콘은 manifest 적용 이전 설정을 그대로 들고 있다 |
| 배포했는데 옛 화면이 보임 | 문서 요청은 네트워크 우선이라 새로고침으로 갱신된다. 그래도 남으면 Application → Service Workers → `Unregister` 후 새로고침 |
