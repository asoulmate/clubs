import { useEffect, useState } from 'react'

/** 값이 delay(ms) 동안 바뀌지 않을 때만 반영 (사용자 검색 등에 사용) */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
