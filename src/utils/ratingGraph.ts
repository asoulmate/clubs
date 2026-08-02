import type {
  ShadowRatingGraph,
  ShadowRatingGraphEdge,
  ShadowRatingPath,
  ShadowRatingPathHop,
  ShadowRatingPathNode,
} from '../types/domain'

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** 상대 그래프에서 최단 경로(BFS). 서버 path RPC 실패 시 클라이언트 폴백용. */
export function findShortestRatingPath(
  graph: ShadowRatingGraph,
  fromId: string,
  toId: string,
): ShadowRatingPath {
  if (!fromId || !toId) {
    return { found: false, path: [], nodes: [], hops: [] }
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.global_player_id, n]))
  const adj = new Map<string, string[]>()
  const edgeMap = new Map<string, ShadowRatingGraphEdge>()

  for (const e of graph.edges) {
    edgeMap.set(edgeKey(e.from_id, e.to_id), e)
    if (!adj.has(e.from_id)) adj.set(e.from_id, [])
    if (!adj.has(e.to_id)) adj.set(e.to_id, [])
    adj.get(e.from_id)!.push(e.to_id)
    adj.get(e.to_id)!.push(e.from_id)
  }

  const toNode = (id: string): ShadowRatingPathNode => {
    const n = nodeMap.get(id)
    return {
      global_player_id: id,
      player_name: n?.player_name ?? '이름 없음',
      rating: n?.rating ?? null,
      uncertainty: n?.uncertainty ?? null,
    }
  }

  if (fromId === toId) {
    return { found: true, path: [fromId], nodes: [toNode(fromId)], hops: [] }
  }

  const parent = new Map<string, string | null>()
  const queue: string[] = [fromId]
  parent.set(fromId, null)

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === toId) break
    for (const nxt of adj.get(cur) ?? []) {
      if (parent.has(nxt)) continue
      parent.set(nxt, cur)
      queue.push(nxt)
    }
  }

  if (!parent.has(toId)) {
    return { found: false, path: [], nodes: [], hops: [] }
  }

  const path: string[] = []
  let cur: string | null = toId
  while (cur) {
    path.unshift(cur)
    cur = parent.get(cur) ?? null
  }

  const hops: ShadowRatingPathHop[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const e = edgeMap.get(edgeKey(a, b))
    hops.push({
      from_id: a,
      to_id: b,
      from_name: nodeMap.get(a)?.player_name ?? '이름 없음',
      to_name: nodeMap.get(b)?.player_name ?? '이름 없음',
      match_id: e?.match_id ?? null,
      match_date: e?.match_date ?? null,
      team_a_score: e?.team_a_score ?? null,
      team_b_score: e?.team_b_score ?? null,
      club_name: e?.club_name ?? null,
    })
  }

  return {
    found: true,
    path,
    nodes: path.map(toNode),
    hops,
  }
}

export function neighborsOf(graph: ShadowRatingGraph, playerId: string): Set<string> {
  const set = new Set<string>()
  for (const e of graph.edges) {
    if (e.from_id === playerId) set.add(e.to_id)
    if (e.to_id === playerId) set.add(e.from_id)
  }
  return set
}
