import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DateNavigator } from '../components/common/DateNavigator'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { AbsencesPanel } from '../components/match/AbsencesPanel'
import { CreateMatchDialog } from '../components/match/CreateMatchDialog'
import { MatchCard } from '../components/match/MatchCard'
import { useMatchesByDate } from '../hooks/useMatchesByDate'
import { reorderMatches } from '../services/matchService'
import {
  autoLinkYoutubeAroundDate,
  YOUTUBE_MATCH_WINDOW_DAYS,
} from '../services/youtubeService'
import { useAuthStore } from '../stores/authStore'
import { useClubStore } from '../stores/clubStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import type { MatchWithPlayers } from '../types/domain'
import { requiredPlayerCount } from '../types/domain'
import { toErrorMessage } from '../utils/errors'
import { todayKst } from '../utils/kst'

function SortableMatchCard({
  match,
  index,
  dayMatches,
  showHandle,
  canReorder,
  onChanged,
  onMoveUp,
  onMoveDown,
}: {
  match: MatchWithPlayers
  index: number
  dayMatches: MatchWithPlayers[]
  showHandle: boolean
  canReorder: boolean
  onChanged: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: match.id,
    disabled: !canReorder,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'relative z-20' : undefined}>
      <MatchCard
        match={match}
        index={index}
        dayMatches={dayMatches}
        onChanged={onChanged}
        isDragging={isDragging}
        dragHandleProps={showHandle ? { ...attributes, ...listeners } : undefined}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      />
    </div>
  )
}

/**
 * 오늘의 경기 페이지 (메인)
 */
export function MatchesPage() {
  const [date, setDate] = useState(() => todayKst())
  const club = useClubStore((s) => s.club)
  const clubId = club?.id
  const { matches, loading, error, refresh } = useMatchesByDate(date, clubId)
  const [ordered, setOrdered] = useState<MatchWithPlayers[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [syncingYoutube, setSyncingYoutube] = useState(false)
  const [reordering, setReordering] = useState(false)
  const profile = useAuthStore((s) => s.profile)
  const settings = useSettingsStore((s) => s.settings)
  const showToast = useToastStore((s) => s.show)

  useEffect(() => {
    setOrdered(matches)
  }, [matches])

  const showReorder = Boolean(profile) && ordered.length > 1
  const canInteractReorder = showReorder && !reordering

  const sensors = useSensors(
    useSensor(TouchSensor, {
      // 길게 눌러 드래그 (스크롤과 구분)
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const sortableIds = useMemo(() => ordered.map((m) => m.id), [ordered])

  const persistOrder = async (next: MatchWithPlayers[]) => {
    if (!clubId) return
    setOrdered(next)
    setReordering(true)
    try {
      await reorderMatches(
        clubId,
        date,
        next.map((m) => m.id),
      )
      // display_order 동기화 (로컬 번호 갱신)
      setOrdered(
        next.map((m, i) => ({
          ...m,
          display_order: i + 1,
        })),
      )
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
      await refresh()
    } finally {
      setReordering(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !canInteractReorder) return
    const oldIndex = ordered.findIndex((m) => m.id === active.id)
    const newIndex = ordered.findIndex((m) => m.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    void persistOrder(arrayMove(ordered, oldIndex, newIndex))
  }

  const moveBy = (index: number, delta: number) => {
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= ordered.length || !canInteractReorder) return
    void persistOrder(arrayMove(ordered, index, nextIndex))
  }

  const unlinkedCount = ordered.filter(
    (m) =>
      !m.youtube_video_id &&
      m.status !== 'canceled' &&
      m.players.length >= requiredPlayerCount(m.match_type),
  ).length

  const runManualLink = async () => {
    if (!clubId) return
    if (!settings.youtube_channel_handle) {
      showToast('관리자 설정에서 유튜브 채널 핸들을 먼저 등록해주세요.', 'error')
      return
    }
    if (!import.meta.env.VITE_YOUTUBE_API_KEY) {
      showToast('유튜브 API 키가 없어 연결을 할 수 없습니다.', 'error')
      return
    }
    setSyncingYoutube(true)
    try {
      const { linked, scannedMatches, scannedVideos } = await autoLinkYoutubeAroundDate(
        date,
        settings.youtube_channel_handle,
        clubId,
        YOUTUBE_MATCH_WINDOW_DAYS,
      )
      if (linked > 0) {
        showToast(
          `${linked}개 경기에 유튜브를 연결했습니다. (±${YOUTUBE_MATCH_WINDOW_DAYS}일: 경기 ${scannedMatches}·영상 ${scannedVideos})`,
          'success',
        )
        await refresh()
      } else {
        showToast(
          `연결할 영상이 없습니다. (±${YOUTUBE_MATCH_WINDOW_DAYS}일: 경기 ${scannedMatches}·영상 ${scannedVideos})`,
          'info',
        )
      }
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setSyncingYoutube(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DateNavigator date={date} onChange={setDate} />

      {club?.absence_enabled && <AbsencesPanel date={date} />}

      {profile && club?.youtube_enabled && (
        <button
          type="button"
          disabled={syncingYoutube || loading}
          onClick={() => void runManualLink()}
          className="h-11 rounded-xl border-2 border-red-200 bg-white px-4 text-sm font-bold text-red-700 active:bg-red-50 disabled:opacity-50"
        >
          {syncingYoutube
            ? '유튜브 매칭 중…'
            : `유튜브 연결 (±${YOUTUBE_MATCH_WINDOW_DAYS}일)${unlinkedCount > 0 ? ` · 오늘 미연결 ${unlinkedCount}` : ''}`}
        </button>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-14">
          <p className="text-center text-gray-600">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="h-11 rounded-xl bg-gray-800 px-5 font-bold text-white"
          >
            다시 시도
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <EmptyState message="등록된 경기가 없습니다. 첫 경기를 만들어보세요!" />
      ) : (
        <div className="flex flex-col gap-3">
          {showReorder && (
            <p className="text-center text-xs text-gray-400">
              ⠿ 를 길게 눌러 끌어 순서를 바꾸거나, ↑↓ 버튼으로 이동할 수 있습니다.
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {ordered.map((match, i) => (
                <SortableMatchCard
                  key={match.id}
                  match={match}
                  index={i + 1}
                  dayMatches={ordered}
                  showHandle={showReorder}
                  canReorder={canInteractReorder}
                  onChanged={() => void refresh()}
                  onMoveUp={canInteractReorder && i > 0 ? () => moveBy(i, -1) : undefined}
                  onMoveDown={
                    canInteractReorder && i < ordered.length - 1 ? () => moveBy(i, 1) : undefined
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      <div className="pb-safe fixed bottom-20 left-1/2 z-30 -translate-x-1/2 md:bottom-8">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex h-13 items-center gap-2 rounded-full bg-green-700 px-6 py-3 text-base font-bold text-white shadow-lg active:bg-green-800"
        >
          <span className="text-xl leading-none" aria-hidden="true">
            +
          </span>
          경기 만들기
        </button>
      </div>

      {createOpen && (
        <CreateMatchDialog
          date={date}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void refresh()}
        />
      )}
    </div>
  )
}
