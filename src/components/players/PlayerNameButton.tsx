import { AWARD_LEVEL_ICONS } from '../../constants/labels'
import type { AwardLevel } from '../../types/domain'
import { usePlayerSummaryStore } from '../../stores/playerSummaryStore'

interface PlayerNameButtonProps {
  userId: string
  name: string
  /** 입상 구분 — 있으면 이름 오른쪽에 아이콘 표시 */
  awardLevel?: AwardLevel | null
  /** 소속 — 있으면 이름 아래 작은 글씨로 표시 (게스트 등) */
  affiliation?: string | null
  className?: string
}

/** 클릭하면 선수 요약 다이얼로그를 여는 이름 버튼 */
export function PlayerNameButton({
  userId,
  name,
  awardLevel,
  affiliation,
  className = '',
}: PlayerNameButtonProps) {
  const open = usePlayerSummaryStore((s) => s.open)
  const icon = awardLevel ? AWARD_LEVEL_ICONS[awardLevel] : ''
  const aff = affiliation?.trim() || ''

  return (
    <button
      type="button"
      onClick={() => open(userId)}
      className={`inline-flex min-h-11 flex-col justify-center gap-0 rounded-lg px-1 font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4 active:bg-gray-100 ${className}`}
    >
      <span className="inline-flex items-center gap-0.5">
        <span>{name}</span>
        {icon ? (
          <span className="no-underline" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </span>
      {aff ? (
        <span className="max-w-full truncate text-[10px] font-medium leading-tight text-gray-400 no-underline">
          {aff}
        </span>
      ) : null}
    </button>
  )
}
