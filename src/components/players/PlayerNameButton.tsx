import { usePlayerSummaryStore } from '../../stores/playerSummaryStore'

interface PlayerNameButtonProps {
  userId: string
  name: string
  className?: string
}

/** 클릭하면 선수 요약 다이얼로그를 여는 이름 버튼 */
export function PlayerNameButton({ userId, name, className = '' }: PlayerNameButtonProps) {
  const open = usePlayerSummaryStore((s) => s.open)

  return (
    <button
      type="button"
      onClick={() => open(userId)}
      className={`min-h-11 rounded-lg px-1 text-left font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4 active:bg-gray-100 ${className}`}
    >
      {name}
    </button>
  )
}
