import { AWARD_LEVEL_LABELS } from '../../constants/labels'
import type { RankedPlayerStats } from '../../types/domain'
import { PlayerNameButton } from '../players/PlayerNameButton'

interface RankingTableProps {
  rows: RankedPlayerStats[]
  minMatches: number
}

/**
 * 개인별 순위표
 *  - 모바일: 핵심 컬럼만 (순위/이름/경기/승-패/승률)
 *  - PC(md 이상): 득점/실점/득실차/참가율 추가 표시
 *  - 최소 경기 수 미달 사용자는 순위 없이 하단에 별도 표시
 */
export function RankingTable({ rows, minMatches }: RankingTableProps) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-gray-500">해당 기간에 확정된 경기가 없습니다.</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
            <th className="px-2 py-3 text-center font-semibold">순위</th>
            <th className="px-2 py-3 text-left font-semibold">이름</th>
            <th className="px-2 py-3 text-center font-semibold">경기</th>
            <th className="px-2 py-3 text-center font-semibold">승-패</th>
            <th className="px-2 py-3 text-center font-semibold">승률</th>
            <th className="hidden px-2 py-3 text-center font-semibold md:table-cell">득점</th>
            <th className="hidden px-2 py-3 text-center font-semibold md:table-cell">실점</th>
            <th className="hidden px-2 py-3 text-center font-semibold md:table-cell">득실차</th>
            <th className="hidden px-2 py-3 text-center font-semibold md:table-cell">참가율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.user_id} className="border-b border-gray-50 last:border-b-0">
              <td className="px-2 py-2 text-center">
                {row.rank === null ? (
                  <span
                    className="text-xs text-gray-400"
                    title={`최소 ${minMatches}경기 미달로 순위 제외`}
                  >
                    제외
                  </span>
                ) : row.rank <= 3 ? (
                  <span className="text-base" aria-label={`${row.rank}위`}>
                    {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'}
                  </span>
                ) : (
                  <span className="font-bold text-gray-700">{row.rank}</span>
                )}
              </td>
              <td className="px-2 py-2">
                <PlayerNameButton userId={row.user_id} name={row.name} className="min-h-9" />
                <span className="ml-1 hidden text-xs text-gray-400 md:inline">
                  {AWARD_LEVEL_LABELS[row.award_level]}
                </span>
              </td>
              <td className="px-2 py-2 text-center tabular-nums">{row.matches_played}</td>
              <td className="px-2 py-2 text-center tabular-nums">
                <span className="font-semibold text-green-700">{row.wins}</span>
                <span className="text-gray-400"> - </span>
                <span className="font-semibold text-red-600">{row.losses}</span>
                {row.ties > 0 && <span className="text-xs text-gray-400"> ({row.ties}무)</span>}
              </td>
              <td className="px-2 py-2 text-center font-semibold tabular-nums">
                {row.win_rate.toFixed(1)}%
              </td>
              <td className="hidden px-2 py-2 text-center tabular-nums md:table-cell">
                {row.points_for}
              </td>
              <td className="hidden px-2 py-2 text-center tabular-nums md:table-cell">
                {row.points_against}
              </td>
              <td className="hidden px-2 py-2 text-center tabular-nums md:table-cell">
                {row.point_diff > 0 ? `+${row.point_diff}` : row.point_diff}
              </td>
              <td className="hidden px-2 py-2 text-center tabular-nums md:table-cell">
                {row.participation_rate.toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
