import { supabase } from '../lib/supabase'
import type { Profile } from '../types/domain'

// ============================================================
// 무단 결석 데이터 접근 계층
// ============================================================

export interface AbsenceRow {
  id: string
  absence_date: string
  user_id: string
  registered_by: string
  created_at: string
  profile: Profile
}

/** 특정 날짜의 무단 결석 목록 */
export async function fetchAbsencesByDate(date: string): Promise<AbsenceRow[]> {
  const { data, error } = await supabase
    .from('unexcused_absences')
    .select('*, profile:profiles!unexcused_absences_user_id_fkey(*)')
    .eq('absence_date', date)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as AbsenceRow[]
}

/** 무단 결석 등록 */
export async function addUnexcusedAbsence(date: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_unexcused_absence', {
    p_absence_date: date,
    p_user_id: userId,
  })
  if (error) throw error
}

/** 무단 결석 삭제 */
export async function removeUnexcusedAbsence(date: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_unexcused_absence', {
    p_absence_date: date,
    p_user_id: userId,
  })
  if (error) throw error
}
