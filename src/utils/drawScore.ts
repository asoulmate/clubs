import type { AwardLevel, PlayerStatsRow, Profile } from '../types/domain'

/** 입상 기본점수 (우승/입상 세분화 전: 구간 중간값) */
export const AWARD_BASE_SCORE: Record<AwardLevel, number> = {
  open: 95,
  national_rookie: 75,
  local_rookie: 55,
  none: 40,
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
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * MVP 개인점수
 * S = 입상기본 + r × (8W + 4G)
 * r = n/(n+10), W = 2×(승+2)/(n+4)-1, G = clamp(경기당득실/3, -1, 1)
 */
export function computePlayerScore(
  profile: Profile,
  stats: PlayerStatsRow | null | undefined,
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

  const score = awardBase + r * (8 * W + 4 * G)

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
  }
}
