-- ============================================================
-- 48_tie_default_and_ranking_mode.sql
-- 1) 동점(무승부) 기본 허용 — app/club 설정 true
-- 2) validate_score: 클럽 설정 우선 (선택 club_id)
-- 3) 순위 집계 방식 설정 ranking_mode 추가
-- ============================================================

-- 동점 허용 기본값 ON
update public.app_settings
set value = 'true'::jsonb,
    description = '동점(무승부) 허용 여부'
where key = 'allow_tie';

update public.club_settings
set value = 'true'::jsonb,
    description = '동점 허용'
where key = 'allow_tie';

insert into public.app_settings (key, value, description)
values (
  'ranking_mode',
  '"wins"',
  '순위 집계: wins(승수→승률→득실) | win_rate(승률→승수→득실) | points(승점3·1·0→득실→승수)'
)
on conflict (key) do nothing;

insert into public.club_settings (club_id, key, value, description)
select c.id, 'ranking_mode', '"wins"', '순위 집계 방식'
from public.clubs c
where not exists (
  select 1 from public.club_settings cs
  where cs.club_id = c.id and cs.key = 'ranking_mode'
);

-- 스코어 검증: 클럽 설정 우선, 없으면 전역, 최종 기본은 동점 허용
-- (인자 추가이므로 기존 2-인자 함수를 교체)
drop function if exists public.validate_score(integer, integer);

create or replace function public.validate_score(
  p_team_a integer,
  p_team_b integer,
  p_club_id uuid default null
)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_max integer;
  v_allow_tie boolean;
begin
  if p_club_id is not null then
    begin
      v_max := (public.get_club_setting(p_club_id, 'score_max'))::integer;
    exception when others then
      v_max := null;
    end;
    begin
      v_allow_tie := (public.get_club_setting(p_club_id, 'allow_tie'))::boolean;
    exception when others then
      v_allow_tie := null;
    end;
  end if;

  v_max := coalesce(v_max, (public.get_setting('score_max'))::integer, 99);
  v_allow_tie := coalesce(v_allow_tie, (public.get_setting('allow_tie'))::boolean, true);

  if p_team_a is null or p_team_b is null then
    raise exception '양 팀의 점수를 모두 입력해주세요.';
  end if;
  if p_team_a < 0 or p_team_b < 0 then
    raise exception '점수는 0 이상이어야 합니다.';
  end if;
  if p_team_a > v_max or p_team_b > v_max then
    raise exception '점수는 최대 %점까지 입력할 수 있습니다.', v_max;
  end if;
  if p_team_a = p_team_b and not v_allow_tie then
    raise exception '동점은 허용되지 않습니다. 승부가 결정된 후 입력해주세요.';
  end if;
end;
$$;

comment on function public.validate_score(integer, integer, uuid) is
  '스코어 범위·동점 검증. p_club_id가 있으면 클럽 설정 우선.';

grant execute on function public.validate_score(integer, integer, uuid) to authenticated;

-- 스코어 제출/관리자 수정 시 클럽 allow_tie·score_max 적용
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
  perform public.validate_score(p_team_a, p_team_b, v_match.club_id);

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

create or replace function public.admin_update_score(
  p_match_id uuid,
  p_team_a integer,
  p_team_b integer,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player_count integer;
  v_required integer;
  v_before jsonb;
begin
  perform public.assert_active_caller();

  if p_reason is null or trim(p_reason) = '' then
    raise exception '수정 사유를 입력해주세요.';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  if not public.is_club_admin_or_sub(v_match.club_id) then
    raise exception '확정된 경기는 관리자만 수정할 수 있습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 스코어를 입력할 수 없습니다.';
  end if;

  v_required := case when v_match.match_type = 'singles' then 2 else 4 end;
  select count(*) into v_player_count from public.match_players where match_id = p_match_id;
  if v_player_count < v_required then
    raise exception '참가자 %명이 모두 등록된 후 스코어를 입력할 수 있습니다.', v_required;
  end if;

  perform public.validate_score(p_team_a, p_team_b, v_match.club_id);

  v_before := public.match_snapshot(v_match);

  update public.matches
  set team_a_score = p_team_a,
      team_b_score = p_team_b,
      score_submitted_by = coalesce(score_submitted_by, auth.uid()),
      score_submitted_at = coalesce(score_submitted_at, now()),
      status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      version = version + 1
  where id = p_match_id;

  perform public.log_match_audit(
    p_match_id, 'admin_update_score', v_before,
    jsonb_build_object('team_a_score', p_team_a, 'team_b_score', p_team_b),
    p_reason
  );
end;
$$;

-- 신규 클럽 기본값: 동점 허용 + ranking_mode
create or replace function public.platform_create_club(
  p_name text,
  p_slug text,
  p_youtube_enabled boolean default true,
  p_absence_enabled boolean default true,
  p_fine_enabled boolean default true
)
returns public.clubs
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_slug text := lower(trim(p_slug));
  v_row public.clubs;
  v_key text;
begin
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 클럽을 만들 수 있습니다.';
  end if;
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception '클럽 이름은 1~40자로 입력해주세요.';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$' then
    raise exception '슬러그는 영문 소문자·숫자·하이픈만 사용할 수 있습니다.';
  end if;
  if v_slug in ('login','signup','admin','settings','results','players','platform','select-club','c','api') then
    raise exception '사용할 수 없는 슬러그입니다.';
  end if;

  insert into public.clubs (name, slug, youtube_enabled, absence_enabled, fine_enabled)
  values (
    v_name,
    v_slug,
    coalesce(p_youtube_enabled, true),
    coalesce(p_absence_enabled, true),
    coalesce(p_fine_enabled, true)
  )
  returning * into v_row;

  for v_key in select key from public.app_settings
  loop
    insert into public.club_settings (club_id, key, value, description)
    select v_row.id, s.key, s.value, s.description
    from public.app_settings s where s.key = v_key
    on conflict do nothing;
  end loop;

  insert into public.club_settings (club_id, key, value, description) values
    (v_row.id, 'confirm_mode', '"double"', '스코어 확정 방식'),
    (v_row.id, 'allow_tie', 'true', '동점 허용'),
    (v_row.id, 'score_max', '99', '최대 점수'),
    (v_row.id, 'min_matches_for_ranking', '0', '순위 최소 경기'),
    (v_row.id, 'ranking_mode', '"wins"', '순위 집계 방식'),
    (v_row.id, 'allow_proxy_registration', 'true', '대리 등록'),
    (v_row.id, 'require_signup_approval', 'true', '가입 승인'),
    (v_row.id, 'youtube_channel_handle', '""', '유튜브 핸들'),
    (v_row.id, 'youtube_upload_delay_days', '2', '유튜브 업로드 지연'),
    (v_row.id, 'default_match_type', '"doubles"', '경기 만들기 기본 유형')
  on conflict do nothing;

  insert into public.club_members (club_id, user_id, role, status)
  values (v_row.id, auth.uid(), 'admin', 'active')
  on conflict (club_id, user_id) do update
    set role = 'admin',
        status = 'active',
        updated_at = now();

  return v_row;
end;
$$;
