import { supabase } from '../lib/supabase'
import type {
  ShadowRatingEgo,
  ShadowRatingExclusion,
  ShadowRatingGraph,
  ShadowRatingPath,
  ShadowRatingPool,
  ShadowRatingRow,
} from '../types/domain'

function mapRatingRow(row: Record<string, unknown>): ShadowRatingRow {
  return {
    global_player_id: String(row.global_player_id),
    player_name: String(row.player_name),
    rating: Number(row.rating),
    uncertainty: Number(row.uncertainty),
    provisional: Boolean(row.provisional),
    games_played: Number(row.games_played),
    opponent_count: Number(row.opponent_count),
    linked_club_count: Number(row.linked_club_count),
    last_calculated_at: String(row.last_calculated_at ?? ''),
    model_version: String(row.model_version ?? ''),
    run_id: String(row.run_id ?? ''),
    excluded_match_count: Number(row.excluded_match_count ?? 0),
  }
}

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
  return (data ?? []).map((row: Record<string, unknown>) => mapRatingRow(row))
}

export async function getShadowRatingLeaderboard(poolId: string): Promise<ShadowRatingRow[]> {
  const { data, error } = await supabase.rpc('get_shadow_rating_leaderboard_v1', {
    p_pool_id: poolId,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => mapRatingRow(row))
}

export async function getShadowRatingEgo(
  poolId: string,
  playerId: string,
  hops = 2,
): Promise<ShadowRatingEgo> {
  const { data, error } = await supabase.rpc('get_shadow_rating_ego_v1', {
    p_pool_id: poolId,
    p_player_id: playerId,
    p_hops: hops,
  })
  if (error) throw error
  const raw = (data ?? {}) as Record<string, unknown>
  const center = raw.center as Record<string, unknown> | null
  return {
    center: center
      ? {
          global_player_id: String(center.global_player_id),
          player_name: String(center.player_name),
          rating: Number(center.rating),
          uncertainty: Number(center.uncertainty),
        }
      : null,
    nodes: ((raw.nodes as Record<string, unknown>[]) ?? []).map((n) => ({
      global_player_id: String(n.global_player_id),
      player_name: String(n.player_name),
      rating: n.rating == null ? null : Number(n.rating),
      uncertainty: n.uncertainty == null ? null : Number(n.uncertainty),
      hop: Number(n.hop),
      games_vs_center: Number(n.games_vs_center ?? 0),
    })),
    edges: ((raw.edges as Record<string, unknown>[]) ?? []).map((e) => ({
      from_id: String(e.from_id),
      to_id: String(e.to_id),
      match_count: Number(e.match_count),
    })),
  }
}

export async function getShadowRatingPath(
  poolId: string,
  fromId: string,
  toId: string,
): Promise<ShadowRatingPath> {
  const { data, error } = await supabase.rpc('get_shadow_rating_path_v1', {
    p_pool_id: poolId,
    p_from: fromId,
    p_to: toId,
  })
  if (error) throw error
  const raw = (data ?? {}) as Record<string, unknown>
  return {
    found: Boolean(raw.found),
    path: ((raw.path as unknown[]) ?? []).map(String),
    nodes: ((raw.nodes as Record<string, unknown>[]) ?? []).map((n) => ({
      global_player_id: String(n.global_player_id),
      player_name: String(n.player_name),
      rating: n.rating == null ? null : Number(n.rating),
      uncertainty: n.uncertainty == null ? null : Number(n.uncertainty),
    })),
    hops: ((raw.hops as Record<string, unknown>[]) ?? []).map((h) => ({
      from_id: String(h.from_id),
      to_id: String(h.to_id),
      from_name: String(h.from_name),
      to_name: String(h.to_name),
      match_id: h.match_id == null ? null : String(h.match_id),
      match_date: h.match_date == null ? null : String(h.match_date),
      team_a_score: h.team_a_score == null ? null : Number(h.team_a_score),
      team_b_score: h.team_b_score == null ? null : Number(h.team_b_score),
      club_name: h.club_name == null ? null : String(h.club_name),
    })),
  }
}

export async function getShadowRatingGraph(poolId: string): Promise<ShadowRatingGraph> {
  const { data, error } = await supabase.rpc('get_shadow_rating_graph_v1', {
    p_pool_id: poolId,
  })
  if (error) throw error
  const raw = (data ?? {}) as Record<string, unknown>
  return {
    nodes: ((raw.nodes as Record<string, unknown>[]) ?? []).map((n) => ({
      global_player_id: String(n.global_player_id),
      player_name: String(n.player_name),
      rating: Number(n.rating),
      uncertainty: Number(n.uncertainty),
      games_played: Number(n.games_played),
      provisional: Boolean(n.provisional),
    })),
    edges: ((raw.edges as Record<string, unknown>[]) ?? []).map((e) => ({
      from_id: String(e.from_id),
      to_id: String(e.to_id),
      match_count: Number(e.match_count),
      match_id: e.match_id == null ? null : String(e.match_id),
      match_date: e.match_date == null ? null : String(e.match_date),
      team_a_score: e.team_a_score == null ? null : Number(e.team_a_score),
      team_b_score: e.team_b_score == null ? null : Number(e.team_b_score),
      club_name: e.club_name == null ? null : String(e.club_name),
    })),
  }
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
