import { supabase } from '../lib/supabase'
import type {
  ShadowRatingExclusion,
  ShadowRatingPool,
  ShadowRatingRow,
} from '../types/domain'

export async function listShadowRatingPools(): Promise<ShadowRatingPool[]> {
  const { data, error } = await supabase.rpc('list_shadow_rating_pools_v1')
  if (error) throw error
  return (data ?? []) as ShadowRatingPool[]
}

export async function runShadowRating(poolId: string): Promise<string> {
  const { data, error } = await supabase.rpc('run_shadow_team_elo_v1', {
    p_pool_id: poolId,
  })
  if (error) throw error
  return data as string
}

export async function getShadowRatingSummary(
  clubId: string,
  poolId: string,
): Promise<ShadowRatingRow[]> {
  const { data, error } = await supabase.rpc('get_shadow_rating_summary_v1', {
    p_club_id: clubId,
    p_pool_id: poolId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    rating: Number(row.rating),
    uncertainty: Number(row.uncertainty),
    games_played: Number(row.games_played),
    opponent_count: Number(row.opponent_count),
    linked_club_count: Number(row.linked_club_count),
    excluded_match_count: Number(row.excluded_match_count),
  })) as ShadowRatingRow[]
}

export async function getShadowRatingExclusions(
  runId: string,
): Promise<ShadowRatingExclusion[]> {
  const { data, error } = await supabase.rpc('get_shadow_rating_exclusions_v1', {
    p_run_id: runId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    exclusion_reason: String(row.exclusion_reason),
    match_count: Number(row.match_count),
  }))
}
