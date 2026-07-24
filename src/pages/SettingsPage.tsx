import { useState, type FormEvent } from 'react'
import { AWARD_LEVEL_OPTIONS, ROLE_LABELS } from '../constants/labels'
import { signOut } from '../services/authService'
import { updateMyProfile } from '../services/profileService'
import { useAuthStore } from '../stores/authStore'
import { useToastStore } from '../stores/toastStore'
import type { AwardLevel } from '../types/domain'
import { toErrorMessage } from '../utils/errors'

/** 설정 페이지: 내 정보 수정 + 로그아웃 */
export function SettingsPage() {
  const { session, profile, refreshProfile } = useAuthStore()
  const showToast = useToastStore((s) => s.show)
  const [name, setName] = useState(profile?.name ?? '')
  const [awardLevel, setAwardLevel] = useState<AwardLevel>(profile?.award_level ?? 'none')
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile) return
    if (name.trim().length < 1) {
      showToast('이름을 입력해주세요.', 'error')
      return
    }

    setSaving(true)
    try {
      await updateMyProfile(profile.id, { name: name.trim(), award_level: awardLevel })
      await refreshProfile()
      showToast('내 정보가 저장되었습니다.', 'success')
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none'

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-extrabold">설정</h1>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">내 정보</h2>
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="text-sm text-gray-500">
            <p>이메일: {session?.user.email}</p>
            <p>권한: {profile ? ROLE_LABELS[profile.role] : '-'}</p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">이름</span>
            <input
              type="text"
              required
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">입상 구분</span>
            <select
              value={awardLevel}
              onChange={(e) => setAwardLevel(e.target.value as AwardLevel)}
              className={inputClass}
            >
              {AWARD_LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </form>
      </section>

      <button
        type="button"
        onClick={() => void signOut()}
        className="h-12 rounded-xl border-2 border-gray-300 font-bold text-gray-600 active:bg-gray-100"
      >
        로그아웃
      </button>
    </div>
  )
}
