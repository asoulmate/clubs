import { supabase } from '../lib/supabase'
import type { MatchWithPlayers } from '../types/domain'
import { fetchMatchesByDateRange } from './matchService'
import { addDaysToDateString } from '../utils/kst'
import {
  assignVideosToMatches,
  extractYoutubeVideoId,
  suggestVideosForMatch,
  YOUTUBE_MATCH_WINDOW_DAYS,
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

/** 채널 최근 업로드 영상 조회 (업로드일이 from~to인 것만, 또는 전체 후 필터) */
export async function fetchChannelRecentVideos(
  channelHandle: string,
  options?: { fromDate?: string; toDate?: string; maxPages?: number },
): Promise<YoutubeVideo[]> {
  const playlistId = await resolveUploadsPlaylistId(channelHandle)
  const key = getApiKey()
  const maxPages = options?.maxPages ?? 3
  const fromDate = options?.fromDate
  const toDate = options?.toDate
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

    let reachedOlderThanFrom = false
    for (const item of json.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      const title = item.snippet?.title
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt
      if (!videoId || !title || !publishedAt) continue
      const publishedDate = publishedDateKst(publishedAt)

      // 재생목록은 최신순 → from보다 오래되면 이후는 불필요
      if (fromDate && publishedDate < fromDate) {
        reachedOlderThanFrom = true
        continue
      }
      if (toDate && publishedDate > toDate) continue

      videos.push({
        videoId,
        title,
        publishedAt,
        publishedDate,
        url: youtubeWatchUrl(videoId),
      })
    }

    pageToken = json.nextPageToken ?? ''
    if (!pageToken || reachedOlderThanFrom) break
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

/**
 * 기준일 ±windowDays 경기·영상을 가져와 미연결 경기만 매칭
 * (이미 유튜브 링크가 있는 경기는 스킵)
 */
export async function autoLinkYoutubeAroundDate(
  centerDate: string,
  channelHandle: string,
  windowDays: number = YOUTUBE_MATCH_WINDOW_DAYS,
): Promise<{ linked: number; scannedMatches: number; scannedVideos: number }> {
  const fromDate = addDaysToDateString(centerDate, -windowDays)
  const toDate = addDaysToDateString(centerDate, windowDays)

  const [matches, videos] = await Promise.all([
    fetchMatchesByDateRange(fromDate, toDate),
    fetchChannelRecentVideos(channelHandle, { fromDate, toDate }),
  ])

  const assignments = assignVideosToMatches(matches, videos, windowDays)

  let linked = 0
  for (const a of assignments) {
    await linkMatchYoutube(a.matchId, a.video.videoId, a.video.title)
    linked += 1
  }
  return { linked, scannedMatches: matches.length, scannedVideos: videos.length }
}

/** 한 경기의 후보 영상 (해당 경기일 ±window 업로드) */
export async function fetchSuggestionsForMatch(
  match: MatchWithPlayers,
  allMatches: MatchWithPlayers[],
  channelHandle: string,
  windowDays: number = YOUTUBE_MATCH_WINDOW_DAYS,
): Promise<YoutubeMatchCandidate[]> {
  const fromDate = addDaysToDateString(match.match_date, -windowDays)
  const toDate = addDaysToDateString(match.match_date, windowDays)
  const videos = await fetchChannelRecentVideos(channelHandle, { fromDate, toDate })
  const used = new Set(
    allMatches.map((m) => m.youtube_video_id).filter((id): id is string => Boolean(id)),
  )
  return suggestVideosForMatch(match, videos, used, windowDays)
}

export { youtubeWatchUrl, YOUTUBE_MATCH_WINDOW_DAYS }
