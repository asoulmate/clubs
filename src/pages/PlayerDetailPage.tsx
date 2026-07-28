import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Spinner } from '../components/common/Spinner'
import { AWARD_LEVEL_ICONS, AWARD_LEVEL_LABELS } from '../constants/labels'
import { fetchProfileById } from '../services/profileService'
import {
  fetchMonthlyTrend,
  fetchOpponentStats,
  fetchPartnerStats,
  fetchPlayerSummary,
  fetchRecentMatches,
} from '../services/statsService'
import type {
  AwardLevel,
  MonthlyTrendRow,
  OpponentStatsRow,
  PartnerStatsRow,
  PlayerStatsRow,
  Profile,
  RecentMatchRow,
} from '../types/domain'
import { formatDateKorean } from '../utils/kst'
import { ALL_TIME_RANGE } from '../utils/period'
import { calcParticipationRate, calcWinRate } from '../utils/ranking'

/** 이름 + 입상 아이콘 */
function NameWithAward({ name, award }: { name: string; award?: AwardLevel | null }) {
  const icon = award ? AWARD_LEVEL_ICONS[award] : ''
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold text-gray-900">
      {name}
      {icon ? (
        <span aria-hidden="true" title={award ? AWARD_LEVEL_LABELS[award] : undefined}>
          {icon}
        </span>
      ) : null}
    </span>
  )
}

/** 통계 카드 1칸 */
function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-xl py-3 text-center shadow-sm ${
        highlight ? 'border-2 border-red-400 bg-red-50' : 'bg-white'
      }`}
    >
      <p
        className={`text-lg font-extrabold tabular-nums ${highlight ? 'text-red-700' : ''}`}
      >
        {value}
      </p>
      <p className={`text-xs ${highlight ? 'font-bold text-red-700' : 'text-gray-500'}`}>{label}</p>
    </div>
  )
}

const RESULT_LABELS = { win: '승', loss: '패', tie: '무' } as const
const RESULT_STYLES = {
  win: 'bg-green-100 text-green-800',
  loss: 'bg-red-100 text-red-700',
  tie: 'bg-gray-100 text-gray-600',
} as const

/** 개인 상세 기록 페이지 */
export function PlayerDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<PlayerStatsRow | null>(null)
  const [partners, setPartners] = useState<PartnerStatsRow[]>([])
  const [opponents, setOpponents] = useState<OpponentStatsRow[]>([])
  const [trend, setTrend] = useState<MonthlyTrendRow[]>([])
  const [recent, setRecent] = useState<RecentMatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let stale = false
    setLoading(true)
    setError(null)

    void Promise.all([
      fetchProfileById(userId),
      fetchPlayerSummary(userId, ALL_TIME_RANGE.from, ALL_TIME_RANGE.to),
      fetchPartnerStats(userId, ALL_TIME_RANGE.from, ALL_TIME_RANGE.to),
      fetchOpponentStats(userId, ALL_TIME_RANGE.from, ALL_TIME_RANGE.to),
      fetchMonthlyTrend(userId),
      fetchRecentMatches(userId, 10),
    ])
      .then(([p, s, pt, op, tr, rc]) => {
        if (stale) return
        setProfile(p)
        setStats(s)
        setPartners(pt)
        setOpponents(op)
        setTrend(tr)
        setRecent(rc)
      })
      .catch(() => {
        if (!stale) setError('기록을 불러오지 못했습니다. 네트워크 상태를 확인해주세요.')
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })

    return () => {
      stale = true
    }
  }, [userId])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  if (error || !profile) {
    return <p className="py-10 text-center text-gray-600">{error ?? '사용자를 찾을 수 없습니다.'}</p>
  }

  const winRate = stats ? calcWinRate(stats.wins, stats.matches_played) : 0
  const participationRate = stats
    ? calcParticipationRate(stats.days_participated, stats.total_match_days)
    : 0
  const pointDiff = stats ? stats.points_for - stats.points_against : 0
  const maxTrendMatches = Math.max(1, ...trend.map((t) => t.matches_played))

  const recentWins = recent.filter((m) => m.result === 'win').length
  const recentLosses = recent.filter((m) => m.result === 'loss').length
  const recentTies = recent.filter((m) => m.result === 'tie').length

  return (
    <div className="flex flex-col gap-5">
      {/* 프로필 헤더 */}
      <div>
        <h1 className="text-2xl font-extrabold">
          <NameWithAward name={profile.name} award={profile.award_level} />
        </h1>
        <p className="text-sm text-gray-500">
          {AWARD_LEVEL_LABELS[profile.award_level]}
          {profile.is_guest && profile.affiliation ? ` · ${profile.affiliation}` : ''}
          {profile.is_guest ? ' · 게스트' : ''}
          {!profile.is_active && ' · 비활성'}
        </p>
      </div>

      {/* 누적 통계 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatCard label="총 경기" value={`${stats?.matches_played ?? 0}`} />
        <StatCard label="승" value={`${stats?.wins ?? 0}`} />
        <StatCard label="패" value={`${stats?.losses ?? 0}`} />
        <StatCard label="승률" value={`${winRate.toFixed(1)}%`} />
        <StatCard label="득점" value={`${stats?.points_for ?? 0}`} />
        <StatCard label="실점" value={`${stats?.points_against ?? 0}`} />
        <StatCard label="득실차" value={pointDiff > 0 ? `+${pointDiff}` : `${pointDiff}`} />
        <StatCard label="누적 참가일" value={`${stats?.days_participated ?? 0}일`} />
        <StatCard label="참가율" value={`${participationRate.toFixed(0)}%`} />
        <StatCard label="무단 결석" value={`${stats?.absences ?? 0}회`} highlight />
      </div>

      {/* 파트너별 기록 */}
      <section>
        <h2 className="mb-2 text-lg font-bold">자주 함께한 파트너</h2>
        {partners.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
            아직 확정된 경기가 없습니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {partners.map((partner) => {
              const rate = calcWinRate(partner.wins, partner.matches_played)
              return (
                <div
                  key={partner.partner_id}
                  className="flex items-center justify-between border-b border-gray-50 px-4 py-3 last:border-b-0"
                >
                  <div>
                    <p>
                      <NameWithAward name={partner.partner_name} award={partner.partner_award} />
                    </p>
                    <p className="text-xs text-gray-400">
                      {AWARD_LEVEL_LABELS[partner.partner_award]}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="tabular-nums">
                      {partner.matches_played}경기 ·{' '}
                      <span className="font-semibold text-green-700">{partner.wins}승</span>{' '}
                      <span className="font-semibold text-red-600">{partner.losses}패</span>
                    </p>
                    <p className="text-xs text-gray-500">승률 {rate.toFixed(1)}%</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 상대별 기록 */}
      <section>
        <h2 className="mb-2 text-lg font-bold">상대별 승률</h2>
        {opponents.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
            아직 확정된 경기가 없습니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {opponents.map((opp) => {
              const rate = calcWinRate(opp.wins, opp.matches_played)
              return (
                <div
                  key={opp.opponent_id}
                  className="flex items-center justify-between border-b border-gray-50 px-4 py-3 last:border-b-0"
                >
                  <div>
                    <p>
                      <NameWithAward name={opp.opponent_name} award={opp.opponent_award} />
                    </p>
                    <p className="text-xs text-gray-400">
                      {AWARD_LEVEL_LABELS[opp.opponent_award]}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="tabular-nums">
                      {opp.matches_played}경기 ·{' '}
                      <span className="font-semibold text-green-700">{opp.wins}승</span>{' '}
                      <span className="font-semibold text-red-600">{opp.losses}패</span>
                    </p>
                    <p className="text-xs text-gray-500">승률 {rate.toFixed(1)}%</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 월별 추이 */}
      <section>
        <h2 className="mb-2 text-lg font-bold">월별 경기·참가 추이</h2>
        {trend.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
            최근 12개월 내 확정된 경기가 없습니다.
          </p>
        ) : (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-green-600" aria-hidden="true" />
                경기 수
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-sky-500" aria-hidden="true" />
                참가일
              </span>
            </div>

            <div className="flex items-end gap-2 overflow-x-auto">
              {trend.map((t) => (
                <div key={t.month} className="flex min-w-12 flex-1 flex-col items-center gap-1">
                  <div className="flex w-full items-end justify-center gap-0.5">
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-semibold tabular-nums text-green-700">
                        {t.matches_played}
                      </span>
                      <div
                        className="w-4 rounded-t-md bg-green-600"
                        style={{ height: `${(t.matches_played / maxTrendMatches) * 80 + 4}px` }}
                        title={`${t.month}: ${t.matches_played}경기 (${t.wins}승 ${t.losses}패)`}
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-semibold tabular-nums text-sky-600">
                        {t.days_participated}
                      </span>
                      <div
                        className="w-4 rounded-t-md bg-sky-500"
                        style={{ height: `${(t.days_participated / maxTrendMatches) * 80 + 4}px` }}
                        title={`${t.month}: ${t.days_participated}일 참가`}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {t.month.slice(2).replace('-', '.')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 최근 경기 목록 */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">최근 경기</h2>
          {recent.length > 0 && (
            <p className="text-sm tabular-nums text-gray-600">
              {recent.length}경기 ·{' '}
              <span className="font-semibold text-green-700">{recentWins}승</span>{' '}
              <span className="font-semibold text-red-600">{recentLosses}패</span>
              {recentTies > 0 && (
                <>
                  {' '}
                  <span className="font-semibold text-gray-500">{recentTies}무</span>
                </>
              )}
            </p>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
            아직 확정된 경기가 없습니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {recent.map((m) => {
              const myScore = m.my_team === 'A' ? m.team_a_score : m.team_b_score
              const oppScore = m.my_team === 'A' ? m.team_b_score : m.team_a_score
              return (
                <div
                  key={m.match_id}
                  className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500">{formatDateKorean(m.match_date)}</p>
                    <p className="text-sm">
                      <span className="text-gray-400">파트너</span>{' '}
                      {m.partner_names.length > 0
                        ? m.partner_names.map((name, i) => (
                            <span key={`${m.match_id}-p-${i}`}>
                              {i > 0 ? ', ' : ''}
                              <NameWithAward name={name} award={m.partner_awards[i]} />
                            </span>
                          ))
                        : '-'}
                      <span className="ml-2 text-gray-400">상대</span>{' '}
                      {m.opponent_names.length > 0
                        ? m.opponent_names.map((name, i) => (
                            <span key={`${m.match_id}-o-${i}`}>
                              {i > 0 ? ', ' : ''}
                              <NameWithAward name={name} award={m.opponent_awards[i]} />
                            </span>
                          ))
                        : '-'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-lg font-extrabold tabular-nums">
                      {myScore} : {oppScore}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${RESULT_STYLES[m.result]}`}
                    >
                      {RESULT_LABELS[m.result]}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
