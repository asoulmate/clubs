import type { MatchWithPlayers } from '../types/domain'
import { addDaysToDateString } from './kst'

// ============================================================
// 유튜브 제목 ↔ 경기 매칭
//  - 제목 기본: 선수 이름 4명
//  - 선택: 제목에 날짜 포함 시 경기일과 일치해야 함
//  - 스코어/코트/회차 없음 → 동일 페어 2경기는 업로드 시각·경기 생성순으로 1:1 배정
// ============================================================

export interface YoutubeVideo {
  videoId: string
  title: string
  /** YYYY-MM-DD (업로드일, Asia/Seoul 기준) */
  publishedDate: string
  publishedAt: string
  url: string
}

export interface YoutubeMatchCandidate {
  matchId: string
  video: YoutubeVideo
  score: number
  reason: string
}

/** 이름 정규화: 공백 제거, 소문자(영문), 괄호 안 표기는 별도 변형으로 사용 */
export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '')
}

/** 매칭용 이름 변형 (예: 김연수(우) → ["김연수(우)", "김연수"]) */
export function nameVariants(name: string): string[] {
  const trimmed = name.trim()
  const withoutParen = trimmed.replace(/\([^)]*\)/g, '').trim()
  const variants = [trimmed]
  if (withoutParen && withoutParen !== trimmed) variants.push(withoutParen)
  return [...new Set(variants.map(normalizePersonName).filter(Boolean))]
}

export function titleContainsAllNames(title: string, names: string[]): boolean {
  const normalizedTitle = normalizePersonName(title)
  return names.every((name) =>
    nameVariants(name).some((variant) => normalizedTitle.includes(variant)),
  )
}

/**
 * 제목에서 날짜 추출 (있으면 YYYY-MM-DD)
 * 지원: 2026-07-27, 2026.7.27, 2026년 7월 27일, 7/27, 7월 27일
 */
export function extractDateFromTitle(title: string, fallbackYear?: number): string | null {
  const year = fallbackYear ?? new Date().getFullYear()

  let m = title.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/)
  if (m) return toYmd(Number(m[1]), Number(m[2]), Number(m[3]))

  m = title.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m) return toYmd(year, Number(m[1]), Number(m[2]))

  m = title.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/)
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year
    return toYmd(y, Number(m[1]), Number(m[2]))
  }

  return null
}

function toYmd(y: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** 경기의 참가자 이름 4명 (부족하면 null) */
export function getMatchPlayerNames(match: MatchWithPlayers): string[] | null {
  if (match.players.length < 4) return null
  const names = match.players.map((p) => p.profile?.name).filter((n): n is string => Boolean(n))
  return names.length === 4 ? names : null
}

/** 동일 페어 판별용 키 (이름 정렬) */
export function playerSetKey(names: string[]): string {
  return names.map(normalizePersonName).sort().join('|')
}

function isPublishInWindow(
  matchDate: string,
  publishedDate: string,
  delayDays: number,
): boolean {
  if (publishedDate < matchDate) return false
  const latest = addDaysToDateString(matchDate, delayDays)
  return publishedDate <= latest
}

/** 단일 영상·경기 매칭 점수. 불가하면 null */
export function scoreVideoAgainstMatch(
  video: YoutubeVideo,
  match: MatchWithPlayers,
  delayDays: number,
): { score: number; reason: string } | null {
  if (match.status === 'canceled') return null
  const names = getMatchPlayerNames(match)
  if (!names) return null
  if (!titleContainsAllNames(video.title, names)) return null

  const year = Number(match.match_date.slice(0, 4))
  const titleDate = extractDateFromTitle(video.title, year)

  if (titleDate) {
    if (titleDate !== match.match_date) return null
    return {
      score: 200 + closenessBonus(match.match_date, video.publishedDate),
      reason: '제목 날짜·선수 4명 일치',
    }
  }

  if (!isPublishInWindow(match.match_date, video.publishedDate, delayDays)) return null

  return {
    score: 100 + closenessBonus(match.match_date, video.publishedDate),
    reason: `선수 4명 일치 · 업로드 ${video.publishedDate} (경기일+${delayDays}일 이내)`,
  }
}

function closenessBonus(matchDate: string, publishedDate: string): number {
  // 업로드가 경기일에 가까울수록 가점 (최대 10)
  const a = Date.parse(`${matchDate}T00:00:00+09:00`)
  const b = Date.parse(`${publishedDate}T00:00:00+09:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  const days = Math.max(0, Math.round((b - a) / 86400000))
  return Math.max(0, 10 - days)
}

/**
 * 날짜의 경기들과 영상 목록을 1:1로 배정
 * 동일 페어 2경기·2영상이면 점수·시간순으로 각각 연결
 */
export function assignVideosToMatches(
  matches: MatchWithPlayers[],
  videos: YoutubeVideo[],
  delayDays: number,
): YoutubeMatchCandidate[] {
  const openMatches = matches.filter((m) => !m.youtube_video_id && m.status !== 'canceled')
  const usedVideos = new Set(matches.map((m) => m.youtube_video_id).filter(Boolean) as string[])

  const edges: YoutubeMatchCandidate[] = []
  for (const match of openMatches) {
    for (const video of videos) {
      if (usedVideos.has(video.videoId)) continue
      const scored = scoreVideoAgainstMatch(video, match, delayDays)
      if (!scored) continue
      edges.push({
        matchId: match.id,
        video,
        score: scored.score,
        reason: scored.reason,
      })
    }
  }

  // 점수 높은 순, 동점이면 경기 생성 빠른 순 + 영상 업로드 빠른 순
  const matchCreated = new Map(openMatches.map((m) => [m.id, m.created_at]))
  edges.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const mc = (matchCreated.get(a.matchId) ?? '').localeCompare(matchCreated.get(b.matchId) ?? '')
    if (mc !== 0) return mc
    return a.video.publishedAt.localeCompare(b.video.publishedAt)
  })

  const assignedMatches = new Set<string>()
  const assignedVideos = new Set<string>()
  const result: YoutubeMatchCandidate[] = []

  for (const edge of edges) {
    if (assignedMatches.has(edge.matchId) || assignedVideos.has(edge.video.videoId)) continue
    assignedMatches.add(edge.matchId)
    assignedVideos.add(edge.video.videoId)
    result.push(edge)
  }

  return result
}

/** 특정 경기에 대한 후보 영상 (점수순, 상위 N) */
export function suggestVideosForMatch(
  match: MatchWithPlayers,
  videos: YoutubeVideo[],
  delayDays: number,
  usedVideoIds: Set<string>,
  limit = 8,
): YoutubeMatchCandidate[] {
  const list: YoutubeMatchCandidate[] = []
  for (const video of videos) {
    if (usedVideoIds.has(video.videoId) && match.youtube_video_id !== video.videoId) continue
    const scored = scoreVideoAgainstMatch(video, match, delayDays)
    if (!scored) continue
    list.push({ matchId: match.id, video, score: scored.score, reason: scored.reason })
  }
  return list.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed) && !trimmed.includes('/') && !trimmed.includes('=')) {
    return trimmed
  }
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /\/shorts\/([A-Za-z0-9_-]{6,})/,
    /\/embed\/([A-Za-z0-9_-]{6,})/,
  ]
  for (const re of patterns) {
    const m = trimmed.match(re)
    if (m) return m[1]
  }
  return null
}
