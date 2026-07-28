import { supabase } from '../lib/supabase'
import type {
  MatchType,
  MonthlyTrendRow,
  OpponentStatsRow,
  PartnerStatsRow,
  PlayerStatsRow,
  RecentMatchRow,
} from '../types/domain'

// ============================================================
// 통계 데이터 접근 계층
// 집계는 전부 DB(RPC)에서 수행하고 프런트는 결과만 받아 순위를 부여한다.
// ============================================================

/** 기간별 전체 사용자 집계 (확정 경기만 포함). matchType 생략 시 단식+복식 전체 */
export async function fetchPlayerStats(
  from: string,
  to: string,
  clubId: string,
  matchType: MatchType | null = null,
): Promise<PlayerStatsRow[]> {
  const { data, error } = await supabase.rpc('get_player_stats', {
    p_from: from,
    p_to: to,
    p_club_id: clubId,
    p_match_type: matchType,
  })
  if (error) throw error
  return ((data ?? []) as PlayerStatsRow[]).map((row) => ({
    ...row,
    is_guest: Boolean(row.is_guest),
    affiliation: row.affiliation?.trim() ? row.affiliation.trim() : null,
  }))
}

/** 특정 사용자의 누적 요약 (이름 클릭 팝오버용) */
export async function fetchPlayerSummary(
  userId: string,
  from: string,
  to: string,
  clubId: string,
): Promise<PlayerStatsRow | null> {
  const rows = await fetchPlayerStats(from, to, clubId)
  return rows.find((r) => r.user_id === userId) ?? null
}

/** 파트너별 집계 */
export async function fetchPartnerStats(
  userId: string,
  from: string,
  to: string,
  clubId: string,
): Promise<PartnerStatsRow[]> {
  const { data, error } = await supabase.rpc('get_partner_stats', {
    p_user_id: userId,
    p_from: from,
    p_to: to,
    p_club_id: clubId,
  })
  if (error) throw error
  return (data ?? []) as PartnerStatsRow[]
}

/** 상대별 집계 (반대 팀 선수) */
export async function fetchOpponentStats(
  userId: string,
  from: string,
  to: string,
  clubId: string,
): Promise<OpponentStatsRow[]> {
  const { data, error } = await supabase.rpc('get_opponent_stats', {
    p_user_id: userId,
    p_from: from,
    p_to: to,
    p_club_id: clubId,
  })
  if (error) throw error
  return (data ?? []) as OpponentStatsRow[]
}

/** 월별 경기 추이 */
export async function fetchMonthlyTrend(
  userId: string,
  clubId: string,
  months = 12,
): Promise<MonthlyTrendRow[]> {
  const { data, error } = await supabase.rpc('get_player_monthly_trend', {
    p_user_id: userId,
    p_months: months,
    p_club_id: clubId,
  })
  if (error) throw error
  return (data ?? []) as MonthlyTrendRow[]
}

/** 최근 경기 목록 */
export async function fetchRecentMatches(
  userId: string,
  clubId: string,
  limit = 10,
): Promise<RecentMatchRow[]> {
  const { data, error } = await supabase.rpc('get_player_recent_matches', {
    p_user_id: userId,
    p_limit: limit,
    p_club_id: clubId,
  })
  if (error) throw error
  return ((data ?? []) as RecentMatchRow[]).map((row) => ({
    ...row,
    partner_awards: row.partner_awards ?? [],
    opponent_awards: row.opponent_awards ?? [],
  }))
}
