import { useEffect, useState } from 'react'
import { AWARD_LEVEL_LABELS, AWARD_LEVEL_OPTIONS } from '../../constants/labels'
import { useDebounce } from '../../hooks/useDebounce'
import { createGuestProfile, searchActiveProfiles } from '../../services/profileService'
import type { AwardLevel, Profile } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'

interface PlayerSearchInputProps {
  /** 검색 결과에서 제외할 사용자 id (이미 편성된 참가자 등) */
  excludeIds?: string[]
  onSelect: (profile: Profile) => void
  placeholder?: string
  autoFocus?: boolean
  /** 검색 결과 없을 때 게스트 수기 등록 UI 표시 (기본 true) */
  allowGuestCreate?: boolean
}

/**
 * 회원 이름 부분 검색 자동완성
 *  - debounce 적용으로 불필요한 조회 방지
 *  - 비활성 사용자는 서비스 계층에서 제외
 *  - 동명이인 구분을 위해 입상 구분을 함께 표시
 *  - 미가입 선수는 이름·입상·소속으로 게스트 등록 가능
 */
export function PlayerSearchInput({
  excludeIds = [],
  onSelect,
  placeholder = '이름으로 검색',
  autoFocus = false,
  allowGuestCreate = true,
}: PlayerSearchInputProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestAward, setGuestAward] = useState<AwardLevel>('none')
  const [guestAffiliation, setGuestAffiliation] = useState('')
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)
  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    let stale = false
    setSearching(true)

    void searchActiveProfiles(debouncedQuery)
      .then((profiles) => {
        if (!stale) setResults(profiles)
      })
      .catch(() => {
        if (!stale) setResults([])
      })
      .finally(() => {
        if (!stale) setSearching(false)
      })

    return () => {
      stale = true
    }
  }, [debouncedQuery])

  const visible = results.filter((p) => !excludeIds.includes(p.id))

  const openGuestForm = () => {
    setGuestName(query.trim())
    setGuestAward('none')
    setGuestAffiliation('')
    setGuestError(null)
    setGuestOpen(true)
  }

  const handleCreateGuest = async () => {
    setGuestError(null)
    if (guestName.trim().length < 1) {
      setGuestError('이름을 입력해주세요.')
      return
    }
    if (guestAffiliation.trim().length < 1) {
      setGuestError('소속을 입력해주세요.')
      return
    }
    setGuestSaving(true)
    try {
      const guest = await createGuestProfile(guestName.trim(), guestAward, guestAffiliation.trim())
      onSelect(guest)
      setGuestOpen(false)
      setQuery('')
    } catch (err) {
      setGuestError(toErrorMessage(err))
    } finally {
      setGuestSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:border-green-600 focus:outline-none"
      />

      <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100">
        {searching && visible.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">검색 중...</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-400">
            {query.trim()
              ? '검색 결과가 없습니다. 아래에서 게스트로 수기 등록할 수 있습니다.'
              : '이름을 입력해 검색하세요.'}
          </p>
        ) : (
          visible.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => onSelect(profile)}
              className="flex min-h-11 w-full items-center justify-between border-b border-gray-50 px-4 py-2 text-left last:border-b-0 active:bg-green-50"
            >
              <span className="min-w-0">
                <span className="font-semibold">
                  {profile.name}
                  {profile.is_guest && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      게스트
                    </span>
                  )}
                </span>
                {profile.affiliation ? (
                  <span className="mt-0.5 block truncate text-xs text-gray-400">
                    {profile.affiliation}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm text-gray-500">
                {AWARD_LEVEL_LABELS[profile.award_level]}
              </span>
            </button>
          ))
        )}
      </div>

      {allowGuestCreate && (
        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-3">
          {!guestOpen ? (
            <button
              type="button"
              onClick={openGuestForm}
              className="w-full text-left text-sm font-semibold text-amber-800 active:opacity-70"
            >
              + 미가입 선수 게스트로 등록 (이름·소속·입상 수기 입력)
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-amber-800">
                비밀번호 없이 선수 목록에만 저장됩니다. 이후 같은 이름으로 회원가입하면 기록이
                연동됩니다.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">이름</span>
                <input
                  type="text"
                  maxLength={30}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="h-11 rounded-lg border border-gray-300 px-3 text-base focus:border-green-600 focus:outline-none"
                  placeholder="실명 입력"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">소속</span>
                <input
                  type="text"
                  maxLength={40}
                  value={guestAffiliation}
                  onChange={(e) => setGuestAffiliation(e.target.value)}
                  className="h-11 rounded-lg border border-gray-300 px-3 text-base focus:border-green-600 focus:outline-none"
                  placeholder="예: ○○테니스클럽"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">입상 구분</span>
                <select
                  value={guestAward}
                  onChange={(e) => setGuestAward(e.target.value as AwardLevel)}
                  className="h-11 rounded-lg border border-gray-300 px-3 text-base focus:border-green-600 focus:outline-none"
                >
                  {AWARD_LEVEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {guestError && <p className="text-sm text-red-600">{guestError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={guestSaving}
                  onClick={() => setGuestOpen(false)}
                  className="h-11 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={guestSaving}
                  onClick={() => void handleCreateGuest()}
                  className="h-11 flex-1 rounded-lg bg-amber-600 text-sm font-bold text-white disabled:opacity-50"
                >
                  {guestSaving ? '등록 중...' : '게스트 등록'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
