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
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'
import { BettingCountdown } from './BettingCountdown'

const BET_RESULT_LABELS = {
  win: '적중',
  loss: '미적중',
  push: '무효',
} as const

function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}

interface MatchBettingDialogProps {
  match: MatchWithPlayers
  onClose: () => void
}

/** 승패 배팅 다이얼로그 (배팅 입력 + 참여 현황 + 정산 결과) */
export function MatchBettingDialog({ match, onClose }: MatchBettingDialogProps) {
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [bets, setBets] = useState<MatchBet[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState<BetAmount>(1000)
  const [team, setTeam] = useState<TeamSide>('A')
  // 마감 시각이 지나면 즉시 입력을 잠그기 위한 1초 시계
  const [now, setNow] = useState(() => Date.now())

  const deadlineMs = match.betting_deadline ? new Date(match.betting_deadline).getTime() : null
  const deadlinePassed = deadlineMs !== null && !Number.isNaN(deadlineMs) && now >= deadlineMs
  const settled = match.status === 'confirmed' || match.status === 'canceled'
  const locked = settled || deadlinePassed

  const myBet = profile ? bets.find((b) => b.user_id === profile.id) : undefined
  const winner =
    match.team_a_score !== null && match.team_b_score !== null
      ? winnerTeam(match.team_a_score, match.team_b_score)
      : null

  useEffect(() => {
    if (locked || deadlineMs === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [locked, deadlineMs])

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
    if (!myBet) return
    // 과거 2000원 배팅 등 현재 선택지에 없는 금액이면 기본값 유지
    if ((BET_AMOUNTS as readonly number[]).includes(myBet.amount)) {
      setAmount(myBet.amount as BetAmount)
    }
    setTeam(myBet.predicted_team)
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

  const totalPool = bets.reduce((s, b) => s + b.amount, 0)
  const teamACount = bets.filter((b) => b.predicted_team === 'A').length
  const teamBCount = bets.filter((b) => b.predicted_team === 'B').length

  return (
    <Dialog open onClose={onClose} title="승패 배팅">
      <div className="flex flex-col gap-3">
        {/* 마감 시간 안내 */}
        {match.betting_deadline && (
          <div className="flex justify-center">
            <BettingCountdown deadline={match.betting_deadline} settled={settled} />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <>
            {!locked && profile && (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <div className="grid grid-cols-2 gap-1.5">
                  {BET_AMOUNTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={busy}
                      onClick={() => setAmount(a)}
                      className={`h-11 rounded-lg text-sm font-bold ${
                        amount === a
                          ? 'bg-amber-600 text-white'
                          : 'border border-amber-300 bg-white text-amber-900'
                      }`}
                    >
                      {formatWon(a)}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['A', 'B'] as TeamSide[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={busy}
                      onClick={() => setTeam(t)}
                      className={`h-11 rounded-lg text-sm font-bold ${
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
                    className="h-11 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {myBet ? '배팅 변경' : '배팅하기'}
                  </button>
                  {myBet && !myBet.result && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleCancel()}
                      className="h-11 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-600 disabled:opacity-50"
                    >
                      취소
                    </button>
                  )}
                </div>
              </div>
            )}

            {locked && !settled && (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-center text-sm text-gray-600">
                배팅이 마감되어 더 이상 배팅하거나 변경할 수 없습니다.
              </p>
            )}

            {/* 참여 현황 */}
            <div className="flex items-center justify-between text-xs text-amber-800/80">
              <span>
                {bets.length}명 참여 · 합계 {formatWon(totalPool)}
              </span>
              <span>
                A팀 {teamACount}명 · B팀 {teamBCount}명
                {settled && winner ? ` · 결과 ${winner}팀 승` : ''}
              </span>
            </div>

            {bets.length === 0 ? (
              <p className="py-3 text-center text-sm text-gray-400">아직 배팅이 없습니다.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {bets.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
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
    </Dialog>
  )
}
