-- ============================================================
-- 37_club_fine_flag.sql
-- 패자 벌금을 유튜브·무단결석과 같은 clubs 기능 플래그로 이동
-- ============================================================

alter table public.clubs
  add column if not exists fine_enabled boolean not null default true;

comment on column public.clubs.fine_enabled is
  'true면 결과 집계·내 기록에 패자 벌금 현황 표시';

-- club_settings에 있던 값을 clubs 컬럼으로 이관
update public.clubs c
set fine_enabled = coalesce((cs.value)::boolean, true)
from public.club_settings cs
where cs.club_id = c.id
  and cs.key = 'fine_enabled';

delete from public.club_settings where key = 'fine_enabled';
delete from public.app_settings where key = 'fine_enabled';

-- list_my_clubs에 fine_enabled 포함
drop function if exists public.list_my_clubs();
create or replace function public.list_my_clubs()
returns table (
  club_id uuid,
  name text,
  slug text,
  role public.user_role,
  status text,
  youtube_enabled boolean,
  absence_enabled boolean,
  fine_enabled boolean
)
language sql stable security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.slug,
    cm.role,
    cm.status,
    c.youtube_enabled,
    c.absence_enabled,
    c.fine_enabled
  from public.club_members cm
  join public.clubs c on c.id = cm.club_id
  where cm.user_id = auth.uid()
  order by c.created_at asc, c.id asc;
$$;

grant execute on function public.list_my_clubs() to authenticated;

-- 클럽 관리자 기능 플래그
drop function if exists public.update_club_feature_flags(uuid, boolean, boolean);
create or replace function public.update_club_feature_flags(
  p_club_id uuid,
  p_youtube_enabled boolean default null,
  p_absence_enabled boolean default null,
  p_fine_enabled boolean default null
)
returns public.clubs
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.clubs;
begin
  perform public.assert_active_caller();
  if not (
    public.is_platform_admin()
    or exists (
      select 1 from public.club_members cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid()
        and cm.status = 'active' and cm.role = 'admin'
    )
  ) then
    raise exception '클럽 관리자 또는 플랫폼 슈퍼만 기능을 변경할 수 있습니다.';
  end if;

  update public.clubs set
    youtube_enabled = coalesce(p_youtube_enabled, youtube_enabled),
    absence_enabled = coalesce(p_absence_enabled, absence_enabled),
    fine_enabled = coalesce(p_fine_enabled, fine_enabled),
    updated_at = now()
  where id = p_club_id
  returning * into v_row;
  if not found then raise exception '클럽을 찾을 수 없습니다.'; end if;
  return v_row;
end;
$$;

grant execute on function public.update_club_feature_flags(uuid, boolean, boolean, boolean)
  to authenticated;

-- 플랫폼 클럽 수정
drop function if exists public.platform_update_club(uuid, text, boolean, boolean);
create or replace function public.platform_update_club(
  p_club_id uuid,
  p_name text default null,
  p_youtube_enabled boolean default null,
  p_absence_enabled boolean default null,
  p_fine_enabled boolean default null
)
returns public.clubs
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.clubs;
begin
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 클럽을 수정할 수 있습니다.';
  end if;
  select * into v_row from public.clubs where id = p_club_id for update;
  if not found then raise exception '클럽을 찾을 수 없습니다.'; end if;

  update public.clubs set
    name = coalesce(nullif(trim(p_name), ''), name),
    youtube_enabled = coalesce(p_youtube_enabled, youtube_enabled),
    absence_enabled = coalesce(p_absence_enabled, absence_enabled),
    fine_enabled = coalesce(p_fine_enabled, fine_enabled),
    updated_at = now()
  where id = p_club_id
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.platform_update_club(uuid, text, boolean, boolean, boolean)
  to authenticated;

-- 플랫폼 클럽 생성 시 fine_enabled 기본 true
drop function if exists public.platform_create_club(text, text, boolean, boolean);
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
    (v_row.id, 'allow_tie', 'false', '동점 허용'),
    (v_row.id, 'score_max', '99', '최대 점수'),
    (v_row.id, 'min_matches_for_ranking', '0', '순위 최소 경기'),
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

grant execute on function public.platform_create_club(text, text, boolean, boolean, boolean)
  to authenticated;

-- 벌금 RPC: clubs.fine_enabled 사용
create or replace function public.get_match_fine_records(
  p_from date,
  p_to date,
  p_club_id uuid,
  p_user_id uuid default null,
  p_match_type text default null
)
returns table (
  match_id uuid,
  match_date date,
  match_type text,
  user_id uuid,
  name text,
  award_level public.award_level,
  team_a_score integer,
  team_b_score integer,
  amount integer,
  fine_reason text
)
language sql stable security definer
set search_path = public
as $$
  select
    m.id,
    m.match_date,
    m.match_type::text,
    mp.user_id,
    p.name,
    p.award_level,
    m.team_a_score,
    m.team_b_score,
    case
      when greatest(m.team_a_score, m.team_b_score) = 6
       and least(m.team_a_score, m.team_b_score) in (0, 5)
        then 3500
      else 2500
    end as amount,
    case
      when greatest(m.team_a_score, m.team_b_score) = 6
       and least(m.team_a_score, m.team_b_score) = 0
        then '6:0 패배'
      when greatest(m.team_a_score, m.team_b_score) = 6
       and least(m.team_a_score, m.team_b_score) = 5
        then '6:5 패배'
      else '일반 패배'
    end as fine_reason
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  join public.profiles p on p.id = mp.user_id
  join public.clubs cl on cl.id = m.club_id
  where m.club_id = p_club_id
    and cl.fine_enabled = true
    and m.status = 'confirmed'
    and m.team_a_score is not null
    and m.team_b_score is not null
    and m.team_a_score <> m.team_b_score
    and m.match_date between p_from and p_to
    and (p_match_type is null or m.match_type::text = p_match_type)
    and (p_user_id is null or mp.user_id = p_user_id)
    and (
      (public.position_team(mp.position) = 'A' and m.team_a_score < m.team_b_score)
      or
      (public.position_team(mp.position) = 'B' and m.team_b_score < m.team_a_score)
    )
    and (
      public.is_platform_admin()
      or public.is_active_club_member(p_club_id)
    )
  order by m.match_date desc, m.created_at desc, p.name asc;
$$;
