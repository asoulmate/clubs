# 🎾 모닝스타 테니스 — 복식 경기 결과 관리

테니스 모임의 2대2 복식 경기 개설, 참가자 편성, 스코어 입력·확정, 실시간 공유, 기간별 집계와 개인 통계를 관리하는 웹 애플리케이션입니다.

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS (정적 SPA)
- **Backend**: Supabase (PostgreSQL + Auth + Realtime + RLS + RPC)
- **호스팅**: GitHub Pages (GitHub Actions 자동 배포)
- **라우팅**: HashRouter (GitHub Pages 새로고침 404 문제 회피)
- **설치**: PWA — 홈 화면에 추가하면 주소창 없는 독립 앱으로 실행 (`docs/deployment.md` 6장)

## 프로젝트 구조

```text
├─ .github/workflows/deploy.yml   # GitHub Pages 자동 배포
├─ supabase/migrations/           # DB 스키마·함수·RLS·시드 SQL (01→04 순서 실행)
├─ docs/                          # 설계 문서·테스트 체크리스트·배포 가이드
├─ scripts/                       # 점검 스크립트 + PWA 아이콘 생성기
├─ public/                        # PWA manifest·서비스워커·아이콘 (그대로 배포됨)
└─ src/
   ├─ lib/                        # Supabase 클라이언트
   ├─ types/                      # 도메인 타입 정의
   ├─ constants/                  # 한글 라벨 매핑
   ├─ utils/                      # 한국시간·기간·순위·스코어·오류·권한 유틸
   ├─ services/                   # 데이터 접근 계층 (auth/match/stats/admin/settings)
   ├─ stores/                     # Zustand 전역 상태 (auth/settings/toast)
   ├─ hooks/                      # useMatchesByDate(Realtime)·useDebounce 등
   ├─ components/                 # layout/common/match/players/stats/admin
   └─ pages/                      # 라우트 페이지
```

## 시작하기

### 1. Supabase 프로젝트 설정

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. **SQL Editor**에서 아래 파일을 순서대로 실행합니다.
   1. `supabase/migrations/01_schema.sql` — Enum·테이블·인덱스·Realtime 발행
   2. `supabase/migrations/02_functions.sql` — 트리거·RPC 함수
   3. `supabase/migrations/03_rls.sql` — RLS 정책
   4. `supabase/migrations/04_seed.sql` — 운영 설정 기본값
   5. `supabase/migrations/05_updates.sql` — 경기 삭제 RPC, 월별 추이 참가일
3. 첫 계정 가입 후, SQL Editor에서 관리자로 지정합니다.

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = '관리자이메일@example.com');
   ```

4. **Authentication → URL Configuration**에 배포 주소를 등록합니다.
   - Site URL: `https://사용자명.github.io/저장소명/`
   - Redirect URLs: `https://사용자명.github.io/저장소명/**` (로컬 개발용 `http://localhost:5173/**` 추가)

### 2. 로컬 개발

```bash
npm install
copy .env.example .env      # 값 채우기 (macOS/Linux는 cp)
npm run dev
```

`.env`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
```

### 3. GitHub Pages 배포

1. 저장소 **Settings → Pages → Source**를 `GitHub Actions`로 설정합니다.
2. **Settings → Secrets and variables → Actions**에 등록:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
3. `main` 브랜치에 push하면 자동으로 타입 검사 → 빌드 → 배포됩니다.

자세한 내용은 [docs/deployment.md](docs/deployment.md)를 참고하세요.

## 보안 설계 요약

- 프런트엔드에는 publishable(anon) key만 포함되며, **service_role 키는 절대 사용하지 않습니다.**
- 모든 쓰기 작업(경기 생성·참가자 등록·스코어 제출/확정·관리자 작업)은 **SECURITY DEFINER RPC 함수**로만 수행되고, 테이블 직접 쓰기는 RLS로 차단됩니다.
- 역할 검사는 클라이언트 값이 아닌 DB에 저장된 실제 역할(`get_my_role()`)로 판단합니다.
- 동시 수정은 `version` 낙관적 잠금, 동시 슬롯 등록은 UNIQUE 제약으로 차단됩니다.
- 확정 스코어의 관리자 수정은 사유 입력이 필수이며 감사 로그(`match_audit_logs`)에 기록됩니다.

## 문서

- [시스템 구조 및 설계](docs/architecture.md)
- [화면 와이어프레임](docs/wireframes.md)
- [테스트 체크리스트](docs/test-checklist.md)
- [배포 가이드](docs/deployment.md)
