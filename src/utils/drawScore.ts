import type { AwardLevel, PlayerStatsRow, Profile } from '../types/domain'

/** 입상 기본점수 (7단계) */
export const AWARD_BASE_SCORE: Record<AwardLevel, number> = {
  open_champion: 100,
  open_place: 90,
  national_rookie_champion: 80,
  national_rookie_place: 70,
  local_rookie_champion: 60,
  local_rookie_place: 50,
  none: 40,
  // 구버전 → 입상 점수
  open: 90,
  national_rookie: 70,
  local_rookie: 50,
}

/** 최근 폼 집계에 쓰는 경기 수 */
export const RECENT_FORM_MATCH_LIMIT = 5

export interface RecentFormStats {
  wins: number
  losses: number
  ties: number
  /** 반영된 최근 경기 수 (최대 RECENT_FORM_MATCH_LIMIT) */
  n: number
}

export interface ScoredPlayer {
  profile: Profile
  /** 종합 개인점수 S */
  score: number
  awardBase: number
  matchesPlayed: number
  reliability: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  /** 베이지안 보정 승률 */
  adjustedWinRate: number
  /** 승률 지수 W ∈ [-1, 1] */
  winFactor: number
  /** 경기당 평균 득실 */
  pointDiffPerMatch: number
  /** 득실 지수 G ∈ [-1, 1] */
  pointFactor: number
  /** 단기 폼 F ∈ [-1, 1] (경기 없으면 0) */
  form: number
  recentFormMatches: number
  /** 기본점수에 더해진 성적 보정값 */
  performanceAdjustment: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 최근 k경기 승/무/패 → F ∈ [-1, 1]
 * 표본이 적을 때 k/(k+2)로 완화
 */
export function computeRecentForm(form: RecentFormStats | null | undefined): number {
  const k = Math.max(0, Number(form?.n ?? 0))
  if (k <= 0) return 0
  const wins = Number(form?.wins ?? 0)
  const ties = Number(form?.ties ?? 0)
  const rate = (wins + 0.5 * ties) / k
  const rawF = 2 * rate - 1
  return clamp((k / (k + 2)) * rawF, -1, 1)
}

/**
 * 개인점수
 * S = 입상기본 + r × (8W + 4G + 3F)
 * W·G: 누적 성적, F: 최근 5경기 단기 폼
 */
export function computePlayerScore(
  profile: Profile,
  stats: PlayerStatsRow | null | undefined,
  recentForm?: RecentFormStats | null,
): ScoredPlayer {
  const awardBase = AWARD_BASE_SCORE[profile.award_level] ?? 40
  const n = Math.max(0, Number(stats?.matches_played ?? 0))
  const wins = Number(stats?.wins ?? 0)
  const losses = Number(stats?.losses ?? 0)
  const ties = Number(stats?.ties ?? 0)
  const pointsFor = Number(stats?.points_for ?? 0)
  const pointsAgainst = Number(stats?.points_against ?? 0)

  const r = n / (n + 10)
  const adjWinRate = (wins + 2) / (n + 4)
  const W = 2 * adjWinRate - 1
  const perMatchDiff = n > 0 ? (pointsFor - pointsAgainst) / n : 0
  const G = clamp(perMatchDiff / 3, -1, 1)
  const F = computeRecentForm(recentForm)

  const score = awardBase + r * (8 * W + 4 * G + 3 * F)

  return {
    profile,
    score: Math.round(score * 10) / 10,
    awardBase,
    matchesPlayed: n,
    reliability: Math.round(r * 1000) / 1000,
    wins,
    losses,
    ties,
    pointsFor,
    pointsAgainst,
    adjustedWinRate: Math.round(adjWinRate * 1000) / 1000,
    winFactor: Math.round(W * 1000) / 1000,
    pointDiffPerMatch: Math.round(perMatchDiff * 1000) / 1000,
    pointFactor: Math.round(G * 1000) / 1000,
    form: Math.round(F * 1000) / 1000,
    recentFormMatches: Math.max(0, Number(recentForm?.n ?? 0)),
    performanceAdjustment: Math.round((score - awardBase) * 10) / 10,
  }
}
