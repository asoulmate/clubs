import { useEffect, useState } from 'react'

/** 미디어 쿼리 매칭 여부 (PC/모바일 분기용) */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    setMatches(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** PC 화면 여부 (768px 이상) */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
