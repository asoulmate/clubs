import { useEffect, useState } from 'react'
import { AUDIT_ACTION_LABELS } from '../../constants/labels'
import { fetchAuditLogs } from '../../services/adminService'
import { useClubStore } from '../../stores/clubStore'
import type { MatchAuditLog } from '../../types/domain'
import { formatDateKorean, formatTimestampKorean } from '../../utils/kst'
import { Spinner } from '../common/Spinner'

/** 감사 로그의 before/after 스코어 요약 */
function scoreSummary(data: Record<string, unknown> | null): string | null {
  if (!data) return null
  const a = data.team_a_score
  const b = data.team_b_score
  if (a === undefined && b === undefined) return null
  return `${a ?? '-'} : ${b ?? '-'}`
}

type AuditLogRow = MatchAuditLog & {
  match?: { club_id: string; match_date: string } | null
}

/** 관리자 - 수정 이력(감사 로그) 탭 (현재 클럽만) */
export function LogsTab() {
  const clubId = useClubStore((s) => s.club?.id)
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clubId) {
      setLogs([])
      setLoading(false)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)
    void fetchAuditLogs(clubId)
      .then((data) => {
        if (!stale) setLogs(data as AuditLogRow[])
      })
      .catch(() => {
        if (!stale) setError('수정 이력을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [clubId])

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }

  if (error) return <p className="py-10 text-center text-gray-600">{error}</p>
  if (logs.length === 0) return <p className="py-10 text-center text-gray-500">수정 이력이 없습니다.</p>

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {logs.map((log) => {
        const before = scoreSummary(log.before_data)
        const after = scoreSummary(log.after_data)
        const matchDate = log.match?.match_date
        return (
          <div key={log.id} className="border-b border-gray-50 px-4 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">
                {AUDIT_ACTION_LABELS[log.action_type] ?? log.action_type}
              </span>
              <span className="shrink-0 text-xs text-gray-400">
                {formatTimestampKorean(log.changed_at)}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              처리자: {log.changed_by_profile?.name ?? '(알 수 없음)'}
              {matchDate ? (
                <span className="ml-2 text-gray-400">{formatDateKorean(matchDate)} 경기</span>
              ) : null}
              {before && after && (
                <span className="ml-2 tabular-nums">
                  {before} → {after}
                </span>
              )}
            </p>
            {log.reason && <p className="mt-1 text-sm text-amber-700">사유: {log.reason}</p>}
          </div>
        )
      })}
    </div>
  )
}
