import { supabase } from '../lib/supabase'
import { fetchClubMembers } from './clubService'
import type {
  AwardLevel,
  ClubMemberStatus,
  MatchAuditLog,
  PlayerPosition,
  Profile,
  UserRole,
} from '../types/domain'

// ============================================================
// 관리자 기능 데이터 접근 계층
// 최종 권한 검증은 전부 DB(RPC + 트리거)에서 수행한다.
// ============================================================

export interface ClubUserRow {
  user_id: string
  role: UserRole
  status: ClubMemberStatus
  profile: Profile
}

/** 클럽 멤버 목록 (pending 포함, 이름 검색 지원) */
export async function fetchClubUsers(clubId: string, search = ''): Promise<ClubUserRow[]> {
  const members = await fetchClubMembers(clubId)
  const trimmed = search.trim().toLowerCase()

  return members
    .map((row) => {
      const raw = (row as { profile: Profile | Profile[] | null }).profile
      const profile = Array.isArray(raw) ? raw[0] : raw
      if (!profile) return null
      return {
        user_id: (row as { user_id: string }).user_id,
        role: (row as { role: UserRole }).role,
        status: (row as { status: ClubMemberStatus }).status,
        profile: {
          ...profile,
          is_guest: Boolean(profile.is_guest),
          affiliation: profile.affiliation?.trim() ? profile.affiliation.trim() : null,
          is_platform_admin: Boolean(profile.is_platform_admin),
          // 클럽 컨텍스트 역할로 표시
          role: (row as { role: UserRole }).role,
        },
      } satisfies ClubUserRow
    })
    .filter((row): row is ClubUserRow => Boolean(row))
    .filter((row) =>
      trimmed.length > 0 ? row.profile.name.toLowerCase().includes(trimmed) : true,
    )
    .sort((a, b) => a.profile.name.localeCompare(b.profile.name, 'ko'))
}

/** @deprecated 클럽 단위에서는 fetchClubUsers 사용 */
export async function fetchAllUsers(search = ''): Promise<Profile[]> {
  let builder = supabase.from('profiles').select('*').order('name', { ascending: true })

  const trimmed = search.trim()
  if (trimmed.length > 0) {
    builder = builder.ilike('name', `%${trimmed}%`)
  }

  const { data, error } = await builder
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    is_guest: Boolean(row.is_guest),
    affiliation: row.affiliation?.trim() ? row.affiliation.trim() : null,
    is_platform_admin: Boolean(row.is_platform_admin),
  }))
}

/** 사용자 이름/입상/활성 변경 (역할은 setClubMemberRole 사용) */
export async function adminUpdateUser(
  userId: string,
  updates: {
    role?: UserRole
    is_active?: boolean
    name?: string
    award_level?: AwardLevel
  },
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_user', {
    p_user_id: userId,
    p_role: updates.role ?? null,
    p_is_active: updates.is_active ?? null,
    p_name: updates.name ?? null,
    p_award_level: updates.award_level ?? null,
  })
  if (error) throw error
}

/** 메인 관리자: 비밀번호를 123456으로 초기화 */
export async function adminResetUserPassword(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reset_user_password', {
    p_user_id: userId,
  })
  if (error) throw error
}

/**
 * 게스트 삭제 또는 회원 탈퇴
 * 반환: guest_deleted | guest_deactivated | member_withdrawn | member_deactivated
 */
export async function adminRemoveUser(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_remove_user', {
    p_user_id: userId,
  })
  if (error) throw error
  return (data as string) ?? 'ok'
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
