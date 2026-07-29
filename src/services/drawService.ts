import { supabase } from '../lib/supabase'
import { fetchPlayerStats } from './statsService'
import { searchActiveProfiles } from './profileService'
import type { MatchWithPlayers, PlayerPosition, Profile } from '../types/domain'
import {
  computePlayerScore,
  RECENT_FORM_MATCH_LIMIT,
  type RecentFormStats,
  type ScoredPlayer,
} from '../utils/drawScore'
import {
  runDraw,
  type DrawMode,
  type DrawResult,
  type PairingHistory,
} from '../utils/drawPairing'
import { ALL_TIME_RANGE } from '../utils/period'
import { positionTeam } from '../types/domain'

/** 클럽 활성 멤버 전체(검색창용, 이름순) */
export async function fetchClubActiveMembers(clubId: string): Promise<Profile[]> {
  return searchActiveProfiles('', clubId, 200)
}

/** 참석자별 최근 N경기 승/무/패 (확정 경기, 최신순) */
export async function fetchRecentFormByUser(
  clubId: string,
  userIds: string[],
  recentLimit = RECENT_FORM_MATCH_LIMIT,
): Promise<Map<string, RecentFormStats>> {
  const result = new Map<string, RecentFormStats>()
  for (const id of userIds) {
    result.set(id, { wins: 0, losses: 0, ties: 0, n: 0 })
  }
  if (userIds.length === 0) return result

  const idSet = new Set(userIds)
  const { data, error } = await supabase
    .from('matches')
    .select(
      'team_a_score, team_b_score, players:match_players(user_id, position)',
    )
    .eq('club_id', clubId)
    .eq('status', 'confirmed')
    .not('team_a_score', 'is', null)
    .not('team_b_score', 'is', null)
    .order('match_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(80)

  if (error) throw error

  for (const raw of data ?? []) {
    const m = raw as {
      team_a_score: number
      team_b_score: number
      players: { user_id: string; position: PlayerPosition }[] | null
    }
    const players = m.players ?? []
    if (players.length === 0) continue

    let aWins = 0
    if (m.team_a_score > m.team_b_score) aWins = 1
    else if (m.team_a_score < m.team_b_score) aWins = -1

    for (const p of players) {
      if (!idSet.has(p.user_id)) continue
      const form = result.get(p.user_id)!
      if (form.n >= recentLimit) continue

      const onA = positionTeam(p.position) === 'A'
      if (aWins === 0) form.ties += 1
      else if ((onA && aWins === 1) || (!onA && aWins === -1)) form.wins += 1
      else form.losses += 1
      form.n += 1
    }

    const allFilled = userIds.every((id) => (result.get(id)?.n ?? 0) >= recentLimit)
    if (allFilled) break
  }

  return result
}

/** 개인점수 일괄 계산 (누적 성적 + 최근 폼) */
export async function scoreAttendees(
  profiles: Profile[],
  clubId: string,
): Promise<ScoredPlayer[]> {
  const [stats, formByUser] = await Promise.all([
    fetchPlayerStats(ALL_TIME_RANGE.from, ALL_TIME_RANGE.to, clubId),
    fetchRecentFormByUser(
      clubId,
      profiles.map((p) => p.id),
      RECENT_FORM_MATCH_LIMIT,
    ),
  ])
  const byId = new Map(stats.map((s) => [s.user_id, s]))
  return profiles
    .map((p) => computePlayerScore(p, byId.get(p.id), formByUser.get(p.id)))
    .sort((a, b) => b.score - a.score)
}

/** 최근 확정 복식에서 파트너·상대 이력 수집 */
export async function fetchPairingHistory(
  clubId: string,
  userIds: string[],
  limitMatches = 40,
): Promise<PairingHistory> {
  const recentPartners = new Map<string, string[]>()
  const recentOpponents = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, userId: string, otherId: string) => {
    const list = map.get(userId) ?? []
    if (!list.includes(otherId)) {
      list.push(otherId)
      map.set(userId, list.slice(0, 5))
    }
  }

  const { data, error } = await supabase
    .from('matches')
    .select('*, players:match_players(*, profile:profiles!match_players_user_id_fkey(id))')
    .eq('club_id', clubId)
    .eq('status', 'confirmed')
    .eq('match_type', 'doubles')
    .order('match_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limitMatches)

  if (error) throw error

  const idSet = new Set(userIds)
  for (const raw of data ?? []) {
    const m = raw as unknown as MatchWithPlayers
    const players = m.players ?? []
    if (players.length < 4) continue
    const involves = players.some((p) => idSet.has(p.user_id))
    if (!involves) continue

    for (const me of players) {
      if (!idSet.has(me.user_id)) continue
      const myTeam = positionTeam(me.position)
      for (const other of players) {
        if (other.user_id === me.user_id) continue
        if (positionTeam(other.position) === myTeam) {
          push(recentPartners, me.user_id, other.user_id)
        } else {
          push(recentOpponents, me.user_id, other.user_id)
        }
      }
    }
  }

  return { recentPartners, recentOpponents }
}

export function executeDraw(
  mode: DrawMode,
  players: ScoredPlayer[],
  history: PairingHistory | null,
): DrawResult {
  return runDraw({ mode, players, history })
}

/** 추첨 결과를 복식 경기로 생성 */
export async function createMatchesFromDraw(
  clubId: string,
  matchDate: string,
  result: DrawResult,
): Promise<string[]> {
  const ids: string[] = []
  for (const m of result.matches) {
    const a1 = m.split.teamA[0].profile.id
    const a2 = m.split.teamA[1].profile.id
    const b1 = m.split.teamB[0].profile.id
    const b2 = m.split.teamB[1].profile.id
    const { data, error } = await supabase.rpc('create_match_lineup', {
      p_match_date: matchDate,
      p_club_id: clubId,
      p_a1: a1,
      p_a2: a2,
      p_b1: b1,
      p_b2: b2,
      p_match_type: 'doubles',
    })
    if (error) throw error
    ids.push(data as string)
  }
  return ids
}
