import { MATCH_STATUS_LABELS } from '../../constants/labels'
import type { MatchStatus } from '../../types/domain'

// 색상만으로 구분하지 않도록 아이콘 + 텍스트를 함께 표시
const STATUS_STYLES: Record<MatchStatus, { className: string; icon: string }> = {
  open: { className: 'bg-blue-50 text-blue-700', icon: '👥' },
  ready: { className: 'bg-indigo-50 text-indigo-700', icon: '✅' },
  in_progress: { className: 'bg-amber-50 text-amber-700', icon: '🎾' },
  submitted: { className: 'bg-orange-50 text-orange-700', icon: '⏳' },
  confirmed: { className: 'bg-green-50 text-green-700', icon: '🏁' },
  canceled: { className: 'bg-gray-100 text-gray-500', icon: '🚫' },
}

/** 경기 상태 배지 */
export function StatusBadge({ status }: { status: MatchStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${style.className}`}
    >
      <span aria-hidden="true">{style.icon}</span>
      {MATCH_STATUS_LABELS[status]}
    </span>
  )
}
