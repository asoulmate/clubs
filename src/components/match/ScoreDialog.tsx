import { useState, type FormEvent } from 'react'
import { submitScore } from '../../services/matchService'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { MatchWithPlayers } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { validateScoreInput } from '../../utils/score'
import { Dialog } from '../common/Dialog'

interface ScoreDialogProps {
  match: MatchWithPlayers
  onClose: () => void
  onChanged: () => void
}

/** 스코어 입력 및 확정 요청 다이얼로그 */
export function ScoreDialog({ match, onClose, onChanged }: ScoreDialogProps) {
  const settings = useSettingsStore((s) => s.settings)
  const showToast = useToastStore((s) => s.show)
  const [teamA, setTeamA] = useState<string>(match.team_a_score?.toString() ?? '')
  const [teamB, setTeamB] = useState<string>(match.team_b_score?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const a = teamA === '' ? null : Number(teamA)
    const b = teamB === '' ? null : Number(teamB)

    // 1차 검증은 프런트에서, 최종 검증은 DB(validate_score)에서 수행
    const validationError = validateScoreInput(a, b, settings)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    try {
      // version으로 낙관적 잠금: 동시 수정 시 DB가 한글 오류를 반환
      await submitScore(match.id, a as number, b as number, match.version)
      showToast(
        settings.confirm_mode === 'single'
          ? '스코어가 확정되었습니다.'
          : '확정 요청되었습니다. 상대 팀 참가자의 최종 확인을 기다립니다.',
        'success',
      )
      onChanged()
      onClose()
    } catch (err) {
      setError(toErrorMessage(err))
      setSaving(false)
    }
  }

  const scoreInputClass =
    'h-16 w-full rounded-xl border-2 border-gray-300 text-center text-3xl font-extrabold focus:border-green-600 focus:outline-none'

  return (
    <Dialog open onClose={onClose} title="스코어 입력">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <label className="flex flex-col items-center gap-1">
            <span className="text-sm font-bold text-gray-600">A팀</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={settings.score_max}
              value={teamA}
              onChange={(e) => setTeamA(e.target.value)}
              className={scoreInputClass}
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
              max={settings.score_max}
              value={teamB}
              onChange={(e) => setTeamB(e.target.value)}
              className={scoreInputClass}
              aria-label="B팀 점수"
            />
          </label>
        </div>

        {settings.confirm_mode === 'double' && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            확정 요청 후 상대 팀 참가자 1명이 최종 확인하면 경기가 확정됩니다.
          </p>
        )}
        {settings.allow_tie && (
          <p className="text-center text-xs text-gray-400">동점(예: 5:5)은 무승부로 기록됩니다.</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
        >
          {saving ? '저장 중...' : settings.confirm_mode === 'single' ? '스코어 확정' : '확정 요청'}
        </button>
      </form>
    </Dialog>
  )
}
