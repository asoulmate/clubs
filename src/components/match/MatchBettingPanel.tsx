import { useCallback, useEffect, useState } from 'react'
import {
  cancelMatchBet,
  fetchMatchBets,
  placeMatchBet,
} from '../../services/betService'
import { useAuthStore } from '../../stores/authStore'
import { useToastStore } from '../../stores/toastStore'
import type { BetAmount, MatchBet, MatchWithPlayers, TeamSide } from '../../types/domain'
import { BET_AMOUNTS } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { winnerTeam } from '../../utils/score'
import { Spinner } from '../common/Spinner'

const BET_RESULT_LABELS = {
  win: '적중',
  loss: '미적중',
  push: '무효',
} as const

function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}

interface MatchBettingPanelProps {
  match: MatchWithPlayers
}

/** 경기 카드 하단: 배팅 참여·목록·결과 */
export function MatchBettingPanel({ match }: MatchBettingPanelProps) {
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [bets, setBets] = useState<MatchBet[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState<BetAmount>(1000)
  const [team, setTeam] = useState<TeamSide>('A')

  const locked = match.status === 'confirmed' || match.status === 'canceled'
  const myBet = profile ? bets.find((b) => b.user_id === profile.id) : undefined
  const winner =
    match.team_a_score !== null && match.team_b_score !== null
      ? winnerTeam(match.team_a_score, match.team_b_score)
      : null

  const refresh = useCallback(async () => {
    try {
      setBets(await fetchMatchBets(match.id))
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [match.id, showToast])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (myBet) {
      setAmount(myBet.amount)
      setTeam(myBet.predicted_team)
    }
  }, [myBet])

  const handlePlace = async () => {
    setBusy(true)
    try {
      await placeMatchBet(match.id, amount, team)
      showToast(myBet ? '배팅을 변경했습니다.' : '배팅했습니다.', 'success')
      await refresh()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    if (!window.confirm('이 경기의 배팅을 취소할까요?')) return
    setBusy(true)
    try {
      await cancelMatchBet(match.id)
      showToast('배팅을 취소했습니다.', 'success')
      await refresh()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (match.status === 'canceled' && bets.length === 0) return null

  const totalPool = bets.reduce((s, b) => s + b.amount, 0)
  const teamACount = bets.filter((b) => b.predicted_team === 'A').length
  const teamBCount = bets.filter((b) => b.predicted_team === 'B').length

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-amber-900">승패 배팅</h3>
        {bets.length > 0 && (
          <span className="text-xs text-amber-800">
            {bets.length}명 · 합계 {formatWon(totalPool)}
            {locked && winner ? ` · 결과 ${winner}팀` : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-3">
          <Spinner />
        </div>
      ) : (
        <>
          {!locked && profile && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg bg-white/80 p-2">
              <div className="flex flex-wrap gap-1.5">
                {BET_AMOUNTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={busy}
                    onClick={() => setAmount(a)}
                    className={`h-9 rounded-lg px-3 text-sm font-bold ${
                      amount === a
                        ? 'bg-amber-600 text-white'
                        : 'border border-amber-300 bg-white text-amber-900'
                    }`}
                  >
                    {formatWon(a)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['A', 'B'] as TeamSide[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={busy}
                    onClick={() => setTeam(t)}
                    className={`h-9 flex-1 rounded-lg text-sm font-bold ${
                      team === t
                        ? 'bg-green-700 text-white'
                        : 'border border-gray-300 bg-white text-gray-700'
                    }`}
                  >
                    {t}팀 승
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePlace()}
                  className="h-10 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white disabled:opacity-50"
                >
                  {myBet ? '배팅 변경' : '배팅하기'}
                </button>
                {myBet && !myBet.result && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancel()}
                    className="h-10 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-600"
                  >
                    취소
                  </button>
                )}
              </div>
            </div>
          )}

          {bets.length === 0 ? (
            <p className="text-center text-xs text-amber-800/80">아직 배팅이 없습니다.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              <li className="flex justify-between text-xs text-amber-800/70">
                <span>A팀 {teamACount}명</span>
                <span>B팀 {teamBCount}명</span>
              </li>
              {bets.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1.5"
                >
                  <span className="truncate font-medium text-gray-900">
                    {b.profile?.name ?? '회원'}
                    {profile?.id === b.user_id ? ' (나)' : ''}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-700">
                    {b.predicted_team}팀 · {formatWon(b.amount)}
                    {b.result ? (
                      <span
                        className={`ml-1.5 font-bold ${
                          b.result === 'win'
                            ? 'text-green-700'
                            : b.result === 'loss'
                              ? 'text-red-600'
                              : 'text-gray-500'
                        }`}
                      >
                        {BET_RESULT_LABELS[b.result]}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
