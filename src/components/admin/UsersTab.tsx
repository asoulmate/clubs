import { useCallback, useEffect, useState } from 'react'
import { AWARD_LEVEL_LABELS, ROLE_LABELS } from '../../constants/labels'
import { useDebounce } from '../../hooks/useDebounce'
import { adminUpdateUser, fetchAllUsers } from '../../services/adminService'
import { useAuthStore } from '../../stores/authStore'
import { useToastStore } from '../../stores/toastStore'
import type { Profile, UserRole } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdmin } from '../../utils/permissions'
import { Spinner } from '../common/Spinner'

/** 관리자 - 사용자 관리 탭 */
export function UsersTab() {
  const myProfile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const debouncedSearch = useDebounce(search, 300)

  const canChangeRole = isAdmin(myProfile)

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
          ? `${user.name} 님을 활성화할까요?`
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

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="이름으로 검색 (비활성 포함)"
        className="h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
      />

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
                  {!user.is_active && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                      비활성
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">{AWARD_LEVEL_LABELS[user.award_level]}</p>
              </div>

              <div className="flex items-center gap-2">
                {/* 역할 변경은 admin만 가능 (자기 자신 제외) — 최종 검증은 DB가 수행 */}
                <select
                  value={user.role}
                  disabled={!canChangeRole || user.id === myProfile?.id}
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
                  {user.is_active ? '비활성화' : '활성화'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
