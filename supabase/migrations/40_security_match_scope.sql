-- ============================================================
-- 40_security_match_scope.sql
-- Target-club enforcement for match mutations and NULL-scope stats blocking.
-- Existing signatures and return shapes are preserved.
-- ============================================================

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  if v_match.match_type = 'singles' and p_position in ('A2', 'B2') then
    raise exception '단식 경기는 팀당 한 명만 등록할 수 있습니다.';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found or not v_target.is_active then
    raise exception '등록할 수 있는 active 사용자를 찾을 수 없습니다.';
  end if;
  if not exists (
    select 1 from public.club_members cm
    where cm.club_id = v_match.club_id
      and cm.user_id = p_user_id
      and cm.status = 'active'
  ) then
    raise exception '대상 사용자는 해당 경기 클럽의 active 회원이 아닙니다.';
  end if;

  perform public.assert_not_in_progress(p_user_id, p_match_id);
  begin
    insert into public.match_players (match_id, user_id, position, registered_by)
    values (p_match_id, p_user_id, p_position, auth.uid());
  exception when unique_violation then
    if exists (select 1 from public.match_players where match_id = p_match_id and user_id = p_user_id) then
      raise exception '해당 사용자는 이미 이 경기에 등록되어 있습니다.';
    end if;
    raise exception '이미 다른 사용자가 해당 자리에 등록되었습니다.';
  end;
end;
$$;

create or replace function public.register_player(
  p_match_id uuid,
  p_position public.player_position,
  p_user_id uuid default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_allow_proxy boolean;
begin
  perform public.assert_active_caller();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);

  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 참가자를 등록할 수 없습니다.';
  end if;
  if v_match.status not in ('open', 'ready') and not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '스코어 입력이 시작된 경기는 참가자를 변경할 수 없습니다.';
  end if;

  v_allow_proxy := coalesce(
    (public.get_club_setting(v_match.club_id, 'allow_proxy_registration'))::boolean,
    (public.get_setting('allow_proxy_registration'))::boolean,
    true
  );
  if v_target_id <> auth.uid()
     and not v_allow_proxy
     and not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '다른 사용자를 대신 등록하는 기능이 현재 허용되지 않습니다.';
  end if;
  perform public.internal_add_player(p_match_id, v_target_id, p_position);
end;
$$;

create or replace function public.remove_player(
  p_match_id uuid,
  p_position public.player_position
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player public.match_players;
begin
  perform public.assert_active_caller();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);

  select * into v_player from public.match_players
  where match_id = p_match_id and position = p_position;
  if not found then raise exception '해당 자리에 등록된 참가자가 없습니다.'; end if;

  if not public.is_club_admin_or_sub(v_match.club_id) then
    if v_match.status not in ('open', 'ready') then
      raise exception '스코어 입력이 시작된 경기는 참가자를 변경할 수 없습니다.';
    end if;
    if v_player.user_id <> auth.uid() and v_player.registered_by <> auth.uid() then
      raise exception '본인 또는 본인이 등록한 참가자만 제외할 수 있습니다.';
    end if;
  end if;
  delete from public.match_players where id = v_player.id;
end;
$$;

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
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);
  if not v_match.is_betting then
    raise exception '배팅 경기가 아닌 경기는 시작 절차 없이 바로 스코어를 입력합니다.';
  end if;
  if not public.is_match_participant(p_match_id)
     and not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '경기 참가자만 경기를 시작할 수 있습니다.';
  end if;
  if v_match.status <> 'ready' then
    raise exception '참가자가 모두 편성된 경기만 시작할 수 있습니다.';
  end if;
  for v_player in select user_id from public.match_players where match_id = p_match_id loop
    perform public.assert_not_in_progress(v_player.user_id, p_match_id);
  end loop;
  update public.matches set status = 'in_progress' where id = p_match_id;
end;
$$;

create or replace function public.submit_score(
  p_match_id uuid,
  p_team_a integer,
  p_team_b integer,
  p_expected_version integer
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_is_participant boolean;
  v_my_position public.player_position;
  v_confirm_mode text;
  v_player_count integer;
  v_required integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);

  v_is_participant := public.is_match_participant(p_match_id);
  if not v_is_participant and not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '경기 참가자만 스코어를 입력할 수 있습니다.';
  end if;
  if v_match.status = 'canceled' then raise exception '취소된 경기에는 스코어를 입력할 수 없습니다.'; end if;
  if v_match.status = 'confirmed' then raise exception '확정된 경기는 관리자만 수정할 수 있습니다.'; end if;

  v_required := case when v_match.match_type = 'singles' then 2 else 4 end;
  select count(*) into v_player_count from public.match_players where match_id = p_match_id;
  if v_player_count <> v_required then
    raise exception '참가자 %명이 정확히 등록된 후 스코어를 입력할 수 있습니다.', v_required;
  end if;
  if v_match.version <> p_expected_version then
    raise exception '다른 사용자가 방금 이 경기를 수정했습니다. 새로고침 후 다시 확인해주세요.';
  end if;
  perform public.validate_score(p_team_a, p_team_b);

  v_confirm_mode := coalesce(
    public.get_club_setting(v_match.club_id, 'confirm_mode') #>> '{}',
    public.get_setting('confirm_mode') #>> '{}',
    'double'
  );
  v_before := public.match_snapshot(v_match);
  delete from public.score_confirmations where match_id = p_match_id;
  update public.matches
  set team_a_score = p_team_a, team_b_score = p_team_b,
      score_submitted_by = auth.uid(), score_submitted_at = now(),
      status = 'submitted', confirmed_by = null, confirmed_at = null,
      version = version + 1
  where id = p_match_id;

  if v_is_participant then
    select position into v_my_position from public.match_players
    where match_id = p_match_id and user_id = auth.uid();
    insert into public.score_confirmations (match_id, user_id, team)
    values (p_match_id, auth.uid(), public.position_team(v_my_position));
  end if;
  if v_confirm_mode = 'single' then
    update public.matches
    set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), version = version + 1
    where id = p_match_id;
  end if;
  perform public.log_match_audit(
    p_match_id, 'submit_score', v_before,
    jsonb_build_object('team_a_score', p_team_a, 'team_b_score', p_team_b, 'confirm_mode', v_confirm_mode)
  );
end;
$$;

create or replace function public.confirm_score(p_match_id uuid, p_expected_version integer)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_my_position public.player_position;
  v_submitter_position public.player_position;
  v_before jsonb;
begin
  perform public.assert_active_caller();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);
  if v_match.status <> 'submitted' then raise exception '확정 대기 상태의 경기만 최종 확인할 수 있습니다.'; end if;
  if v_match.version <> p_expected_version then raise exception '다른 사용자가 방금 이 경기를 수정했습니다.'; end if;
  select position into v_my_position from public.match_players
  where match_id = p_match_id and user_id = auth.uid();
  if v_my_position is null then raise exception '경기 참가자만 스코어를 확인할 수 있습니다.'; end if;
  select position into v_submitter_position from public.match_players
  where match_id = p_match_id and user_id = v_match.score_submitted_by;
  if v_submitter_position is not null
     and public.position_team(v_my_position) = public.position_team(v_submitter_position) then
    raise exception '상대 팀 참가자가 스코어를 확인해야 합니다.';
  end if;
  v_before := public.match_snapshot(v_match);
  insert into public.score_confirmations (match_id, user_id, team)
  values (p_match_id, auth.uid(), public.position_team(v_my_position))
  on conflict (match_id, user_id) do nothing;
  update public.matches
  set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), version = version + 1
  where id = p_match_id;
  perform public.log_match_audit(p_match_id, 'confirm_score', v_before,
    jsonb_build_object('confirmed_by', auth.uid()));
end;
$$;

create or replace function public.cancel_match(p_match_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_before jsonb;
begin
  perform public.assert_active_caller();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);
  if v_match.status = 'canceled' then raise exception '이미 취소된 경기입니다.'; end if;
  if not public.is_club_admin_or_sub(v_match.club_id) then
    if v_match.created_by <> auth.uid() then raise exception '경기를 만든 사용자 또는 관리자만 취소할 수 있습니다.'; end if;
    if v_match.status not in ('open', 'ready', 'in_progress') then raise exception '스코어가 입력된 경기는 관리자만 취소할 수 있습니다.'; end if;
  end if;
  v_before := public.match_snapshot(v_match);
  update public.matches set status = 'canceled', version = version + 1 where id = p_match_id;
  perform public.log_match_audit(p_match_id, 'cancel', v_before, null, p_reason);
end;
$$;

create or replace function public.link_match_youtube(
  p_match_id uuid, p_video_id text, p_title text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_video text := trim(p_video_id);
begin
  perform public.assert_active_caller();
  if v_video is null or v_video = '' then raise exception '유튜브 영상 ID를 입력해주세요.'; end if;
  v_video := regexp_replace(v_video, '^.*(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{6,}).*$', '\1');
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);
  if v_match.status = 'canceled' then raise exception '취소된 경기에는 영상을 연결할 수 없습니다.'; end if;
  if exists (select 1 from public.matches where youtube_video_id = v_video and id <> p_match_id) then
    raise exception '이미 다른 경기에 연결된 영상입니다.';
  end if;
  update public.matches
  set youtube_video_id = v_video, youtube_title = nullif(trim(p_title), ''),
      youtube_matched_at = now(), version = version + 1
  where id = p_match_id;
end;
$$;

create or replace function public.unlink_match_youtube(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_match public.matches;
begin
  perform public.assert_active_caller();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception '경기를 찾을 수 없습니다.'; end if;
  perform public.assert_club_member(v_match.club_id);
  update public.matches
  set youtube_video_id = null, youtube_title = null, youtube_matched_at = null, version = version + 1
  where id = p_match_id;
end;
$$;

-- Keep signatures but remove the historical NULL-club global fallback.
create or replace function public.get_player_monthly_trend(
  p_user_id uuid, p_months integer default 12, p_club_id uuid default null
)
returns table (month text, matches_played bigint, wins bigint, losses bigint, days_participated bigint)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_club_id is null then raise exception '클럽을 지정해야 합니다.'; end if;
  perform public.assert_club_member(p_club_id);
  return query
  select to_char(m.match_date, 'YYYY-MM'), count(*),
    count(*) filter (where case when public.position_team(mp.position) = 'A'
      then m.team_a_score > m.team_b_score else m.team_b_score > m.team_a_score end),
    count(*) filter (where case when public.position_team(mp.position) = 'A'
      then m.team_a_score < m.team_b_score else m.team_b_score < m.team_a_score end),
    count(distinct m.match_date)
  from public.match_players mp
  join public.matches m on m.id = mp.match_id and m.status = 'confirmed'
  where mp.user_id = p_user_id and m.club_id = p_club_id
    and m.match_date >= (current_date - make_interval(months => p_months))::date
  group by to_char(m.match_date, 'YYYY-MM') order by 1;
end;
$$;

create or replace function public.get_player_recent_matches(
  p_user_id uuid, p_limit integer default 10, p_club_id uuid default null
)
returns table (
  match_id uuid, match_date date, my_team public.team_side,
  team_a_score integer, team_b_score integer, result text,
  partner_names text[], partner_awards public.award_level[],
  opponent_names text[], opponent_awards public.award_level[]
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_club_id is null then raise exception '클럽을 지정해야 합니다.'; end if;
  perform public.assert_club_member(p_club_id);
  return query
  select m.id, m.match_date, public.position_team(me.position), m.team_a_score, m.team_b_score,
    case when m.team_a_score = m.team_b_score then 'tie'
      when (public.position_team(me.position) = 'A') = (m.team_a_score > m.team_b_score) then 'win'
      else 'loss' end,
    (select coalesce(array_agg(pr.name order by pr.name), '{}') from public.match_players t
      join public.profiles pr on pr.id = t.user_id where t.match_id = m.id and t.user_id <> me.user_id
      and public.position_team(t.position) = public.position_team(me.position)),
    (select coalesce(array_agg(pr.award_level order by pr.name), '{}') from public.match_players t
      join public.profiles pr on pr.id = t.user_id where t.match_id = m.id and t.user_id <> me.user_id
      and public.position_team(t.position) = public.position_team(me.position)),
    (select coalesce(array_agg(pr.name order by pr.name), '{}') from public.match_players t
      join public.profiles pr on pr.id = t.user_id where t.match_id = m.id
      and public.position_team(t.position) <> public.position_team(me.position)),
    (select coalesce(array_agg(pr.award_level order by pr.name), '{}') from public.match_players t
      join public.profiles pr on pr.id = t.user_id where t.match_id = m.id
      and public.position_team(t.position) <> public.position_team(me.position))
  from public.match_players me
  join public.matches m on m.id = me.match_id and m.status = 'confirmed'
  where me.user_id = p_user_id and m.club_id = p_club_id
  order by m.match_date desc, m.created_at desc limit p_limit;
end;
$$;

revoke execute on function public.internal_add_player(uuid, uuid, public.player_position) from public, anon, authenticated;

commit;
