import { useState } from 'react'
import { DateNavigator } from '../components/common/DateNavigator'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { AbsencesPanel } from '../components/match/AbsencesPanel'
import { CreateMatchDialog } from '../components/match/CreateMatchDialog'
import { MatchCard } from '../components/match/MatchCard'
import { useMatchesByDate } from '../hooks/useMatchesByDate'
import {
  autoLinkYoutubeAroundDate,
  YOUTUBE_MATCH_WINDOW_DAYS,
} from '../services/youtubeService'
import { useAuthStore } from '../stores/authStore'
import { useClubStore } from '../stores/clubStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import { toErrorMessage } from '../utils/errors'
import { todayKst } from '../utils/kst'

/**
 * 오늘의 경기 페이지 (메인)
 */
export function MatchesPage() {
  const [date, setDate] = useState(() => todayKst())
  const club = useClubStore((s) => s.club)
  const clubId = club?.id
  const { matches, loading, error, refresh } = useMatchesByDate(date, clubId)
  const [createOpen, setCreateOpen] = useState(false)
  const [syncingYoutube, setSyncingYoutube] = useState(false)
  const profile = useAuthStore((s) => s.profile)
  const settings = useSettingsStore((s) => s.settings)
  const showToast = useToastStore((s) => s.show)

  const unlinkedCount = matches.filter(
    (m) => !m.youtube_video_id && m.status !== 'canceled' && m.players.length >= 4,
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
