import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { requestClubJoin } from '../../services/clubService'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import { toErrorMessage } from '../../utils/errors'
import { Spinner } from '../common/Spinner'

/** 클럽 밖(클럽 선택·로그인 등)에서 쓰는 기본 브라우저 탭 제목 */
const DEFAULT_DOCUMENT_TITLE = '창원테니스클럽'

/** URL 슬러그로 클럽 진입 · 멤버십 게이트 */
export function ClubGate() {
  const { clubSlug } = useParams<{ clubSlug: string }>()
  const profile = useAuthStore((s) => s.profile)
  const { club, membership, enterClubBySlug, loadMyClubs } = useClubStore()
  const loadSettings = useSettingsStore((s) => s.load)
  const showToast = useToastStore((s) => s.show)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  const isPlatformAdmin = Boolean(profile?.is_platform_admin)
  const canEnter =
    isPlatformAdmin || membership?.status === 'active'

  useEffect(() => {
    if (!clubSlug) return
    let stale = false
    setLoading(true)
    setError(null)

    void enterClubBySlug(clubSlug)
      .then(() => {
        if (stale) return
        const state = useClubStore.getState()
        const allowed =
          useAuthStore.getState().profile?.is_platform_admin ||
          state.membership?.status === 'active'
        if (allowed && state.club) {
          void loadSettings(state.club.id)
        } else {
          void loadSettings()
        }
      })
      .catch((err) => {
        if (!stale) setError(toErrorMessage(err))
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })

    return () => {
      stale = true
    }
  }, [clubSlug, enterClubBySlug, loadSettings])

  // 브라우저 탭 제목: 클럽 페이지에서는 클럽 이름, 벗어나면 기본 제목으로 복원
  useEffect(() => {
    const name = club?.name?.trim()
    document.title = name ? name : DEFAULT_DOCUMENT_TITLE
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE
    }
  }, [club?.name])

  const handleJoin = async () => {
    if (!club) return
    setJoining(true)
    try {
      await requestClubJoin(club.id)
      showToast('가입 신청이 완료되었습니다.', 'success')
      await loadMyClubs()
      if (clubSlug) await enterClubBySlug(clubSlug)
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (error || !club) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4">
        <p className="text-center text-gray-600">{error ?? '클럽을 찾을 수 없습니다.'}</p>
      </div>
    )
  }

  if (canEnter) {
    return <Outlet />
  }

  if (!membership || membership.status === 'rejected') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 px-4">
        <h1 className="text-xl font-extrabold text-green-800">{club.name}</h1>
        <p className="text-center text-gray-600">
          {membership?.status === 'rejected'
            ? '가입이 거절되었습니다. 다시 신청할 수 있습니다.'
            : '이 클럽의 멤버가 아닙니다. 가입을 신청해주세요.'}
        </p>
        <button
          type="button"
          disabled={joining}
          onClick={() => void handleJoin()}
          className="h-12 w-full rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
        >
          {joining ? '신청 중…' : '가입 신청'}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-extrabold text-green-800">{club.name}</h1>
      <p className="text-center text-gray-600">
        가입 승인 대기 중입니다. 클럽 관리자가 승인하면 이용할 수 있습니다.
      </p>
    </div>
  )
}
