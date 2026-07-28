-- ============================================================
-- 18_updates.sql
-- 회원가입용 공개 클럽 목록 (이름·슬러그만)
-- ============================================================

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
  order by c.name;
$$;

grant execute on function public.list_clubs_for_signup() to anon, authenticated;

comment on function public.list_clubs_for_signup() is
  '비로그인 회원가입 화면에서 클럽 선택용. 이름·슬러그만 공개.';
