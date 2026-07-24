/** 데이터가 없을 때 표시하는 안내 문구 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-gray-500">
      <span className="text-3xl" aria-hidden="true">
        🎾
      </span>
      <p className="text-base">{message}</p>
    </div>
  )
}
