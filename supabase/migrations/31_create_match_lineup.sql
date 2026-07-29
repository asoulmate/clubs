-- ============================================================
-- 31_create_match_lineup.sql
-- 추첨 편성: A1~B2를 지정해 복식 경기 생성 (생성자가 선수가 아니어도 됨)
-- ============================================================

create or replace function public.create_match_lineup(
  p_match_date date,
  p_club_id uuid,
  p_a1 uuid,
  p_a2 uuid,
  p_b1 uuid,
  p_b2 uuid,
  p_match_type text default 'doubles'
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_ids uuid[];
  v_type text := coalesce(nullif(trim(p_match_type), ''), 'doubles');
begin
  perform public.assert_active_caller();
  perform public.assert_club_member(p_club_id);

  if p_match_date is null then
    raise exception '경기 날짜를 선택해주세요.';
  end if;
  if v_type <> 'doubles' then
    raise exception '추첨 편성은 복식만 지원합니다.';
  end if;
  if p_a1 is null or p_a2 is null or p_b1 is null or p_b2 is null then
    raise exception '네 명의 선수를 모두 지정해주세요.';
  end if;

  v_ids := array[p_a1, p_a2, p_b1, p_b2];
  if (select count(distinct x) from unnest(v_ids) x) <> 4 then
    raise exception '같은 사용자를 한 경기에 두 번 등록할 수 없습니다.';
  end if;

  -- 전원 클럽 활성 멤버
  if (
    select count(*) from public.club_members cm
    where cm.club_id = p_club_id
      and cm.user_id = any (v_ids)
      and cm.status = 'active'
  ) <> 4 then
    raise exception '추첨에 포함된 선수 모두 이 클럽의 활성 멤버여야 합니다.';
  end if;

  insert into public.matches (match_date, created_by, status, club_id, match_type, is_betting)
  values (p_match_date, auth.uid(), 'open', p_club_id, 'doubles', false)
  returning id into v_match_id;

  perform public.internal_add_player(v_match_id, p_a1, 'A1');
  perform public.internal_add_player(v_match_id, p_a2, 'A2');
  perform public.internal_add_player(v_match_id, p_b1, 'B1');
  perform public.internal_add_player(v_match_id, p_b2, 'B2');

  return v_match_id;
end;
$$;

grant execute on function public.create_match_lineup(date, uuid, uuid, uuid, uuid, uuid, text)
  to authenticated;
