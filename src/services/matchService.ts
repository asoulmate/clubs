import { supabase } from '../lib/supabase'
import type { MatchWithPlayers, PlayerPosition } from '../types/domain'

// ============================================================
// 경기 데이터 접근 계층
// 조회는 RLS SELECT 정책, 쓰기는 전부 RPC 함수를 통해 수행한다.
// ============================================================

// match_players는 profiles에 대한 FK가 2개(user_id, registered_by)이므로
// user_id 기준 FK 이름을 명시하여 조인한다.
const MATCH_SELECT = '*, players:match_players(*, profile:profiles!match_players_user_id_fkey(*))'

/** 특정 날짜의 경기 목록 조회 (참가자 포함) */
export async function fetchMatchesByDate(date: string): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('match_date', date)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as MatchWithPlayers[]
}

/** 단일 경기 조회 (Realtime 이벤트 수신 시 해당 경기만 갱신할 때 사용) */
export async function fetchMatchById(matchId: string): Promise<MatchWithPlayers | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .maybeSingle()

  if (error) throw error
  return data as unknown as MatchWithPlayers | null
}

/** 신규 경기 생성 (생성자는 A1로 자동 등록됨). 생성된 경기 id 반환 */
export async function createMatch(
  matchDate: string,
  a2: string | null,
  b1: string | null,
  b2: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_match', {
    p_match_date: matchDate,
    p_a2: a2,
    p_b1: b1,
    p_b2: b2,
  })
  if (error) throw error
  return data as string
}

/** 빈 슬롯에 참가자 등록 (userId 생략 시 본인 등록) */
export async function registerPlayer(
  matchId: string,
  position: PlayerPosition,
  userId?: string,
): Promise<void> {
  const { error } = await supabase.rpc('register_player', {
    p_match_id: matchId,
    p_position: position,
    p_user_id: userId ?? null,
  })
  if (error) throw error
}

/** 슬롯에서 참가자 제거 */
export async function removePlayer(matchId: string, position: PlayerPosition): Promise<void> {
  const { error } = await supabase.rpc('remove_player', {
    p_match_id: matchId,
    p_position: position,
  })
  if (error) throw error
}

/** 경기 시작 (ready → in_progress) */
export async function startMatch(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('start_match', { p_match_id: matchId })
  if (error) throw error
}

/** 스코어 입력 및 확정 요청 (version: 낙관적 잠금용 현재 버전) */
export async function submitScore(
  matchId: string,
  teamA: number,
  teamB: number,
  expectedVersion: number,
): Promise<void> {
  const { error } = await supabase.rpc('submit_score', {
    p_match_id: matchId,
    p_team_a: teamA,
    p_team_b: teamB,
    p_expected_version: expectedVersion,
  })
  if (error) throw error
}

/** 상대 팀 참가자의 최종 확인 (submitted → confirmed) */
export async function confirmScore(matchId: string, expectedVersion: number): Promise<void> {
  const { error } = await supabase.rpc('confirm_score', {
    p_match_id: matchId,
    p_expected_version: expectedVersion,
  })
  if (error) throw error
}

/** 경기 취소 */
export async function cancelMatch(matchId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_match', {
    p_match_id: matchId,
    p_reason: reason ?? null,
  })
  if (error) throw error
}
