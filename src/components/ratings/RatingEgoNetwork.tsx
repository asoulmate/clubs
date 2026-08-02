import { useMemo } from 'react'
import type { ShadowRatingEgo } from '../../types/domain'

interface Props {
  ego: ShadowRatingEgo | null
  loading: boolean
}

export function RatingEgoNetwork({ ego, loading }: Props) {
  const hop1 = useMemo(
    () => (ego?.nodes ?? []).filter((n) => n.hop === 1),
    [ego],
  )
  const hop2 = useMemo(
    () => (ego?.nodes ?? []).filter((n) => n.hop === 2),
    [ego],
  )

  if (loading) {
    return <p className="py-6 text-center text-sm text-gray-500">주변 상대 불러오는 중…</p>
  }
  if (!ego?.center) {
    return (
      <p className="rounded-xl bg-gray-50 py-6 text-center text-sm text-gray-500">
        리더보드나 전체 연결에서 선수를 선택하면, 그 선수의 직접 상대가 표시됩니다.
      </p>
    )
  }

  const center = ego.center
  const ring = hop1.slice(0, 10)
  const cx = 160
  const cy = 130
  const r = 88

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4">
      <h2 className="font-extrabold text-gray-900">{center.player_name} 주변 상대</h2>
      <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
        <p>
          <strong className="text-gray-800">직접 상대</strong>: 같은 경기에서 맞은편에 선 선수
          (예: A vs B).
        </p>
        <p className="mt-1">
          <strong className="text-gray-800">한 다리 건너</strong>: 나와는 안 붙었지만, 내 직접
          상대와는 붙은 선수. 예: A–B, B–C만 있으면 C는 A의 「한 다리 건너」입니다. 글로벌
          레이팅은 이런 연결로 A와 C도 같은 풀에서 간접 비교됩니다.
        </p>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        직접 상대 {hop1.length}명 · 한 다리 건너 {hop2.length}명
      </p>

      <div className="mt-3 flex justify-center overflow-hidden">
        <svg viewBox="0 0 320 260" className="h-56 w-full max-w-sm" role="img" aria-label="ego network">
          {ring.map((node, i) => {
            const angle = (Math.PI * 2 * i) / Math.max(ring.length, 1) - Math.PI / 2
            const x = cx + r * Math.cos(angle)
            const y = cy + r * Math.sin(angle)
            return (
              <g key={node.global_player_id}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="#bbf7d0" strokeWidth={2} />
                <circle cx={x} cy={y} r={18} fill="#ecfdf5" stroke="#059669" strokeWidth={1.5} />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  className="fill-gray-800"
                  style={{ fontSize: 9, fontWeight: 700 }}
                >
                  {node.player_name.slice(0, 3)}
                </text>
              </g>
            )
          })}
          <circle cx={cx} cy={cy} r={28} fill="#166534" />
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            className="fill-white"
            style={{ fontSize: 11, fontWeight: 800 }}
          >
            {center.player_name.slice(0, 4)}
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            className="fill-emerald-100"
            style={{ fontSize: 9 }}
          >
            {center.rating.toFixed(0)}
          </text>
        </svg>
      </div>

      <div className="mt-2 space-y-3">
        <HopList title="직접 상대 (맞은편)" rows={hop1} showGames />
        <HopList title="한 다리 건너 (공통 상대 있음)" rows={hop2} />
      </div>
    </section>
  )
}

function HopList({
  title,
  rows,
  showGames = false,
}: {
  title: string
  rows: ShadowRatingEgo['nodes']
  showGames?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-bold text-gray-500">{title}</h3>
        <p className="mt-1 text-sm text-gray-400">없음</p>
      </div>
    )
  }
  return (
    <div>
      <h3 className="text-xs font-bold text-gray-500">{title}</h3>
      <ul className="mt-1 divide-y divide-gray-50 rounded-xl border border-gray-100">
        {rows.map((n) => (
          <li
            key={n.global_player_id}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <span className="font-semibold text-gray-800">{n.player_name}</span>
            <span className="shrink-0 tabular-nums text-gray-600">
              {n.rating == null ? '—' : n.rating.toFixed(0)}
              {showGames && n.games_vs_center > 0 ? (
                <span className="ml-2 text-xs text-gray-400">{n.games_vs_center}경기</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
