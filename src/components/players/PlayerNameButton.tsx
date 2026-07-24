import { AWARD_LEVEL_ICONS } from '../../constants/labels'
import type { AwardLevel } from '../../types/domain'
import { usePlayerSummaryStore } from '../../stores/playerSummaryStore'

interface PlayerNameButtonProps {
  userId: string
  name: string
  /** 입상 구분 — 있으면 이름 오른쪽에 아이콘 표시 */
  awardLevel?: AwardLevel | null
  className?: string
}

/** 클릭하면 선수 요약 다이얼로그를 여는 이름 버튼 */
export function PlayerNameButton({
  userId,
  name,
  awardLevel,
  className = '',
}: PlayerNameButtonProps) {
  const open = usePlayerSummaryStore((s) => s.open)
  const icon = awardLevel ? AWARD_LEVEL_ICONS[awardLevel] : ''

  return (
    <button
      type="button"
      onClick={() => open(userId)}
      className={`inline-flex min-h-11 items-center justify-center gap-0.5 rounded-lg px-1 font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4 active:bg-gray-100 ${className}`}
    >
      <span>{name}</span>
      {icon ? (
        <span className="no-underline" aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </button>
  )
}
