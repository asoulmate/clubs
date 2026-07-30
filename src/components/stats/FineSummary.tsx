import { Link } from 'react-router-dom'
import { AWARD_LEVEL_ICONS } from '../../constants/labels'
import type { MatchFineRecord } from '../../types/domain'
import { formatDateKorean } from '../../utils/kst'

interface FineSummaryProps {
  records: MatchFineRecord[]
  rangeLabel: string
  clubSlug: string
}

/** 결과 집계: 기간별 벌금 합계와 경기별 상세 */
export function FineSummary({ records, rangeLabel, clubSlug }: FineSummaryProps) {
  const total = records.reduce((sum, row) => sum + Number(row.amount), 0)
  const byPlayer = new Map<
    string,
    { userId: string; name: string; icon: string; count: number; amount: number }
  >()

  for (const row of records) {
    const current = byPlayer.get(row.user_id) ?? {
      userId: row.user_id,
      name: row.name,
      icon: AWARD_LEVEL_ICONS[row.award_level],
      count: 0,
      amount: 0,
    }
    current.count += 1
    current.amount += Number(row.amount)
    byPlayer.set(row.user_id, current)
  }

  const players = [...byPlayer.values()].sort(
    (a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ko'),
  )

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold text-gray-800">{rangeLabel} 벌금 현황</h2>
        <p className="text-xs text-gray-500">
          확정 경기 기준 · 일반 패배 2,500원 · 6:0/6:5 패배 3,500원 (1인당)
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums text-red-700">
            {total.toLocaleString('ko-KR')}원
          </p>
          <p className="text-xs text-gray-500">기간 합계</p>
        </div>
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums">{players.length}명</p>
          <p className="text-xs text-gray-500">벌금 대상</p>
        </div>
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums">{records.length}건</p>
          <p className="text-xs text-gray-500">개인 부과</p>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
          해당 기간에 부과된 벌금이 없습니다.
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-500">
              <span>회원</span>
              <span>패배</span>
              <span>합계</span>
            </div>
            {players.map((player) => (
              <div
                key={player.userId}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-gray-50 px-4 py-3 text-sm"
              >
                <Link
                  to={`/c/${clubSlug}/players/${player.userId}`}
                  className="truncate font-semibold text-green-800"
                >
                  {player.name}
                  {player.icon ? <span aria-hidden="true"> {player.icon}</span> : null}
                </Link>
                <span className="tabular-nums text-gray-500">{player.count}회</span>
                <span className="font-bold tabular-nums text-red-700">
                  {player.amount.toLocaleString('ko-KR')}원
                </span>
              </div>
            ))}
          </div>

          <details className="rounded-2xl bg-white shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">
              경기별 부과 내역 ({records.length}건)
            </summary>
            <div className="border-t border-gray-100">
              {records.map((row) => (
                <div
                  key={`${row.match_id}-${row.user_id}`}
                  className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{row.name}</p>
                    <p className="text-xs text-gray-500">
                      {formatDateKorean(row.match_date)} · {row.team_a_score}:{row.team_b_score} ·{' '}
                      {row.fine_reason}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-red-700">
                    {Number(row.amount).toLocaleString('ko-KR')}원
                  </span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  )
}

