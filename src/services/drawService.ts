import { supabase } from '../lib/supabase'
import { fetchPlayerStats } from './statsService'
import { searchActiveProfiles } from './profileService'
import type { MatchWithPlayers, Profile } from '../types/domain'
import { computePlayerScore, type ScoredPlayer } from '../utils/drawScore'
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

/** 개인점수 일괄 계산 */
export async function scoreAttendees(
  profiles: Profile[],
  clubId: string,
): Promise<ScoredPlayer[]> {
  const stats = await fetchPlayerStats(ALL_TIME_RANGE.from, ALL_TIME_RANGE.to, clubId)
  const byId = new Map(stats.map((s) => [s.user_id, s]))
  return profiles
    .map((p) => computePlayerScore(p, byId.get(p.id)))
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
