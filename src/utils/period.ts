import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { parseDateString } from './kst'

// ============================================================
// 기간 계산 유틸
//  - 주간: 월요일 ~ 일요일
//  - 분기: 1~3월 / 4~6월 / 7~9월 / 10~12월
//  - 누적: 전체 기간
// ============================================================

export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'all'

export const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'daily', label: '일간' },
  { value: 'weekly', label: '주간' },
  { value: 'monthly', label: '월간' },
  { value: 'quarterly', label: '분기' },
  { value: 'yearly', label: '연간' },
  { value: 'all', label: '누적' },
]

export interface PeriodRange {
  /** 조회 시작일 (YYYY-MM-DD) */
  from: string
  /** 조회 종료일 (YYYY-MM-DD) */
  to: string
  /** 화면 표시용 라벨 */
  label: string
}

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

/** 기준 날짜(anchor)와 기간 유형으로 조회 범위를 계산한다 */
export function getPeriodRange(period: PeriodType, anchorDateStr: string): PeriodRange {
  const anchor = parseDateString(anchorDateStr)
  const year = anchor.getFullYear()
  const month = anchor.getMonth() // 0-based

  switch (period) {
    case 'daily':
      return { from: anchorDateStr, to: anchorDateStr, label: format(anchor, 'yyyy년 M월 d일') }

    case 'weekly': {
      // 월요일 시작 ~ 일요일 종료
      const start = startOfWeek(anchor, { weekStartsOn: 1 })
      const end = endOfWeek(anchor, { weekStartsOn: 1 })
      return {
        from: fmt(start),
        to: fmt(end),
        label: `${format(start, 'M/d')} ~ ${format(end, 'M/d')} 주간`,
      }
    }

    case 'monthly': {
      const start = startOfMonth(anchor)
      const end = endOfMonth(anchor)
      return { from: fmt(start), to: fmt(end), label: format(anchor, 'yyyy년 M월') }
    }

    case 'quarterly': {
      const quarter = Math.floor(month / 3) // 0~3
      const start = new Date(year, quarter * 3, 1)
      const end = endOfMonth(new Date(year, quarter * 3 + 2, 1))
      return { from: fmt(start), to: fmt(end), label: `${year}년 ${quarter + 1}분기` }
    }

    case 'yearly':
      return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}년` }

    case 'all':
      return { from: '1900-01-01', to: '2999-12-31', label: '전체 누적' }
  }
}

/** 누적(전체 기간) 범위 */
export const ALL_TIME_RANGE: PeriodRange = { from: '1900-01-01', to: '2999-12-31', label: '전체 누적' }
