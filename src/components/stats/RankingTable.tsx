import { AWARD_LEVEL_LABELS } from '../../constants/labels'
import type { RankedPlayerStats } from '../../types/domain'
import { PlayerNameButton } from '../players/PlayerNameButton'

interface RankingTableProps {
  rows: RankedPlayerStats[]
  minMatches: number
}

/** 1·2·3등 행 배경 (sticky 셀에도 동일하게 적용) */
function podiumStyles(rank: number | null): { row: string; sticky: string } {
  if (rank === 1) return { row: 'bg-amber-100', sticky: 'bg-amber-100' }
  if (rank === 2) return { row: 'bg-slate-200/80', sticky: 'bg-slate-200/80' }
  if (rank === 3) return { row: 'bg-orange-100', sticky: 'bg-orange-100' }
  return { row: '', sticky: 'bg-white' }
}

/**
 * 개인별 순위표
 *  - 참가율 다음(맨 끝)에 무단 결석 열 표시
 *  - 1·2·3등 행 하이라이트
 *  - 경기 0회는 하단 배치(순위 계산에서 제외)
 */
export function RankingTable({ rows, minMatches }: RankingTableProps) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-gray-500">
        해당 기간에 확정된 경기 또는 무단 결석 기록이 없습니다.
      </p>
    )
  }

  const hasTies = rows.some((r) => r.ties > 0)

  const stickyRank = 'sticky left-0 z-10 w-11 min-w-11'
  const stickyName = 'sticky left-11 z-10 border-r border-gray-200'
  const numCell = 'whitespace-nowrap px-2.5 py-2 text-center tabular-nums'
  const numHead = 'whitespace-nowrap px-2.5 py-3 text-center font-semibold'

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <th className={`${stickyRank} bg-gray-50 px-1 py-3 text-center font-semibold`}>순위</th>
              <th className={`${stickyName} bg-gray-50 px-2 py-3 text-left font-semibold`}>이름</th>
              <th className={numHead}>경기</th>
              <th className={numHead}>승</th>
              <th className={numHead}>패</th>
              {hasTies && <th className={numHead}>무</th>}
              <th className={numHead}>승률</th>
              <th className={numHead}>득점</th>
              <th className={numHead}>실점</th>
              <th className={numHead}>득실차</th>
              <th className={numHead}>참가일</th>
              <th className={numHead}>참가율</th>
              <th className={`${numHead} text-red-700`}>무단결석</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const absences = row.absences ?? 0
              const podium = podiumStyles(row.rank)
              const absenceCellBg =
                absences > 0
                  ? row.rank === 1
                    ? 'bg-red-100'
                    : 'bg-red-50'
                  : ''

              return (
                <tr
                  key={row.user_id}
                  className={`border-b border-gray-50 last:border-b-0 ${podium.row}`}
                >
                  <td className={`${stickyRank} ${podium.sticky} px-1 py-2 text-center`}>
                    {row.rank === null ? (
                      <span
                        className="text-xs font-medium text-gray-400"
                        title={
                          row.matches_played === 0
                            ? '확정 경기 미참가 (순위 제외)'
                            : `최소 ${minMatches}경기 미달로 순위 제외`
                        }
                      >
                        {row.matches_played === 0 ? '미참가' : '제외'}
                      </span>
                    ) : row.rank === 1 ? (
                      <span className="inline-flex flex-col items-center text-base font-extrabold text-amber-800" aria-label="1위">
                        <span>🥇</span>
                        <span className="text-[10px]">1위</span>
                      </span>
                    ) : row.rank === 2 ? (
                      <span className="inline-flex flex-col items-center text-base font-extrabold text-slate-700" aria-label="2위">
                        <span>🥈</span>
                        <span className="text-[10px]">2위</span>
                      </span>
                    ) : row.rank === 3 ? (
                      <span className="inline-flex flex-col items-center text-base font-extrabold text-orange-800" aria-label="3위">
                        <span>🥉</span>
                        <span className="text-[10px]">3위</span>
                      </span>
                    ) : (
                      <span className="font-bold text-gray-700">{row.rank}</span>
                    )}
                  </td>
                  <td className={`${stickyName} ${podium.sticky} whitespace-nowrap px-2 py-2`}>
                    <PlayerNameButton
                      userId={row.user_id}
                      name={row.name}
                      awardLevel={row.award_level}
                      className="min-h-9 justify-start"
                    />
                    <span className="ml-1 hidden text-xs text-gray-400 lg:inline">
                      {AWARD_LEVEL_LABELS[row.award_level]}
                    </span>
                  </td>
                  <td className={numCell}>{row.matches_played}</td>
                  <td className={`${numCell} font-semibold text-green-700`}>{row.wins}</td>
                  <td className={`${numCell} font-semibold text-red-600`}>{row.losses}</td>
                  {hasTies && <td className={`${numCell} text-gray-500`}>{row.ties}</td>}
                  <td className={`${numCell} font-semibold`}>{row.win_rate.toFixed(1)}%</td>
                  <td className={numCell}>{row.points_for}</td>
                  <td className={numCell}>{row.points_against}</td>
                  <td className={numCell}>
                    {row.point_diff > 0 ? `+${row.point_diff}` : row.point_diff}
                  </td>
                  <td className={numCell}>{row.days_participated}일</td>
                  <td className={numCell}>{row.participation_rate.toFixed(0)}%</td>
                  <td
                    className={`${numCell} font-extrabold ${
                      absences > 0 ? `${absenceCellBg} text-red-700` : 'text-gray-400'
                    }`}
                  >
                    {absences}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
