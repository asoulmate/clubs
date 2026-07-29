import { useEffect, useMemo, useState } from 'react'
import { AWARD_LEVEL_LABELS } from '../../constants/labels'
import {
  createMatchesFromDraw,
  executeDraw,
  fetchClubActiveMembers,
  fetchPairingHistory,
  scoreAttendees,
} from '../../services/drawService'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import type { Profile } from '../../types/domain'
import type { DrawMode, DrawResult } from '../../utils/drawPairing'
import { formatTeamNames } from '../../utils/drawPairing'
import type { ScoredPlayer } from '../../utils/drawScore'
import { toErrorMessage } from '../../utils/errors'
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'

interface LineupDrawDialogProps {
  date: string
  onClose: () => void
  onCreated: () => void
}

const MODE_OPTIONS: { value: DrawMode; label: string; desc: string }[] = [
  {
    value: 'level',
    label: '레벨별 균형 추첨',
    desc: '비슷한 실력 4명을 한 경기로 묶고, 경기 안에서 양 팀 점수를 맞춥니다. (추천)',
  },
  {
    value: 'mixed',
    label: '전체 혼합 균형 추첨',
    desc: '레벨을 나누지 않고 팀 합산만 비슷하게 맞춥니다. 상·하 교류에 적합합니다.',
  },
  {
    value: 'random',
    label: '완전 랜덤 추첨',
    desc: '점수·기록을 쓰지 않고 무작위로 편성합니다.',
  },
]

/** 당일 참석자 추첨 → 복식 경기 생성 */
export function LineupDrawDialog({ date, onClose, onCreated }: LineupDrawDialogProps) {
  const clubId = useClubStore((s) => s.club?.id)
  const showToast = useToastStore((s) => s.show)

  const [members, setMembers] = useState<Profile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<DrawMode>('level')
  const [scored, setScored] = useState<ScoredPlayer[] | null>(null)
  const [result, setResult] = useState<DrawResult | null>(null)
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!clubId) return
    let stale = false
    setLoadingMembers(true)
    void fetchClubActiveMembers(clubId)
      .then((list) => {
        if (!stale) setMembers(list)
      })
      .catch((err) => {
        if (!stale) showToast(toErrorMessage(err), 'error')
      })
      .finally(() => {
        if (!stale) setLoadingMembers(false)
      })
    return () => {
      stale = true
    }
  }, [clubId, showToast])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.name.toLowerCase().includes(q))
  }, [members, filter])

  const scoredSelected = useMemo(() => {
    if (!scored) return []
    return scored.filter((p) => selectedIds.has(p.profile.id))
  }, [scored, selectedIds])

  const toggle = (id: string) => {
    setResult(null)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedCount = selectedIds.size
  const canDraw = selectedCount >= 4 && selectedCount % 4 === 0

  const runDrawPipeline = async (reuseScored: ScoredPlayer[] | null) => {
    if (!clubId) return
    if (!canDraw) {
      showToast('참석자는 4명 단위로 선택해주세요. (예: 4, 8, 12명)', 'error')
      return
    }
    setBusy(true)
    try {
      let scoredList = reuseScored
      if (!scoredList || scoredList.length !== selectedCount) {
        const profiles = members.filter((m) => selectedIds.has(m.id))
        scoredList = await scoreAttendees(profiles, clubId)
        setScored(scoredList)
      } else {
        // 선택 변경 반영
        scoredList = scoredList.filter((p) => selectedIds.has(p.profile.id))
        if (scoredList.length !== selectedCount) {
          const profiles = members.filter((m) => selectedIds.has(m.id))
          scoredList = await scoreAttendees(profiles, clubId)
          setScored(scoredList)
        }
      }

      const history = await fetchPairingHistory(
        clubId,
        scoredList.map((p) => p.profile.id),
      )
      const draw = executeDraw(mode, scoredList, history)
      if (draw.matches.length === 0) {
        showToast('편성할 경기를 만들지 못했습니다.', 'error')
        setResult(null)
        return
      }
      setResult(draw)
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async () => {
    if (!clubId || !result) return
    setCreating(true)
    try {
      await createMatchesFromDraw(clubId, date, result)
      showToast(`${result.matches.length}개 경기를 생성했습니다.`, 'success')
      onCreated()
      onClose()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="균형 추첨 편성">
      <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto">
        <p className="text-sm text-gray-600">
          당일 참석자를 고르고 방식을 선택한 뒤 추첨하세요. 개인점수와 팀 합산을 확인한 다음
          경기를 생성하거나 재생성할 수 있습니다.
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-gray-800">추첨 방식</legend>
          {MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer gap-2 rounded-xl border px-3 py-2 ${
                mode === opt.value ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="draw-mode"
                checked={mode === opt.value}
                onChange={() => {
                  setMode(opt.value)
                  setResult(null)
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-bold text-gray-900">{opt.label}</span>
                <span className="text-xs text-gray-500">{opt.desc}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">당일 참석자 ({selectedCount}명)</h3>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="이름 검색"
              className="h-9 w-36 rounded-lg border border-gray-300 px-2 text-sm"
            />
          </div>
          {loadingMembers ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <ul className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 bg-white">
              {filtered.map((m) => {
                const s = scored?.find((x) => x.profile.id === m.id)
                return (
                  <li key={m.id} className="border-b border-gray-50 last:border-0">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 active:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(m.id)}
                        onChange={() => toggle(m.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-gray-900">{m.name}</span>
                        <span className="ml-1.5 text-xs text-gray-400">
                          {AWARD_LEVEL_LABELS[m.award_level] ?? m.award_level}
                        </span>
                      </span>
                      {s && selectedIds.has(m.id) && (
                        <span className="shrink-0 text-sm font-bold tabular-nums text-green-800">
                          {s.score.toFixed(1)}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {!canDraw && selectedCount > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              4명 단위로 선택해야 합니다. (현재 {selectedCount}명
              {selectedCount % 4 !== 0 ? `, ${4 - (selectedCount % 4)}명 더` : ''})
            </p>
          )}
        </div>

        {scoredSelected.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-bold">개인점수 (참석 · 높은 순)</h3>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
              <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-1 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-500">
                <span>#</span>
                <span>이름</span>
                <span>입상</span>
                <span>S</span>
              </div>
              {scoredSelected.map((p, i) => (
                <div
                  key={p.profile.id}
                  className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-1 border-t border-gray-50 px-3 py-1.5"
                >
                  <span className="text-gray-400">{i + 1}</span>
                  <span className="truncate font-medium">{p.profile.name}</span>
                  <span className="text-xs text-gray-400">{p.awardBase}</span>
                  <span className="font-bold tabular-nums text-green-800">
                    {p.score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold">편성 미리보기</h3>
            {result.matches.map((m) => (
              <div key={m.label} className="rounded-xl border border-green-200 bg-green-50/60 p-3">
                <p className="mb-2 text-sm font-extrabold text-green-900">{m.label}</p>
                <div className="space-y-1 text-sm text-gray-800">
                  <p>
                    <span className="font-bold text-gray-500">A </span>
                    {formatTeamNames(m.split.teamA, true)}
                    <span className="ml-2 font-bold tabular-nums text-green-800">
                      합 {m.split.teamASum.toFixed(0)}
                    </span>
                  </p>
                  <p className="text-center text-xs font-bold text-gray-400">vs</p>
                  <p>
                    <span className="font-bold text-gray-500">B </span>
                    {formatTeamNames(m.split.teamB, true)}
                    <span className="ml-2 font-bold tabular-nums text-green-800">
                      합 {m.split.teamBSum.toFixed(0)}
                    </span>
                  </p>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  팀 점수차 {m.split.scoreDiff.toFixed(1)} · 반복페널티 {m.split.repeatPenalty}
                </p>
              </div>
            ))}
            {result.sitOut.length > 0 && (
              <p className="text-xs text-gray-500">
                대기: {result.sitOut.map((p) => p.profile.name).join(', ')}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          {!result ? (
            <button
              type="button"
              disabled={busy || !canDraw}
              onClick={() => void runDrawPipeline(null)}
              className="h-12 w-full rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
            >
              {busy ? '추첨 중…' : '추첨하기 (점수 계산)'}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || creating}
                onClick={() => void runDrawPipeline(scored)}
                className="h-12 flex-1 rounded-xl border-2 border-green-700 font-bold text-green-800 disabled:opacity-50"
              >
                {busy ? '재생성 중…' : '재생성'}
              </button>
              <button
                type="button"
                disabled={creating || busy}
                onClick={() => void handleCreate()}
                className="h-12 flex-1 rounded-xl bg-amber-600 font-bold text-white disabled:opacity-50"
              >
                {creating ? '생성 중…' : '경기 생성'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
