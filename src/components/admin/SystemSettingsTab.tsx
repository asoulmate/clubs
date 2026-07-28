import { useState } from 'react'
import { updateClubSetting } from '../../services/clubSettingsService'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { AppSettings, ConfirmMode, MatchType } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdmin } from '../../utils/permissions'

/** 관리자 - 시스템 설정 탭 (클럽 설정) */
export function SystemSettingsTab() {
  const myProfile = useAuthStore((s) => s.profile)
  const clubId = useClubStore((s) => s.club?.id)
  const { settings, load } = useSettingsStore()
  const showToast = useToastStore((s) => s.show)
  const [saving, setSaving] = useState(false)

  const readOnly = !isAdmin(myProfile)

  const save = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!clubId) {
      showToast('클럽 정보가 없습니다.', 'error')
      return
    }
    setSaving(true)
    try {
      await updateClubSetting(clubId, key, value)
      await load(clubId)
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

        <div className={rowClass}>
          <div>
            <p className="font-semibold">신규 가입 승인</p>
            <p className="text-xs text-gray-400">
              활성화 시 신규 회원은 승인 대기(비활성) 상태이며, 관리자/서브관리자가 사용자 탭에서
              활성화해야 이용 가능
            </p>
          </div>
          <select
            value={settings.require_signup_approval ? 'true' : 'false'}
            disabled={readOnly || saving}
            onChange={(e) => void save('require_signup_approval', e.target.value === 'true')}
            className={selectClass}
          >
            <option value="false">비활성화 (즉시 이용)</option>
            <option value="true">활성화 (승인 필요)</option>
          </select>
        </div>

        <div className={rowClass}>
          <div>
            <p className="font-semibold">경기 만들기 기본 유형</p>
            <p className="text-xs text-gray-400">
              신규 경기 만들기 화면에서 기본으로 선택되는 유형 (만들 때 변경 가능)
            </p>
          </div>
          <select
            value={settings.default_match_type}
            disabled={readOnly || saving}
            onChange={(e) => void save('default_match_type', e.target.value as MatchType)}
            className={selectClass}
          >
            <option value="doubles">복식 (2:2)</option>
            <option value="singles">단식 (1:1)</option>
          </select>
        </div>

        <div className={rowClass}>
          <div>
            <p className="font-semibold">유튜브 채널 핸들</p>
            <p className="text-xs text-gray-400">
              @ 없이 입력 (예: 멍기멍기-k4q). 수동 매칭 버튼·후보 조회에 사용
            </p>
          </div>
          <input
            type="text"
            defaultValue={settings.youtube_channel_handle}
            disabled={readOnly || saving}
            onBlur={(e) => {
              const value = e.target.value.replace(/^@/, '').trim()
              if (value && value !== settings.youtube_channel_handle) {
                void save('youtube_channel_handle', value)
              }
            }}
            className="h-11 w-44 rounded-lg border border-gray-300 px-2 text-sm disabled:bg-gray-100"
            aria-label="유튜브 채널 핸들"
            placeholder="멍기멍기-k4q"
          />
        </div>
      </div>
    </div>
  )
}
