import { supabase } from '../lib/supabase'
import type {
  BetAmount,
  MatchBet,
  PlayerBetStats,
  RecentBetRow,
  TeamSide,
} from '../types/domain'

/** 경기별 배팅 목록 */
export async function fetchMatchBets(matchId: string): Promise<MatchBet[]> {
  const { data, error } = await supabase
    .from('match_bets')
    .select('*, profile:profiles!match_bets_user_id_fkey(id, name, award_level)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as MatchBet[]).map((row) => ({
    ...row,
    amount: Number(row.amount),
    profile: row.profile ?? null,
  }))
}

/** 배팅 등록·변경 */
export async function placeMatchBet(
  matchId: string,
  amount: BetAmount,
  predictedTeam: TeamSide,
): Promise<MatchBet> {
  const { data, error } = await supabase.rpc('place_match_bet', {
    p_match_id: matchId,
    p_amount: amount,
    p_predicted_team: predictedTeam,
  })
  if (error) throw error
  return data as MatchBet
}

/** 배팅 취소 (미정산만) */
export async function cancelMatchBet(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_match_bet', { p_match_id: matchId })
  if (error) throw error
}

/** 선수 배팅 집계 */
export async function fetchPlayerBetStats(
  userId: string,
  clubId: string,
): Promise<PlayerBetStats> {
  const { data, error } = await supabase.rpc('get_player_bet_stats', {
    p_user_id: userId,
    p_club_id: clubId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    bets_total: Number(row?.bets_total ?? 0),
    bets_won: Number(row?.bets_won ?? 0),
    bets_lost: Number(row?.bets_lost ?? 0),
    bets_push: Number(row?.bets_push ?? 0),
    bets_open: Number(row?.bets_open ?? 0),
    amount_won: Number(row?.amount_won ?? 0),
    amount_lost: Number(row?.amount_lost ?? 0),
    amount_total: Number(row?.amount_total ?? 0),
  }
}

/** 최근 배팅 */
export async function fetchPlayerRecentBets(
  userId: string,
  clubId: string,
  limit = 20,
): Promise<RecentBetRow[]> {
  const { data, error } = await supabase.rpc('get_player_recent_bets', {
    p_user_id: userId,
    p_club_id: clubId,
    p_limit: limit,
  })
  if (error) throw error
  return ((data ?? []) as RecentBetRow[]).map((row) => ({
    ...row,
    amount: Number(row.amount),
  }))
}
