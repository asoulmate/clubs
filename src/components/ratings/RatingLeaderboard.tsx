import type { ShadowRatingRow } from '../../types/domain'

interface Props {
  rows: ShadowRatingRow[]
  selectedId: string | null
  onSelect: (row: ShadowRatingRow) => void
}

export function RatingLeaderboard({ rows, selectedId, onSelect }: Props) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl bg-white py-10 text-center text-gray-500 shadow-sm">
        계산된 글로벌 레이팅이 없습니다. 플랫폼 관리자가 Shadow 재계산을 실행해야 합니다.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-2 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">선수</th>
              <th className="px-2 py-2 text-right font-semibold">레이팅</th>
              <th className="px-2 py-2 text-right font-semibold">불확실성</th>
              <th className="px-2 py-2 text-center font-semibold">상태</th>
              <th className="px-2 py-2 text-right font-semibold">경기</th>
              <th className="px-2 py-2 text-right font-semibold">상대</th>
              <th className="px-2 py-2 text-right font-semibold">클럽</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const selected = row.global_player_id === selectedId
              return (
                <tr
                  key={row.global_player_id}
                  className={`cursor-pointer border-b border-gray-50 last:border-b-0 ${
                    selected ? 'bg-green-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => onSelect(row)}
                >
                  <td className="px-2 py-2 tabular-nums text-gray-500">{index + 1}</td>
                  <td className="px-2 py-2 font-semibold text-gray-900">{row.player_name}</td>
                  <td className="px-2 py-2 text-right font-bold tabular-nums text-green-800">
                    {row.rating.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                    ±{row.uncertainty.toFixed(0)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                        row.provisional
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {row.provisional ? '잠정' : '확립'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.games_played}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.opponent_count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.linked_club_count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-gray-50 px-3 py-2 text-xs text-gray-400">
        행을 누르면 해당 선수의 연결 네트워크를 봅니다.
      </p>
    </div>
  )
}
