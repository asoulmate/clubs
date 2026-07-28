import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MATCH_STATUS_LABELS, POSITION_LABELS } from '../../constants/labels'
import {
  adminResetMatch,
  adminSetPlayer,
  adminUpdateScore,
} from '../../services/adminService'
import { cancelMatch, deleteMatch, fetchMatchesByDate } from '../../services/matchService'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import type { MatchWithPlayers, PlayerPosition } from '../../types/domain'
import { ALL_POSITIONS } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { todayKst } from '../../utils/kst'
import { DateNavigator } from '../common/DateNavigator'
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'
import { PlayerSearchInput } from '../players/PlayerSearchInput'
import { StatusBadge } from '../match/StatusBadge'

/** 스코어 강제 수정 다이얼로그 (수정 사유 필수 → 감사 로그 기록) */
function AdminScoreDialog({
  match,
  onClose,
  onChanged,
}: {
  match: MatchWithPlayers
  onClose: () => void
  onChanged: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [teamA, setTeamA] = useState(match.team_a_score?.toString() ?? '')
  const [teamB, setTeamB] = useState(match.team_b_score?.toString() ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (teamA === '' || teamB === '') {
      setError('양 팀의 점수를 모두 입력해주세요.')
      return
    }
    if (reason.trim() === '') {
      setError('수정 사유를 입력해주세요.')
      return
    }

    setSaving(true)
    try {
      await adminUpdateScore(match.id, Number(teamA), Number(teamB), reason.trim())
      showToast('스코어가 수정되어 확정되었습니다.', 'success')
      onChanged()
      onClose()
    } catch (err) {
      setError(toErrorMessage(err))
      setSaving(false)
    }
  }

  const inputClass =
    'h-14 w-full rounded-xl border-2 border-gray-300 text-center text-2xl font-extrabold focus:border-green-600 focus:outline-none'

  return (
    <Dialog open onClose={onClose} title="스코어 강제 수정">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <label className="flex flex-col items-center gap-1">
            <span className="text-sm font-bold text-gray-600">A팀</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={teamA}
              onChange={(e) => setTeamA(e.target.value)}
              className={inputClass}
              aria-label="A팀 점수"
            />
          </label>
          <span className="pt-5 text-xl font-bold text-gray-400">:</span>
          <label className="flex flex-col items-center gap-1">
            <span className="text-sm font-bold text-gray-600">B팀</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={teamB}
              onChange={(e) => setTeamB(e.target.value)}
              className={inputClass}
              aria-label="B팀 점수"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-600">수정 사유 (감사 로그에 기록됨)</span>
          <textarea
            required
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-gray-300 p-3 text-base focus:border-green-600 focus:outline-none"
            placeholder="예: 점수 오기입 정정 (6:4 → 6:3)"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="h-12 rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
        >
          {saving ? '저장 중...' : '수정하고 확정'}
        </button>
      </form>
    </Dialog>
  )
}

/** 참가자 강제 변경 다이얼로그 */
function AdminPlayersDialog({
  match,
  onClose,
  onChanged,
}: {
  match: MatchWithPlayers
  onClose: () => void
  onChanged: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [picking, setPicking] = useState<PlayerPosition | null>(null)
  const [busy, setBusy] = useState(false)

  const playerAt = (position: PlayerPosition) => match.players.find((p) => p.position === position)

  const setSlot = async (position: PlayerPosition, userId: string | null) => {
    setBusy(true)
    try {
      await adminSetPlayer(match.id, position, userId)
      showToast('참가자가 변경되었습니다.', 'success')
      onChanged()
      onClose()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
      setBusy(false)
    }
  }

  // 단식은 A1/B1만 편성 대상
  const positions =
    match.match_type === 'singles'
      ? ALL_POSITIONS.filter((p) => p === 'A1' || p === 'B1')
      : ALL_POSITIONS

  return (
    <Dialog open onClose={onClose} title="참가자 강제 변경">
      <div className="flex flex-col gap-3">
        {positions.map((position) => {
          const player = playerAt(position)
          return (
            <div key={position} className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-gray-600">{POSITION_LABELS[position]}</span>
              {picking === position ? (
                <PlayerSearchInput
                  excludeIds={match.players.map((p) => p.user_id)}
                  autoFocus
                  onSelect={(selected) => void setSlot(position, selected.id)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex min-h-11 flex-1 items-center rounded-xl bg-gray-50 px-3 font-semibold">
                    {player?.profile?.name ?? '(비어 있음)'}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPicking(position)}
                    className="h-11 rounded-xl border border-gray-300 px-3 text-sm font-bold text-gray-600"
                  >
                    변경
                  </button>
                  {player && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setSlot(position, null)}
                      className="h-11 rounded-xl bg-red-50 px-3 text-sm font-bold text-red-600"
                    >
                      비우기
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}

/** 관리자 - 경기 관리 탭 */
export function MatchesTab() {
  const showToast = useToastStore((s) => s.show)
  const clubId = useClubStore((s) => s.club?.id)
  const [date, setDate] = useState(() => todayKst())
  const [matches, setMatches] = useState<MatchWithPlayers[]>([])
  const [loading, setLoading] = useState(true)
  const [scoreTarget, setScoreTarget] = useState<MatchWithPlayers | null>(null)
  const [playersTarget, setPlayersTarget] = useState<MatchWithPlayers | null>(null)

  const load = useCallback(async () => {
    if (!clubId) {
      setMatches([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setMatches(await fetchMatchesByDate(date, clubId))
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [date, clubId, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const handleReset = async (match: MatchWithPlayers) => {
    const reason = window.prompt(
      '경기를 초기화합니다. 스코어와 확인 기록이 삭제됩니다.\n초기화 사유를 입력해주세요. (감사 로그에 기록됨)',
    )
    if (reason === null) return
    try {
      await adminResetMatch(match.id, reason)
      showToast('경기가 초기화되었습니다.', 'success')
      void load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  const handleCancel = async (match: MatchWithPlayers) => {
    const reason = window.prompt('경기를 취소합니다. 취소 사유를 입력해주세요. (선택)')
    if (reason === null) return
    try {
      await cancelMatch(match.id, reason || undefined)
      showToast('경기가 취소되었습니다.', 'success')
      void load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  const handleDelete = async (match: MatchWithPlayers) => {
    if (
      !window.confirm(
        '이 경기를 완전히 삭제할까요?\n참가자·스코어·수정 이력이 모두 삭제되며 되돌릴 수 없습니다.',
      )
    )
      return
    try {
      await deleteMatch(match.id)
      showToast('경기가 삭제되었습니다.', 'success')
      void load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  const teamNames = (match: MatchWithPlayers, team: 'A' | 'B') =>
    match.players
      .filter((p) => p.position.startsWith(team))
      .map((p) => p.profile?.name ?? '?')
      .join(', ') || '(비어 있음)'

  return (
    <div className="flex flex-col gap-3">
      <DateNavigator date={date} onChange={setDate} />

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : matches.length === 0 ? (
        <p className="py-10 text-center text-gray-500">해당 날짜에 경기가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {matches.map((match, i) => (
            <div key={match.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-bold">#{i + 1}</span>
                <StatusBadge status={match.status} />
              </div>

              <p className="text-sm">
                <span className="font-semibold">A팀</span> {teamNames(match, 'A')}
                <span className="mx-2 font-extrabold tabular-nums">
                  {match.team_a_score ?? '-'} : {match.team_b_score ?? '-'}
                </span>
                <span className="font-semibold">B팀</span> {teamNames(match, 'B')}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setScoreTarget(match)}
                  disabled={match.status === 'canceled'}
                  className="h-10 rounded-lg bg-green-50 px-3 text-sm font-bold text-green-700 disabled:opacity-40"
                >
                  스코어 수정
                </button>
                <button
                  type="button"
                  onClick={() => setPlayersTarget(match)}
                  disabled={match.status === 'canceled'}
                  className="h-10 rounded-lg bg-blue-50 px-3 text-sm font-bold text-blue-700 disabled:opacity-40"
                >
                  참가자 변경
                </button>
                <button
                  type="button"
                  onClick={() => void handleReset(match)}
                  className="h-10 rounded-lg bg-amber-50 px-3 text-sm font-bold text-amber-700"
                >
                  초기화
                </button>
                {match.status !== 'canceled' && (
                  <button
                    type="button"
                    onClick={() => void handleCancel(match)}
                    className="h-10 rounded-lg bg-red-50 px-3 text-sm font-bold text-red-600"
                  >
                    취소
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(match)}
                  className="h-10 rounded-lg bg-red-600 px-3 text-sm font-bold text-white"
                >
                  삭제
                </button>
              </div>

              <p className="mt-2 text-xs text-gray-400">
                상태: {MATCH_STATUS_LABELS[match.status]} · 버전 {match.version}
              </p>
            </div>
          ))}
        </div>
      )}

      {scoreTarget && (
        <AdminScoreDialog
          match={scoreTarget}
          onClose={() => setScoreTarget(null)}
          onChanged={() => void load()}
        />
      )}
      {playersTarget && (
        <AdminPlayersDialog
          match={playersTarget}
          onClose={() => setPlayersTarget(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}
