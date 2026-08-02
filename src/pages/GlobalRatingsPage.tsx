import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { RatingEgoNetwork } from '../components/ratings/RatingEgoNetwork'
import { RatingFormulaBanner } from '../components/ratings/RatingFormulaBanner'
import { RatingLeaderboard } from '../components/ratings/RatingLeaderboard'
import { RatingNetworkOverview } from '../components/ratings/RatingNetworkOverview'
import { RatingPathFinder } from '../components/ratings/RatingPathFinder'
import { Spinner } from '../components/common/Spinner'
import { featureFlags } from '../config/featureFlags'
import {
  getShadowRatingEgo,
  getShadowRatingGraph,
  getShadowRatingLeaderboard,
  listShadowRatingPools,
  runShadowRating,
} from '../services/globalRatingService'
import { useAuthStore } from '../stores/authStore'
import { useToastStore } from '../stores/toastStore'
import type {
  ShadowRatingEgo,
  ShadowRatingGraph,
  ShadowRatingPool,
  ShadowRatingRow,
} from '../types/domain'
import { toErrorMessage } from '../utils/errors'

function canViewGlobalRatings(isPlatformAdmin: boolean | undefined): boolean {
  return Boolean(isPlatformAdmin) || featureFlags.shadowRatingPublic
}

/** 플랫폼 전체 글로벌(Shadow) 레이팅 탐색 페이지 */
export function GlobalRatingsPage() {
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const isAdmin = Boolean(profile?.is_platform_admin)

  const [pools, setPools] = useState<ShadowRatingPool[]>([])
  const [poolId, setPoolId] = useState('')
  const [rows, setRows] = useState<ShadowRatingRow[]>([])
  const [graph, setGraph] = useState<ShadowRatingGraph | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pathIds, setPathIds] = useState<string[]>([])
  const [ego, setEgo] = useState<ShadowRatingEgo | null>(null)
  const [loading, setLoading] = useState(true)
  const [graphLoading, setGraphLoading] = useState(false)
  const [egoLoading, setEgoLoading] = useState(false)
  const [running, setRunning] = useState(false)

  const loadBoard = useCallback(async (selectedPoolId: string) => {
    if (!selectedPoolId) {
      setRows([])
      setGraph(null)
      return
    }
    const [nextRows, nextGraph] = await Promise.all([
      getShadowRatingLeaderboard(selectedPoolId),
      getShadowRatingGraph(selectedPoolId),
    ])
    setRows(nextRows)
    setGraph(nextGraph)
  }, [])

  useEffect(() => {
    if (!canViewGlobalRatings(profile?.is_platform_admin)) return
    let active = true
    void (async () => {
      try {
        const nextPools = await listShadowRatingPools()
        if (!active) return
        setPools(nextPools)
        const preferred = nextPools.find((p) => p.discipline === 'doubles') ?? nextPools[0]
        const nextId = preferred?.pool_id ?? ''
        setPoolId(nextId)
        setGraphLoading(true)
        await loadBoard(nextId)
      } catch (error) {
        if (active) showToast(toErrorMessage(error), 'error')
      } finally {
        if (active) {
          setLoading(false)
          setGraphLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [loadBoard, profile?.is_platform_admin, showToast])

  useEffect(() => {
    if (!poolId || !selectedId) {
      setEgo(null)
      return
    }
    let active = true
    setEgoLoading(true)
    void (async () => {
      try {
        const next = await getShadowRatingEgo(poolId, selectedId, 2)
        if (active) setEgo(next)
      } catch (error) {
        if (active) {
          setEgo(null)
          showToast(toErrorMessage(error), 'error')
        }
      } finally {
        if (active) setEgoLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [poolId, selectedId, showToast])

  if (!canViewGlobalRatings(profile?.is_platform_admin)) {
    return <Navigate to="/" replace />
  }

  const handlePoolChange = async (nextId: string) => {
    setPoolId(nextId)
    setSelectedId(null)
    setPathIds([])
    setEgo(null)
    setLoading(true)
    setGraphLoading(true)
    try {
      await loadBoard(nextId)
    } catch (error) {
      showToast(toErrorMessage(error), 'error')
    } finally {
      setLoading(false)
      setGraphLoading(false)
    }
  }

  const handleRun = async () => {
    if (!poolId || !featureFlags.shadowRatingCalculation || !isAdmin) return
    if (!window.confirm('현재 확정 경기로 shadow 레이팅을 재계산할까요? 기존 클럽 순위에는 영향이 없습니다.')) {
      return
    }
    setRunning(true)
    try {
      await runShadowRating(poolId)
      await loadBoard(poolId)
      if (selectedId) setEgo(await getShadowRatingEgo(poolId, selectedId, 2))
      setPathIds([])
      showToast('Shadow 레이팅 계산이 완료되었습니다.', 'success')
    } catch (error) {
      showToast(toErrorMessage(error), 'error')
    } finally {
      setRunning(false)
    }
  }

  const handleSelect = (playerId: string) => {
    setSelectedId(playerId)
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-green-800">글로벌 레이팅</h1>
          <p className="mt-1 text-sm text-gray-500">
            플랫폼 전체 Shadow Team Elo · 기존 클럽 순위와 별도
          </p>
        </div>
        <Link
          to={isAdmin ? '/platform' : '/'}
          className="h-10 shrink-0 rounded-xl border border-gray-300 px-3 text-sm font-semibold leading-10 text-gray-700"
        >
          뒤로
        </Link>
      </div>

      <RatingFormulaBanner />

      <div className="flex flex-wrap gap-2">
        <select
          value={poolId}
          onChange={(e) => void handlePoolChange(e.target.value)}
          className="h-11 min-w-56 flex-1 rounded-lg border border-gray-300 px-3"
        >
          {pools.map((pool) => (
            <option key={pool.pool_id} value={pool.pool_id}>
              {pool.pool_name} · {pool.model_version}
            </option>
          ))}
        </select>
        {isAdmin && featureFlags.shadowRatingCalculation && (
          <button
            type="button"
            disabled={!poolId || running}
            onClick={() => void handleRun()}
            className="h-11 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50"
          >
            {running ? '계산 중…' : '재계산'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <RatingNetworkOverview
            graph={graph}
            loading={graphLoading}
            selectedId={selectedId}
            pathIds={pathIds}
            onSelect={handleSelect}
          />
          <RatingLeaderboard
            rows={rows}
            selectedId={selectedId}
            onSelect={(row) => handleSelect(row.global_player_id)}
          />
          <RatingEgoNetwork ego={ego} loading={egoLoading} />
          <RatingPathFinder
            rows={rows}
            graph={graph}
            defaultFromId={selectedId}
            onPathChange={setPathIds}
          />
        </>
      )}
    </div>
  )
}
