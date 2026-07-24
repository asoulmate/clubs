/** 로딩 스피너 */
export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <div
      role="status"
      aria-label="불러오는 중"
      className={`${small ? 'h-5 w-5 border-2' : 'h-8 w-8 border-4'} animate-spin rounded-full border-green-700 border-t-transparent`}
    />
  )
}
