import { supabase } from '../lib/supabase'
import type { MatchWithPlayers } from '../types/domain'
import {
  assignVideosToMatches,
  extractYoutubeVideoId,
  suggestVideosForMatch,
  type YoutubeMatchCandidate,
  type YoutubeVideo,
  youtubeWatchUrl,
} from '../utils/youtubeMatch'

const YT_API = 'https://www.googleapis.com/youtube/v3'

function getApiKey(): string {
  const key = import.meta.env.VITE_YOUTUBE_API_KEY
  if (!key) {
    throw new Error(
      '유튜브 API 키가 없습니다. .env에 VITE_YOUTUBE_API_KEY를 설정하고 GitHub Secrets에도 등록해주세요.',
    )
  }
  return key
}

function publishedDateKst(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** 채널 핸들(@ 없이) → uploads 재생목록 ID */
async function resolveUploadsPlaylistId(handle: string): Promise<string> {
  const cleaned = handle.replace(/^@/, '').trim()
  const key = getApiKey()

  const byHandle = await fetch(
    `${YT_API}/channels?part=contentDetails&forHandle=${encodeURIComponent(cleaned)}&key=${key}`,
  )
  const handleJson = (await byHandle.json()) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
    error?: { message?: string }
  }
  if (handleJson.error?.message) throw new Error(handleJson.error.message)

  let uploads = handleJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (uploads) return uploads

  // 핸들 조회 실패 시 검색으로 채널 ID 추정
  const searchRes = await fetch(
    `${YT_API}/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(cleaned)}&key=${key}`,
  )
  const searchJson = (await searchRes.json()) as {
    items?: { snippet?: { channelId?: string } }[]
    error?: { message?: string }
  }
  if (searchJson.error?.message) throw new Error(searchJson.error.message)
  const channelId = searchJson.items?.[0]?.snippet?.channelId
  if (!channelId) throw new Error('유튜브 채널을 찾을 수 없습니다. 핸들 설정을 확인해주세요.')

  const chRes = await fetch(
    `${YT_API}/channels?part=contentDetails&id=${channelId}&key=${key}`,
  )
  const chJson = (await chRes.json()) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
  }
  uploads = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) throw new Error('채널 업로드 목록을 가져오지 못했습니다.')
  return uploads
}

/** 채널 최근 업로드 영상 조회 */
export async function fetchChannelRecentVideos(
  channelHandle: string,
  maxPages = 3,
): Promise<YoutubeVideo[]> {
  const playlistId = await resolveUploadsPlaylistId(channelHandle)
  const key = getApiKey()
  const videos: YoutubeVideo[] = []
  let pageToken = ''

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${YT_API}/playlistItems?part=snippet,contentDetails&maxResults=50` +
      `&playlistId=${playlistId}&key=${key}` +
      (pageToken ? `&pageToken=${pageToken}` : '')
    const res = await fetch(url)
    const json = (await res.json()) as {
      items?: {
        snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } }
        contentDetails?: { videoId?: string; videoPublishedAt?: string }
      }[]
      nextPageToken?: string
      error?: { message?: string }
    }
    if (json.error?.message) throw new Error(json.error.message)

    for (const item of json.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt
      if (!videoId || !title || !publishedAt) continue
      videos.push({
        videoId,
        title,
        publishedAt,
        publishedDate: publishedDateKst(publishedAt),
        url: youtubeWatchUrl(videoId),
      })
    }

    pageToken = json.nextPageToken ?? ''
    if (!pageToken) break
  }

  return videos
}

export async function linkMatchYoutube(
  matchId: string,
  videoId: string,
  title?: string,
): Promise<void> {
  const { error } = await supabase.rpc('link_match_youtube', {
    p_match_id: matchId,
    p_video_id: videoId,
    p_title: title ?? null,
  })
  if (error) throw error
}

export async function unlinkMatchYoutube(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_match_youtube', { p_match_id: matchId })
  if (error) throw error
}

export async function linkMatchYoutubeByUrl(
  matchId: string,
  urlOrId: string,
  title?: string,
): Promise<void> {
  const id = extractYoutubeVideoId(urlOrId)
  if (!id) throw new Error('올바른 유튜브 링크 또는 영상 ID를 입력해주세요.')
  await linkMatchYoutube(matchId, id, title)
}

/** 해당 날짜 경기에 유튜브 자동 연결 (연결된 건수 반환) */
export async function autoLinkYoutubeForDate(
  matches: MatchWithPlayers[],
  channelHandle: string,
  delayDays: number,
): Promise<{ linked: number; assignments: YoutubeMatchCandidate[] }> {
  const videos = await fetchChannelRecentVideos(channelHandle)
  const assignments = assignVideosToMatches(matches, videos, delayDays)

  let linked = 0
  for (const a of assignments) {
    await linkMatchYoutube(a.matchId, a.video.videoId, a.video.title)
    linked += 1
  }
  return { linked, assignments }
}

/** 한 경기의 후보 영상 */
export async function fetchSuggestionsForMatch(
  match: MatchWithPlayers,
  allMatches: MatchWithPlayers[],
  channelHandle: string,
  delayDays: number,
): Promise<YoutubeMatchCandidate[]> {
  const videos = await fetchChannelRecentVideos(channelHandle)
  const used = new Set(
    allMatches.map((m) => m.youtube_video_id).filter((id): id is string => Boolean(id)),
  )
  return suggestVideosForMatch(match, videos, delayDays, used)
}

export { youtubeWatchUrl }
