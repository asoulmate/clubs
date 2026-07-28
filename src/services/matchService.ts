import { supabase } from '../lib/supabase'
import type { MatchType, MatchWithPlayers, PlayerPosition } from '../types/domain'

// ============================================================
// 경기 데이터 접근 계층
// 조회는 RLS SELECT 정책, 쓰기는 전부 RPC 함수를 통해 수행한다.
// ============================================================

// match_players는 profiles에 대한 FK가 2개(user_id, registered_by)이므로
// user_id 기준 FK 이름을 명시하여 조인한다.
const MATCH_SELECT = '*, players:match_players(*, profile:profiles!match_players_user_id_fkey(*))'

/** 특정 날짜의 경기 목록 조회 (참가자 포함) */
export async function fetchMatchesByDate(
  date: string,
  clubId: string,
): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('match_date', date)
    .eq('club_id', clubId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return normalizeMatches((data ?? []) as unknown as MatchWithPlayers[])
}

/** 날짜 구간(포함) 경기 목록 조회 */
export async function fetchMatchesByDateRange(
  fromDate: string,
  toDate: string,
  clubId: string,
): Promise<MatchWithPlayers[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('club_id', clubId)
    .gte('match_date', fromDate)
    .lte('match_date', toDate)
    .order('match_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return normalizeMatches((data ?? []) as unknown as MatchWithPlayers[])
}

/** 단일 경기 조회 (Realtime 이벤트 수신 시 해당 경기만 갱신할 때 사용) */
export async function fetchMatchById(matchId: string): Promise<MatchWithPlayers | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return normalizeMatches([data as unknown as MatchWithPlayers])[0] ?? null
}

function normalizeMatches(matches: MatchWithPlayers[]): MatchWithPlayers[] {
  return matches.map((m) => ({
    ...m,
    youtube_video_id: m.youtube_video_id ?? null,
    youtube_title: m.youtube_title ?? null,
    youtube_matched_at: m.youtube_matched_at ?? null,
    // 마이그레이션 이전 행 호환: 기본 복식 · 비배팅
    match_type: m.match_type === 'singles' ? 'singles' : 'doubles',
    is_betting: Boolean(m.is_betting),
    betting_deadline: m.betting_deadline ?? null,
    players: (m.players ?? []).map((p) => ({
      ...p,
      profile: p.profile
        ? {
            ...p.profile,
            is_guest: Boolean(p.profile.is_guest),
            affiliation: p.profile.affiliation?.trim() ? p.profile.affiliation.trim() : null,
            is_platform_admin: Boolean(p.profile.is_platform_admin),
          }
        : p.profile,
    })),
  }))
}

export interface CreateMatchInput {
  matchDate: string
  clubId: string
  matchType: MatchType
  a2: string | null
  b1: string | null
  b2: string | null
  isBetting: boolean
  /** 배팅 마감 시각 (ISO, 배팅 경기에서 필수) */
  bettingDeadline: string | null
}

/** 신규 경기 생성 (생성자는 A1로 자동 등록됨). 생성된 경기 id 반환 */
export async function createMatch(input: CreateMatchInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_match', {
    p_match_date: input.matchDate,
    p_club_id: input.clubId,
    p_a2: input.matchType === 'singles' ? null : input.a2,
    p_b1: input.b1,
    p_b2: input.matchType === 'singles' ? null : input.b2,
    p_match_type: input.matchType,
    p_is_betting: input.isBetting,
    p_betting_deadline: input.isBetting ? input.bettingDeadline : null,
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

/** 경기 삭제 (개설자: 확정 전 / 관리자·서브 관리자: 항상) */
export async function deleteMatch(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_match', { p_match_id: matchId })
  if (error) throw error
}

/**
 * 현재 경기 중(in_progress)인 사용자 id 목록
 * 검색/편성 UI에서 제외하고, 최종 검증은 DB RPC가 수행한다.
 */
export async function fetchInProgressUserIds(clubId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('match_players')
    .select('user_id, matches!inner(status, club_id)')
    .eq('matches.status', 'in_progress')
    .eq('matches.club_id', clubId)

  if (error) throw error
  return [...new Set((data ?? []).map((row) => row.user_id as string))]
}
