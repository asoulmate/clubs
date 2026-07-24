import { useEffect, useMemo, useState } from 'react'
import { DateNavigator } from '../components/common/DateNavigator'
import { Spinner } from '../components/common/Spinner'
import { RankingTable } from '../components/stats/RankingTable'
import { fetchPlayerStats } from '../services/statsService'
import { useSettingsStore } from '../stores/settingsStore'
import type { PlayerStatsRow } from '../types/domain'
import { todayKst } from '../utils/kst'
import { getPeriodRange, PERIOD_OPTIONS, type PeriodType } from '../utils/period'
import { buildRanking } from '../utils/ranking'

/**
 * 결과 집계 페이지
 *  - 일간/주간/월간/분기/연간/누적 기간 선택
 *  - 확정된 경기만 집계에 포함 (DB의 get_player_stats가 보장)
 */
export function ResultsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [anchorDate, setAnchorDate] = useState(() => todayKst())
  const [rows, setRows] = useState<PlayerStatsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => getPeriodRange(period, anchorDate), [period, anchorDate])

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)

    void fetchPlayerStats(range.from, range.to)
      .then((data) => {
        if (!stale) setRows(data)
      })
      .catch(() => {
        if (!stale) setError('집계 데이터를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.')
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })

    return () => {
      stale = true
    }
  }, [range.from, range.to])

  const ranked = useMemo(
    () => buildRanking(rows, settings.min_matches_for_ranking),
    [rows, settings.min_matches_for_ranking],
  )

  return (
    <div className="flex flex-col gap-4">
      {/* 기간 유형 선택 (터치 영역 44px 확보) */}
      <div className="grid grid-cols-6 gap-1 rounded-xl bg-gray-200 p-1">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`h-10 rounded-lg text-sm font-bold ${
              period === opt.value ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 기준 날짜 이동 (누적은 날짜와 무관) */}
      {period !== 'all' && <DateNavigator date={anchorDate} onChange={setAnchorDate} />}

      <h2 className="text-lg font-bold text-gray-800">{range.label} 순위</h2>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <p className="py-10 text-center text-gray-600">{error}</p>
      ) : (
        <>
          <RankingTable rows={ranked} minMatches={settings.min_matches_for_ranking} />
          {settings.min_matches_for_ranking > 0 && (
            <p className="text-xs text-gray-400">
              * 공식 순위는 {settings.min_matches_for_ranking}경기 이상 참가자를 대상으로 하며,
              미달 사용자는 순위 없이 표시됩니다.
            </p>
          )}
        </>
      )}
    </div>
  )
}
