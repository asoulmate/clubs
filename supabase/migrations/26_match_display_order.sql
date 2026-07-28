-- ============================================================
-- 26_match_display_order.sql
-- 당일 경기 표시 순서(display_order) + 순서 변경 RPC
-- 25 실행 후 추가 실행
-- ============================================================

alter table public.matches
  add column if not exists display_order integer not null default 0;

comment on column public.matches.display_order is
  '같은 클럽·날짜 내 화면 표시 순서 (1부터). 드래그로 변경.';

-- 기존 데이터: 생성 시각 순으로 번호 부여
with ranked as (
  select
    id,
    row_number() over (
      partition by club_id, match_date
      order by created_at asc, id asc
    ) as rn
  from public.matches
)
update public.matches m
set display_order = r.rn
from ranked r
where m.id = r.id;

create index if not exists idx_matches_club_date_order
  on public.matches (club_id, match_date, display_order);

-- ------------------------------------------------------------
-- create_match: 새 경기는 당일 맨 뒤에 배치
-- ------------------------------------------------------------
create or replace function public.create_match(
  p_match_date date,
  p_club_id uuid,
  p_a2 uuid default null,
  p_b1 uuid default null,
  p_b2 uuid default null,
  p_match_type text default null,
  p_is_betting boolean default false,
  p_betting_deadline timestamptz default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_ids uuid[];
  v_type text;
  v_is_betting boolean := coalesce(p_is_betting, false);
  v_day_end timestamptz;
  v_order integer;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if p_match_date is null then
    raise exception '경기 날짜를 선택해주세요.';
  end if;

  v_type := coalesce(
    nullif(trim(coalesce(p_match_type, '')), ''),
    public.get_club_setting(p_club_id, 'default_match_type') #>> '{}',
    'doubles'
  );
  if v_type not in ('singles', 'doubles') then
    raise exception '경기 유형은 단식 또는 복식만 선택할 수 있습니다.';
  end if;
  if v_type = 'singles' and (p_a2 is not null or p_b2 is not null) then
    raise exception '단식 경기는 상대 선수 1명(B팀 1번)만 지정할 수 있습니다.';
  end if;

  if v_is_betting then
    if p_betting_deadline is null then
      raise exception '배팅 경기는 배팅 마감 시간을 입력해야 합니다.';
    end if;
    if p_betting_deadline <= now() then
      raise exception '배팅 마감 시간은 현재 시각 이후로 설정해주세요.';
    end if;
    v_day_end := ((p_match_date + 1)::timestamp at time zone 'Asia/Seoul');
    if p_betting_deadline >= v_day_end then
      raise exception '배팅 마감 시간은 경기 당일을 넘길 수 없습니다.';
    end if;
  end if;

  v_ids := array_remove(array[auth.uid(), p_a2, p_b1, p_b2], null);
  if (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
    raise exception '같은 사용자를 한 경기에 두 번 등록할 수 없습니다.';
  end if;

  select coalesce(max(display_order), 0) + 1
  into v_order
  from public.matches
  where club_id = p_club_id and match_date = p_match_date;

  insert into public.matches (
    match_date, created_by, status, club_id, match_type, is_betting, betting_deadline, display_order
  )
  values (
    p_match_date, auth.uid(), 'open', p_club_id, v_type, v_is_betting,
    case when v_is_betting then p_betting_deadline else null end,
    v_order
  )
  returning id into v_match_id;

  perform public.internal_add_player(v_match_id, auth.uid(), 'A1');
  if p_a2 is not null then perform public.internal_add_player(v_match_id, p_a2, 'A2'); end if;
  if p_b1 is not null then perform public.internal_add_player(v_match_id, p_b1, 'B1'); end if;
  if p_b2 is not null then perform public.internal_add_player(v_match_id, p_b2, 'B2'); end if;

  return v_match_id;
end;
$$;

-- ------------------------------------------------------------
-- 당일 경기 순서 일괄 변경
-- ------------------------------------------------------------
create or replace function public.reorder_matches(
  p_club_id uuid,
  p_match_date date,
  p_ordered_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
  v_expected integer;
  v_i integer;
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if p_match_date is null then
    raise exception '경기 날짜를 선택해주세요.';
  end if;
  if p_ordered_ids is null or cardinality(p_ordered_ids) = 0 then
    raise exception '순서를 변경할 경기가 없습니다.';
  end if;

  -- 중복 id 금지
  if (
    select count(*) from unnest(p_ordered_ids) x
  ) <> (
    select count(distinct x) from unnest(p_ordered_ids) x
  ) then
    raise exception '경기 목록에 중복이 있습니다. 새로고침 후 다시 시도해주세요.';
  end if;

  select count(*) into v_expected
  from public.matches
  where club_id = p_club_id and match_date = p_match_date;

  select count(*) into v_count
  from public.matches m
  where m.club_id = p_club_id
    and m.match_date = p_match_date
    and m.id = any (p_ordered_ids);

  if v_count <> cardinality(p_ordered_ids) or v_count <> v_expected then
    raise exception '경기 목록이 변경되었습니다. 새로고침 후 다시 시도해주세요.';
  end if;

  for v_i in 1 .. cardinality(p_ordered_ids) loop
    update public.matches
    set display_order = v_i, updated_at = now()
    where id = p_ordered_ids[v_i]
      and club_id = p_club_id
      and match_date = p_match_date;
  end loop;
end;
$$;

grant execute on function public.create_match(date, uuid, uuid, uuid, uuid, text, boolean, timestamptz) to authenticated;
grant execute on function public.reorder_matches(uuid, date, uuid[]) to authenticated;
