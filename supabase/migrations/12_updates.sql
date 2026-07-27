-- ============================================================
-- 12_updates.sql
-- 유튜브 영상 연동: matches 컬럼 + 연결/해제 RPC + 설정값
-- ============================================================

alter table public.matches
  add column if not exists youtube_video_id text,
  add column if not exists youtube_title text,
  add column if not exists youtube_matched_at timestamptz;

comment on column public.matches.youtube_video_id is '연결된 YouTube video id (예: dQw4w9WgXcQ)';
comment on column public.matches.youtube_title is '연결 당시 영상 제목 스냅샷';

create unique index if not exists uq_matches_youtube_video_id
  on public.matches (youtube_video_id)
  where youtube_video_id is not null;

insert into public.app_settings (key, value, description) values
  ('youtube_channel_handle', '"멍기멍기-k4q"',
   'YouTube 채널 핸들 (@ 없이). 공개 채널 영상 목록 조회에 사용'),
  ('youtube_upload_delay_days', '7',
   '제목에 날짜가 없을 때, 경기일 이후 몇 일까지 업로드된 영상을 매칭 후보로 볼지')
on conflict (key) do nothing;

-- 유튜브 영상 연결 (로그인 사용자)
create or replace function public.link_match_youtube(
  p_match_id uuid,
  p_video_id text,
  p_title text default null
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

  if v_video is null or v_video = '' then
    raise exception '유튜브 영상 ID를 입력해주세요.';
  end if;
  -- URL이 넘어온 경우 video id만 추출
  v_video := regexp_replace(v_video, '^.*(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{6,}).*$', '\1');

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;
  if v_match.status = 'canceled' then
    raise exception '취소된 경기에는 영상을 연결할 수 없습니다.';
  end if;

  if exists (
    select 1 from public.matches
    where youtube_video_id = v_video and id <> p_match_id
  ) then
    raise exception '이미 다른 경기에 연결된 영상입니다.';
  end if;

  update public.matches
  set youtube_video_id = v_video,
      youtube_title = nullif(trim(p_title), ''),
      youtube_matched_at = now(),
      version = version + 1
  where id = p_match_id;
end;
$$;

-- 유튜브 영상 연결 해제
create or replace function public.unlink_match_youtube(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_match public.matches;
begin
  perform public.assert_active_caller();

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception '경기를 찾을 수 없습니다.';
  end if;

  update public.matches
  set youtube_video_id = null,
      youtube_title = null,
      youtube_matched_at = null,
      version = version + 1
  where id = p_match_id;
end;
$$;
