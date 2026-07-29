import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '../common/Spinner'
import { AWARD_LEVEL_ICONS, TOURNAMENT_PLACEMENT_LABELS } from '../../constants/labels'
import {
  fetchClubTournamentEntries,
  fetchTournamentMonthlySummary,
  formatTournamentMonth,
} from '../../services/tournamentService'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import type {
  TournamentEntry,
  TournamentMonthlySummary,
  TournamentPlacement,
} from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { todayKst } from '../../utils/kst'

type PlacementFilter = '' | 'awarded' | TournamentPlacement

const PLACEMENT_STYLE: Record<TournamentPlacement, string> = {
  champion: 'bg-amber-100 text-amber-900',
  runner_up: 'bg-slate-100 text-slate-800',
  third: 'bg-orange-50 text-orange-800',
  none: 'bg-gray-100 text-gray-600',
}

function defaultFromMonth(): string {
  const d = new Date(`${todayKst()}T00:00:00`)
  d.setMonth(d.getMonth() - 11)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 관리자 · 대회 참가 현황 조회 (월별·입상·규모 필터) */
export function TournamentsTab() {
  const club = useClubStore((s) => s.club)
  const showToast = useToastStore((s) => s.show)

  const [fromMonth, setFromMonth] = useState(defaultFromMonth)
  const [toMonth, setToMonth] = useState(() => todayKst().slice(0, 7))
  const [placement, setPlacement] = useState<PlacementFilter>('')
  const [maxLte, setMaxLte] = useState('')
  const [entries, setEntries] = useState<TournamentEntry[]>([])
  const [summary, setSummary] = useState<TournamentMonthlySummary[]>([])
  const [loading, setLoading] = useState(true)

  const maxParticipantsLte = useMemo(() => {
    if (!maxLte.trim()) return null
    const n = Number(maxLte)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [maxLte])

  const load = useCallback(async () => {
    if (!club?.id) return
    setLoading(true)
    try {
      const [rows, monthly] = await Promise.all([
        fetchClubTournamentEntries(club.id, {
          fromMonth,
          toMonth,
          placement: placement || null,
          maxParticipantsLte,
        }),
        fetchTournamentMonthlySummary(club.id, fromMonth, toMonth, maxParticipantsLte),
      ])
      setEntries(rows)
      setSummary(monthly)
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [club?.id, fromMonth, toMonth, placement, maxParticipantsLte, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    return summary.reduce(
      (acc, s) => {
        acc.entries += Number(s.entries_count)
        acc.champions += Number(s.champions)
        acc.runnerUps += Number(s.runner_ups)
        acc.thirds += Number(s.thirds)
        return acc
      },
      { entries: 0, champions: 0, runnerUps: 0, thirds: 0 },
    )
  }, [summary])

  if (!club) return null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold">대회 참가 현황</h2>
        <p className="text-xs text-gray-500">
          기간·입상·대회 규모로 조회합니다. 개별 입력은 회원 「내 기록」에서 합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">시작 월</span>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">종료 월</span>
          <input
            type="month"
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">입상 필터</span>
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value as PlacementFilter)}
            className="h-10 rounded-lg border border-gray-200 px-2 text-sm"
          >
            <option value="">전체</option>
            <option value="awarded">입상만 (우승·준우승·3위)</option>
            <option value="champion">우승</option>
            <option value="runner_up">준우승</option>
            <option value="third">3위</option>
            <option value="none">비입상</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">최대 인원 ≤</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={maxLte}
            onChange={(e) => setMaxLte(e.target.value)}
            placeholder="예: 32 (비우면 전체)"
            className="h-10 rounded-lg border border-gray-200 px-2 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums">{totals.entries}</p>
          <p className="text-xs text-gray-500">참가 건수</p>
        </div>
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums text-amber-800">{totals.champions}</p>
          <p className="text-xs text-gray-500">우승</p>
        </div>
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums">{totals.runnerUps}</p>
          <p className="text-xs text-gray-500">준우승</p>
        </div>
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums">{totals.thirds}</p>
          <p className="text-xs text-gray-500">3위</p>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-bold">월별 참가 현황</h3>
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : summary.length === 0 ? (
          <p className="rounded-xl bg-white py-5 text-center text-sm text-gray-500 shadow-sm">
            해당 기간 기록이 없습니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-1 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-500">
              <span>월</span>
              <span>참가/명</span>
              <span>입상</span>
              <span>비입상</span>
            </div>
            {summary.map((s) => (
              <div
                key={s.month}
                className="grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-1 border-t border-gray-50 px-3 py-2 text-sm"
              >
                <span className="font-semibold tabular-nums">{s.month.slice(2).replace('-', '.')}</span>
                <span className="tabular-nums text-gray-700">
                  {s.entries_count}건 · {s.unique_players}명
                </span>
                <span className="tabular-nums text-amber-800">
                  {Number(s.champions) + Number(s.runner_ups) + Number(s.thirds)}
                </span>
                <span className="tabular-nums text-gray-500">{s.non_awards}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">참가 목록 ({entries.length})</h3>
        {loading ? null : entries.length === 0 ? (
          <p className="rounded-xl bg-white py-5 text-center text-sm text-gray-500 shadow-sm">
            조건에 맞는 기록이 없습니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {entries.map((e) => {
              const icon = e.profile?.award_level
                ? AWARD_LEVEL_ICONS[e.profile.award_level]
                : ''
              return (
                <div
                  key={e.id}
                  className="flex items-start justify-between gap-3 border-b border-gray-50 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {e.profile?.name ?? '회원'}
                      {icon ? <span aria-hidden="true"> {icon}</span> : null}
                      <span className="font-normal text-gray-400"> · {e.tournament_name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTournamentMonth(e.tournament_month)}
                      {e.max_participants != null ? ` · 최대 ${e.max_participants}명` : ''}
                    </p>
                    {e.notes ? <p className="mt-0.5 text-xs text-gray-400">{e.notes}</p> : null}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${PLACEMENT_STYLE[e.placement]}`}
                  >
                    {TOURNAMENT_PLACEMENT_LABELS[e.placement]}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
