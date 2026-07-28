import { useEffect, useState } from 'react'
import { AWARD_LEVEL_LABELS, MATCH_TYPE_LABELS } from '../../constants/labels'
import { createMatch, fetchInProgressUserIds } from '../../services/matchService'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { MatchType, PlayerPosition, Profile } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { formatDateKoreanFull, todayKst } from '../../utils/kst'
import { Dialog } from '../common/Dialog'
import { PlayerSearchInput } from '../players/PlayerSearchInput'

interface CreateMatchDialogProps {
  date: string
  onClose: () => void
  onCreated: () => void
}

type SelectablePosition = Exclude<PlayerPosition, 'A1'>

const DOUBLES_SLOTS: { position: SelectablePosition; label: string }[] = [
  { position: 'A2', label: 'A팀 2번 (내 파트너)' },
  { position: 'B1', label: 'B팀 1번' },
  { position: 'B2', label: 'B팀 2번' },
]

const SINGLES_SLOTS: { position: SelectablePosition; label: string }[] = [
  { position: 'B1', label: '상대 선수 (B팀 1번)' },
]

/** 한국 시간 기준 현재 "HH:MM" */
function nowTimeKst(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/** 신규 경기 생성 다이얼로그 (단식/복식 · 배팅 경기 · 배팅 마감 시간) */
export function CreateMatchDialog({ date, onClose, onCreated }: CreateMatchDialogProps) {
  const profile = useAuthStore((s) => s.profile)
  const clubId = useClubStore((s) => s.club?.id)
  const defaultMatchType = useSettingsStore((s) => s.settings.default_match_type)
  const showToast = useToastStore((s) => s.show)
  const [matchType, setMatchType] = useState<MatchType>(
    defaultMatchType === 'singles' ? 'singles' : 'doubles',
  )
  const [selected, setSelected] = useState<Partial<Record<SelectablePosition, Profile>>>({})
  const [picking, setPicking] = useState<SelectablePosition | null>(null)
  const [isBetting, setIsBetting] = useState(false)
  const [deadlineTime, setDeadlineTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [inProgressIds, setInProgressIds] = useState<string[]>([])

  useEffect(() => {
    if (!clubId) return
    void fetchInProgressUserIds(clubId)
      .then(setInProgressIds)
      .catch(() => setInProgressIds([]))
  }, [clubId])

  const excludeIds = [
    profile?.id ?? '',
    ...Object.values(selected).map((p) => p.id),
    ...inProgressIds,
  ]

  const slots = matchType === 'singles' ? SINGLES_SLOTS : DOUBLES_SLOTS
  const isToday = date === todayKst()

  const handleTypeChange = (type: MatchType) => {
    setMatchType(type)
    setPicking(null)
    if (type === 'singles') {
      // 단식은 상대 1명(B1)만 유지
      setSelected((prev) => (prev.B1 ? { B1: prev.B1 } : {}))
    }
  }

  /** 배팅 마감 시각 검증 + ISO(timestamptz) 변환. 문제가 있으면 오류 메시지 반환 */
  const buildDeadline = (): { iso: string } | { error: string } => {
    if (!deadlineTime) {
      return { error: '배팅 마감 시간을 입력해주세요.' }
    }
    if (!/^\d{2}:\d{2}$/.test(deadlineTime)) {
      return { error: '배팅 마감 시간 형식이 올바르지 않습니다.' }
    }
    // 경기 당일 날짜 + 입력 시각(KST) → 당일을 넘길 수 없음이 구조적으로 보장됨
    const iso = `${date}T${deadlineTime}:00+09:00`
    if (Number.isNaN(new Date(iso).getTime())) {
      return { error: '배팅 마감 시간이 올바르지 않습니다.' }
    }
    if (new Date(iso).getTime() <= Date.now()) {
      return {
        error: isToday
          ? '배팅 마감 시간은 현재 시각 이후로 설정해주세요.'
          : '지난 날짜의 경기에는 배팅 경기를 만들 수 없습니다.',
      }
    }
    return { iso }
  }

  const handleCreate = async () => {
    if (!clubId) {
      showToast('클럽 정보가 없습니다.', 'error')
      return
    }

    let bettingDeadline: string | null = null
    if (isBetting) {
      const result = buildDeadline()
      if ('error' in result) {
        showToast(result.error, 'error')
        return
      }
      bettingDeadline = result.iso
    }

    setSaving(true)
    try {
      await createMatch({
        matchDate: date,
        clubId,
        matchType,
        a2: selected.A2?.id ?? null,
        b1: selected.B1?.id ?? null,
        b2: selected.B2?.id ?? null,
        isBetting,
        bettingDeadline,
      })
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

        {/* 단식/복식 선택 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-gray-600">경기 유형</span>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200 p-1">
            {(['doubles', 'singles'] as MatchType[]).map((type) => (
              <button
                key={type}
                type="button"
                disabled={saving}
                onClick={() => handleTypeChange(type)}
                className={`h-10 rounded-lg text-sm font-bold ${
                  matchType === type ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                {MATCH_TYPE_LABELS[type]}
                <span className="ml-1 text-xs font-normal">
                  ({type === 'singles' ? '1:1' : '2:2'})
                </span>
              </button>
            ))}
          </div>
          {matchType === 'singles' && (
            <p className="text-xs text-gray-400">단식은 상대 선수 1명만 지정하면 됩니다.</p>
          )}
        </div>

        {inProgressIds.length > 0 && (
          <p className="text-xs text-amber-700">
            * 현재 다른 경기를 진행 중인 선수는 목록에 표시되지 않습니다.
          </p>
        )}

        {slots.map(({ position, label }) => {
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

        {/* 배팅 경기 설정 */}
        <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="font-bold text-amber-900">💰 배팅 경기로 만들기</span>
              <span className="mt-0.5 block text-xs text-amber-800/80">
                배팅 경기만 &lsquo;경기 시작&rsquo; 버튼이 활성화됩니다. 일반 경기는 스코어 입력만
                가능합니다.
              </span>
            </span>
            <input
              type="checkbox"
              checked={isBetting}
              disabled={saving}
              onChange={(e) => setIsBetting(e.target.checked)}
              className="h-6 w-6 shrink-0 accent-amber-600"
            />
          </label>

          {isBetting && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-white/80 p-2">
              <label htmlFor="betting-deadline" className="text-sm font-bold text-gray-600">
                배팅 마감 시간 (경기 당일 {formatDateKoreanFull(date)})
              </label>
              <input
                id="betting-deadline"
                type="time"
                value={deadlineTime}
                disabled={saving}
                min={isToday ? nowTimeKst() : undefined}
                onChange={(e) => setDeadlineTime(e.target.value)}
                className="h-11 rounded-lg border border-gray-300 px-3 text-base focus:border-amber-600 focus:outline-none"
              />
              <p className="text-xs text-gray-400">
                마감 시간은 경기 당일을 넘길 수 없으며, 마감 후에는 배팅 등록·변경·취소가
                불가합니다.
              </p>
            </div>
          )}
        </div>

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
