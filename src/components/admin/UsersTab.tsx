import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AWARD_LEVEL_LABELS, AWARD_LEVEL_OPTIONS, ROLE_LABELS } from '../../constants/labels'
import { useDebounce } from '../../hooks/useDebounce'
import {
  adminRemoveUser,
  adminResetUserPassword,
  adminUpdateUser,
  fetchAllUsers,
} from '../../services/adminService'
import { useAuthStore } from '../../stores/authStore'
import { useToastStore } from '../../stores/toastStore'
import type { AwardLevel, Profile, UserRole } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdmin, isAdminOrSub } from '../../utils/permissions'
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'

/** 메인 관리자: 이름·입상 수정 + 비밀번호 초기화 */
function AdminEditUserDialog({
  user,
  onClose,
  onChanged,
}: {
  user: Profile
  onClose: () => void
  onChanged: () => void
}) {
  const showToast = useToastStore((s) => s.show)
  const [name, setName] = useState(user.name)
  const [awardLevel, setAwardLevel] = useState<AwardLevel>(user.award_level)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (name.trim().length < 1) {
      setError('이름을 입력해주세요.')
      return
    }
    setSaving(true)
    try {
      await adminUpdateUser(user.id, {
        name: name.trim(),
        award_level: awardLevel,
      })
      showToast('회원 정보가 저장되었습니다.', 'success')
      onChanged()
      onClose()
    } catch (err) {
      setError(toErrorMessage(err))
      setSaving(false)
    }
  }

  const handleResetPassword = async () => {
    if (
      !window.confirm(
        `${user.name} 님의 비밀번호를 123456 으로 초기화할까요?\n기존 로그인 세션은 종료됩니다.`,
      )
    ) {
      return
    }
    setError(null)
    setResetting(true)
    try {
      await adminResetUserPassword(user.id)
      showToast('비밀번호가 123456 으로 초기화되었습니다.', 'success')
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setResetting(false)
    }
  }

  const inputClass =
    'h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none'

  return (
    <Dialog open onClose={onClose} title="회원 정보 수정">
      <form onSubmit={handleSave} className="flex flex-col gap-4">
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving || resetting}
          className="h-12 rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>

        {!user.is_guest && (
          <button
            type="button"
            disabled={saving || resetting}
            onClick={() => void handleResetPassword()}
            className="h-12 rounded-xl border-2 border-amber-500 font-bold text-amber-700 active:bg-amber-50 disabled:opacity-50"
          >
            {resetting ? '초기화 중...' : '비밀번호 초기화 (123456)'}
          </button>
        )}
      </form>
    </Dialog>
  )
}

/** 관리자 - 사용자 관리 탭 */
export function UsersTab() {
  const myProfile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)
  const debouncedSearch = useDebounce(search, 300)

  const canChangeRole = isAdmin(myProfile)
  const canEditProfile = isAdmin(myProfile)
  const canRemoveUser = isAdminOrSub(myProfile)

  const load = useCallback(async () => {
    try {
      setUsers(await fetchAllUsers(debouncedSearch))
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const changeRole = async (user: Profile, role: UserRole) => {
    if (!window.confirm(`${user.name} 님의 권한을 '${ROLE_LABELS[role]}'(으)로 변경할까요?`)) return
    try {
      await adminUpdateUser(user.id, { role })
      showToast('권한이 변경되었습니다.', 'success')
      void load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  const toggleActive = async (user: Profile) => {
    const next = !user.is_active
    if (
      !window.confirm(
        next
          ? user.is_guest
            ? `${user.name} 님(게스트)을 활성화할까요?`
            : `${user.name} 님을 승인/활성화할까요?`
          : `${user.name} 님을 비활성화할까요? 비활성 사용자는 로그인 및 경기 등록이 제한됩니다.`,
      )
    )
      return
    try {
      await adminUpdateUser(user.id, { is_active: next })
      showToast(next ? '활성화되었습니다.' : '비활성화되었습니다.', 'success')
      void load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  const canShowRemove = (user: Profile) => {
    if (!canRemoveUser || !myProfile) return false
    if (user.id === myProfile.id) return false
    if (user.is_guest) return true
    if (user.role === 'admin') return false
    if (user.role === 'sub_admin') return isAdmin(myProfile)
    return true
  }

  const removeUser = async (user: Profile) => {
    const message = user.is_guest
      ? `${user.name} 님(게스트)을 삭제할까요?\n· 진행 중/미확정 경기 편성에서는 제외됩니다.\n· 확정된 경기 기록이 있으면 삭제 대신 비활성화됩니다.`
      : `${user.name} 님을 탈퇴 처리할까요?\n· 로그인 계정이 삭제되며 재가입이 필요합니다.\n· 진행 중/미확정 경기 편성에서는 제외됩니다.\n· 확정된 경기 기록은 통계용으로 남습니다.`
    if (!window.confirm(message)) return
    try {
      const result = await adminRemoveUser(user.id)
      if (result === 'guest_deleted') {
        showToast('게스트가 삭제되었습니다.', 'success')
      } else if (result === 'guest_deactivated') {
        showToast('확정 기록이 있어 게스트를 비활성화했습니다.', 'success')
      } else if (result === 'member_withdrawn') {
        showToast('회원 탈퇴가 처리되었습니다.', 'success')
      } else {
        showToast('계정이 비활성화되었습니다.', 'success')
      }
      void load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="이름으로 검색 (비활성 포함)"
        className="h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
      />

      {canEditProfile && (
        <p className="text-xs text-gray-500">
          메인 관리자는 회원 편집에서 이름·입상 변경 및 비밀번호 초기화(123456)가 가능합니다.
        </p>
      )}
      {canRemoveUser && (
        <p className="text-xs text-gray-500">
          관리자/서브관리자는 게스트 삭제·회원 탈퇴를 할 수 있습니다. 확정 경기 기록은 보존됩니다.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : users.length === 0 ? (
        <p className="py-10 text-center text-gray-500">검색 결과가 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {users.map((user) => (
            <div
              key={user.id}
              className={`flex flex-wrap items-center justify-between gap-2 border-b border-gray-50 px-4 py-3 last:border-b-0 ${
                !user.is_active ? 'bg-gray-50 opacity-70' : ''
              }`}
            >
              <div>
                <p className="font-semibold">
                  {user.name}
                  {user.is_guest && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      게스트
                    </span>
                  )}
                  {!user.is_active && !user.is_guest && (
                    <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                      승인 대기/비활성
                    </span>
                  )}
                  {!user.is_active && user.is_guest && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                      비활성
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  {AWARD_LEVEL_LABELS[user.award_level]}
                  {user.is_guest ? ' · 로그인 계정 없음' : ''}
                  {user.is_guest && user.affiliation ? ` · ${user.affiliation}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canEditProfile && (
                  <button
                    type="button"
                    onClick={() => setEditing(user)}
                    className="h-10 rounded-lg bg-gray-100 px-3 text-sm font-bold text-gray-700 active:bg-gray-200"
                  >
                    편집
                  </button>
                )}

                {/* 역할 변경은 admin만 가능 (자기 자신·게스트 제외) — 최종 검증은 DB가 수행 */}
                <select
                  value={user.role}
                  disabled={!canChangeRole || user.id === myProfile?.id || user.is_guest}
                  onChange={(e) => void changeRole(user, e.target.value as UserRole)}
                  aria-label={`${user.name} 권한`}
                  className="h-10 rounded-lg border border-gray-300 px-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={user.id === myProfile?.id}
                  onClick={() => void toggleActive(user)}
                  className={`h-10 rounded-lg px-3 text-sm font-bold disabled:opacity-40 ${
                    user.is_active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {user.is_active ? '비활성화' : user.is_guest ? '활성화' : '승인/활성화'}
                </button>

                {canShowRemove(user) && (
                  <button
                    type="button"
                    onClick={() => void removeUser(user)}
                    className="h-10 rounded-lg bg-red-600 px-3 text-sm font-bold text-white active:bg-red-700"
                  >
                    {user.is_guest ? '삭제' : '탈퇴'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AdminEditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}
