import { useEffect, useState } from 'react'
import { POSITION_LABELS } from '../../constants/labels'
import { fetchInProgressUserIds, registerPlayer } from '../../services/matchService'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { MatchWithPlayers, PlayerPosition, Profile } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdminOrSub } from '../../utils/permissions'
import { Dialog } from '../common/Dialog'
import { PlayerSearchInput } from '../players/PlayerSearchInput'

interface RegisterSlotDialogProps {
  match: MatchWithPlayers
  position: PlayerPosition
  onClose: () => void
  onChanged: () => void
}

/** 빈 슬롯 참가자 등록: 본인 등록 + (설정 허용 시) 다른 회원 대리 등록 */
export function RegisterSlotDialog({ match, position, onClose, onChanged }: RegisterSlotDialogProps) {
  const profile = useAuthStore((s) => s.profile)
  const settings = useSettingsStore((s) => s.settings)
  const showToast = useToastStore((s) => s.show)
  const [saving, setSaving] = useState(false)
  const [inProgressIds, setInProgressIds] = useState<string[]>([])

  useEffect(() => {
    void fetchInProgressUserIds()
      .then(setInProgressIds)
      .catch(() => setInProgressIds([]))
  }, [])

  const alreadyInMatch = match.players.some((p) => p.user_id === profile?.id)
  const canProxy = settings.allow_proxy_registration || isAdminOrSub(profile)
  const iAmInProgress = profile ? inProgressIds.includes(profile.id) : false

  const register = async (userId?: string) => {
    setSaving(true)
    try {
      await registerPlayer(match.id, position, userId)
      showToast('참가자가 등록되었습니다.', 'success')
      onChanged()
      onClose()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={`${POSITION_LABELS[position]} 등록`}>
      <div className="flex flex-col gap-4">
        {!alreadyInMatch && (
          <button
            type="button"
            disabled={saving || iAmInProgress}
            onClick={() => void register()}
            className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
          >
            {iAmInProgress ? '다른 경기 진행 중 — 등록 불가' : '나를 이 자리에 등록'}
          </button>
        )}

        {canProxy ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-600">
              {alreadyInMatch ? '다른 회원을 등록합니다.' : '또는 다른 회원을 대신 등록'}
            </p>
            <p className="text-xs text-amber-700">
              * 현재 다른 경기를 진행 중인 선수는 목록에 표시되지 않습니다.
            </p>
            <PlayerSearchInput
              excludeIds={[...match.players.map((p) => p.user_id), ...inProgressIds]}
              onSelect={(selected: Profile) => void register(selected.id)}
              autoFocus={alreadyInMatch}
            />
          </div>
        ) : (
          alreadyInMatch && (
            <p className="text-sm text-gray-500">
              이미 이 경기에 등록되어 있으며, 대리 등록이 허용되지 않아 다른 회원을 등록할 수 없습니다.
            </p>
          )
        )}
      </div>
    </Dialog>
  )
}
