import { useEffect, useState } from 'react'
import { AWARD_LEVEL_LABELS } from '../../constants/labels'
import { createMatch, fetchInProgressUserIds } from '../../services/matchService'
import { useAuthStore } from '../../stores/authStore'
import { useToastStore } from '../../stores/toastStore'
import type { PlayerPosition, Profile } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { formatDateKoreanFull } from '../../utils/kst'
import { Dialog } from '../common/Dialog'
import { PlayerSearchInput } from '../players/PlayerSearchInput'

interface CreateMatchDialogProps {
  date: string
  onClose: () => void
  onCreated: () => void
}

type SelectablePosition = Exclude<PlayerPosition, 'A1'>

const SLOT_INFO: { position: SelectablePosition; label: string }[] = [
  { position: 'A2', label: 'A팀 2번 (내 파트너)' },
  { position: 'B1', label: 'B팀 1번' },
  { position: 'B2', label: 'B팀 2번' },
]

/**
 * 신규 경기 생성 다이얼로그
 *  - 생성자는 자동으로 A팀 1번으로 등록됨
 *  - 경기 중(in_progress)인 선수는 검색에서 제외 (최종 검증은 DB)
 */
export function CreateMatchDialog({ date, onClose, onCreated }: CreateMatchDialogProps) {
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [selected, setSelected] = useState<Partial<Record<SelectablePosition, Profile>>>({})
  const [picking, setPicking] = useState<SelectablePosition | null>(null)
  const [saving, setSaving] = useState(false)
  const [inProgressIds, setInProgressIds] = useState<string[]>([])

  useEffect(() => {
    void fetchInProgressUserIds()
      .then(setInProgressIds)
      .catch(() => setInProgressIds([]))
  }, [])

  const excludeIds = [
    profile?.id ?? '',
    ...Object.values(selected).map((p) => p.id),
    ...inProgressIds,
  ]

  const handleCreate = async () => {
    setSaving(true)
    try {
      await createMatch(date, selected.A2?.id ?? null, selected.B1?.id ?? null, selected.B2?.id ?? null)
      showToast('경기가 생성되었습니다.', 'success')
      onCreated()
      onClose()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="신규 경기 만들기">
      <div className="flex flex-col gap-4">
        <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800">
          {formatDateKoreanFull(date)} 경기 · <strong>{profile?.name}</strong> 님이 A팀 1번으로
          자동 등록됩니다. 나머지 자리는 비워두고 나중에 채울 수도 있습니다.
        </p>
        {inProgressIds.length > 0 && (
          <p className="text-xs text-amber-700">
            * 현재 다른 경기를 진행 중인 선수는 목록에 표시되지 않습니다.
          </p>
        )}

        {SLOT_INFO.map(({ position, label }) => {
          const pick = selected[position]
          return (
            <div key={position} className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-gray-600">{label}</span>

              {pick ? (
                <div className="flex min-h-12 items-center justify-between rounded-xl bg-gray-50 px-3">
                  <span className="min-w-0">
                    <span className="font-semibold">
                      {pick.name}
                      {pick.is_guest && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          G
                        </span>
                      )}
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        {AWARD_LEVEL_LABELS[pick.award_level]}
                      </span>
                    </span>
                    {pick.is_guest && pick.affiliation ? (
                      <span className="mt-0.5 block truncate text-xs text-gray-400">
                        {pick.affiliation}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-label={`${pick.name} 선택 해제`}
                    onClick={() =>
                      setSelected((prev) => {
                        const next = { ...prev }
                        delete next[position]
                        return next
                      })
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 active:bg-gray-200"
                  >
                    ×
                  </button>
                </div>
              ) : picking === position ? (
                <PlayerSearchInput
                  excludeIds={excludeIds}
                  autoFocus
                  onSelect={(p) => {
                    setSelected((prev) => ({ ...prev, [position]: p }))
                    setPicking(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPicking(position)}
                  className="flex min-h-12 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-400 active:bg-gray-50"
                >
                  + 선수 선택 (선택 사항)
                </button>
              )}
            </div>
          )
        })}

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleCreate()}
          className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
        >
          {saving ? '생성 중...' : '경기 만들기'}
        </button>
      </div>
    </Dialog>
  )
}
