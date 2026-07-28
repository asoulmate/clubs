import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getClubBySlug, requestClubJoin } from '../services/clubService'
import { useAuthStore } from '../stores/authStore'
import { useClubStore } from '../stores/clubStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import { toErrorMessage } from '../utils/errors'
import { Spinner } from '../components/common/Spinner'

const STATUS_LABELS = {
  active: '이용 중',
  pending: '승인 대기',
  rejected: '거절됨',
} as const

/** 내 클럽 목록 / 가입 신청 */
export function ClubSelectPage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { myClubs, loaded, loadMyClubs, clearClub } = useClubStore()
  const clearSettings = useSettingsStore((s) => s.load)
  const showToast = useToastStore((s) => s.show)
  const [slugInput, setSlugInput] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    clearClub()
    void clearSettings()
    void loadMyClubs()
  }, [clearClub, clearSettings, loadMyClubs])

  const handleJoin = async () => {
    const slug = slugInput.trim().toLowerCase()
    if (!slug) {
      showToast('클럽 슬러그를 입력해주세요.', 'error')
      return
    }
    setJoining(true)
    try {
      const club = await getClubBySlug(slug)
      await requestClubJoin(club.id)
      showToast('가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.', 'success')
      setSlugInput('')
      await loadMyClubs()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setJoining(false)
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
      <div>
        <h1 className="text-2xl font-extrabold text-green-800">클럽 선택</h1>
        <p className="mt-1 text-sm text-gray-500">
          {profile?.name} 님, 이용할 클럽을 선택하세요.
        </p>
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
        <p className="mb-3 text-xs text-gray-500">클럽 슬러그를 알고 있으면 가입을 신청할 수 있습니다.</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder="예: morning-star"
            className="h-12 flex-1 rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
          />
          <button
            type="button"
            disabled={joining}
            onClick={() => void handleJoin()}
            className="h-12 shrink-0 rounded-xl bg-green-700 px-4 font-bold text-white disabled:opacity-50"
          >
            {joining ? '신청 중…' : '신청'}
          </button>
        </div>
      </section>
    </div>
  )
}
