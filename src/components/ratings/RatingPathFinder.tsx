import { useEffect, useState } from 'react'
import type { ShadowRatingPath, ShadowRatingRow } from '../../types/domain'
import { getShadowRatingPath } from '../../services/globalRatingService'
import { toErrorMessage } from '../../utils/errors'
import { Spinner } from '../common/Spinner'

interface Props {
  poolId: string
  rows: ShadowRatingRow[]
  defaultFromId?: string | null
}

export function RatingPathFinder({ poolId, rows, defaultFromId }: Props) {
  const [fromId, setFromId] = useState(defaultFromId ?? '')
  const [toId, setToId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ShadowRatingPath | null>(null)

  useEffect(() => {
    if (defaultFromId) setFromId(defaultFromId)
  }, [defaultFromId])

  const handleSearch = async () => {
    if (!poolId || !fromId || !toId) {
      setError('출발·도착 선수를 모두 선택해주세요.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      setResult(await getShadowRatingPath(poolId, fromId, toId))
    } catch (err) {
      setError(toErrorMessage(err))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4">
      <h2 className="font-extrabold text-gray-900">두 선수 연결 경로</h2>
      <p className="mt-1 text-xs text-gray-500">
        A–B, B–C처럼 상대 네트워크로 이어진 최단 경로와 연결 경기를 보여줍니다.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-gray-500">출발</span>
          <select
            value={fromId}
            onChange={(e) => {
              setFromId(e.target.value)
              setResult(null)
            }}
            className="h-11 w-full rounded-lg border border-gray-300 px-2"
          >
            <option value="">선수 선택</option>
            {rows.map((r) => (
              <option key={r.global_player_id} value={r.global_player_id}>
                {r.player_name} ({r.rating.toFixed(0)})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-gray-500">도착</span>
          <select
            value={toId}
            onChange={(e) => {
              setToId(e.target.value)
              setResult(null)
            }}
            className="h-11 w-full rounded-lg border border-gray-300 px-2"
          >
            <option value="">선수 선택</option>
            {rows.map((r) => (
              <option key={r.global_player_id} value={r.global_player_id}>
                {r.player_name} ({r.rating.toFixed(0)})
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={() => void handleSearch()}
        className="mt-3 h-11 w-full rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
      >
        {loading ? '찾는 중…' : '최단 경로 찾기'}
      </button>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {loading && (
        <div className="mt-4 flex justify-center">
          <Spinner />
        </div>
      )}

      {result && !loading && (
        <div className="mt-4">
          {!result.found ? (
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900">
              연결 경로를 찾지 못했습니다. (같은 풀에서 공통 상대망이 없거나, 경기가 부족합니다)
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700">
                경로: {result.nodes.map((n) => n.player_name).join(' → ')}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  ({Math.max(result.hops.length, 0)}홉)
                </span>
              </p>
              <ol className="mt-3 space-y-2">
                {result.hops.map((hop, idx) => (
                  <li
                    key={`${hop.from_id}-${hop.to_id}-${idx}`}
                    className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                  >
                    <p className="font-bold text-gray-900">
                      {hop.from_name} ↔ {hop.to_name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {hop.match_date ?? '날짜 없음'}
                      {hop.club_name ? ` · ${hop.club_name}` : ''}
                      {hop.team_a_score != null && hop.team_b_score != null
                        ? ` · ${hop.team_a_score}:${hop.team_b_score}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  )
}
