-- ============================================================
-- 28_platform_create_club_admin.sql
-- 플랫폼에서 클럽 생성 시, 생성자를 해당 클럽 관리자(active)로 자동 등록
-- 27 실행 후 추가 실행
-- ============================================================

create or replace function public.platform_create_club(
  p_name text,
  p_slug text,
  p_youtube_enabled boolean default true,
  p_absence_enabled boolean default true
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

  insert into public.clubs (name, slug, youtube_enabled, absence_enabled)
  values (v_name, v_slug, coalesce(p_youtube_enabled, true), coalesce(p_absence_enabled, true))
  returning * into v_row;

  -- 앱 설정 템플릿 복사
  for v_key in select key from public.app_settings
  loop
    insert into public.club_settings (club_id, key, value, description)
    select v_row.id, s.key, s.value, s.description
    from public.app_settings s where s.key = v_key
    on conflict do nothing;
  end loop;

  -- 기본 설정 (템플릿에 없어도 보장)
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

  -- 생성자를 해당 클럽 관리자로 등록
  insert into public.club_members (club_id, user_id, role, status)
  values (v_row.id, auth.uid(), 'admin', 'active')
  on conflict (club_id, user_id) do update
    set role = 'admin',
        status = 'active',
        updated_at = now();

  return v_row;
end;
$$;

grant execute on function public.platform_create_club(text, text, boolean, boolean) to authenticated;

-- 이미 생성된 클럽 중 '클럽 관리자'가 한 명도 없으면
-- 플랫폼 슈퍼를 해당 클럽 관리자로 등록 (신규 클럽 생성 직 누락 보정)
insert into public.club_members (club_id, user_id, role, status)
select c.id, p.id, 'admin', 'active'
from public.clubs c
cross join public.profiles p
where p.is_platform_admin = true
  and not exists (
    select 1
    from public.club_members cm
    where cm.club_id = c.id
      and cm.status = 'active'
      and cm.role = 'admin'
  )
on conflict (club_id, user_id) do update
  set role = 'admin',
      status = 'active',
      updated_at = now();
