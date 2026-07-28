-- ============================================================
-- 21_updates.sql
-- 곽창섭(asoulmates@gmail.com) 등: 클럽 일반회원인데 플랫폼 슈퍼가 남은 경우 정리
-- 필요 시 이메일만 바꿔 재실행
-- ============================================================

-- 클럽 멤버십이 user 인데 is_platform_admin 이 true 인 계정은
-- 설정/관리자 UI에서 계속 관리자로 보였음 → 플랫폼 플래그 해제
update public.profiles p
set is_platform_admin = false
where p.is_platform_admin = true
  and p.id in (
    select u.id from auth.users u where u.email = 'asoulmates@gmail.com'
  );

-- 다른 계정도 동일 증상이면 이메일을 바꿔 실행하세요.
-- 플랫폼 슈퍼가 한 명도 없으면 아래에서 생성 불가 → 최소 1명은 유지:
-- update public.profiles set is_platform_admin = true
-- where id = (select id from auth.users where email = '남길슈퍼@example.com');
