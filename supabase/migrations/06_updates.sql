-- ============================================================
-- 06_updates.sql
-- 경기 중(in_progress)인 선수는 다른 경기에 등록할 수 없도록 차단
-- (사전 편성 open/ready 는 허용, 진행 중인 경기만 차단)
-- 01~05 실행 후 추가로 실행하세요.
-- ============================================================

-- 사용자가 현재 진행 중인 다른 경기에 참가 중인지 검사
create or replace function public.assert_not_in_progress(
  p_user_id uuid,
  p_except_match_id uuid default null
)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if exists (
    select 1
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = p_user_id
      and m.status = 'in_progress'
      and (p_except_match_id is null or m.id <> p_except_match_id)
  ) then
    select name into v_name from public.profiles where id = p_user_id;
    raise exception '% 님은 현재 다른 경기를 진행 중이라 등록할 수 없습니다.', coalesce(v_name, '해당 사용자');
  end if;
end;
$$;

-- 참가자 등록 공통 함수에 경기 중 중복 참가 검증 추가
create or replace function public.internal_add_player(
  p_match_id uuid,
  p_user_id uuid,
  p_position public.player_position
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target public.profiles;
begin
  select * into v_target from public.profiles where id = p_user_id;

  if not found then
    raise exception '회원가입된 사용자만 경기에 등록할 수 있습니다.';
  end if;
  if not v_target.is_active then
    raise exception '비활성화된 사용자는 경기에 등록할 수 없습니다.';
  end if;

  -- 다른 경기가 진행 중이면 신규 편성 불가 (사전 편성용 open/ready 경기는 허용)
  perform public.assert_not_in_progress(p_user_id, p_match_id);

  begin
    insert into public.match_players (match_id, user_id, position, registered_by)
    values (p_match_id, p_user_id, p_position, auth.uid());
  exception
    when unique_violation then
      if exists (select 1 from public.match_players where match_id = p_match_id and user_id = p_user_id) then
        raise exception '해당 사용자는 이미 이 경기에 등록되어 있습니다.';
      else
        raise exception '이미 다른 사용자가 해당 자리에 등록되었습니다.';
      end if;
  end;
end;
$$;

-- 경기 시작 시에도, 참가자 중 누군가가 이미 다른 경기를 진행 중이면 차단
create or replace function public.start_match(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player record;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if not public.is_match_participant(p_match_id) and not public.is_admin_or_sub() then
    raise exception '경기 참가자만 경기를 시작할 수 있습니다.';
  end if;
  if v_match.status <> 'ready' then
    raise exception '참가자 4명이 모두 편성된 경기만 시작할 수 있습니다.';
  end if;

  for v_player in
    select user_id from public.match_players where match_id = p_match_id
  loop
    perform public.assert_not_in_progress(v_player.user_id, p_match_id);
  end loop;

  update public.matches set status = 'in_progress' where id = p_match_id;
end;
$$;
