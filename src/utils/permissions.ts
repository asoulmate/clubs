import type { MatchWithPlayers, Profile } from '../types/domain'
import { positionTeam } from '../types/domain'

// ============================================================
// 권한 판정 공통 함수
// 주의: 여기서의 판정은 UI 표시(버튼 노출 등) 용도일 뿐이며,
// 실제 권한 검증은 Supabase RPC와 RLS가 DB에서 수행한다.
// ============================================================

/** 관리자 또는 서브 관리자 여부 */
export function isAdminOrSub(profile: Profile | null): boolean {
  return profile?.role === 'admin' || profile?.role === 'sub_admin'
}

/** 관리자 여부 */
export function isAdmin(profile: Profile | null): boolean {
  return profile?.role === 'admin'
}

/** 해당 경기의 참가자 여부 */
export function isParticipant(userId: string | undefined, match: MatchWithPlayers): boolean {
  if (!userId) return false
  return match.players.some((p) => p.user_id === userId)
}

/** 스코어 입력/수정 버튼을 보여줄 수 있는지 (확정 전, 참가자 또는 관리자) */
export function canSubmitScore(profile: Profile | null, match: MatchWithPlayers): boolean {
  if (!profile) return false
  if (match.status === 'canceled' || match.status === 'confirmed') return false
  if (match.players.length < 4) return false
  return isParticipant(profile.id, match) || isAdminOrSub(profile)
}

/** 최종 확인 버튼을 보여줄 수 있는지 (확정 대기 + 상대 팀 참가자) */
export function canConfirmScore(profile: Profile | null, match: MatchWithPlayers): boolean {
  if (!profile || match.status !== 'submitted') return false
  const me = match.players.find((p) => p.user_id === profile.id)
  if (!me) return false
  const submitter = match.players.find((p) => p.user_id === match.score_submitted_by)
  // 제출자가 참가자가 아니면(관리자 입력) 어느 팀이든 확인 가능
  if (!submitter) return true
  return positionTeam(me.position) !== positionTeam(submitter.position)
}

/** 경기 취소 버튼을 보여줄 수 있는지 */
export function canCancelMatch(profile: Profile | null, match: MatchWithPlayers): boolean {
  if (!profile || match.status === 'canceled') return false
  if (isAdminOrSub(profile)) return true
  return (
    match.created_by === profile.id &&
    (match.status === 'open' || match.status === 'ready' || match.status === 'in_progress')
  )
}

/** 슬롯의 참가자를 제거할 수 있는지 */
export function canRemovePlayer(
  profile: Profile | null,
  match: MatchWithPlayers,
  playerUserId: string,
  registeredBy: string,
): boolean {
  if (!profile) return false
  if (isAdminOrSub(profile)) return true
  if (match.status !== 'open' && match.status !== 'ready') return false
  return playerUserId === profile.id || registeredBy === profile.id
}
