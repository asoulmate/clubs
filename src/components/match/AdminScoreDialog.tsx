import { useState, type FormEvent } from 'react'
import { adminUpdateScore } from '../../services/adminService'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { MatchWithPlayers } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { Dialog } from '../common/Dialog'

/** 확정 경기 포함 스코어 강제 수정 (사유 필수 → 감사 로그) */
export function AdminScoreDialog({
  match,
  onClose,
  onChanged,
}: {
  match: MatchWithPlayers
  onClose: () => void
  onChanged: () => void
}) {
  const settings = useSettingsStore((s) => s.settings)
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
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          확정된 경기도 수정할 수 있습니다. 수정 사유는 이력에 남습니다.
        </p>
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
              max={settings.score_max}
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
