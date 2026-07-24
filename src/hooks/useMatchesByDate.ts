import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMatchById, fetchMatchesByDate } from '../services/matchService'
import type { MatchWithPlayers } from '../types/domain'

// ============================================================
// 날짜별 경기 목록 + Supabase Realtime 구독 훅
//
//  - matches 테이블: 해당 날짜 필터로 구독
//  - match_players 테이블: 전체 구독 후 관련 경기만 갱신
//  - 이벤트 수신 시 전체 목록을 다시 불러오지 않고
//    변경된 경기 1건만 조회하여 목록에 반영한다.
//  - 재연결(SUBSCRIBED 재진입) 시에는 끊긴 동안의 변경을 반영하기 위해
//    목록을 1회 새로고침한다.
// ============================================================

interface RealtimeRow {
  id?: string
  match_id?: string
  match_date?: string
}

export function useMatchesByDate(date: string) {
  const [matches, setMatches] = useState<MatchWithPlayers[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 콜백 내부에서 최신 date를 참조하기 위한 ref
  const dateRef = useRef(date)
  dateRef.current = date

  /** 전체 목록 새로고침 */
  const refresh = useCallback(async () => {
    try {
      const list = await fetchMatchesByDate(date)
      setMatches(list)
      setError(null)
    } catch {
      setError('경기 목록을 불러오지 못했습니다. 네트워크 상태를 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }, [date])

  /** 변경된 경기 1건만 다시 조회하여 목록에 반영 */
  const upsertMatch = useCallback(async (matchId: string) => {
    try {
      const match = await fetchMatchById(matchId)
      setMatches((prev) => {
        // 다른 날짜의 경기면 목록에서 제거만 수행
        if (!match || match.match_date !== dateRef.current) {
          return prev.filter((m) => m.id !== matchId)
        }
        const exists = prev.some((m) => m.id === matchId)
        const next = exists ? prev.map((m) => (m.id === matchId ? match : m)) : [...prev, match]
        return next.sort((a, b) => a.created_at.localeCompare(b.created_at))
      })
    } catch {
      // 단건 갱신 실패는 무시 (다음 이벤트나 새로고침에서 복구됨)
    }
  }, [])

  // 초기 로드 및 날짜 변경 시 재조회
  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  // Realtime 구독
  useEffect(() => {
    let firstSubscribe = true

    const channel = supabase
      .channel(`matches-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `match_date=eq.${date}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as RealtimeRow
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
        // 재연결 시 끊긴 동안의 변경 사항을 반영
        if (status === 'SUBSCRIBED' && !firstSubscribe) {
          void refresh()
        }
        if (status === 'SUBSCRIBED') firstSubscribe = false
      })

    // 오프라인 → 온라인 복귀 시 새로고침
    const onOnline = () => void refresh()
    window.addEventListener('online', onOnline)

    return () => {
      window.removeEventListener('online', onOnline)
      void supabase.removeChannel(channel)
    }
  }, [date, refresh, upsertMatch])

  return { matches, loading, error, refresh }
}
