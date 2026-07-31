import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  platformCreateClub,
  platformDeleteClub,
  platformListClubs,
  platformUpdateClub,
} from '../services/clubService'
import { useAuthStore } from '../stores/authStore'
import { useToastStore } from '../stores/toastStore'
import type { Club } from '../types/domain'
import { toErrorMessage } from '../utils/errors'
import { Spinner } from '../components/common/Spinner'

/** 플랫폼 슈퍼관리자: 클럽 생성·기능 토글 */
export function PlatformAdminPage() {
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [clubs, setClubs] = useState<Club[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingClubId, setDeletingClubId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setClubs(await platformListClubs())
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  if (!profile?.is_platform_admin) {
    return <Navigate to="/" replace />
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) {
      showToast('이름과 슬러그를 입력해주세요.', 'error')
      return
    }
    setSaving(true)
    try {
      await platformCreateClub({ name: name.trim(), slug: slug.trim().toLowerCase() })
      showToast('클럽이 생성되었습니다.', 'success')
      setName('')
      setSlug('')
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleFlag = async (
    club: Club,
    key: 'youtube_enabled' | 'absence_enabled' | 'fine_enabled',
    value: boolean,
  ) => {
    try {
      await platformUpdateClub(club.id, { [key]: value })
      showToast('설정이 저장되었습니다.', 'success')
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  const handleDelete = async (club: Club) => {
    const confirmed = window.confirm(
      `「${club.name}」 클럽을 삭제할까요?\n\n회원 소속, 경기, 배팅, 대회 참가 기록 등 클럽의 모든 데이터가 영구 삭제되며 복구할 수 없습니다.`,
    )
    if (!confirmed) return

    setDeletingClubId(club.id)
    try {
      await platformDeleteClub(club.id)
      showToast('클럽을 삭제했습니다.', 'success')
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setDeletingClubId(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-green-800">플랫폼 관리</h1>
        <Link to="/" className="text-sm font-semibold text-green-700 underline">
          클럽 선택
        </Link>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold">클럽 생성</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="클럽 이름"
          className="h-12 rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
        />
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="슬러그 (예: morning-star)"
          className="h-12 rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="h-12 rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
        >
          {saving ? '생성 중…' : '생성'}
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {clubs.map((club) => (
            <li key={club.id} className="border-b border-gray-50 px-4 py-4 last:border-b-0">
              <div className="mb-2">
                <p className="font-bold">{club.name}</p>
                <p className="text-xs text-gray-400">
                  #{club.slug} ·{' '}
                  <Link to={`/c/${club.slug}`} className="text-green-700 underline">
                    바로가기
                  </Link>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={club.youtube_enabled}
                    disabled={deletingClubId === club.id}
                    onChange={(e) => void toggleFlag(club, 'youtube_enabled', e.target.checked)}
                  />
                  유튜브
                </label>
                <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={club.absence_enabled}
                    disabled={deletingClubId === club.id}
                    onChange={(e) => void toggleFlag(club, 'absence_enabled', e.target.checked)}
                  />
                  무단결석
                </label>
                <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={club.fine_enabled}
                    disabled={deletingClubId === club.id}
                    onChange={(e) => void toggleFlag(club, 'fine_enabled', e.target.checked)}
                  />
                  벌금
                </label>
                <button
                  type="button"
                  disabled={deletingClubId !== null}
                  onClick={() => void handleDelete(club)}
                  className="ml-auto rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 active:bg-red-50 disabled:opacity-50"
                >
                  {deletingClubId === club.id ? '삭제 중…' : '클럽 삭제'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
