import { supabase } from '../lib/supabase'
import type { AwardLevel, Profile } from '../types/domain'

// ============================================================
// 사용자 프로필 데이터 접근 계층
// ============================================================

/** DB 행 → Profile (구스키마 누락 대비)
 *  profiles.role 은 레거시이며 권한 소스가 아님.
 *  클럽 진입 전엔 user 로 두고, 클럽 멤버십/플랫폼 플래그로 덮어쓴다.
 */
function toProfile(
  row: Profile & {
    is_guest?: boolean | null
    affiliation?: string | null
    is_platform_admin?: boolean | null
  },
): Profile {
  const aff = row.affiliation?.trim()
  const isPlatformAdmin = Boolean(row.is_platform_admin)
  return {
    ...row,
    is_guest: Boolean(row.is_guest),
    affiliation: aff ? aff : null,
    is_platform_admin: isPlatformAdmin,
    // 클럽 역할은 clubStore가 덮어씀. 프로필 단독 조회 시 기본 user
    role: 'user',
  }
}

/** 내 프로필 조회 */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data ? toProfile(data) : null
}

/** 프로필 단건 조회 (이름 클릭 요약 등) */
export async function fetchProfileById(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data ? toProfile(data) : null
}

/**
 * 클럽 활성 멤버 이름 부분 검색 (자동완성용)
 * club_members → profiles 조인 후 클라이언트에서 이름 필터
 */
export async function searchActiveProfiles(
  query: string,
  clubId: string,
  limit = 20,
): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('club_members')
    .select('profile:profiles(*)')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .limit(200)

  if (error) throw error

  const trimmed = query.trim().toLowerCase()
  const profiles = (data ?? [])
    .map((row) => {
      const profile = (row as { profile: Profile | Profile[] | null }).profile
      const p = Array.isArray(profile) ? profile[0] : profile
      return p ? toProfile(p) : null
    })
    .filter((p): p is Profile => p !== null && p.is_active)
    .filter((p) => (trimmed.length > 0 ? p.name.toLowerCase().includes(trimmed) : true))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit)

  return profiles
}

/**
 * 게스트 선수 수기 등록 (이름 + 입상 + 소속).
 * 동일 이름·입상·소속 활성 게스트가 있으면 DB에서 재사용한다.
 */
export async function createGuestProfile(
  name: string,
  awardLevel: AwardLevel,
  affiliation: string,
  clubId: string,
): Promise<Profile> {
  const { data, error } = await supabase.rpc('create_guest_profile', {
    p_name: name.trim(),
    p_club_id: clubId,
    p_award_level: awardLevel,
    p_affiliation: affiliation.trim(),
  })
  if (error) throw error
  return toProfile(data as Profile)
}

/** 내 프로필 수정 (이름, 입상 구분만 — role/is_active는 DB 트리거가 차단) */
export async function updateMyProfile(
  userId: string,
  updates: { name?: string; award_level?: AwardLevel },
): Promise<void> {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId)
  if (error) throw error
}
