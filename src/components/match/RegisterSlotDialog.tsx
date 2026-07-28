import { useEffect, useState } from 'react'
import { POSITION_LABELS } from '../../constants/labels'
import { adminSetPlayer } from '../../services/adminService'
import { fetchInProgressUserIds, registerPlayer } from '../../services/matchService'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
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

/** 빈 슬롯 참가자 등록: 본인 등록 + (설정 허용 시) 다른 회원/게스트 대리 등록 */
export function RegisterSlotDialog({ match, position, onClose, onChanged }: RegisterSlotDialogProps) {
  const profile = useAuthStore((s) => s.profile)
  const clubId = useClubStore((s) => s.club?.id)
  const settings = useSettingsStore((s) => s.settings)
  const showToast = useToastStore((s) => s.show)
  const [saving, setSaving] = useState(false)
  const [inProgressIds, setInProgressIds] = useState<string[]>([])

  useEffect(() => {
    if (!clubId) return
    void fetchInProgressUserIds(clubId)
      .then(setInProgressIds)
      .catch(() => setInProgressIds([]))
  }, [clubId])

  const alreadyInMatch = match.players.some((p) => p.user_id === profile?.id)
  const canProxy = settings.allow_proxy_registration || isAdminOrSub(profile)
  const iAmInProgress = profile ? inProgressIds.includes(profile.id) : false
  const isEditingLockedStatus = match.status !== 'open' && match.status !== 'ready'
  // 확정·진행 중 등: 관리자/서브만 빈 슬롯 채우기 가능 (DB register_player / admin_set_player)
  const adminCanFillLocked = isAdminOrSub(profile) && isEditingLockedStatus

  const register = async (userId?: string) => {
    setSaving(true)
    try {
      if (adminCanFillLocked) {
        // 확정 경기 등에서는 admin_set_player로 대체 등록 (일반 register 경로 혼동 방지)
        if (!userId) {
          throw new Error('확정된 경기에는 관리자가 다른 선수를 지정해 등록해야 합니다.')
        }
        await adminSetPlayer(match.id, position, userId)
      } else {
        await registerPlayer(match.id, position, userId)
      }
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
        {adminCanFillLocked && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            확정(또는 진행 중) 경기의 참가자 변경입니다. 관리자 권한으로 대체 선수를 등록합니다.
          </p>
        )}

        {!alreadyInMatch && !adminCanFillLocked && (
          <button
            type="button"
            disabled={saving || iAmInProgress}
            onClick={() => void register()}
            className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
          >
            {iAmInProgress ? '다른 경기 진행 중 — 등록 불가' : '나를 이 자리에 등록'}
          </button>
        )}

        {canProxy || adminCanFillLocked ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-600">
              {adminCanFillLocked
                ? '대체할 선수(회원 또는 게스트)를 선택하세요.'
                : alreadyInMatch
                  ? '다른 회원을 등록합니다.'
                  : '또는 다른 회원을 대신 등록'}
            </p>
            <p className="text-xs text-amber-700">
              * 현재 다른 경기를 진행 중인 선수는 목록에 표시되지 않습니다.
            </p>
            <PlayerSearchInput
              excludeIds={[...match.players.map((p) => p.user_id), ...inProgressIds]}
              onSelect={(selected: Profile) => void register(selected.id)}
              autoFocus={alreadyInMatch || adminCanFillLocked}
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
