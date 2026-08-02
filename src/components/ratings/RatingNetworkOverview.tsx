import { useMemo } from 'react'
import type { ShadowRatingGraph } from '../../types/domain'
import { neighborsOf } from '../../utils/ratingGraph'

interface Props {
  graph: ShadowRatingGraph | null
  loading: boolean
  selectedId: string | null
  pathIds: string[]
  onSelect: (playerId: string) => void
}

function layoutCircle(
  nodes: ShadowRatingGraph['nodes'],
  size: number,
): Map<string, { x: number; y: number }> {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.38
  const map = new Map<string, { x: number; y: number }>()
  const n = Math.max(nodes.length, 1)
  nodes.forEach((node, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    map.set(node.global_player_id, {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    })
  })
  return map
}

function edgePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** 플랫폼 전체 상대 연결 한눈에 보기 + 선택/경로 하이라이트 */
export function RatingNetworkOverview({
  graph,
  loading,
  selectedId,
  pathIds,
  onSelect,
}: Props) {
  const size = 360
  const positions = useMemo(
    () => (graph ? layoutCircle(graph.nodes, size) : new Map()),
    [graph],
  )
  const neighborIds = useMemo(
    () => (graph && selectedId ? neighborsOf(graph, selectedId) : new Set<string>()),
    [graph, selectedId],
  )
  const pathSet = useMemo(() => new Set(pathIds), [pathIds])
  const pathEdgeSet = useMemo(() => {
    const set = new Set<string>()
    for (let i = 0; i < pathIds.length - 1; i++) {
      set.add(edgePairKey(pathIds[i], pathIds[i + 1]))
    }
    return set
  }, [pathIds])

  if (loading) {
    return <p className="py-6 text-center text-sm text-gray-500">전체 연결망 불러오는 중…</p>
  }
  if (!graph || graph.nodes.length === 0) {
    return (
      <p className="rounded-xl bg-gray-50 py-6 text-center text-sm text-gray-500">
        표시할 연결 데이터가 없습니다. Shadow 재계산 후 다시 확인하세요.
      </p>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4">
      <h2 className="font-extrabold text-gray-900">플랫폼 전체 연결</h2>
      <p className="mt-1 text-xs text-gray-500">
        선끼리 맞붙은 관계를 한눈에 봅니다. 선수를 누르면 직접 상대가 강조되고, 아래 경로
        찾기를 쓰면 연결 경로가 하이라이트됩니다.
      </p>
      <p className="mt-1 text-xs text-gray-400">
        선수 {graph.nodes.length}명 · 연결 {graph.edges.length}개
      </p>

      <div className="mt-3 overflow-x-auto">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="mx-auto h-72 w-full max-w-md"
          role="img"
          aria-label="platform rating network"
        >
          {graph.edges.map((e) => {
            const a = positions.get(e.from_id)
            const b = positions.get(e.to_id)
            if (!a || !b) return null
            const key = edgePairKey(e.from_id, e.to_id)
            const onPath = pathEdgeSet.has(key)
            const nearSelected =
              Boolean(selectedId) &&
              (e.from_id === selectedId ||
                e.to_id === selectedId ||
                (neighborIds.has(e.from_id) && neighborIds.has(e.to_id)))
            const dim = Boolean(selectedId || pathIds.length > 0) && !onPath && !nearSelected
            return (
              <line
                key={key}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={onPath ? '#166534' : nearSelected ? '#34d399' : '#e5e7eb'}
                strokeWidth={onPath ? 3 : nearSelected ? 2 : 1}
                opacity={dim ? 0.15 : 1}
              />
            )
          })}
          {graph.nodes.map((n) => {
            const p = positions.get(n.global_player_id)
            if (!p) return null
            const selected = n.global_player_id === selectedId
            const onPath = pathSet.has(n.global_player_id)
            const near = neighborIds.has(n.global_player_id)
            const dim =
              Boolean(selectedId || pathIds.length > 0) && !selected && !onPath && !near
            return (
              <g
                key={n.global_player_id}
                className="cursor-pointer"
                onClick={() => onSelect(n.global_player_id)}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={selected || onPath ? 14 : 10}
                  fill={selected ? '#166534' : onPath ? '#059669' : near ? '#a7f3d0' : '#f3f4f6'}
                  stroke={selected || onPath ? '#14532d' : '#9ca3af'}
                  strokeWidth={1.5}
                  opacity={dim ? 0.25 : 1}
                />
                <text
                  x={p.x}
                  y={p.y + 3}
                  textAnchor="middle"
                  style={{ fontSize: 8, fontWeight: 700 }}
                  className={selected || onPath ? 'fill-white' : 'fill-gray-800'}
                  opacity={dim ? 0.25 : 1}
                >
                  {n.player_name.slice(0, 2)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {selectedId && (
        <p className="mt-1 text-center text-xs text-gray-500">
          선택:{' '}
          <span className="font-semibold text-gray-800">
            {graph.nodes.find((n) => n.global_player_id === selectedId)?.player_name}
          </span>
          {neighborIds.size > 0 ? ` · 직접 상대 ${neighborIds.size}명` : ' · 직접 상대 없음'}
        </p>
      )}
    </section>
  )
}
