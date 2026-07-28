import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMatchById, fetchMatchesByDate } from '../services/matchService'
import type { MatchWithPlayers } from '../types/domain'

// ============================================================
// 날짜별 경기 목록 + Supabase Realtime 구독 훅
// ============================================================

interface RealtimeRow {
  id?: string
  match_id?: string
  match_date?: string
}

export function useMatchesByDate(date: string, clubId: string | undefined) {
  const [matches, setMatches] = useState<MatchWithPlayers[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dateRef = useRef(date)
  dateRef.current = date

  /** 전체 목록 새로고침 */
  const refresh = useCallback(async () => {
    if (!clubId) {
      setMatches([])
      setLoading(false)
      return
    }
    try {
      const list = await fetchMatchesByDate(date, clubId)
      setMatches(list)
      setError(null)
    } catch {
      setError('경기 목록을 불러오지 못했습니다. 네트워크 상태를 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }, [date, clubId])

  /** 변경된 경기 1건만 다시 조회하여 목록에 반영 */
  const upsertMatch = useCallback(async (matchId: string) => {
    try {
      const match = await fetchMatchById(matchId)
      setMatches((prev) => {
        if (!match || match.match_date !== dateRef.current) {
          return prev.filter((m) => m.id !== matchId)
        }
        const exists = prev.some((m) => m.id === matchId)
        const next = exists ? prev.map((m) => (m.id === matchId ? match : m)) : [...prev, match]
        return next.sort((a, b) => a.created_at.localeCompare(b.created_at))
      })
    } catch {
      // 단건 갱신 실패는 무시
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!clubId) return

    let firstSubscribe = true

    const channel = supabase
      .channel(`matches-${clubId}-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `match_date=eq.${date}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as RealtimeRow & { club_id?: string }
          if (row.club_id && row.club_id !== clubId) return
          if (row.id) void upsertMatch(row.id)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_players' },
        (payload) => {
          const row = (payload.new ?? payload.old) as RealtimeRow
          if (row.match_id) void upsertMatch(row.match_id)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && !firstSubscribe) {
          void refresh()
        }
        if (status === 'SUBSCRIBED') firstSubscribe = false
      })

    const onOnline = () => void refresh()
    window.addEventListener('online', onOnline)

    return () => {
      window.removeEventListener('online', onOnline)
      void supabase.removeChannel(channel)
    }
  }, [date, clubId, refresh, upsertMatch])

  return { matches, loading, error, refresh }
}
