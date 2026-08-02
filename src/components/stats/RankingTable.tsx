import { useMemo, useState } from 'react'
import type { RankedPlayerStats, RankingMode } from '../../types/domain'
import { PlayerNameButton } from '../players/PlayerNameButton'

interface RankingTableProps {
  rows: RankedPlayerStats[]
  minMatches: number
  rankingMode?: RankingMode
}

type SortKey =
  | 'rank'
  | 'name'
  | 'matches_played'
  | 'wins'
  | 'losses'
  | 'ties'
  | 'league_points'
  | 'win_rate'
  | 'points_for'
  | 'points_against'
  | 'point_diff'
  | 'days_participated'
  | 'participation_rate'
  | 'absences'

type SortDir = 'asc' | 'desc'

/** 1·2·3등 행 배경 (sticky 셀에도 동일하게 적용 — 불투명만 사용) */
function podiumStyles(rank: number | null): { row: string; sticky: string } {
  if (rank === 1) return { row: 'bg-amber-100', sticky: 'bg-amber-100' }
  if (rank === 2) return { row: 'bg-slate-200', sticky: 'bg-slate-200' }
  if (rank === 3) return { row: 'bg-orange-100', sticky: 'bg-orange-100' }
  return { row: '', sticky: 'bg-white' }
}

function compareValues(a: number | string | null, b: number | string | null, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, 'ko') * mul
  }
  return ((a as number) - (b as number)) * mul
}

function getSortValue(row: RankedPlayerStats, key: SortKey): number | string | null {
  switch (key) {
    case 'rank':
      return row.rank
    case 'name':
      return row.name
    case 'matches_played':
      return row.matches_played
    case 'wins':
      return row.wins
    case 'losses':
      return row.losses
    case 'ties':
      return row.ties
    case 'league_points':
      return row.league_points
    case 'win_rate':
      return row.win_rate
    case 'points_for':
      return row.points_for
    case 'points_against':
      return row.points_against
    case 'point_diff':
      return row.point_diff
    case 'days_participated':
      return row.days_participated
    case 'participation_rate':
      return row.participation_rate
    case 'absences':
      return row.absences ?? 0
  }
}

/**
 * 개인별 순위표 (모바일 밀도 우선)
 */
export function RankingTable({
  rows,
  minMatches,
  rankingMode = 'wins',
}: RankingTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const sortedRows = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      const primary = compareValues(getSortValue(a, sortKey), getSortValue(b, sortKey), sortDir)
      if (primary !== 0) return primary
      const byName = a.name.localeCompare(b.name, 'ko')
      if (byName !== 0) return byName
      return compareValues(a.rank, b.rank, 'asc')
    })
    return list
  }, [rows, sortKey, sortDir])

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-gray-500">
        해당 기간에 확정된 경기 또는 무단 결석 기록이 없습니다.
      </p>
    )
  }

  const hasTies = rows.some((r) => r.ties > 0) || rankingMode === 'points'
  const showPoints = rankingMode === 'points'

  const stickyRank = 'sticky left-0 z-10 w-10 min-w-10 align-middle'
  const stickyName = 'sticky left-10 z-10 border-r border-gray-200 align-middle'
  const numCell = 'whitespace-nowrap px-1.5 py-1 text-center align-middle tabular-nums text-[13px]'
  const numHead = 'whitespace-nowrap px-1.5 py-1.5 text-center font-semibold'

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'rank' ? 'asc' : 'desc')
    }
  }

  const sortMark = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  const SortableTh = ({
    label,
    columnKey,
    className,
  }: {
    label: string
    columnKey: SortKey
    className: string
  }) => (
    <th className={className}>
      <button
        type="button"
        onClick={() => toggleSort(columnKey)}
        className={`inline-flex min-h-8 items-center justify-center gap-0.5 whitespace-nowrap rounded-md px-0.5 text-[11px] font-semibold active:bg-gray-200 sm:text-xs ${
          sortKey === columnKey ? 'text-green-700' : 'text-gray-500'
        }`}
        aria-label={`${label} 정렬`}
      >
        {label}
        <span className="shrink-0 text-[9px]" aria-hidden="true">
          {sortMark(columnKey) || ' ↕'}
        </span>
      </button>
    </th>
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <SortableTh
                label="#"
                columnKey="rank"
                className={`${stickyRank} bg-gray-50 px-0.5 py-1.5 text-center`}
              />
              <SortableTh
                label="이름"
                columnKey="name"
                className={`${stickyName} bg-gray-50 px-1.5 py-1.5 text-left`}
              />
              <SortableTh label="경기" columnKey="matches_played" className={numHead} />
              <SortableTh label="승" columnKey="wins" className={numHead} />
              <SortableTh label="패" columnKey="losses" className={numHead} />
              {hasTies && <SortableTh label="무" columnKey="ties" className={numHead} />}
              {showPoints && (
                <SortableTh label="승점" columnKey="league_points" className={numHead} />
              )}
              <SortableTh label="승률" columnKey="win_rate" className={numHead} />
              <SortableTh label="득점" columnKey="points_for" className={numHead} />
              <SortableTh label="실점" columnKey="points_against" className={numHead} />
              <SortableTh label="득실" columnKey="point_diff" className={numHead} />
              <SortableTh label="참가" columnKey="days_participated" className={numHead} />
              <SortableTh label="참가율" columnKey="participation_rate" className={numHead} />
              <SortableTh
                label="결석"
                columnKey="absences"
                className={`${numHead} text-red-700`}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const absences = row.absences ?? 0
              const podium = podiumStyles(row.rank)
              const absenceCellBg =
                absences > 0 ? (row.rank === 1 ? 'bg-red-100' : 'bg-red-50') : ''

              return (
                <tr
                  key={row.user_id}
                  className={`border-b border-gray-50 last:border-b-0 ${podium.row}`}
                >
                  <td className={`${stickyRank} ${podium.sticky} px-0.5 py-1 text-center`}>
                    {row.rank === null ? (
                      <span
                        className="text-[10px] font-medium text-gray-400"
                        title={
                          row.matches_played === 0
                            ? '확정 경기 미참가 (순위 제외)'
                            : `최소 ${minMatches}경기 미달로 순위 제외`
                        }
                      >
                        —
                      </span>
                    ) : row.rank <= 3 ? (
                      <span className="text-sm leading-none" aria-label={`${row.rank}위`}>
                        {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'}
                      </span>
                    ) : (
                      <span className="text-[13px] font-bold text-gray-700">{row.rank}</span>
                    )}
                  </td>
                  <td className={`${stickyName} ${podium.sticky} whitespace-nowrap px-1.5 py-1`}>
                    <div className="flex min-h-8 items-center">
                      <PlayerNameButton
                        userId={row.user_id}
                        name={row.name}
                        awardLevel={row.award_level}
                        affiliation={row.is_guest ? row.affiliation : null}
                        affiliationClassName="text-[10px]"
                        className="min-h-0 items-start justify-center py-0 text-[13px]"
                      />
                    </div>
                  </td>
                  <td className={numCell}>{row.matches_played}</td>
                  <td className={`${numCell} font-semibold text-green-700`}>{row.wins}</td>
                  <td className={`${numCell} font-semibold text-red-600`}>{row.losses}</td>
                  {hasTies && <td className={`${numCell} text-gray-500`}>{row.ties}</td>}
                  {showPoints && (
                    <td className={`${numCell} font-bold text-green-800`}>{row.league_points}</td>
                  )}
                  <td className={`${numCell} font-semibold`}>{row.win_rate.toFixed(0)}%</td>
                  <td className={numCell}>{row.points_for}</td>
                  <td className={numCell}>{row.points_against}</td>
                  <td className={numCell}>
                    {row.point_diff > 0 ? `+${row.point_diff}` : row.point_diff}
                  </td>
                  <td className={numCell}>{row.days_participated}</td>
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
