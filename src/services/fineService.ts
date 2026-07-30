import { supabase } from '../lib/supabase'
import type { MatchFineRecord, MatchType } from '../types/domain'

/** 확정 경기 결과에서 계산된 패자별 벌금 상세 */
export async function fetchMatchFineRecords(
  from: string,
  to: string,
  clubId: string,
  options: {
    userId?: string | null
    matchType?: MatchType | null
  } = {},
): Promise<MatchFineRecord[]> {
  const { data, error } = await supabase.rpc('get_match_fine_records', {
    p_from: from,
    p_to: to,
    p_club_id: clubId,
    p_user_id: options.userId ?? null,
    p_match_type: options.matchType ?? null,
  })
  if (error) throw error
  return (data ?? []) as MatchFineRecord[]
}

