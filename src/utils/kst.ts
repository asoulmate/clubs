import { addDays, format, parse } from 'date-fns'
import { ko } from 'date-fns/locale'

// ============================================================
// 한국 시간(Asia/Seoul) 기준 날짜 처리
// 브라우저의 로컬 시간대와 무관하게 항상 한국 날짜를 사용한다.
// (UTC 날짜를 잘라 쓰면 자정 전후에 날짜가 어긋나는 문제가 생김)
// ============================================================

const KST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKst(): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 반환
  return KST_FORMATTER.format(new Date())
}

/** YYYY-MM-DD 문자열 → Date (시간대 변환 없이 달력상 날짜로만 해석) */
export function parseDateString(dateStr: string): Date {
  return parse(dateStr, 'yyyy-MM-dd', new Date())
}

/** 날짜 문자열에 일수 더하기 */
export function addDaysToDateString(dateStr: string, days: number): string {
  return format(addDays(parseDateString(dateStr), days), 'yyyy-MM-dd')
}

/** "7월 24일 (금)" 형태의 한글 날짜 표시 */
export function formatDateKorean(dateStr: string): string {
  return format(parseDateString(dateStr), 'M월 d일 (EEE)', { locale: ko })
}

/** "2026년 7월 24일 (금)" 형태의 전체 한글 날짜 표시 */
export function formatDateKoreanFull(dateStr: string): string {
  return format(parseDateString(dateStr), 'yyyy년 M월 d일 (EEE)', { locale: ko })
}

/** timestamptz → "7월 24일 10:30" 형태 (한국 시간 기준) */
export function formatTimestampKorean(timestamp: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}
