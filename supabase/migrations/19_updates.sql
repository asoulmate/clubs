-- ============================================================
-- 19_updates.sql
-- morning-star 클럽명 깨짐(????) → 모닝스타 보정
-- ============================================================

update public.clubs
set name = '모닝스타', updated_at = now()
where slug = 'morning-star'
  and name is distinct from '모닝스타';
