import { useEffect, useMemo, useState } from 'react'
import { DateNavigator } from '../components/common/DateNavigator'
import { Spinner } from '../components/common/Spinner'
import { FineSummary } from '../components/stats/FineSummary'
import { RankingTable } from '../components/stats/RankingTable'
import { MATCH_TYPE_LABELS } from '../constants/labels'
import { fetchMatchFineRecords } from '../services/fineService'
import { fetchPlayerStats } from '../services/statsService'
import { useClubStore } from '../stores/clubStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { MatchFineRecord, MatchType, PlayerStatsRow } from '../types/domain'
import { addDaysToDateString, todayKst } from '../utils/kst'
import { getPeriodRange, PERIOD_OPTIONS, type PeriodType } from '../utils/period'
import { buildRanking } from '../utils/ranking'

/**
 * 결과 집계 페이지
 */
export function ResultsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const club = useClubStore((s) => s.club)
  const clubId = club?.id
  const fineEnabled = club?.fine_enabled ?? false
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [matchType, setMatchType] = useState<MatchType>('doubles')
  const [anchorDate, setAnchorDate] = useState(() => todayKst())
  const [customFrom, setCustomFrom] = useState(() => addDaysToDateString(todayKst(), -7))
  const [customTo, setCustomTo] = useState(() => todayKst())
  const [rows, setRows] = useState<PlayerStatsRow[]>([])
  const [fineRows, setFineRows] = useState<MatchFineRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(
    () => getPeriodRange(period, anchorDate, { from: customFrom, to: customTo }),
    [period, anchorDate, customFrom, customTo],
  )

  useEffect(() => {
    if (!clubId) {
      setRows([])
      setFineRows([])
      setLoading(false)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)

    void Promise.all([
      fetchPlayerStats(range.from, range.to, clubId, matchType),
      fineEnabled
        ? fetchMatchFineRecords(range.from, range.to, clubId, { matchType })
        : Promise.resolve([]),
    ])
      .then(([data, fines]) => {
        if (stale) return
        setRows(data)
        setFineRows(fines)
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
  }, [range.from, range.to, clubId, matchType, fineEnabled])

  const ranked = useMemo(
    () => buildRanking(rows, settings.min_matches_for_ranking),
    [rows, settings.min_matches_for_ranking],
  )

  const dateInputClass =
    'h-11 flex-1 rounded-xl border border-gray-300 px-3 text-base font-semibold focus:border-green-600 focus:outline-none'

  return (
    <div className="flex flex-col gap-4">
      {/* 단식/복식 분리 집계 */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1">
        {(['doubles', 'singles'] as MatchType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setMatchType(type)}
            className={`h-10 rounded-lg text-sm font-bold ${
              matchType === type ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {MATCH_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {/* 기간 유형 선택 (터치 영역 확보) */}
      <div className="grid grid-cols-6 gap-1 rounded-xl bg-gray-200 p-1">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`h-10 rounded-lg text-xs font-bold sm:text-sm ${
              period === opt.value ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 기준 날짜 이동 (일간/주간/월간/연간) */}
      {period !== 'all' && period !== 'custom' && (
        <DateNavigator date={anchorDate} onChange={setAnchorDate} />
      )}

      {/* 사용자 지정 기간: 시작일 ~ 종료일 직접 입력 */}
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
            aria-label="조회 시작일"
            className={dateInputClass}
          />
          <span className="font-bold text-gray-400">~</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => e.target.value && setCustomTo(e.target.value)}
            aria-label="조회 종료일"
            className={dateInputClass}
          />
        </div>
      )}

      <h2 className="text-lg font-bold text-gray-800">
        {range.label} {MATCH_TYPE_LABELS[matchType]} 순위
      </h2>

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

      {!loading && !error && fineEnabled && club && (
        <FineSummary records={fineRows} rangeLabel={range.label} clubSlug={club.slug} />
      )}
    </div>
  )
}
