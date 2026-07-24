import { supabase } from '../lib/supabase'
import type { MatchAuditLog, PlayerPosition, Profile, UserRole } from '../types/domain'

// ============================================================
// 관리자 기능 데이터 접근 계층
// 최종 권한 검증은 전부 DB(RPC + 트리거)에서 수행한다.
// ============================================================

/** 전체 사용자 목록 (비활성 포함, 이름 검색 지원) */
export async function fetchAllUsers(search = ''): Promise<Profile[]> {
  let builder = supabase.from('profiles').select('*').order('name', { ascending: true })

  const trimmed = search.trim()
  if (trimmed.length > 0) {
    builder = builder.ilike('name', `%${trimmed}%`)
  }

  const { data, error } = await builder
  if (error) throw error
  return data ?? []
}

/** 사용자 역할/활성 상태 변경 */
export async function adminUpdateUser(
  userId: string,
  updates: { role?: UserRole; is_active?: boolean },
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_user', {
    p_user_id: userId,
    p_role: updates.role ?? null,
    p_is_active: updates.is_active ?? null,
  })
  if (error) throw error
}

/** 슬롯 참가자 강제 변경 (userId가 null이면 비우기) */
export async function adminSetPlayer(
  matchId: string,
  position: PlayerPosition,
  userId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_player', {
    p_match_id: matchId,
    p_position: position,
    p_user_id: userId,
  })
  if (error) throw error
}

/** 확정 경기 포함 스코어 강제 수정 (사유 필수) */
export async function adminUpdateScore(
  matchId: string,
  teamA: number,
  teamB: number,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_score', {
    p_match_id: matchId,
    p_team_a: teamA,
    p_team_b: teamB,
    p_reason: reason,
  })
  if (error) throw error
}

/** 경기 초기화 (스코어 삭제, 편성 상태로 복귀, 사유 필수) */
export async function adminResetMatch(matchId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reset_match', {
    p_match_id: matchId,
    p_reason: reason,
  })
  if (error) throw error
}

/** 감사 로그 조회 (최신순) */
export async function fetchAuditLogs(matchId?: string, limit = 100): Promise<MatchAuditLog[]> {
  let builder = supabase
    .from('match_audit_logs')
    .select('*, changed_by_profile:profiles!match_audit_logs_changed_by_fkey(id, name)')
    .order('changed_at', { ascending: false })
    .limit(limit)

  if (matchId) {
    builder = builder.eq('match_id', matchId)
  }

  const { data, error } = await builder
  if (error) throw error
  return (data ?? []) as unknown as MatchAuditLog[]
}
