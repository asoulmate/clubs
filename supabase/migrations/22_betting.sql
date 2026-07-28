-- ============================================================
-- 22_betting.sql
-- 경기별 승패 배팅 (500 / 1000 / 2000원, A팀·B팀 예측)
-- 가상 기록용. 실결제 없음. 확정 시 적중/미적중 정산.
-- ============================================================

create table if not exists public.match_bets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount in (500, 1000, 2000)),
  predicted_team public.team_side not null,
  -- win=적중, loss=미적중, push=무승부·취소 등 무효, null=미정산
  result text check (result is null or result in ('win', 'loss', 'push')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_match_bets_match_user unique (match_id, user_id)
);

create index if not exists idx_match_bets_match on public.match_bets (match_id);
create index if not exists idx_match_bets_user_club on public.match_bets (club_id, user_id);
create index if not exists idx_match_bets_user_result on public.match_bets (user_id, result);

comment on table public.match_bets is '경기 승패 배팅. amount는 500/1000/2000. 확정 시 result 정산.';

alter table public.match_bets enable row level security;

drop policy if exists "match_bets_select" on public.match_bets;
create policy "match_bets_select" on public.match_bets for select to authenticated
using (
  public.is_platform_admin()
  or public.is_active_club_member(club_id)
);

-- ------------------------------------------------------------
-- 정산
-- ------------------------------------------------------------
create or replace function public.settle_match_bets(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_winner public.team_side;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then return; end if;

  if v_match.status = 'canceled' then
    update public.match_bets
    set result = 'push', settled_at = now(), updated_at = now()
    where match_id = p_match_id and result is null;
    return;
  end if;

  if v_match.status <> 'confirmed'
     or v_match.team_a_score is null
     or v_match.team_b_score is null then
    return;
  end if;

  if v_match.team_a_score = v_match.team_b_score then
    update public.match_bets
    set result = 'push', settled_at = now(), updated_at = now()
    where match_id = p_match_id;
    return;
  end if;

  v_winner := case
    when v_match.team_a_score > v_match.team_b_score then 'A'::public.team_side
    else 'B'::public.team_side
  end;

  update public.match_bets
  set
    result = case when predicted_team = v_winner then 'win' else 'loss' end,
    settled_at = now(),
    updated_at = now()
  where match_id = p_match_id;
end;
$$;

create or replace function public.trg_match_bets_settle()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
      perform public.settle_match_bets(new.id);
    elsif new.status = 'canceled' and old.status is distinct from 'canceled' then
      perform public.settle_match_bets(new.id);
    elsif old.status = 'confirmed'
      and new.status is distinct from 'confirmed'
      and new.status <> 'canceled' then
      -- 관리자 초기화 등: 정산 해제
      update public.match_bets
      set result = null, settled_at = null, updated_at = now()
      where match_id = new.id;
    elsif new.status = 'confirmed'
      and (
        new.team_a_score is distinct from old.team_a_score
        or new.team_b_score is distinct from old.team_b_score
      ) then
      perform public.settle_match_bets(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_match_bets_settle on public.matches;
create trigger trg_match_bets_settle
  after update of status, team_a_score, team_b_score on public.matches
  for each row execute function public.trg_match_bets_settle();

-- ------------------------------------------------------------
-- 배팅 등록/변경 (확정·취소 전)
-- ------------------------------------------------------------
create or replace function public.place_match_bet(
  p_match_id uuid,
  p_amount integer,
  p_predicted_team public.team_side
)
returns public.match_bets
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_row public.match_bets;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  perform public.assert_club_member(v_match.club_id);

  if v_match.status in ('confirmed', 'canceled') then
    raise exception '확정되었거나 취소된 경기에는 배팅할 수 없습니다.';
  end if;

  if p_amount not in (500, 1000, 2000) then
    raise exception '배팅 금액은 500원, 1000원, 2000원만 가능합니다.';
  end if;

  if p_predicted_team not in ('A', 'B') then
    raise exception '승리 팀을 A 또는 B로 선택해주세요.';
  end if;

  select * into v_row from public.match_bets
  where match_id = p_match_id and user_id = auth.uid();

  if found then
    if v_row.result is not null then
      raise exception '이미 정산된 배팅은 변경할 수 없습니다.';
    end if;
    update public.match_bets
    set amount = p_amount,
        predicted_team = p_predicted_team,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.match_bets (match_id, club_id, user_id, amount, predicted_team)
    values (p_match_id, v_match.club_id, auth.uid(), p_amount, p_predicted_team)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.cancel_match_bet(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_row public.match_bets;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  perform public.assert_club_member(v_match.club_id);

  if v_match.status in ('confirmed', 'canceled') then
    raise exception '확정되었거나 취소된 경기의 배팅은 취소할 수 없습니다.';
  end if;

  select * into v_row from public.match_bets
  where match_id = p_match_id and user_id = auth.uid();

  if not found then
    raise exception '배팅 내역이 없습니다.';
  end if;
  if v_row.result is not null then
    raise exception '이미 정산된 배팅은 취소할 수 없습니다.';
  end if;

  delete from public.match_bets where id = v_row.id;
end;
$$;

-- 내 기록용 집계
create or replace function public.get_player_bet_stats(
  p_user_id uuid,
  p_club_id uuid
)
returns table (
  bets_total bigint,
  bets_won bigint,
  bets_lost bigint,
  bets_push bigint,
  bets_open bigint,
  amount_won bigint,
  amount_lost bigint,
  amount_total bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where b.result = 'win')::bigint,
    count(*) filter (where b.result = 'loss')::bigint,
    count(*) filter (where b.result = 'push')::bigint,
    count(*) filter (where b.result is null)::bigint,
    coalesce(sum(b.amount) filter (where b.result = 'win'), 0)::bigint,
    coalesce(sum(b.amount) filter (where b.result = 'loss'), 0)::bigint,
    coalesce(sum(b.amount), 0)::bigint
  from public.match_bets b
  where b.user_id = p_user_id
    and b.club_id = p_club_id
    and auth.uid() is not null
    and (public.is_platform_admin() or public.is_active_club_member(p_club_id));
$$;

-- 최근 배팅 목록 (내 기록)
create or replace function public.get_player_recent_bets(
  p_user_id uuid,
  p_club_id uuid,
  p_limit integer default 20
)
returns table (
  bet_id uuid,
  match_id uuid,
  match_date date,
  amount integer,
  predicted_team public.team_side,
  result text,
  team_a_score integer,
  team_b_score integer,
  created_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select
    b.id,
    b.match_id,
    m.match_date,
    b.amount,
    b.predicted_team,
    b.result,
    m.team_a_score,
    m.team_b_score,
    b.created_at
  from public.match_bets b
  join public.matches m on m.id = b.match_id
  where b.user_id = p_user_id
    and b.club_id = p_club_id
    and auth.uid() is not null
    and (public.is_platform_admin() or public.is_active_club_member(p_club_id))
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.place_match_bet(uuid, integer, public.team_side) to authenticated;
grant execute on function public.cancel_match_bet(uuid) to authenticated;
grant execute on function public.get_player_bet_stats(uuid, uuid) to authenticated;
grant execute on function public.get_player_recent_bets(uuid, uuid, integer) to authenticated;
grant execute on function public.settle_match_bets(uuid) to authenticated;
