import { supabase } from '../lib/supabase'
import type { AwardLevel, Profile } from '../types/domain'

// ============================================================
// 사용자 프로필 데이터 접근 계층
// ============================================================

/** 내 프로필 조회 */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

/** 프로필 단건 조회 (이름 클릭 요약 등) */
export async function fetchProfileById(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * 이름 부분 검색 (자동완성용)
 * 비활성 사용자는 기본적으로 검색 결과에서 제외한다.
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
  return data ?? []
}

/** 내 프로필 수정 (이름, 입상 구분만 — role/is_active는 DB 트리거가 차단) */
export async function updateMyProfile(
  userId: string,
  updates: { name?: string; award_level?: AwardLevel },
): Promise<void> {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId)
  if (error) throw error
}
