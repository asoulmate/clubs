import type { PlayerStatsRow, RankedPlayerStats, RankingMode } from '../types/domain'

// ============================================================
// 순위 계산 로직 (UI와 분리, 기준 변경 시 이 파일만 수정)
//
// ranking_mode 별 1차 기준:
//   wins     — 승수 → 승률 → 득실 → 득점 → 경기수
//   win_rate — 승률 → 승수 → 득실 → 득점 → 경기수
//   points   — 승점(승3·무1·패0) → 득실 → 승수 → 승률 → 경기수
//
// 동률 정책: 공동 순위 (1, 2, 2, 4위)
// 경기 0회·최소 경기 미달은 rank = null
// ============================================================

/** 승률 계산: 경기 수가 0이면 0% */
export function calcWinRate(wins: number, matches: number): number {
  return matches === 0 ? 0 : (wins / matches) * 100
}

/** 참가율 계산: 개인 참가 일수 / 경기가 등록된 날짜 수 */
export function calcParticipationRate(daysParticipated: number, totalMatchDays: number): number {
  return totalMatchDays === 0 ? 0 : (daysParticipated / totalMatchDays) * 100
}

/** 승점: 승 3 · 무 1 · 패 0 */
export function calcLeaguePoints(wins: number, ties: number): number {
  return wins * 3 + ties * 1
}

export const RANKING_MODE_OPTIONS: { value: RankingMode; label: string; hint: string }[] = [
  {
    value: 'wins',
    label: '승수 우선',
    hint: '승수 → 승률 → 득실차',
  },
  {
    value: 'win_rate',
    label: '승률 우선',
    hint: '승률 → 승수 → 득실차',
  },
  {
    value: 'points',
    label: '승점 우선',
    hint: '승점(승3·무1) → 득실차 → 승수',
  },
]

type Derived = Omit<RankedPlayerStats, 'rank'> & { league_points: number }

/** 파생 지표 계산 */
function withDerived(row: PlayerStatsRow): Derived {
  return {
    ...row,
    win_rate: calcWinRate(row.wins, row.matches_played),
    point_diff: row.points_for - row.points_against,
    participation_rate: calcParticipationRate(row.days_participated, row.total_match_days),
    league_points: calcLeaguePoints(row.wins, row.ties),
  }
}

function rankKeys(row: Derived, mode: RankingMode): number[] {
  switch (mode) {
    case 'win_rate':
      return [row.win_rate, row.wins, row.point_diff, row.points_for, row.matches_played]
    case 'points':
      return [row.league_points, row.point_diff, row.wins, row.win_rate, row.matches_played]
    case 'wins':
    default:
      return [row.wins, row.win_rate, row.point_diff, row.points_for, row.matches_played]
  }
}

function compareByRanking(a: Derived, b: Derived, mode: RankingMode): number {
  const ka = rankKeys(a, mode)
  const kb = rankKeys(b, mode)
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return kb[i] - ka[i]
  }
  return a.name.localeCompare(b.name, 'ko')
}

function isTied(a: Derived, b: Derived, mode: RankingMode): boolean {
  const ka = rankKeys(a, mode)
  const kb = rankKeys(b, mode)
  return ka.every((v, i) => v === kb[i])
}

function isQualified(row: Derived, minMatches: number): boolean {
  return row.matches_played > 0 && row.matches_played >= minMatches
}

function compareUnqualified(a: Derived, b: Derived): number {
  const aa = a.absences ?? 0
  const ba = b.absences ?? 0
  if (aa !== ba) return ba - aa
  return a.name.localeCompare(b.name, 'ko')
}

/**
 * 통계 행에 경쟁 순위(1, 2, 2, 4위)를 부여한다.
 * 경기 0회·최소 경기 수 미달은 rank = null 로 목록 하단에 배치한다.
 */
export function buildRanking(
  rows: PlayerStatsRow[],
  minMatches: number,
  mode: RankingMode = 'wins',
): RankedPlayerStats[] {
  const derived = rows.map(withDerived)
  const rankingMode: RankingMode =
    mode === 'win_rate' || mode === 'points' || mode === 'wins' ? mode : 'wins'

  const qualified = derived
    .filter((r) => isQualified(r, minMatches))
    .sort((a, b) => compareByRanking(a, b, rankingMode))
  const unqualified = derived.filter((r) => !isQualified(r, minMatches)).sort(compareUnqualified)

  const ranked: RankedPlayerStats[] = []
  qualified.forEach((row, index) => {
    const prev = ranked[index - 1]
    const rank =
      prev && isTied(row, qualified[index - 1], rankingMode) ? prev.rank : index + 1
    ranked.push({ ...row, rank })
  })

  return [...ranked, ...unqualified.map((row) => ({ ...row, rank: null }))]
}
