import type { PlayerStatsRow, RankedPlayerStats } from '../types/domain'

// ============================================================
// 순위 계산 로직 (UI와 분리, 기준 변경 시 이 파일만 수정)
//
// 기본 순위 기준 (위에서부터 순서대로 비교):
//   1. 승리 수 많은 순
//   2. 승률 높은 순
//   3. 득실 차 높은 순
//   4. 득점 높은 순
//   5. 경기 수 많은 순
//   6. 이름 오름차순 (순위 동률 판단에서는 제외)
//
// 동률 정책: 공동 순위를 허용하는 경쟁 순위 방식 (1, 2, 2, 4위)
// ============================================================

/** 승률 계산: 경기 수가 0이면 0% */
export function calcWinRate(wins: number, matches: number): number {
  return matches === 0 ? 0 : (wins / matches) * 100
}

/** 참가율 계산: 참가 일수 / 기간 내 경기가 개최된 날짜 수 */
export function calcParticipationRate(daysParticipated: number, totalMatchDays: number): number {
  return totalMatchDays === 0 ? 0 : (daysParticipated / totalMatchDays) * 100
}

/** 파생 지표 계산 */
function withDerived(row: PlayerStatsRow): Omit<RankedPlayerStats, 'rank'> {
  return {
    ...row,
    win_rate: calcWinRate(row.wins, row.matches_played),
    point_diff: row.points_for - row.points_against,
    participation_rate: calcParticipationRate(row.days_participated, row.total_match_days),
  }
}

type Derived = Omit<RankedPlayerStats, 'rank'>

/** 순위 비교 키 (동률 판단에도 사용, 이름은 제외) */
function rankKeys(row: Derived): number[] {
  return [row.wins, row.win_rate, row.point_diff, row.points_for, row.matches_played]
}

/** 순위 기준 비교 함수 */
function compareByRanking(a: Derived, b: Derived): number {
  const ka = rankKeys(a)
  const kb = rankKeys(b)
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return kb[i] - ka[i] // 내림차순
  }
  return a.name.localeCompare(b.name, 'ko') // 이름 오름차순
}

/** 두 행이 순위 동률인지 (비교 키가 모두 같은지) */
function isTied(a: Derived, b: Derived): boolean {
  const ka = rankKeys(a)
  const kb = rankKeys(b)
  return ka.every((v, i) => v === kb[i])
}

/**
 * 통계 행에 경쟁 순위(1, 2, 2, 4위)를 부여한다.
 * 최소 경기 수(minMatches) 미달 사용자는 rank = null로 목록 하단에 배치한다.
 */
export function buildRanking(rows: PlayerStatsRow[], minMatches: number): RankedPlayerStats[] {
  const derived = rows.map(withDerived)

  const qualified = derived.filter((r) => r.matches_played >= minMatches).sort(compareByRanking)
  const unqualified = derived.filter((r) => r.matches_played < minMatches).sort(compareByRanking)

  const ranked: RankedPlayerStats[] = []
  qualified.forEach((row, index) => {
    // 경쟁 순위: 직전 행과 동률이면 같은 순위, 아니면 (인덱스 + 1)
    const prev = ranked[index - 1]
    const rank = prev && isTied(row, qualified[index - 1]) ? prev.rank : index + 1
    ranked.push({ ...row, rank })
  })

  return [...ranked, ...unqualified.map((row) => ({ ...row, rank: null }))]
}
