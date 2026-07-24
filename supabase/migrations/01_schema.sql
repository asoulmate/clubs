-- ============================================================
-- 01_schema.sql
-- 테니스 경기 결과 관리 - Enum, 테이블, 제약조건, 인덱스
-- Supabase SQL Editor에서 01 → 02 → 03 → 04 순서로 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- Enum 정의
-- ------------------------------------------------------------

-- 사용자 역할: 일반 사용자 / 서브 관리자 / 관리자
create type public.user_role as enum ('user', 'sub_admin', 'admin');

-- 입상 구분: 오픈부 / 전국신인부 / 지역신인부 / 비입상
create type public.award_level as enum ('open', 'national_rookie', 'local_rookie', 'none');

-- 경기 상태
create type public.match_status as enum ('open', 'ready', 'in_progress', 'submitted', 'confirmed', 'canceled');

-- 참가자 포지션 (A팀 1·2번, B팀 1·2번)
create type public.player_position as enum ('A1', 'A2', 'B1', 'B2');

-- 팀 구분
create type public.team_side as enum ('A', 'B');

-- ------------------------------------------------------------
-- profiles: 사용자 프로필 및 역할
-- ------------------------------------------------------------
-- id 는 일반 회원의 경우 auth.users.id 와 동일.
-- 게스트(is_guest=true)는 auth 계정 없이 profiles 에만 존재하므로 auth.users FK 를 두지 않는다.
create table public.profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 30),
  award_level public.award_level not null default 'none',
  role        public.user_role not null default 'user',
  is_active   boolean not null default true,
  is_guest    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is '사용자 프로필. 역할(role)은 클라이언트가 직접 수정할 수 없으며 관리자 RPC로만 변경 가능. 게스트는 is_guest=true.';
comment on column public.profiles.is_guest is 'true면 비밀번호 미설정 게스트. 이후 동명 회원가입 시 실계정으로 연동됨.';

-- ------------------------------------------------------------
-- matches: 경기 기본 정보와 스코어
-- ------------------------------------------------------------
create table public.matches (
  id                 uuid primary key default gen_random_uuid(),
  match_date         date not null,
  created_by         uuid not null references public.profiles (id),
  status             public.match_status not null default 'open',
  team_a_score       integer check (team_a_score >= 0),
  team_b_score       integer check (team_b_score >= 0),
  score_submitted_by uuid references public.profiles (id),
  score_submitted_at timestamptz,
  confirmed_by       uuid references public.profiles (id),
  confirmed_at       timestamptz,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 확정된 경기는 반드시 양 팀 점수가 존재해야 함
  constraint confirmed_needs_scores
    check (status <> 'confirmed' or (team_a_score is not null and team_b_score is not null))
);

comment on table public.matches is '2대2 복식 경기. 쓰기는 전부 RPC 함수를 통해서만 수행 (RLS로 직접 쓰기 차단).';
comment on column public.matches.version is '낙관적 잠금용 버전. 동시 수정 충돌 감지에 사용.';

-- ------------------------------------------------------------
-- match_players: 경기별 참가자 편성
-- ------------------------------------------------------------
create table public.match_players (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches (id) on delete cascade,
  user_id       uuid not null references public.profiles (id),
  position      public.player_position not null,
  registered_by uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  -- 한 경기에서 같은 포지션 중복 금지 (동시 슬롯 등록 충돌도 이 제약으로 차단)
  constraint uq_match_position unique (match_id, position),
  -- 한 경기에 같은 사용자 중복 등록 금지
  constraint uq_match_user unique (match_id, user_id)
);

comment on table public.match_players is '경기 참가자 편성. UNIQUE 제약으로 동시 등록 충돌을 DB 차원에서 차단.';

-- ------------------------------------------------------------
-- score_confirmations: 스코어 확인 정보 (양측 확정 절차)
-- ------------------------------------------------------------
create table public.score_confirmations (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  team         public.team_side not null,
  confirmed_at timestamptz not null default now(),
  constraint uq_confirmation_user unique (match_id, user_id)
);

-- ------------------------------------------------------------
-- match_audit_logs: 경기 및 스코어 수정 이력 (감사 로그)
-- ------------------------------------------------------------
create table public.match_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  action_type text not null,
  before_data jsonb,
  after_data  jsonb,
  changed_by  uuid not null references public.profiles (id),
  changed_at  timestamptz not null default now(),
  reason      text
);

comment on table public.match_audit_logs is '확정 스코어 수정, 초기화, 취소 등 주요 변경 이력. 관리자만 조회 가능.';

-- ------------------------------------------------------------
-- app_settings: 운영 설정값 (key-value)
-- ------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);

comment on table public.app_settings is '운영 설정. confirm_mode, allow_tie, score_max, min_matches_for_ranking, allow_proxy_registration, require_signup_approval 등.';

-- ------------------------------------------------------------
-- 인덱스
-- ------------------------------------------------------------

-- 날짜 단위 경기 목록 조회
create index idx_matches_date on public.matches (match_date);
-- 상태별 조회 (집계는 confirmed만 사용)
create index idx_matches_status_date on public.matches (status, match_date);
-- 참가자 기준 조회 (개인 통계)
create index idx_match_players_user on public.match_players (user_id);
create index idx_match_players_match on public.match_players (match_id);
-- 감사 로그 조회
create index idx_audit_logs_match on public.match_audit_logs (match_id);
create index idx_audit_logs_changed_at on public.match_audit_logs (changed_at desc);
-- 이름 부분 검색 (자동완성)
create index idx_profiles_name on public.profiles (name text_pattern_ops);
-- 게스트 동명 연동용
create index idx_profiles_guest_name on public.profiles (lower(trim(name))) where is_guest = true;

-- ------------------------------------------------------------
-- updated_at 자동 갱신 트리거
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_matches_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Realtime: 변경 이벤트 발행 대상 등록
-- (delete 이벤트에서도 전체 행 정보를 받기 위해 replica identity full 설정)
-- ------------------------------------------------------------
alter table public.matches replica identity full;
alter table public.match_players replica identity full;

alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_players;
