import { supabase } from '../lib/supabase'
import type { AwardLevel, Profile } from '../types/domain'

// ============================================================
// 사용자 프로필 데이터 접근 계층
// ============================================================

/** DB 행 → Profile (구스키마 누락 대비) */
function toProfile(row: Profile & { is_guest?: boolean | null; affiliation?: string | null }): Profile {
  const aff = row.affiliation?.trim()
  return {
    ...row,
    is_guest: Boolean(row.is_guest),
    affiliation: aff ? aff : null,
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
 * 이름 부분 검색 (자동완성용)
 * 비활성 사용자는 기본적으로 검색 결과에서 제외한다. (게스트 포함)
 */
export async function searchActiveProfiles(query: string, limit = 20): Promise<Profile[]> {
  let builder = supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(limit)

  const trimmed = query.trim()
  if (trimmed.length > 0) {
    builder = builder.ilike('name', `%${trimmed}%`)
  }

  const { data, error } = await builder
  if (error) throw error
  return (data ?? []).map(toProfile)
}

/**
 * 게스트 선수 수기 등록 (이름 + 입상 + 소속).
 * 동일 이름·입상·소속 활성 게스트가 있으면 DB에서 재사용한다.
 */
export async function createGuestProfile(
  name: string,
  awardLevel: AwardLevel,
  affiliation: string,
): Promise<Profile> {
  const { data, error } = await supabase.rpc('create_guest_profile', {
    p_name: name.trim(),
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
