import type { MatchWithPlayers } from '../types/domain'
import { requiredPlayerCount } from '../types/domain'
import { addDaysToDateString } from './kst'

// ============================================================
// 유튜브 제목 ↔ 경기 매칭
//  - 실제 제목 예:
//    [지역신인부]7월 근무💫연수💫 vs 지훈💫희영💫
//    → 풀네임이 아니라 짧은 이름 + 이모지 + vs 형식
//  - 업로드일·경기일: 서로 ±windowDays(기본 2) 이내
//  - 제목에 날짜가 있으면 그 날짜도 경기일 ±windowDays 이내
//  - 이미 youtube_video_id 있는 경기는 스킵
//  - 스코어/코트/회차 없음 → 동일 페어는 업로드·생성 순 1:1 배정
// ============================================================

/** 경기일 ↔ 업로드일 허용 범위 (±일). 고정 2일 */
export const YOUTUBE_MATCH_WINDOW_DAYS = 2

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

/** 이름 정규화: 공백·기호 제거, 소문자(영문) */
export function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w가-힣]/g, '')
}

/**
 * 매칭용 이름 변형
 * 예: 김연수(우) → 김연수(우), 김연수, 연수
 *     문광준 → 문광준, 광준
 */
export function nameVariants(name: string): string[] {
  const trimmed = name.trim()
  const withoutParen = trimmed.replace(/\([^)]*\)/g, '').trim()
  const candidates = [trimmed]
  if (withoutParen && withoutParen !== trimmed) candidates.push(withoutParen)

  const out = new Set<string>()
  for (const c of candidates) {
    const n = normalizePersonName(c)
    if (!n) continue
    out.add(n)
    // 한글 성+이름(3글자 이상)이면 뒤 2글자(이름으로 추정)도 허용
    if (/^[가-힣]{3,}$/.test(n)) {
      out.add(n.slice(-2))
    }
  }
  // 긴 변형 우선 (풀네임 매칭 가점용)
  return [...out].sort((a, b) => b.length - a.length)
}

/** 제목에서 선수 이름 후보 토큰 추출 */
export function tokenizeYoutubeTitle(title: string): string[] {
  // [지역신인부] 같은 대괄호 태그 제거
  let t = title.replace(/\[[^\]]*]/g, ' ')
  t = t.replace(/\([^)]*\)/g, ' ')
  // vs 구분
  t = t.replace(/\bvs\b/gi, ' ')
  // 이모지·기호 → 공백, 한글/영문/숫자만 유지
  t = t.replace(/[^\w가-힣]+/g, ' ')

  return t
    .split(/\s+/)
    .map((p) => normalizePersonName(p))
    .filter(Boolean)
    .filter((p) => !/^\d{1,2}월$/.test(p))
    .filter((p) => !/^\d{4}년?$/.test(p))
    .filter((p) => !/^\d+$/.test(p))
    .filter((p) => p.length >= 2)
}

/**
 * 선수 4명이 제목에 모두 나타나는지 (짧은 이름·이모지 제목 지원)
 * 토큰 단위로 1:1 배정해 같은 "연수"를 두 선수가 중복 쓰지 않게 함
 */
export function titleContainsAllNames(title: string, names: string[]): boolean {
  return matchNamesInTitle(title, names) !== null
}

/** 매칭 성공 시 사용한 변형 길이 합(점수용), 실패 시 null */
export function matchNamesInTitle(
  title: string,
  names: string[],
): { usedVariants: string[]; quality: number } | null {
  if (names.length === 0) return null

  const tokens = tokenizeYoutubeTitle(title)
  const usedTokenIdx = new Set<number>()
  const usedVariants: string[] = []
  let quality = 0

  // 풀네임이 긴 선수부터 매칭해 짧은 이름 충돌을 줄임
  const ordered = names
    .map((name, index) => ({ name, index, variants: nameVariants(name) }))
    .sort((a, b) => (b.variants[0]?.length ?? 0) - (a.variants[0]?.length ?? 0))

  const assigned: (string | null)[] = Array.from({ length: names.length }, () => null)

  for (const player of ordered) {
    let found: { variant: string; tokenIdx: number } | null = null

    for (const variant of player.variants) {
      // 1) 토큰 완전 일치 (근무, 연수, 광준 …)
      const exactIdx = tokens.findIndex((tok, i) => !usedTokenIdx.has(i) && tok === variant)
      if (exactIdx >= 0) {
        found = { variant, tokenIdx: exactIdx }
        break
      }
      // 2) 토큰이 변형을 포함하거나 변형이 토큰을 포함 (김연수 ↔ 연수)
      const fuzzyIdx = tokens.findIndex((tok, i) => {
        if (usedTokenIdx.has(i)) return false
        if (tok.length < 2 || variant.length < 2) return false
        return tok.includes(variant) || variant.includes(tok)
      })
      if (fuzzyIdx >= 0) {
        found = { variant, tokenIdx: fuzzyIdx }
        break
      }
    }

    // 3) 토큰 분리가 안 된 붙여쓰기 제목 대비: 정규화 제목 부분 문자열
    if (!found) {
      const compact = normalizePersonName(title)
      for (const variant of player.variants) {
        if (variant.length >= 2 && compact.includes(variant)) {
          found = { variant, tokenIdx: -1 }
          break
        }
      }
    }

    if (!found) return null
    if (found.tokenIdx >= 0) usedTokenIdx.add(found.tokenIdx)
    assigned[player.index] = found.variant
    usedVariants.push(found.variant)
    quality += found.variant.length
  }

  if (assigned.some((v) => !v)) return null
  return { usedVariants, quality }
}

/**
 * 제목에서 날짜 추출 (있으면 YYYY-MM-DD)
 * 지원: 2026-07-27, 2026.7.27, 2026년 7월 27일, 7/27, 7월 27일
 * (주의: "7월 근무"처럼 일자 없는 "N월"만은 날짜로 보지 않음)
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

/** 경기의 참가자 이름 (단식 2명 / 복식 4명 모두 편성되지 않으면 null) */
export function getMatchPlayerNames(match: MatchWithPlayers): string[] | null {
  const required = requiredPlayerCount(match.match_type)
  if (match.players.length < required) return null
  const names = match.players.map((p) => p.profile?.name).filter((n): n is string => Boolean(n))
  return names.length === required ? names : null
}

/** 동일 페어 판별용 키 (이름 정렬) */
export function playerSetKey(names: string[]): string {
  return names.map(normalizePersonName).sort().join('|')
}

/** 두 YYYY-MM-DD가 ±windowDays 이내인지 */
export function isWithinDayWindow(
  centerDate: string,
  otherDate: string,
  windowDays: number = YOUTUBE_MATCH_WINDOW_DAYS,
): boolean {
  const earliest = addDaysToDateString(centerDate, -windowDays)
  const latest = addDaysToDateString(centerDate, windowDays)
  return otherDate >= earliest && otherDate <= latest
}

/** 단일 영상·경기 매칭 점수. 불가하면 null */
export function scoreVideoAgainstMatch(
  video: YoutubeVideo,
  match: MatchWithPlayers,
  windowDays: number = YOUTUBE_MATCH_WINDOW_DAYS,
): { score: number; reason: string } | null {
  if (match.status === 'canceled') return null
  if (match.youtube_video_id) return null
  const names = getMatchPlayerNames(match)
  if (!names) return null

  const nameMatch = matchNamesInTitle(video.title, names)
  if (!nameMatch) return null

  // 업로드일이 경기일 ±window 밖이면 제외
  if (!isWithinDayWindow(match.match_date, video.publishedDate, windowDays)) return null

  const year = Number(match.match_date.slice(0, 4))
  const titleDate = extractDateFromTitle(video.title, year)
  const nameBonus = Math.min(20, nameMatch.quality)

  if (titleDate) {
    if (!isWithinDayWindow(match.match_date, titleDate, windowDays)) return null
    return {
      score:
        200 +
        nameBonus +
        closenessBonus(match.match_date, video.publishedDate) +
        (titleDate === match.match_date ? 20 : 0),
      reason:
        titleDate === match.match_date
          ? '제목 날짜·선수 전원 일치'
          : `제목 날짜 ${titleDate}·선수 일치 (경기일 ±${windowDays}일)`,
    }
  }

  return {
    score: 100 + nameBonus + closenessBonus(match.match_date, video.publishedDate),
    reason: `선수 이름 일치(${nameMatch.usedVariants.join(', ')}) · 업로드 ${video.publishedDate}`,
  }
}

function closenessBonus(matchDate: string, publishedDate: string): number {
  const a = Date.parse(`${matchDate}T00:00:00+09:00`)
  const b = Date.parse(`${publishedDate}T00:00:00+09:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  const days = Math.abs(Math.round((b - a) / 86400000))
  return Math.max(0, 10 - days)
}

/**
 * 경기들과 영상 목록을 1:1로 배정
 * 이미 링크된 경기/영상은 스킵. 동일 페어 2경기면 점수·시간순 각각 연결
 */
export function assignVideosToMatches(
  matches: MatchWithPlayers[],
  videos: YoutubeVideo[],
  windowDays: number = YOUTUBE_MATCH_WINDOW_DAYS,
): YoutubeMatchCandidate[] {
  const openMatches = matches.filter((m) => !m.youtube_video_id && m.status !== 'canceled')
  const usedVideos = new Set(matches.map((m) => m.youtube_video_id).filter(Boolean) as string[])

  const edges: YoutubeMatchCandidate[] = []
  for (const match of openMatches) {
    for (const video of videos) {
      if (usedVideos.has(video.videoId)) continue
      const scored = scoreVideoAgainstMatch(video, match, windowDays)
      if (!scored) continue
      edges.push({
        matchId: match.id,
        video,
        score: scored.score,
        reason: scored.reason,
      })
    }
  }

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
  usedVideoIds: Set<string>,
  windowDays: number = YOUTUBE_MATCH_WINDOW_DAYS,
  limit = 8,
): YoutubeMatchCandidate[] {
  const probe: MatchWithPlayers = match.youtube_video_id
    ? { ...match, youtube_video_id: null }
    : match
  const list: YoutubeMatchCandidate[] = []
  for (const video of videos) {
    if (usedVideoIds.has(video.videoId) && match.youtube_video_id !== video.videoId) continue
    const scored = scoreVideoAgainstMatch(video, probe, windowDays)
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
