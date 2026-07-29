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

/**
 * AI 분석용 확정 경기 flat CSV
 * (취소·미확정 제외, 한 행 = 한 경기)
 */
export function buildConfirmedMatchesCsv(matches: MatchWithPlayers[]): Record<string, unknown>[] {
  return matches
    .filter((m) => m.status === 'confirmed')
    .map((m) => {
      const a1 = playerAt(m, 'A1')
      const a2 = playerAt(m, 'A2')
      const b1 = playerAt(m, 'B1')
      const b2 = playerAt(m, 'B2')
      const winner =
        m.team_a_score !== null && m.team_b_score !== null
          ? (winnerTeam(m.team_a_score, m.team_b_score) ?? 'TIE')
          : ''
      return {
        match_id: m.id,
        match_date: m.match_date,
        match_type: m.match_type,
        match_type_label: MATCH_TYPE_LABELS[m.match_type],
        display_order: m.display_order,
        is_betting: m.is_betting ? 1 : 0,
        team_a_score: m.team_a_score,
        team_b_score: m.team_b_score,
        winner,
        a1_user_id: a1?.user_id ?? '',
        a1_name: a1?.profile?.name ?? '',
        a1_award: awardLabel(a1?.profile?.award_level),
        a1_is_guest: a1?.profile?.is_guest ? 1 : 0,
        a2_user_id: a2?.user_id ?? '',
        a2_name: a2?.profile?.name ?? '',
        a2_award: awardLabel(a2?.profile?.award_level),
        a2_is_guest: a2?.profile?.is_guest ? 1 : 0,
        b1_user_id: b1?.user_id ?? '',
        b1_name: b1?.profile?.name ?? '',
        b1_award: awardLabel(b1?.profile?.award_level),
        b1_is_guest: b1?.profile?.is_guest ? 1 : 0,
        b2_user_id: b2?.user_id ?? '',
        b2_name: b2?.profile?.name ?? '',
        b2_award: awardLabel(b2?.profile?.award_level),
        b2_is_guest: b2?.profile?.is_guest ? 1 : 0,
        youtube_video_id: m.youtube_video_id ?? '',
        confirmed_at: m.confirmed_at ?? '',
        created_at: m.created_at,
      }
    })
}

/** 확정 경기 참가자 long format (한 행 = 한 참가자) */
export function buildMatchPlayersCsv(matches: MatchWithPlayers[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const m of matches.filter((x) => x.status === 'confirmed')) {
    const winner =
      m.team_a_score !== null && m.team_b_score !== null
        ? (winnerTeam(m.team_a_score, m.team_b_score) ?? 'TIE')
        : ''
    for (const p of m.players) {
      const team = p.position.startsWith('A') ? 'A' : 'B'
      rows.push({
        match_id: m.id,
        match_date: m.match_date,
        match_type: m.match_type,
        display_order: m.display_order,
        position: p.position,
        team,
        user_id: p.user_id,
        player_name: p.profile?.name ?? '',
        award_level: awardLabel(p.profile?.award_level),
        is_guest: p.profile?.is_guest ? 1 : 0,
        affiliation: p.profile?.affiliation ?? '',
        team_a_score: m.team_a_score,
        team_b_score: m.team_b_score,
        winner,
        result:
          winner === 'TIE' ? 'TIE' : winner === '' ? '' : winner === team ? 'WIN' : 'LOSS',
      })
    }
  }
  return rows
}

/** 전체 경기 메타 (상태 포함 — 분석 필터용 raw) */
export function buildAllMatchesMetaCsv(matches: MatchWithPlayers[]): Record<string, unknown>[] {
  return matches.map((m) => ({
    match_id: m.id,
    match_date: m.match_date,
    status: m.status,
    status_label: MATCH_STATUS_LABELS[m.status],
    match_type: m.match_type,
    is_betting: m.is_betting ? 1 : 0,
    betting_deadline: m.betting_deadline ?? '',
    display_order: m.display_order,
    team_a_score: m.team_a_score ?? '',
    team_b_score: m.team_b_score ?? '',
    player_count: m.players.length,
    youtube_video_id: m.youtube_video_id ?? '',
    created_at: m.created_at,
    confirmed_at: m.confirmed_at ?? '',
  }))
}

export async function buildMembersCsv(clubId: string): Promise<Record<string, unknown>[]> {
  const users = await fetchClubUsers(clubId)
  return users.map((row) => ({
    user_id: row.user_id,
    name: row.profile.name,
    award_level: awardLabel(row.profile.award_level),
    club_role: row.role,
    member_status: row.status,
    is_active: row.profile.is_active ? 1 : 0,
    is_guest: row.profile.is_guest ? 1 : 0,
    affiliation: row.profile.affiliation ?? '',
    created_at: row.profile.created_at,
  }))
}

export function buildAbsencesCsv(
  rows: Awaited<ReturnType<typeof fetchExportAbsences>>,
): Record<string, unknown>[] {
  return rows.map((r) => ({
    absence_id: r.id,
    absence_date: r.absence_date,
    user_id: r.user_id,
    player_name: r.profile?.name ?? '',
    award_level: awardLabel(r.profile?.award_level),
    is_guest: r.profile?.is_guest ? 1 : 0,
    affiliation: r.profile?.affiliation ?? '',
    registered_by: r.registered_by,
    created_at: r.created_at,
  }))
}

export function buildBetsCsv(
  rows: Awaited<ReturnType<typeof fetchExportBets>>,
): Record<string, unknown>[] {
  return rows.map((r) => ({
    bet_id: r.id,
    match_id: r.match_id,
    match_date: r.match?.match_date ?? '',
    match_type: r.match?.match_type ?? '',
    match_status: r.match?.status ?? '',
    team_a_score: r.match?.team_a_score ?? '',
    team_b_score: r.match?.team_b_score ?? '',
    user_id: r.user_id,
    player_name: r.profile?.name ?? '',
    amount: r.amount,
    predicted_team: r.predicted_team,
    result: r.result ?? 'open',
    settled_at: r.settled_at ?? '',
    created_at: r.created_at,
  }))
}
