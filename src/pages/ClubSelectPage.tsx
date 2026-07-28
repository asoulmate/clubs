import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listClubsForSignup, requestClubJoin } from '../services/clubService'
import { signOut } from '../services/authService'
import { useAuthStore } from '../stores/authStore'
import { useClubStore } from '../stores/clubStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import type { Club } from '../types/domain'
import { toErrorMessage } from '../utils/errors'
import { Spinner } from '../components/common/Spinner'

const STATUS_LABELS = {
  active: '이용 중',
  pending: '승인 대기',
  rejected: '거절됨',
} as const

type ClubOption = Pick<Club, 'id' | 'name' | 'slug'>

/** 내 클럽 목록 / 가입 신청 */
export function ClubSelectPage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { myClubs, loaded, loadMyClubs, clearClub } = useClubStore()
  const clearSettings = useSettingsStore((s) => s.load)
  const showToast = useToastStore((s) => s.show)

  const [allClubs, setAllClubs] = useState<ClubOption[]>([])
  const [clubsLoading, setClubsLoading] = useState(true)
  const [selectedClubId, setSelectedClubId] = useState('')
  const [joining, setJoining] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    clearClub()
    void clearSettings()
    void loadMyClubs()
  }, [clearClub, clearSettings, loadMyClubs])

  useEffect(() => {
    let stale = false
    setClubsLoading(true)
    void listClubsForSignup()
      .then((list) => {
        if (!stale) setAllClubs(list)
      })
      .catch((err) => {
        if (!stale) showToast(toErrorMessage(err), 'error')
      })
      .finally(() => {
        if (!stale) setClubsLoading(false)
      })
    return () => {
      stale = true
    }
  }, [showToast])

  /** 이미 이용 중·승인 대기인 클럽 제외 (거절된 클럽은 재신청 가능) */
  const joinableClubs = useMemo(() => {
    const blocked = new Set(
      myClubs.filter((c) => c.status === 'active' || c.status === 'pending').map((c) => c.club_id),
    )
    return allClubs.filter((c) => !blocked.has(c.id))
  }, [allClubs, myClubs])

  useEffect(() => {
    if (joinableClubs.length === 0) {
      setSelectedClubId('')
      return
    }
    setSelectedClubId((prev) =>
      joinableClubs.some((c) => c.id === prev) ? prev : joinableClubs[0].id,
    )
  }, [joinableClubs])

  const handleJoin = async () => {
    if (!selectedClubId) {
      showToast('가입할 클럽을 선택해주세요.', 'error')
      return
    }
    setJoining(true)
    try {
      await requestClubJoin(selectedClubId)
      showToast('가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.', 'success')
      await loadMyClubs()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setJoining(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await signOut()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
      setLoggingOut(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-green-800">클럽 선택</h1>
          <p className="mt-1 text-sm text-gray-500">
            {profile?.name} 님, 이용할 클럽을 선택하세요.
          </p>
        </div>
        <button
          type="button"
          disabled={loggingOut}
          onClick={() => void handleLogout()}
          className="h-10 shrink-0 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700 active:bg-gray-50 disabled:opacity-50"
        >
          {loggingOut ? '…' : '로그아웃'}
        </button>
      </div>

      {profile?.is_platform_admin && (
        <Link
          to="/platform"
          className="flex h-12 items-center justify-center rounded-xl border-2 border-green-700 font-bold text-green-800 active:bg-green-50"
        >
          플랫폼 관리
        </Link>
      )}

      {myClubs.length === 0 ? (
        <p className="rounded-2xl bg-white py-10 text-center text-gray-500 shadow-sm">
          소속된 클럽이 없습니다. 아래에서 가입을 신청하세요.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {myClubs.map((c) => (
            <li key={c.club_id} className="border-b border-gray-50 last:border-b-0">
              {c.status === 'active' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/c/${c.slug}`)}
                  className="flex w-full items-center justify-between px-4 py-4 text-left active:bg-green-50"
                >
                  <div>
                    <p className="font-bold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">#{c.slug}</p>
                  </div>
                  <span className="text-sm font-semibold text-green-700">
                    {STATUS_LABELS[c.status]} →
                  </span>
                </button>
              ) : (
                <div className="flex items-center justify-between px-4 py-4">
                  <div>
                    <p className="font-bold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">#{c.slug}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      c.status === 'pending'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-base font-bold">클럽 가입 신청</h2>
        <p className="mb-3 text-xs text-gray-500">가입할 클럽을 선택한 뒤 신청하세요.</p>
        {clubsLoading ? (
          <p className="py-2 text-sm text-gray-500">클럽 목록 불러오는 중…</p>
        ) : joinableClubs.length === 0 ? (
          <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500">
            신청 가능한 클럽이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedClubId}
              onChange={(e) => setSelectedClubId(e.target.value)}
              className="h-12 w-full flex-1 rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
            >
              {joinableClubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={joining || !selectedClubId}
              onClick={() => void handleJoin()}
              className="h-12 shrink-0 rounded-xl bg-green-700 px-5 font-bold text-white disabled:opacity-50"
            >
              {joining ? '신청 중…' : '신청'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
