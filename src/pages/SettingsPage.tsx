import { useState, type FormEvent } from 'react'
import { AWARD_LEVEL_OPTIONS, ROLE_LABELS } from '../constants/labels'
import { changePassword, signOut } from '../services/authService'
import { updateMyProfile } from '../services/profileService'
import { useAuthStore } from '../stores/authStore'
import { useClubStore } from '../stores/clubStore'
import { useToastStore } from '../stores/toastStore'
import type { AwardLevel } from '../types/domain'
import { toErrorMessage } from '../utils/errors'

const inputClass =
  'h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none'

/** 설정 페이지: 내 정보 수정 + 비밀번호 변경 + 로그아웃 */
export function SettingsPage() {
  const { session, profile, refreshProfile } = useAuthStore()
  const membership = useClubStore((s) => s.membership)
  const showToast = useToastStore((s) => s.show)
  const [name, setName] = useState(profile?.name ?? '')
  const [awardLevel, setAwardLevel] = useState<AwardLevel>(profile?.award_level ?? 'none')
  const [saving, setSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordCheck, setNewPasswordCheck] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const clubRoleLabel =
    membership?.status === 'active' ? ROLE_LABELS[membership.role] : profile ? ROLE_LABELS[profile.role] : '-'

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

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    const email = session?.user.email
    if (!email) {
      showToast('로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.', 'error')
      return
    }
    if (newPassword.length < 6) {
      showToast('새 비밀번호는 6자 이상 입력해주세요.', 'error')
      return
    }
    if (newPassword !== newPasswordCheck) {
      showToast('새 비밀번호가 서로 일치하지 않습니다.', 'error')
      return
    }
    if (currentPassword === newPassword) {
      showToast('기존과 다른 새 비밀번호를 입력해주세요.', 'error')
      return
    }

    setChangingPassword(true)
    try {
      await changePassword(email, currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordCheck('')
      showToast('비밀번호가 변경되었습니다.', 'success')
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-extrabold">설정</h1>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">내 정보</h2>
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="text-sm text-gray-500">
            <p>이메일: {session?.user.email}</p>
            <p>클럽 권한: {clubRoleLabel}</p>
            {profile?.is_platform_admin && (
              <p className="mt-1 text-amber-700">플랫폼 슈퍼관리자 (클럽 생성 등)</p>
            )}
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

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">비밀번호 변경</h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">현재 비밀번호</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">새 비밀번호 (6자 이상)</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">새 비밀번호 확인</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={newPasswordCheck}
              onChange={(e) => setNewPasswordCheck(e.target.value)}
              className={inputClass}
            />
          </label>

          <button
            type="submit"
            disabled={changingPassword}
            className="h-12 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
          >
            {changingPassword ? '변경 중...' : '비밀번호 변경'}
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
