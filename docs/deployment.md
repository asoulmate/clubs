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

### 1-2. 최초 관리자 지정

첫 계정 가입 후 SQL Editor에서:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = '관리자이메일@example.com');
```

### 1-3. Auth URL 설정

**Authentication → URL Configuration**:

```text
Site URL:
https://사용자명.github.io/저장소명/

Redirect URLs:
https://사용자명.github.io/저장소명/**
http://localhost:5173/**        (로컬 개발용)
```

HashRouter를 사용하므로 이메일 인증·비밀번호 재설정 링크가 `.../저장소명/#/update-password` 형태로 리다이렉트된다.

### 1-4. 이메일 인증 (선택)

**Authentication → Sign In / Up → Email**에서 `Confirm email`을 끄면 가입 즉시 로그인된다 (소규모 모임 운영 시 편리).

## 2. GitHub 저장소 설정

1. **Settings → Pages → Source**: `GitHub Actions` 선택
2. **Settings → Secrets and variables → Actions → New repository secret**:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://프로젝트ref.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API의 publishable(anon) key |

> publishable key는 어차피 빌드 결과물에 공개되는 값이며, 모든 데이터 접근은 RLS로 보호된다.
> **service_role 키는 절대 GitHub에 등록하지 않는다.**

## 3. 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 자동으로:

1. 의존성 설치 (`npm ci`)
2. TypeScript 검사 + 빌드 (`npm run build`) — 이때 `VITE_BASE_PATH=/저장소명/`이 저장소 이름으로 자동 주입됨
3. `dist`를 GitHub Pages에 배포

배포 주소: `https://사용자명.github.io/저장소명/`

## 4. 로컬 개발

```bash
npm install
copy .env.example .env    # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY 입력
npm run dev               # http://localhost:5173
npm run build             # 타입 검사 + 프로덕션 빌드
npm run preview           # 빌드 결과 미리보기
```

## 5. 문제 해결

| 증상 | 원인/해결 |
|---|---|
| 배포 후 JS/CSS 404 | `VITE_BASE_PATH`가 저장소 이름과 다름. 워크플로는 저장소 이름을 자동 사용하므로 fork 후 이름 변경 시 재배포 |
| 새로고침 시 404 | HashRouter(#/...) 주소인지 확인. `#` 없는 주소는 GitHub Pages가 처리하지 못함 |
| 이메일 링크가 localhost로 감 | Supabase Site URL/Redirect URLs에 실제 Pages 주소 등록 |
| "환경변수가 설정되지 않았습니다" | GitHub Secrets 미등록 또는 로컬 `.env` 누락 |
| 실시간 반영 안 됨 | `01_schema.sql`의 `alter publication supabase_realtime ...` 실행 여부 확인 |
