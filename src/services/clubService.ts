import { supabase } from '../lib/supabase'
import type { Club, ClubMembership, UserRole } from '../types/domain'

export async function getClubBySlug(slug: string): Promise<Club> {
  const { data, error } = await supabase.rpc('get_club_by_slug', { p_slug: slug })
  if (error) throw error
  return data as Club
}

export async function listMyClubs(): Promise<ClubMembership[]> {
  const { data, error } = await supabase.rpc('list_my_clubs')
  if (error) throw error
  return (data ?? []) as ClubMembership[]
}

export async function platformListClubs(): Promise<Club[]> {
  const { data, error } = await supabase.rpc('platform_list_clubs')
  if (error) throw error
  return (data ?? []) as Club[]
}

export async function platformCreateClub(input: {
  name: string
  slug: string
  youtube_enabled?: boolean
  absence_enabled?: boolean
}): Promise<Club> {
  const { data, error } = await supabase.rpc('platform_create_club', {
    p_name: input.name,
    p_slug: input.slug,
    p_youtube_enabled: input.youtube_enabled ?? true,
    p_absence_enabled: input.absence_enabled ?? true,
  })
  if (error) throw error
  return data as Club
}

export async function platformUpdateClub(
  clubId: string,
  updates: { name?: string; youtube_enabled?: boolean; absence_enabled?: boolean },
): Promise<Club> {
  const { data, error } = await supabase.rpc('platform_update_club', {
    p_club_id: clubId,
    p_name: updates.name ?? null,
    p_youtube_enabled: updates.youtube_enabled ?? null,
    p_absence_enabled: updates.absence_enabled ?? null,
  })
  if (error) throw error
  return data as Club
}

export async function updateClubFeatureFlags(
  clubId: string,
  updates: { youtube_enabled?: boolean; absence_enabled?: boolean },
): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club_feature_flags', {
    p_club_id: clubId,
    p_youtube_enabled: updates.youtube_enabled ?? null,
    p_absence_enabled: updates.absence_enabled ?? null,
  })
  if (error) throw error
  return data as Club
}

export async function requestClubJoin(clubId: string): Promise<void> {
  const { error } = await supabase.rpc('request_club_join', { p_club_id: clubId })
  if (error) throw error
}

export async function approveClubMember(
  clubId: string,
  userId: string,
  approve: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('approve_club_member', {
    p_club_id: clubId,
    p_user_id: userId,
    p_approve: approve,
  })
  if (error) throw error
}

export async function setClubMemberRole(
  clubId: string,
  userId: string,
  role: UserRole,
): Promise<void> {
  const { error } = await supabase.rpc('set_club_member_role', {
    p_club_id: clubId,
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw error
}

/** 클럽 멤버 목록 (profiles 조인) */
export async function fetchClubMembers(clubId: string) {
  const { data, error } = await supabase
    .from('club_members')
    .select('club_id, user_id, role, status, created_at, profile:profiles(*)')
    .eq('club_id', clubId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}
