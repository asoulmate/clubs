import { useEffect, useState } from 'react'

/** 남은 시간(ms) → "1:23:45" 또는 "23:45" */
function formatRemainingCompact(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${m}:${ss}`
}

/** 남은 시간(ms) → "1시간 23분 45초" 형태 */
function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}시간 ${m}분 ${s}초`
  if (m > 0) return `${m}분 ${s}초`
  return `${s}초`
}

/** timestamptz → "14:30" (한국 시간) */
function formatDeadlineTime(deadline: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(deadline)
}

interface BettingCountdownProps {
  /** 배팅 마감 시각 (ISO) */
  deadline: string
  /** 확정·취소 등으로 배팅이 이미 끝난 경기면 true */
  settled?: boolean
  /** 카드용 짧은 표기 (한 줄 공간 절약) */
  compact?: boolean
}

/**
 * 배팅 마감 카운트다운 배지.
 * 마감 전에는 1초 단위로 남은 시간을 표시하고, 지나면 "배팅 마감"으로 바뀐다.
 */
export function BettingCountdown({
  deadline,
  settled = false,
  compact = false,
}: BettingCountdownProps) {
  const deadlineDate = new Date(deadline)
  const deadlineMs = deadlineDate.getTime()
  const [now, setNow] = useState(() => Date.now())

  const invalid = Number.isNaN(deadlineMs)
  const remaining = deadlineMs - now
  const closed = invalid || settled || remaining <= 0

  useEffect(() => {
    if (closed) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [closed])

  if (invalid) return null

  const timeLabel = formatDeadlineTime(deadlineDate)
  // 10분 이하로 남으면 붉게 강조
  const urgent = !closed && remaining <= 10 * 60 * 1000

  if (compact) {
    if (closed) {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
          마감 {timeLabel}
        </span>
      )
    }
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
          urgent ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
        }`}
        aria-live="off"
        title={`${timeLabel} 마감`}
      >
        {timeLabel} · {formatRemainingCompact(remaining)}
      </span>
    )
  }

  if (closed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-500">
        ⏰ 배팅 마감 ({timeLabel})
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
        urgent ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
      }`}
      aria-live="off"
    >
      ⏰ {timeLabel} 마감 · {formatRemaining(remaining)} 남음
    </span>
  )
}
