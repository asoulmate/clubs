import { addDaysToDateString, formatDateKoreanFull, todayKst } from '../../utils/kst'

interface DateNavigatorProps {
  date: string
  onChange: (date: string) => void
}

/**
 * 날짜 이동 컨트롤: 이전 / 오늘 / 다음 / 달력 직접 선택
 * 모바일 터치 조작을 위해 버튼 높이 44px 이상 유지
 */
export function DateNavigator({ date, onChange }: DateNavigatorProps) {
  const today = todayKst()
  const isToday = date === today

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(addDaysToDateString(date, -1))}
          aria-label="이전 날짜"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-lg font-bold text-gray-700 active:bg-gray-100"
        >
          ‹
        </button>

        {/* 달력 직접 선택 (네이티브 date input — 모바일에서 시스템 달력 사용) */}
        <label className="relative flex h-11 flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white font-semibold">
          <span>{formatDateKoreanFull(date)}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            aria-label="날짜 선택"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <button
          type="button"
          onClick={() => onChange(addDaysToDateString(date, 1))}
          aria-label="다음 날짜"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-lg font-bold text-gray-700 active:bg-gray-100"
        >
          ›
        </button>

        {!isToday && (
          <button
            type="button"
            onClick={() => onChange(today)}
            className="h-11 shrink-0 rounded-xl bg-green-700 px-4 font-semibold text-white active:bg-green-800"
          >
            오늘
          </button>
        )}
      </div>
    </div>
  )
}
