-- ============================================================
-- 35_club_delete_and_order.sql
-- 클럽 목록 생성순 정렬 + 플랫폼 슈퍼관리자 클럽 삭제
-- ============================================================

-- 최초 생성된 클럽부터 표시
create or replace function public.list_clubs_for_signup()
returns table (
  id uuid,
  name text,
  slug text
)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.name, c.slug
  from public.clubs c
  order by c.created_at asc, c.id asc;
$$;

create or replace function public.list_my_clubs()
returns table (
  club_id uuid,
  name text,
  slug text,
  role public.user_role,
  status text,
  youtube_enabled boolean,
  absence_enabled boolean
)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, cm.role, cm.status, c.youtube_enabled, c.absence_enabled
  from public.club_members cm
  join public.clubs c on c.id = cm.club_id
  where cm.user_id = auth.uid()
  order by c.created_at asc, c.id asc;
$$;

create or replace function public.platform_list_clubs()
returns setof public.clubs
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 클럽 목록을 조회할 수 있습니다.';
  end if;

  return query
  select *
  from public.clubs
  order by created_at asc, id asc;
end;
$$;

-- 클럽과 클럽 소유 데이터를 영구 삭제한다.
-- matches / unexcused_absences의 기존 club_id FK에는 cascade가 없으므로 먼저 삭제한다.
create or replace function public.platform_delete_club(p_club_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_club public.clubs;
begin
  if not public.is_platform_admin() then
    raise exception '플랫폼 관리자만 클럽을 삭제할 수 있습니다.';
  end if;

  select * into v_club
  from public.clubs
  where id = p_club_id
  for update;

  if not found then
    raise exception '클럽을 찾을 수 없습니다.';
  end if;

  delete from public.matches where club_id = p_club_id;
  delete from public.unexcused_absences where club_id = p_club_id;
  delete from public.clubs where id = p_club_id;
end;
$$;

revoke all on function public.platform_delete_club(uuid) from public;
grant execute on function public.platform_delete_club(uuid) to authenticated;

grant execute on function public.list_clubs_for_signup() to anon, authenticated;
grant execute on function public.list_my_clubs() to authenticated;
grant execute on function public.platform_list_clubs() to authenticated;
