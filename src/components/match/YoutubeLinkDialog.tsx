import { useEffect, useState, type FormEvent } from 'react'
import {
  fetchSuggestionsForMatch,
  linkMatchYoutube,
  linkMatchYoutubeByUrl,
  unlinkMatchYoutube,
  youtubeWatchUrl,
} from '../../services/youtubeService'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import type { MatchWithPlayers } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import type { YoutubeMatchCandidate } from '../../utils/youtubeMatch'
import { Dialog } from '../common/Dialog'

interface YoutubeLinkDialogProps {
  match: MatchWithPlayers
  /** 같은 날짜의 전체 경기 (이미 연결된 영상 제외용) */
  dayMatches: MatchWithPlayers[]
  onClose: () => void
  onChanged: () => void
}

/** 경기 ↔ 유튜브 영상 수동/후보 연결 */
export function YoutubeLinkDialog({
  match,
  dayMatches,
  onClose,
  onChanged,
}: YoutubeLinkDialogProps) {
  const settings = useSettingsStore((s) => s.settings)
  const showToast = useToastStore((s) => s.show)
  const [url, setUrl] = useState(
    match.youtube_video_id ? youtubeWatchUrl(match.youtube_video_id) : '',
  )
  const [candidates, setCandidates] = useState<YoutubeMatchCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCandidates = async () => {
    setLoadingCandidates(true)
    setError(null)
    try {
      const list = await fetchSuggestionsForMatch(
        match,
        dayMatches,
        settings.youtube_channel_handle,
        settings.youtube_upload_delay_days,
      )
      setCandidates(list)
      if (list.length === 0) {
        setError(
          '이름 4명이 모두 제목에 포함된 후보가 없습니다. 링크를 직접 붙여넣거나, 업로드·핸들·허용 일수를 확인해주세요.',
        )
      }
    } catch (err) {
      setError(toErrorMessage(err))
      setCandidates([])
    } finally {
      setLoadingCandidates(false)
    }
  }

  useEffect(() => {
    void loadCandidates()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 다이얼로그 열릴 때 1회
  }, [])

  const finish = (message: string) => {
    showToast(message, 'success')
    onChanged()
    onClose()
  }

  const handleManual = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await linkMatchYoutubeByUrl(match.id, url)
      finish('유튜브 영상이 연결되었습니다.')
    } catch (err) {
      setError(toErrorMessage(err))
      setBusy(false)
    }
  }

  const handlePick = async (c: YoutubeMatchCandidate) => {
    setBusy(true)
    setError(null)
    try {
      await linkMatchYoutube(match.id, c.video.videoId, c.video.title)
      finish('유튜브 영상이 연결되었습니다.')
    } catch (err) {
      setError(toErrorMessage(err))
      setBusy(false)
    }
  }

  const handleUnlink = async () => {
    if (!window.confirm('이 경기의 유튜브 연결을 해제할까요?')) return
    setBusy(true)
    setError(null)
    try {
      await unlinkMatchYoutube(match.id)
      finish('유튜브 연결이 해제되었습니다.')
    } catch (err) {
      setError(toErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="유튜브 연결">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500">
          제목에 선수 이름 4명이 들어간 영상을 찾습니다. 날짜가 제목에 있으면 경기일과 같아야
          하고, 없으면 경기일~+{settings.youtube_upload_delay_days}일 업로드만 후보입니다.
        </p>

        {match.youtube_video_id && (
          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            연결됨:{' '}
            <a
              href={youtubeWatchUrl(match.youtube_video_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline"
            >
              {match.youtube_title ?? match.youtube_video_id}
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUnlink()}
              className="ml-2 text-red-600 underline disabled:opacity-50"
            >
              해제
            </button>
          </div>
        )}

        <form onSubmit={(e) => void handleManual(e)} className="flex flex-col gap-2">
          <label className="text-sm font-bold text-gray-700">
            링크 직접 입력
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="mt-1 h-11 w-full rounded-xl border border-gray-300 px-3 text-sm focus:border-green-600 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="h-11 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
          >
            이 링크로 연결
          </button>
        </form>

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-gray-700">채널 후보</p>
          <button
            type="button"
            disabled={loadingCandidates || busy}
            onClick={() => void loadCandidates()}
            className="text-sm text-green-700 underline disabled:opacity-50"
          >
            {loadingCandidates ? '불러오는 중…' : '다시 불러오기'}
          </button>
        </div>

        {candidates.length > 0 && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.video.videoId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePick(c)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-left active:bg-gray-50 disabled:opacity-50"
                >
                  <p className="line-clamp-2 text-sm font-semibold text-gray-800">{c.video.title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    업로드 {c.video.publishedDate} · {c.reason}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Dialog>
  )
}
