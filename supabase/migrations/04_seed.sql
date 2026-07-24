-- ============================================================
-- 04_seed.sql
-- 운영 설정 기본값
-- ============================================================

insert into public.app_settings (key, value, description) values
  ('confirm_mode', '"double"',
   '스코어 확정 방식: "double"(상대 팀 확인 필요) 또는 "single"(제출 즉시 확정)'),
  ('allow_tie', 'false',
   '동점 허용 여부. true면 무승부로 기록되며 승/패 집계에서 제외'),
  ('score_max', '99',
   '입력 가능한 최대 점수. 6게임제/타이브레이크/시간제 등 임의 점수제 대응'),
  ('min_matches_for_ranking', '0',
   '공식 순위에 포함되기 위한 최소 확정 경기 수. 미달 사용자는 순위 없이 별도 표시'),
  ('allow_proxy_registration', 'true',
   '다른 회원을 빈 슬롯에 대리 등록할 수 있는지 여부')
on conflict (key) do nothing;

-- ============================================================
-- 최초 관리자 지정 방법 (SQL Editor에서 직접 실행):
--
--   update public.profiles
--   set role = 'admin'
--   where id = (select id from auth.users where email = '관리자이메일@example.com');
-- ============================================================
