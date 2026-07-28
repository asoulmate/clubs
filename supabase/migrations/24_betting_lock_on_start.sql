-- ============================================================
-- 24_betting_lock_on_start.sql
-- 배팅 마감 전이라도 경기 중(in_progress)이거나 스코어가 입력되면
-- 배팅 등록·변경·취소 불가
-- 23 실행 후 추가 실행
-- ============================================================

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

  if not v_match.is_betting then
    raise exception '배팅 경기로 개설된 경기에만 배팅할 수 있습니다.';
  end if;
  if v_match.status in ('confirmed', 'canceled') then
    raise exception '확정되었거나 취소된 경기에는 배팅할 수 없습니다.';
  end if;
  -- 경기 시작·스코어 입력 후에는 마감 전이라도 변경 불가
  if v_match.status in ('in_progress', 'submitted')
     or v_match.team_a_score is not null
     or v_match.team_b_score is not null then
    raise exception '경기가 시작되었거나 스코어가 입력되어 배팅을 변경할 수 없습니다.';
  end if;
  if v_match.betting_deadline is not null and now() > v_match.betting_deadline then
    raise exception '배팅이 마감되었습니다.';
  end if;

  if p_amount not in (500, 1000) then
    raise exception '배팅 금액은 500원 또는 1000원만 가능합니다.';
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
  if v_match.status in ('in_progress', 'submitted')
     or v_match.team_a_score is not null
     or v_match.team_b_score is not null then
    raise exception '경기가 시작되었거나 스코어가 입력되어 배팅을 취소할 수 없습니다.';
  end if;
  if v_match.betting_deadline is not null and now() > v_match.betting_deadline then
    raise exception '배팅 마감 후에는 배팅을 취소할 수 없습니다.';
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

grant execute on function public.place_match_bet(uuid, integer, public.team_side) to authenticated;
grant execute on function public.cancel_match_bet(uuid) to authenticated;
