import { useState } from 'react'
import { updateAppSetting } from '../../services/settingsService'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { AppSettings, ConfirmMode } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdmin } from '../../utils/permissions'

/** 관리자 - 시스템 설정 탭 (변경은 admin만 가능, RLS로 보호) */
export function SystemSettingsTab() {
  const myProfile = useAuthStore((s) => s.profile)
  const { settings, load } = useSettingsStore()
  const showToast = useToastStore((s) => s.show)
  const [saving, setSaving] = useState(false)

  const readOnly = !isAdmin(myProfile)

  const save = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSaving(true)
    try {
      await updateAppSetting(key, value)
      await load()
      showToast('설정이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const rowClass = 'flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-4 last:border-b-0'
  const selectClass = 'h-11 rounded-lg border border-gray-300 px-2 text-sm disabled:bg-gray-100'

  return (
    <div className="flex flex-col gap-3">
      {readOnly && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          시스템 설정 변경은 관리자만 가능합니다. (조회만 가능)
        </p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className={rowClass}>
          <div>
            <p className="font-semibold">스코어 확정 방식</p>
            <p className="text-xs text-gray-400">양측 확정: 상대 팀 확인 필요 / 단일 확정: 제출 즉시 확정</p>
          </div>
          <select
            value={settings.confirm_mode}
            disabled={readOnly || saving}
            onChange={(e) => void save('confirm_mode', e.target.value as ConfirmMode)}
            className={selectClass}
          >
            <option value="double">양측 확정</option>
            <option value="single">단일 확정</option>
          </select>
        </div>

        <div className={rowClass}>
          <div>
            <p className="font-semibold">동점 허용</p>
            <p className="text-xs text-gray-400">허용 시 무승부로 기록되며 승/패 집계에서 제외</p>
          </div>
          <select
            value={settings.allow_tie ? 'true' : 'false'}
            disabled={readOnly || saving}
            onChange={(e) => void save('allow_tie', e.target.value === 'true')}
            className={selectClass}
          >
            <option value="false">허용 안 함</option>
            <option value="true">허용</option>
          </select>
        </div>

        <div className={rowClass}>
          <div>
            <p className="font-semibold">최대 입력 점수</p>
            <p className="text-xs text-gray-400">6게임제·타이브레이크·시간제 등 점수제에 맞게 조정</p>
          </div>
          <input
            type="number"
            min={1}
            max={999}
            defaultValue={settings.score_max}
            disabled={readOnly || saving}
            onBlur={(e) => {
              const value = Number(e.target.value)
              if (Number.isInteger(value) && value > 0 && value !== settings.score_max) {
                void save('score_max', value)
              }
            }}
            className="h-11 w-20 rounded-lg border border-gray-300 px-2 text-center text-sm disabled:bg-gray-100"
            aria-label="최대 입력 점수"
          />
        </div>

        <div className={rowClass}>
          <div>
            <p className="font-semibold">공식 순위 최소 경기 수</p>
            <p className="text-xs text-gray-400">미달 사용자는 순위 없이 별도 표시</p>
          </div>
          <input
            type="number"
            min={0}
            max={999}
            defaultValue={settings.min_matches_for_ranking}
            disabled={readOnly || saving}
            onBlur={(e) => {
              const value = Number(e.target.value)
              if (Number.isInteger(value) && value >= 0 && value !== settings.min_matches_for_ranking) {
                void save('min_matches_for_ranking', value)
              }
            }}
            className="h-11 w-20 rounded-lg border border-gray-300 px-2 text-center text-sm disabled:bg-gray-100"
            aria-label="공식 순위 최소 경기 수"
          />
        </div>

        <div className={rowClass}>
          <div>
            <p className="font-semibold">대리 등록 허용</p>
            <p className="text-xs text-gray-400">다른 회원을 빈 슬롯에 대신 등록할 수 있는지</p>
          </div>
          <select
            value={settings.allow_proxy_registration ? 'true' : 'false'}
            disabled={readOnly || saving}
            onChange={(e) => void save('allow_proxy_registration', e.target.value === 'true')}
            className={selectClass}
          >
            <option value="true">허용</option>
            <option value="false">허용 안 함</option>
          </select>
        </div>
      </div>
    </div>
  )
}
