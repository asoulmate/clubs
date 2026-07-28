import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AWARD_LEVEL_ICONS, AWARD_LEVEL_LABELS } from '../../constants/labels'
import { fetchProfileById } from '../../services/profileService'
import { fetchPlayerSummary } from '../../services/statsService'
import { useClubStore } from '../../stores/clubStore'
import { usePlayerSummaryStore } from '../../stores/playerSummaryStore'
import type { PlayerStatsRow, Profile } from '../../types/domain'
import { calcWinRate } from '../../utils/ranking'
import { ALL_TIME_RANGE } from '../../utils/period'
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'

/** 선수 이름 클릭 시 표시되는 누적 요약 */
export function PlayerSummaryDialog() {
  const { userId, close } = usePlayerSummaryStore()
  const navigate = useNavigate()
  const { clubSlug: paramSlug } = useParams<{ clubSlug?: string }>()
  const club = useClubStore((s) => s.club)
  const clubId = club?.id
  const slug = club?.slug ?? paramSlug
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<PlayerStatsRow | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!userId || !clubId) return
    let stale = false
    setLoading(true)
    setProfile(null)
    setStats(null)

    void Promise.all([
      fetchProfileById(userId),
      fetchPlayerSummary(userId, ALL_TIME_RANGE.from, ALL_TIME_RANGE.to, clubId),
    ])
      .then(([p, s]) => {
        if (stale) return
        setProfile(p)
        setStats(s)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })

    return () => {
      stale = true
    }
  }, [userId, clubId])

  if (!userId) return null

  const winRate = stats ? calcWinRate(stats.wins, stats.matches_played) : 0

  return (
    <Dialog open onClose={close} title="선수 요약">
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !profile ? (
        <p className="py-6 text-center text-gray-500">선수 정보를 불러오지 못했습니다.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xl font-extrabold">
              {profile.name}
              {AWARD_LEVEL_ICONS[profile.award_level] ? (
                <span className="ml-1" aria-hidden="true">
                  {AWARD_LEVEL_ICONS[profile.award_level]}
                </span>
              ) : null}
              {profile.is_guest && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  게스트
                </span>
              )}
            </p>
            <p className="text-sm text-gray-500">
              {AWARD_LEVEL_LABELS[profile.award_level]}
              {profile.is_guest ? ' · 미가입(게스트)' : ''}
              {profile.is_guest && profile.affiliation ? ` · ${profile.affiliation}` : ''}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-xl bg-gray-50 py-3">
              <p className="text-lg font-bold">{stats?.matches_played ?? 0}</p>
              <p className="text-xs text-gray-500">누적 경기</p>
            </div>
            <div className="rounded-xl bg-gray-50 py-3">
              <p className="text-lg font-bold text-green-700">{stats?.wins ?? 0}</p>
              <p className="text-xs text-gray-500">승</p>
            </div>
            <div className="rounded-xl bg-gray-50 py-3">
              <p className="text-lg font-bold text-red-600">{stats?.losses ?? 0}</p>
              <p className="text-xs text-gray-500">패</p>
            </div>
            <div className="rounded-xl bg-gray-50 py-3">
              <p className="text-lg font-bold">{winRate.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">승률</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              close()
              navigate(slug ? `/c/${slug}/players/${profile.id}` : `/players/${profile.id}`)
            }}
            className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800"
          >
            상세 기록 보기
          </button>
        </div>
      )}
    </Dialog>
  )
}
