-- ============================================================
-- 32_award_level_7.sql
-- 입상 등급 7단계: 우승/입상 세분화
-- open → open_place, national_rookie → national_rookie_place,
-- local_rookie → local_rookie_place (기존 "입상"으로 이관)
-- ============================================================

-- 1) 새 enum 값 추가 (구 enum 값은 이관 후 미사용으로 남음)
alter type public.award_level add value if not exists 'open_champion';
alter type public.award_level add value if not exists 'open_place';
alter type public.award_level add value if not exists 'national_rookie_champion';
alter type public.award_level add value if not exists 'national_rookie_place';
alter type public.award_level add value if not exists 'local_rookie_champion';
alter type public.award_level add value if not exists 'local_rookie_place';
