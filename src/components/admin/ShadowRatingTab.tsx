import { useCallback, useEffect, useState } from 'react'
import { featureFlags } from '../../config/featureFlags'
import {
  getShadowRatingExclusions,
  getShadowRatingSummary,
  listShadowRatingPools,
  runShadowRating,
} from '../../services/globalRatingService'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import type {
  ShadowRatingExclusion,
  ShadowRatingPool,
  ShadowRatingRow,
} from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { Spinner } from '../common/Spinner'

export function ShadowRatingTab() {
  const club = useClubStore((s) => s.club)
  const showToast = useToastStore((s) => s.show)
  const [pools, setPools] = useState<ShadowRatingPool[]>([])
  const [poolId, setPoolId] = useState('')
  const [rows, setRows] = useState<ShadowRatingRow[]>([])
  const [exclusions, setExclusions] = useState<ShadowRatingExclusion[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const loadRows = useCallback(async (selectedPoolId: string) => {
    if (!club?.id || !selectedPoolId) {
      setRows([])
      setExclusions([])
      return
    }
    const nextRows = await getShadowRatingSummary(club.id, selectedPoolId)
    setRows(nextRows)
    const runId = nextRows[0]?.run_id
    setExclusions(runId ? await getShadowRatingExclusions(runId) : [])
  }, [club?.id])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const nextPools = await listShadowRatingPools()
        if (!active) return
        setPools(nextPools)
        const preferred = nextPools.find((pool) => pool.discipline === 'doubles') ?? nextPools[0]
        const nextPoolId = preferred?.pool_id ?? ''
        setPoolId(nextPoolId)
        await loadRows(nextPoolId)
      } catch (error) {
        if (active) showToast(toErrorMessage(error), 'error')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [loadRows, showToast])

  const handlePoolChange = async (nextPoolId: string) => {
    setPoolId(nextPoolId)
    setLoading(true)
    try {
      await loadRows(nextPoolId)
    } catch (error) {
      showToast(toErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    if (!poolId || !featureFlags.shadowRatingCalculation) return
    if (!window.confirm('현재 확정 경기로 shadow 레이팅을 재계산할까요? 기존 순위에는 영향이 없습니다.')) return
    setRunning(true)
    try {
      await runShadowRating(poolId)
      await loadRows(poolId)
      showToast('Shadow 레이팅 계산이 완료되었습니다.', 'success')
    } catch (error) {
      showToast(toErrorMessage(error), 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        내부 검증용 Shadow 레이팅입니다. 기존 결과 순위와 일반 사용자 화면에는 반영되지 않습니다.
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={poolId}
          onChange={(event) => void handlePoolChange(event.target.value)}
          className="h-11 min-w-56 rounded-lg border border-gray-300 px-3"
        >
          {pools.map((pool) => (
            <option key={pool.pool_id} value={pool.pool_id}>
              {pool.pool_name} · {pool.model_version}
            </option>
          ))}
        </select>
        {featureFlags.shadowRatingCalculation && (
          <button
            type="button"
            disabled={!poolId || running}
            onClick={() => void handleRun()}
            className="h-11 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50"
          >
            {running ? '계산 중...' : 'Shadow 재계산'}
          </button>
        )}
      </div>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="min-w-[1300px] w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="p-3">선수</th><th className="p-3">Global ID</th>
                <th className="p-3">레이팅</th><th className="p-3">불확실성</th>
                <th className="p-3">상태</th><th className="p-3">경기</th>
                <th className="p-3">상대</th><th className="p-3">클럽</th>
                <th className="p-3">마지막 계산</th><th className="p-3">모델</th>
                <th className="p-3">최근 run</th><th className="p-3">제외 경기</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.global_player_id} className="border-t border-gray-100">
                  <td className="p-3 font-semibold">{row.player_name}</td>
                  <td className="p-3 font-mono text-xs">{row.global_player_id}</td>
                  <td className="p-3">{row.rating.toFixed(1)}</td>
                  <td className="p-3">±{row.uncertainty.toFixed(1)}</td>
                  <td className="p-3">{row.provisional ? 'provisional' : 'established'}</td>
                  <td className="p-3">{row.games_played}</td>
                  <td className="p-3">{row.opponent_count}</td>
                  <td className="p-3">{row.linked_club_count}</td>
                  <td className="p-3">{new Date(row.last_calculated_at).toLocaleString('ko-KR')}</td>
                  <td className="p-3">{row.model_version}</td>
                  <td className="p-3 font-mono text-xs">{row.run_id.slice(0, 8)}</td>
                  <td className="p-3">{row.excluded_match_count}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={12} className="p-10 text-center text-gray-500">계산된 결과가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-bold">최근 run 제외 경기</h2>
        {exclusions.length === 0 ? <p className="mt-2 text-sm text-gray-500">제외 경기 없음 또는 실행 전</p> : (
          <ul className="mt-2 text-sm text-gray-700">
            {exclusions.map((row) => <li key={row.exclusion_reason}>{row.exclusion_reason}: {row.match_count}경기</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
