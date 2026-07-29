import { supabase } from '../lib/supabase'
import { AWARD_LEVEL_LABELS, MATCH_STATUS_LABELS, MATCH_TYPE_LABELS } from '../constants/labels'
import type {
  AwardLevel,
  MatchStatus,
  MatchType,
  MatchWithPlayers,
  PlayerPosition,
} from '../types/domain'
import { winnerTeam } from '../utils/score'
import { fetchClubUsers } from './adminService'

const MATCH_SELECT = '*, players:match_players(*, profile:profiles!match_players_user_id_fkey(*))'
const PAGE = 1000

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const page = await fetchPage(from, from + PAGE - 1)
    all.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return all
}

function normalizeMatch(m: MatchWithPlayers): MatchWithPlayers {
  return {
    ...m,
    youtube_video_id: m.youtube_video_id ?? null,
    youtube_title: m.youtube_title ?? null,
    youtube_matched_at: m.youtube_matched_at ?? null,
    match_type: m.match_type === 'singles' ? 'singles' : 'doubles',
    is_betting: Boolean(m.is_betting),
    betting_deadline: m.betting_deadline ?? null,
    display_order: typeof m.display_order === 'number' ? m.display_order : 0,
    players: (m.players ?? []).map((p) => ({
      ...p,
      profile: p.profile
        ? {
            ...p.profile,
            is_guest: Boolean(p.profile.is_guest),
            affiliation: p.profile.affiliation?.trim() ? p.profile.affiliation.trim() : null,
            is_platform_admin: Boolean(p.profile.is_platform_admin),
          }
        : p.profile,
    })),
  }
}

/** 클럽에서 가장 이른 경기일 (없으면 null) */
export async function fetchEarliestMatchDate(clubId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('match_date')
    .eq('club_id', clubId)
    .order('match_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { match_date: string } | null)?.match_date ?? null
}

/** 기간·클럽 경기 전체 (페이지네이션) */
export async function fetchExportMatches(
  clubId: string,
  fromDate: string,
  toDate: string,
): Promise<MatchWithPlayers[]> {
  const rows = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .eq('club_id', clubId)
      .gte('match_date', fromDate)
      .lte('match_date', toDate)
      .order('match_date', { ascending: true })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, to)
    if (error) throw error
    return (data ?? []) as unknown as MatchWithPlayers[]
  })
  return rows.map(normalizeMatch)
}

/** 기간·클럽 무단결석 */
export async function fetchExportAbsences(
  clubId: string,
  fromDate: string,
  toDate: string,
): Promise<
  {
    id: string
    absence_date: string
    user_id: string
    registered_by: string
    created_at: string
    profile: { name: string; award_level: AwardLevel; is_guest: boolean; affiliation: string | null }
  }[]
> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('unexcused_absences')
      .select(
        'id, absence_date, user_id, registered_by, created_at, profile:profiles!unexcused_absences_user_id_fkey(name, award_level, is_guest, affiliation)',
      )
      .eq('club_id', clubId)
      .gte('absence_date', fromDate)
      .lte('absence_date', toDate)
      .order('absence_date', { ascending: true })
      .range(from, to)
    if (error) throw error
    return (data ?? []) as unknown as {
      id: string
      absence_date: string
      user_id: string
      registered_by: string
      created_at: string
      profile: {
        name: string
        award_level: AwardLevel
        is_guest: boolean
        affiliation: string | null
      }
    }[]
  })
}

/** 기간 내 경기에 걸린 배팅 */
export async function fetchExportBets(
  clubId: string,
  fromDate: string,
  toDate: string,
): Promise<
  {
    id: string
    match_id: string
    user_id: string
    amount: number
    predicted_team: string
    result: string | null
    settled_at: string | null
    created_at: string
    match: {
      match_date: string
      match_type: MatchType
      status: MatchStatus
      team_a_score: number | null
      team_b_score: number | null
    } | null
    profile: { name: string } | null
  }[]
> {
  const matchIds = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('matches')
      .select('id')
      .eq('club_id', clubId)
      .gte('match_date', fromDate)
      .lte('match_date', toDate)
      .range(from, to)
    if (error) throw error
    return (data ?? []) as { id: string }[]
  })

  if (matchIds.length === 0) return []

  const ids = matchIds.map((m) => m.id)
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 200) {
    chunks.push(ids.slice(i, i + 200))
  }

  const all: {
    id: string
    match_id: string
    user_id: string
    amount: number
    predicted_team: string
    result: string | null
    settled_at: string | null
    created_at: string
    match: {
      match_date: string
      match_type: MatchType
      status: MatchStatus
      team_a_score: number | null
      team_b_score: number | null
    } | null
    profile: { name: string } | null
  }[] = []

  for (const chunk of chunks) {
    const page = await fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from('match_bets')
        .select(
          'id, match_id, user_id, amount, predicted_team, result, settled_at, created_at, profile:profiles!match_bets_user_id_fkey(name), match:matches!match_bets_match_id_fkey(match_date, match_type, status, team_a_score, team_b_score)',
        )
        .eq('club_id', clubId)
        .in('match_id', chunk)
        .order('created_at', { ascending: true })
        .range(from, to)
      if (error) throw error
      return ((data ?? []) as unknown as {
        id: string
        match_id: string
        user_id: string
        amount: number
        predicted_team: string
        result: string | null
        settled_at: string | null
        created_at: string
        match:
          | {
              match_date: string
              match_type: MatchType
              status: MatchStatus
              team_a_score: number | null
              team_b_score: number | null
            }
          | {
              match_date: string
              match_type: MatchType
              status: MatchStatus
              team_a_score: number | null
              team_b_score: number | null
            }[]
          | null
        profile: { name: string } | { name: string }[] | null
      }[]).map((row) => {
        const match = Array.isArray(row.match) ? row.match[0] : row.match
        const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
        return {
          ...row,
          amount: Number(row.amount),
          match: match ?? null,
          profile: profile ?? null,
        }
      })
    })
    all.push(...page)
  }

  return all
}

function playerAt(match: MatchWithPlayers, position: PlayerPosition) {
  return match.players.find((p) => p.position === position)
}

function awardLabel(level: AwardLevel | undefined): string {
  if (!level) return ''
  return AWARD_LEVEL_LABELS[level] ?? level
}

type ExportBet = Awaited<ReturnType<typeof fetchExportBets>>[number]
type ExportAbsence = Awaited<ReturnType<typeof fetchExportAbsences>>[number]

function slotFields(match: MatchWithPlayers, position: PlayerPosition, prefix: string) {
  const p = playerAt(match, position)
  return {
    [`${prefix}_user_id`]: p?.user_id ?? '',
    [`${prefix}_name`]: p?.profile?.name ?? '',
    [`${prefix}_award`]: awardLabel(p?.profile?.award_level),
    [`${prefix}_is_guest`]: p?.profile?.is_guest ? 1 : 0,
    [`${prefix}_affiliation`]: p?.profile?.affiliation ?? '',
  }
}

/**
 * 경기 통합 CSV (한 행 = 한 경기)
 * - 상태·선수·점수·승패 + 해당 경기 배팅 요약
 * - AI 분석 시 status=confirmed 로 필터하면 됨
 */
export function buildMatchesCsv(
  matches: MatchWithPlayers[],
  bets: ExportBet[] = [],
): Record<string, unknown>[] {
  const betsByMatch = new Map<string, ExportBet[]>()
  for (const b of bets) {
    const list = betsByMatch.get(b.match_id) ?? []
    list.push(b)
    betsByMatch.set(b.match_id, list)
  }

  return matches.map((m) => {
    const winner =
      m.status === 'confirmed' && m.team_a_score !== null && m.team_b_score !== null
        ? (winnerTeam(m.team_a_score, m.team_b_score) ?? 'TIE')
        : ''
    const matchBets = betsByMatch.get(m.id) ?? []
    const betAmountSum = matchBets.reduce((s, b) => s + b.amount, 0)
    const betsOnA = matchBets.filter((b) => b.predicted_team === 'A').length
    const betsOnB = matchBets.filter((b) => b.predicted_team === 'B').length
    const betDetail = matchBets
      .map(
        (b) =>
          `${b.profile?.name ?? b.user_id}:${b.predicted_team}:${b.amount}:${b.result ?? 'open'}`,
      )
      .join('|')

    return {
      match_id: m.id,
      match_date: m.match_date,
      status: m.status,
      status_label: MATCH_STATUS_LABELS[m.status],
      match_type: m.match_type,
      match_type_label: MATCH_TYPE_LABELS[m.match_type],
      display_order: m.display_order,
      is_betting: m.is_betting ? 1 : 0,
      betting_deadline: m.betting_deadline ?? '',
      player_count: m.players.length,
      team_a_score: m.team_a_score ?? '',
      team_b_score: m.team_b_score ?? '',
      winner,
      ...slotFields(m, 'A1', 'a1'),
      ...slotFields(m, 'A2', 'a2'),
      ...slotFields(m, 'B1', 'b1'),
      ...slotFields(m, 'B2', 'b2'),
      bet_count: matchBets.length,
      bet_amount_sum: betAmountSum,
      bets_on_a: betsOnA,
      bets_on_b: betsOnB,
      bet_detail: betDetail,
      youtube_video_id: m.youtube_video_id ?? '',
      confirmed_at: m.confirmed_at ?? '',
      created_at: m.created_at,
    }
  })
}

/**
 * 멤버 통합 CSV (한 행 = 한 멤버)
 * - 역할·입상 + 기간 내 무단결석 횟수·날짜 목록
 */
export async function buildMembersCsv(
  clubId: string,
  absences: ExportAbsence[] = [],
): Promise<Record<string, unknown>[]> {
  const users = await fetchClubUsers(clubId)
  const absByUser = new Map<string, string[]>()
  for (const a of absences) {
    const list = absByUser.get(a.user_id) ?? []
    list.push(a.absence_date)
    absByUser.set(a.user_id, list)
  }

  return users.map((row) => {
    const dates = (absByUser.get(row.user_id) ?? []).sort()
    return {
      user_id: row.user_id,
      name: row.profile.name,
      award_level: awardLabel(row.profile.award_level),
      club_role: row.role,
      member_status: row.status,
      is_active: row.profile.is_active ? 1 : 0,
      is_guest: row.profile.is_guest ? 1 : 0,
      affiliation: row.profile.affiliation ?? '',
      absence_count: dates.length,
      absence_dates: dates.join('|'),
      created_at: row.profile.created_at,
    }
  })
}

