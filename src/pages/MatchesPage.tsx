import { useEffect, useRef, useState } from 'react'
import { DateNavigator } from '../components/common/DateNavigator'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { AbsencesPanel } from '../components/match/AbsencesPanel'
import { CreateMatchDialog } from '../components/match/CreateMatchDialog'
import { MatchCard } from '../components/match/MatchCard'
import { useMatchesByDate } from '../hooks/useMatchesByDate'
import { autoLinkYoutubeForDate } from '../services/youtubeService'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import { toErrorMessage } from '../utils/errors'
import { todayKst } from '../utils/kst'

/**
 * 오늘의 경기 페이지 (메인)
 *  - 상단: 해당 날짜 무단 결석자 등록
 *  - Realtime으로 경기·결석 변경이 실시간 반영됨
 *  - 페이지 진입/날짜 변경 시 미연결 경기에 유튜브 자동 매칭 시도
 */
export function MatchesPage() {
  const [date, setDate] = useState(() => todayKst())
  const { matches, loading, error, refresh } = useMatchesByDate(date)
  const [createOpen, setCreateOpen] = useState(false)
  const [syncingYoutube, setSyncingYoutube] = useState(false)
  const profile = useAuthStore((s) => s.profile)
  const settings = useSettingsStore((s) => s.settings)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const showToast = useToastStore((s) => s.show)
  /** 같은 미연결 세트에 대해 자동 매칭을 중복 호출하지 않음 */
  const autoAttemptKeyRef = useRef('')

  const unlinkedMatches = matches.filter(
    (m) => !m.youtube_video_id && m.status !== 'canceled' && m.players.length >= 4,
  )
  const unlinkedCount = unlinkedMatches.length

  const runAutoLink = async (silent: boolean) => {
    if (!settings.youtube_channel_handle) {
      if (!silent) showToast('관리자 설정에서 유튜브 채널 핸들을 먼저 등록해주세요.', 'error')
      return
    }
    if (!import.meta.env.VITE_YOUTUBE_API_KEY) {
      if (!silent) {
        showToast('유튜브 API 키가 없어 자동 연결을 할 수 없습니다.', 'error')
      }
      return
    }
    setSyncingYoutube(true)
    try {
      const { linked } = await autoLinkYoutubeForDate(
        matches,
        settings.youtube_channel_handle,
        settings.youtube_upload_delay_days,
      )
      if (linked > 0) {
        showToast(`${linked}개 경기에 유튜브를 연결했습니다.`, 'success')
        await refresh()
      } else if (!silent) {
        showToast('자동으로 연결할 영상이 없습니다. 카드에서 수동 연결을 시도해보세요.', 'info')
      }
    } catch (err) {
      if (!silent) showToast(toErrorMessage(err), 'error')
    } finally {
      setSyncingYoutube(false)
    }
  }

  // 페이지 열림·날짜 변경 후 경기 로드되면 미연결 건 자동 매칭
  useEffect(() => {
    if (loading || !settingsLoaded || !profile) return
    if (unlinkedCount === 0) return

    const attemptKey = `${date}:${unlinkedMatches
      .map((m) => m.id)
      .sort()
      .join(',')}`
    if (autoAttemptKeyRef.current === attemptKey) return
    autoAttemptKeyRef.current = attemptKey

    void runAutoLink(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 날짜·미연결 세트 기준으로만 1회
  }, [date, loading, settingsLoaded, profile, unlinkedCount, matches])

  return (
    <div className="flex flex-col gap-4">
      <DateNavigator date={date} onChange={setDate} />

      <AbsencesPanel date={date} />

      {profile && matches.length > 0 && unlinkedCount > 0 && (
        <button
          type="button"
          disabled={syncingYoutube}
          onClick={() => void runAutoLink(false)}
          className="h-11 rounded-xl border-2 border-red-200 bg-white px-4 text-sm font-bold text-red-700 active:bg-red-50 disabled:opacity-50"
        >
          {syncingYoutube
            ? '유튜브 매칭 중…'
            : `유튜브 다시 연결 (미연결 ${unlinkedCount}경기)`}
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
      ) : matches.length === 0 ? (
        <EmptyState message="등록된 경기가 없습니다. 첫 경기를 만들어보세요!" />
      ) : (
        <div className="flex flex-col gap-3">
          {matches.map((match, i) => (
            <MatchCard
              key={match.id}
              match={match}
              index={i + 1}
              dayMatches={matches}
              onChanged={() => void refresh()}
            />
          ))}
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
