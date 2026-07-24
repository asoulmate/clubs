import { useEffect, useState } from 'react'
import { AWARD_LEVEL_LABELS } from '../../constants/labels'
import { useDebounce } from '../../hooks/useDebounce'
import { searchActiveProfiles } from '../../services/profileService'
import type { Profile } from '../../types/domain'

interface PlayerSearchInputProps {
  /** 검색 결과에서 제외할 사용자 id (이미 편성된 참가자 등) */
  excludeIds?: string[]
  onSelect: (profile: Profile) => void
  placeholder?: string
  autoFocus?: boolean
}

/**
 * 회원 이름 부분 검색 자동완성
 *  - debounce 적용으로 불필요한 조회 방지
 *  - 비활성 사용자는 서비스 계층에서 제외
 *  - 동명이인 구분을 위해 입상 구분을 함께 표시
 */
export function PlayerSearchInput({
  excludeIds = [],
  onSelect,
  placeholder = '이름으로 검색',
  autoFocus = false,
}: PlayerSearchInputProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)
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
            {query.trim() ? '검색 결과가 없습니다. 회원가입된 사용자만 선택할 수 있습니다.' : '이름을 입력해 검색하세요.'}
          </p>
        ) : (
          visible.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => onSelect(profile)}
              className="flex min-h-11 w-full items-center justify-between border-b border-gray-50 px-4 py-2 text-left last:border-b-0 active:bg-green-50"
            >
              <span className="font-semibold">{profile.name}</span>
              {/* 동명이인 구분용 입상 구분 표시 */}
              <span className="text-sm text-gray-500">{AWARD_LEVEL_LABELS[profile.award_level]}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
