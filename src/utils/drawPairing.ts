import type { ScoredPlayer } from './drawScore'

export type DrawMode = 'level' | 'mixed' | 'random'

export interface PairingHistory {
  /** userId → 최근 파트너 id 목록 (최신순, 최대 5) */
  recentPartners: Map<string, string[]>
  /** userId → 최근 상대 id 목록 (최신순, 최대 5) */
  recentOpponents: Map<string, string[]>
}

export interface TeamSplit {
  teamA: [ScoredPlayer, ScoredPlayer]
  teamB: [ScoredPlayer, ScoredPlayer]
  teamASum: number
  teamBSum: number
  scoreDiff: number
  repeatPenalty: number
  cost: number
}

export interface MatchLineup {
  label: string
  split: TeamSplit
  players: ScoredPlayer[]
}

export interface DrawResult {
  mode: DrawMode
  matches: MatchLineup[]
  sitOut: ScoredPlayer[]
  totalCost: number
}

export function enumerateTeamSplits(four: ScoredPlayer[]): TeamSplit[] {
  if (four.length !== 4) return []
  const [A, B, C, D] = four
  const combos: Array<[[ScoredPlayer, ScoredPlayer], [ScoredPlayer, ScoredPlayer]]> = [
    [
      [A, D],
      [B, C],
    ],
    [
      [A, C],
      [B, D],
    ],
    [
      [A, B],
      [C, D],
    ],
  ]
  return combos.map(([teamA, teamB]) => {
    const teamASum = teamA[0].score + teamA[1].score
    const teamBSum = teamB[0].score + teamB[1].score
    return {
      teamA,
      teamB,
      teamASum,
      teamBSum,
      scoreDiff: Math.abs(teamASum - teamBSum),
      repeatPenalty: 0,
      cost: Math.abs(teamASum - teamBSum),
    }
  })
}

function partnerPenalty(history: PairingHistory | null, a: string, b: string): number {
  if (!history) return 0
  const list = history.recentPartners.get(a) ?? []
  const idx = list.indexOf(b)
  if (idx === 0) return 8
  if (idx >= 1 && idx <= 2) return 4
  if (idx >= 3 && idx <= 4) return 2
  return 0
}

function opponentPenalty(history: PairingHistory | null, a: string, b: string): number {
  if (!history) return 0
  const list = history.recentOpponents.get(a) ?? []
  const idx = list.indexOf(b)
  if (idx === 0) return 3
  if (idx >= 1 && idx <= 2) return 1
  return 0
}

export function applyRepeatPenalties(
  split: TeamSplit,
  history: PairingHistory | null,
): TeamSplit {
  const [a1, a2] = split.teamA
  const [b1, b2] = split.teamB
  let p = 0
  // 파트너 (양방향 중 큰 값만 — 이중 계산 방지로 한 방향 합)
  p += partnerPenalty(history, a1.profile.id, a2.profile.id)
  p += partnerPenalty(history, b1.profile.id, b2.profile.id)
  // 상대
  for (const x of [a1, a2]) {
    for (const y of [b1, b2]) {
      p += opponentPenalty(history, x.profile.id, y.profile.id)
    }
  }
  return {
    ...split,
    repeatPenalty: p,
    cost: split.scoreDiff + p,
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 비용 ≤ best+margin 인 후보 중 가중 랜덤 (낮을수록 유리) */
export function pickWeightedRandom<T extends { cost: number }>(
  candidates: T[],
  rng: () => number,
  margin = 5,
): T {
  if (candidates.length === 0) throw new Error('후보가 없습니다.')
  const sorted = [...candidates].sort((a, b) => a.cost - b.cost)
  const best = sorted[0].cost
  const pool = sorted.filter((c) => c.cost <= best + margin)
  const weights = pool.map((c) => 1 / (1 + (c.cost - best)))
  const sum = weights.reduce((s, w) => s + w, 0)
  let r = rng() * sum
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

function bestSplitsForGroup(
  group: ScoredPlayer[],
  history: PairingHistory | null,
): TeamSplit[] {
  const sorted = [...group].sort((a, b) => b.score - a.score)
  return enumerateTeamSplits(sorted).map((s) => applyRepeatPenalties(s, history))
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c])
  const withoutFirst = combinations(rest, k)
  return [...withFirst, ...withoutFirst]
}

export interface RunDrawOptions {
  mode: DrawMode
  players: ScoredPlayer[]
  history?: PairingHistory | null
  /** 경계 교환 허용 점수 차 */
  boundaryDelta?: number
  rng?: () => number
}

/**
 * 추첨 실행 (N은 4의 배수 권장, 나머지는 sitOut)
 */
export function runDraw(options: RunDrawOptions): DrawResult {
  const rng = options.rng ?? Math.random
  const history = options.history ?? null
  const boundaryDelta = options.boundaryDelta ?? 5
  const sorted = [...options.players].sort((a, b) => b.score - a.score)
  const usableCount = Math.floor(sorted.length / 4) * 4
  const usable = sorted.slice(0, usableCount)
  const sitOut = sorted.slice(usableCount)

  if (usable.length < 4) {
    return { mode: options.mode, matches: [], sitOut: sorted, totalCost: 0 }
  }

  if (options.mode === 'random') {
    const shuffled = shuffle(usable, rng)
    const matches: MatchLineup[] = []
    let totalCost = 0
    for (let i = 0; i < shuffled.length; i += 4) {
      const group = shuffled.slice(i, i + 4)
      const splits = bestSplitsForGroup(group, history)
      const pick = pickWeightedRandom(splits, rng)
      matches.push({
        label: `경기 ${matches.length + 1}`,
        split: pick,
        players: group,
      })
      totalCost += pick.cost
    }
    return { mode: 'random', matches, sitOut, totalCost }
  }

  if (options.mode === 'mixed') {
    // 8명: 두 그룹(4+4) 분할 후보 평가. 그 외: 점수순 청크 후 각 그룹 균형
    if (usable.length === 8) {
      const ids = usable
      const groupCombos = combinations(ids, 4)
      type Cand = { g1: ScoredPlayer[]; g2: ScoredPlayer[]; s1: TeamSplit; s2: TeamSplit; cost: number }
      const cands: Cand[] = []
      const seen = new Set<string>()
      for (const g1 of groupCombos) {
        const g1ids = new Set(g1.map((p) => p.profile.id))
        const g2 = ids.filter((p) => !g1ids.has(p.profile.id))
        const key = [...g1.map((p) => p.profile.id)].sort().join(',')
        if (seen.has(key)) continue
        seen.add(key)
        // 대칭 제거: g2 key도 등록
        seen.add([...g2.map((p) => p.profile.id)].sort().join(','))
        const s1pool = bestSplitsForGroup(g1, history)
        const s2pool = bestSplitsForGroup(g2, history)
        for (const s1 of s1pool) {
          for (const s2 of s2pool) {
            cands.push({ g1, g2, s1, s2, cost: s1.cost + s2.cost })
          }
        }
      }
      const pick = pickWeightedRandom(cands, rng)
      const avg1 = pick.g1.reduce((s, p) => s + p.score, 0) / 4
      const avg2 = pick.g2.reduce((s, p) => s + p.score, 0) / 4
      const highFirst = avg1 >= avg2
      return {
        mode: 'mixed',
        matches: [
          {
            label: highFirst ? '경기 1' : '경기 2',
            split: highFirst ? pick.s1 : pick.s2,
            players: highFirst ? pick.g1 : pick.g2,
          },
          {
            label: highFirst ? '경기 2' : '경기 1',
            split: highFirst ? pick.s2 : pick.s1,
            players: highFirst ? pick.g2 : pick.g1,
          },
        ].sort((a, b) => a.label.localeCompare(b.label)),
        sitOut,
        totalCost: pick.cost,
      }
    }

    // 일반: 랜덤 셔플 후 4명씩
    const shuffled = shuffle(usable, rng)
    const matches: MatchLineup[] = []
    let totalCost = 0
    for (let i = 0; i < shuffled.length; i += 4) {
      const group = shuffled.slice(i, i + 4)
      const pick = pickWeightedRandom(bestSplitsForGroup(group, history), rng)
      matches.push({ label: `경기 ${matches.length + 1}`, split: pick, players: group })
      totalCost += pick.cost
    }
    return { mode: 'mixed', matches, sitOut, totalCost }
  }

  // level: 점수순 그룹 + 경계 교환 후보
  type LevelCand = { groups: ScoredPlayer[][]; splits: TeamSplit[]; cost: number }
  const cands: LevelCand[] = []

  const baseGroups: ScoredPlayer[][] = []
  for (let i = 0; i < usable.length; i += 4) {
    baseGroups.push(usable.slice(i, i + 4))
  }

  const buildCand = (groups: ScoredPlayer[][]) => {
    const pools = groups.map((g) => {
      const all = bestSplitsForGroup(g, history).sort((a, b) => a.cost - b.cost)
      const best = all[0].cost
      return all.filter((s) => s.cost <= best + 5).slice(0, 3)
    })
    const expand = (idx: number, acc: TeamSplit[]): void => {
      if (idx >= pools.length) {
        cands.push({
          groups,
          splits: [...acc],
          cost: acc.reduce((s, x) => s + x.cost, 0),
        })
        return
      }
      for (const s of pools[idx]) {
        acc.push(s)
        expand(idx + 1, acc)
        acc.pop()
      }
    }
    expand(0, [])
  }

  buildCand(baseGroups)

  // 인접 그룹 경계 교환 (첫 두 그룹만 MVP — 8명)
  if (baseGroups.length >= 2) {
    const g0 = baseGroups[0]
    const g1 = baseGroups[1]
    const d = g0[g0.length - 1]
    const e = g1[0]
    if (Math.abs(d.score - e.score) <= boundaryDelta) {
      const swapped0 = [...g0.slice(0, -1), e]
      const swapped1 = [d, ...g1.slice(1)]
      buildCand([swapped0, swapped1, ...baseGroups.slice(2)])
    }
  }

  if (cands.length === 0) {
    return { mode: 'level', matches: [], sitOut, totalCost: 0 }
  }

  const pick = pickWeightedRandom(cands, rng)
  const matches: MatchLineup[] = pick.groups.map((g, i) => ({
    label: i === 0 ? '상위 경기' : i === pick.groups.length - 1 && pick.groups.length > 1 ? '하위 경기' : `경기 ${i + 1}`,
    split: pick.splits[i],
    players: g,
  }))
  // 2그룹이면 라벨 상위/하위
  if (pick.groups.length === 2) {
    matches[0].label = '상위 경기'
    matches[1].label = '하위 경기'
  }

  return { mode: 'level', matches, sitOut, totalCost: pick.cost }
}

export function formatTeamNames(team: [ScoredPlayer, ScoredPlayer], withScore = false): string {
  if (!withScore) {
    return `${team[0].profile.name} · ${team[1].profile.name}`
  }
  return `${team[0].profile.name}(${team[0].score.toFixed(0)}) · ${team[1].profile.name}(${team[1].score.toFixed(0)})`
}
