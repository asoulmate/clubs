-- ============================================================
-- 34_tournament_entries.sql
-- 회원별 대회 참가 현황 (연-월, 대회명, 입상, 규모, 비고)
-- 클럽 단위 조회·필터(월별/입상/최대인원)를 위한 인덱스 포함
-- ============================================================

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 대회일: 해당 월 1일로 저장 (YYYY-MM-01)
  tournament_month date not null,
  tournament_name text not null,
  -- champion=우승, runner_up=준우승, third=3위, none=비입상
  placement text not null
    check (placement in ('champion', 'runner_up', 'third', 'none')),
  -- 대회 규모(최대 참가 인원). 조회 필터용, 선택
  max_participants integer
    check (max_participants is null or max_participants between 1 and 100000),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_tournament_entries_month_day
    check (extract(day from tournament_month) = 1),
  constraint chk_tournament_entries_name_len
    check (char_length(trim(tournament_name)) between 1 and 120),
  constraint chk_tournament_entries_notes_len
    check (notes is null or char_length(notes) <= 500)
);

comment on table public.tournament_entries is
  '회원별 외부 대회 참가 기록. tournament_month는 연-월(해당 월 1일).';
comment on column public.tournament_entries.max_participants is
  '대회 최대 참가 인원(선택). 규모별 필터링용.';

create index if not exists idx_tournament_entries_club_month
  on public.tournament_entries (club_id, tournament_month desc);

create index if not exists idx_tournament_entries_club_user_month
  on public.tournament_entries (club_id, user_id, tournament_month desc);

create index if not exists idx_tournament_entries_club_placement
  on public.tournament_entries (club_id, placement);

create index if not exists idx_tournament_entries_club_max_participants
  on public.tournament_entries (club_id, max_participants)
  where max_participants is not null;

alter table public.tournament_entries enable row level security;

drop policy if exists "tournament_entries_select" on public.tournament_entries;
create policy "tournament_entries_select"
  on public.tournament_entries for select to authenticated
  using (
    public.is_platform_admin()
    or public.is_active_club_member(club_id)
  );

drop policy if exists "tournament_entries_insert" on public.tournament_entries;
create policy "tournament_entries_insert"
  on public.tournament_entries for insert to authenticated
  with check (
    public.is_active_club_member(club_id)
    and (
      user_id = auth.uid()
      or public.is_club_admin_or_sub(club_id)
      or public.is_platform_admin()
    )
  );

drop policy if exists "tournament_entries_update" on public.tournament_entries;
create policy "tournament_entries_update"
  on public.tournament_entries for update to authenticated
  using (
    public.is_active_club_member(club_id)
    and (
      user_id = auth.uid()
      or public.is_club_admin_or_sub(club_id)
      or public.is_platform_admin()
    )
  )
  with check (
    public.is_active_club_member(club_id)
    and (
      user_id = auth.uid()
      or public.is_club_admin_or_sub(club_id)
      or public.is_platform_admin()
    )
  );

drop policy if exists "tournament_entries_delete" on public.tournament_entries;
create policy "tournament_entries_delete"
  on public.tournament_entries for delete to authenticated
  using (
    public.is_active_club_member(club_id)
    and (
      user_id = auth.uid()
      or public.is_club_admin_or_sub(club_id)
      or public.is_platform_admin()
    )
  );

-- 월별 참가·입상 요약 (관리자 현황용)
create or replace function public.get_tournament_monthly_summary(
  p_club_id uuid,
  p_from date default null,
  p_to date default null,
  p_max_participants_lte integer default null
)
returns table (
  month text,
  entries_count bigint,
  unique_players bigint,
  champions bigint,
  runner_ups bigint,
  thirds bigint,
  non_awards bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_char(te.tournament_month, 'YYYY-MM') as month,
    count(*)::bigint as entries_count,
    count(distinct te.user_id)::bigint as unique_players,
    count(*) filter (where te.placement = 'champion')::bigint as champions,
    count(*) filter (where te.placement = 'runner_up')::bigint as runner_ups,
    count(*) filter (where te.placement = 'third')::bigint as thirds,
    count(*) filter (where te.placement = 'none')::bigint as non_awards
  from public.tournament_entries te
  where te.club_id = p_club_id
    and (p_from is null or te.tournament_month >= date_trunc('month', p_from)::date)
    and (p_to is null or te.tournament_month <= date_trunc('month', p_to)::date)
    and (
      p_max_participants_lte is null
      or (
        te.max_participants is not null
        and te.max_participants <= p_max_participants_lte
      )
    )
    and (
      public.is_platform_admin()
      or public.is_active_club_member(p_club_id)
    )
  group by te.tournament_month
  order by te.tournament_month desc;
$$;

revoke all on function public.get_tournament_monthly_summary(uuid, date, date, integer) from public;
grant execute on function public.get_tournament_monthly_summary(uuid, date, date, integer) to authenticated;
