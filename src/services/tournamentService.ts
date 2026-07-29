import { supabase } from '../lib/supabase'
import type {
  TournamentEntry,
  TournamentEntryInput,
  TournamentMonthlySummary,
  TournamentPlacement,
} from '../types/domain'

function toMonthFirstDay(yearMonth: string): string {
  // 'YYYY-MM' or 'YYYY-MM-DD' → 'YYYY-MM-01'
  const ym = yearMonth.slice(0, 7)
  return `${ym}-01`
}

function normalizeEntry(row: TournamentEntry): TournamentEntry {
  return {
    ...row,
    max_participants: row.max_participants ?? null,
    notes: row.notes?.trim() ? row.notes.trim() : null,
    profile: row.profile ?? null,
  }
}

/** 회원별 대회 참가 목록 (최신순) */
export async function fetchTournamentEntriesForUser(
  clubId: string,
  userId: string,
): Promise<TournamentEntry[]> {
  const { data, error } = await supabase
    .from('tournament_entries')
    .select('*')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .order('tournament_month', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as TournamentEntry[]).map(normalizeEntry)
}

export interface ClubTournamentFilter {
  fromMonth?: string | null
  toMonth?: string | null
  placement?: TournamentPlacement | 'awarded' | null
  maxParticipantsLte?: number | null
  userId?: string | null
}

/** 클럽 대회 참가 목록 (필터·기간) */
export async function fetchClubTournamentEntries(
  clubId: string,
  filter: ClubTournamentFilter = {},
): Promise<TournamentEntry[]> {
  let q = supabase
    .from('tournament_entries')
    .select(
      '*, profile:profiles!tournament_entries_user_id_fkey(id, name, award_level)',
    )
    .eq('club_id', clubId)
    .order('tournament_month', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (filter.fromMonth) {
    q = q.gte('tournament_month', toMonthFirstDay(filter.fromMonth))
  }
  if (filter.toMonth) {
    q = q.lte('tournament_month', toMonthFirstDay(filter.toMonth))
  }
  if (filter.userId) {
    q = q.eq('user_id', filter.userId)
  }
  if (filter.placement === 'awarded') {
    q = q.in('placement', ['champion', 'runner_up', 'third'])
  } else if (filter.placement) {
    q = q.eq('placement', filter.placement)
  }
  if (filter.maxParticipantsLte != null && filter.maxParticipantsLte > 0) {
    q = q
      .not('max_participants', 'is', null)
      .lte('max_participants', filter.maxParticipantsLte)
  }

  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as TournamentEntry[]).map(normalizeEntry)
}

/** 월별 참가·입상 요약 */
export async function fetchTournamentMonthlySummary(
  clubId: string,
  fromMonth?: string | null,
  toMonth?: string | null,
  maxParticipantsLte?: number | null,
): Promise<TournamentMonthlySummary[]> {
  const { data, error } = await supabase.rpc('get_tournament_monthly_summary', {
    p_club_id: clubId,
    p_from: fromMonth ? toMonthFirstDay(fromMonth) : null,
    p_to: toMonth ? toMonthFirstDay(toMonth) : null,
    p_max_participants_lte: maxParticipantsLte ?? null,
  })
  if (error) throw error
  return (data ?? []) as TournamentMonthlySummary[]
}

/** 대회 참가 등록 */
export async function createTournamentEntry(
  clubId: string,
  userId: string,
  input: TournamentEntryInput,
  createdBy: string,
): Promise<TournamentEntry> {
  const name = input.tournamentName.trim()
  if (!name) throw new Error('대회명을 입력해주세요.')

  const { data, error } = await supabase
    .from('tournament_entries')
    .insert({
      club_id: clubId,
      user_id: userId,
      tournament_month: toMonthFirstDay(input.tournamentMonth),
      tournament_name: name,
      placement: input.placement,
      max_participants: input.maxParticipants,
      notes: input.notes?.trim() || null,
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error) throw error
  return normalizeEntry(data as TournamentEntry)
}

/** 대회 참가 수정 */
export async function updateTournamentEntry(
  entryId: string,
  input: TournamentEntryInput,
): Promise<TournamentEntry> {
  const name = input.tournamentName.trim()
  if (!name) throw new Error('대회명을 입력해주세요.')

  const { data, error } = await supabase
    .from('tournament_entries')
    .update({
      tournament_month: toMonthFirstDay(input.tournamentMonth),
      tournament_name: name,
      placement: input.placement,
      max_participants: input.maxParticipants,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .select('*')
    .single()

  if (error) throw error
  return normalizeEntry(data as TournamentEntry)
}

/** 대회 참가 삭제 */
export async function deleteTournamentEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from('tournament_entries').delete().eq('id', entryId)
  if (error) throw error
}

/** input type=month 값용 (YYYY-MM) */
export function monthInputValue(tournamentMonth: string): string {
  return tournamentMonth.slice(0, 7)
}

/** YYYY-MM → 표시용 2026.07 */
export function formatTournamentMonth(tournamentMonth: string): string {
  const [y, m] = tournamentMonth.slice(0, 7).split('-')
  return `${y}.${m}`
}
