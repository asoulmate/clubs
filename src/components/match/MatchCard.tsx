import { useState } from 'react'
import {
  cancelMatch,
  confirmScore,
  deleteMatch,
  removePlayer,
  startMatch,
} from '../../services/matchService'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import type {
  MatchPlayer,
  MatchStatus,
  MatchWithPlayers,
  PlayerPosition,
  TeamSide,
} from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import {
  canCancelMatch,
  canConfirmScore,
  canDeleteMatch,
  canRemovePlayer,
  canSubmitScore,
  isAdminOrSub,
  isParticipant,
} from '../../utils/permissions'
import { winnerTeam } from '../../utils/score'
import { youtubeWatchUrl } from '../../services/youtubeService'
import { PlayerNameButton } from '../players/PlayerNameButton'
import { RegisterSlotDialog } from './RegisterSlotDialog'
import { ScoreDialog } from './ScoreDialog'
import { StatusBadge } from './StatusBadge'
import { YoutubeLinkDialog } from './YoutubeLinkDialog'

interface MatchCardProps {
  match: MatchWithPlayers
  /** 화면 표시용 경기 번호 (1부터) */
  index: number
  /** 같은 날짜 경기 목록 (유튜브 후보에서 이미 연결된 영상 제외) */
  dayMatches?: MatchWithPlayers[]
  onChanged: () => void
}

const TEAM_POSITIONS: Record<TeamSide, PlayerPosition[]> = {
  A: ['A1', 'A2'],
  B: ['B1', 'B2'],
}

// 상태별 카드 테두리 + 부드러운 배경색 (색상만으로 구분하지 않고 배지 텍스트·아이콘과 함께 사용)
const STATUS_CARD_STYLES: Record<MatchStatus, string> = {
  // 편성 완료: 배경 없이 테두리만 — 다음 액션(경기 시작)이 필요하다는 느낌
  open: 'border-gray-200 bg-white',
  ready: 'border-indigo-400 bg-white',
  in_progress: 'border-amber-300 bg-amber-50/80',
  submitted: 'border-orange-300 bg-orange-50/70',
  confirmed: 'border-emerald-300 bg-emerald-50/70',
  canceled: 'border-gray-200 bg-gray-100/80 opacity-70',
}

/**
 * 경기 카드 (모바일에서 많은 경기를 한 화면에 보기 위한 압축 레이아웃)
 *  [A팀 이름 2줄(가운데)] [A점수] : [B점수] [B팀 이름 2줄(가운데)]
 */
export function MatchCard({ match, index, dayMatches, onChanged }: MatchCardProps) {
  const profile = useAuthStore((s) => s.profile)
  const youtubeEnabled = useClubStore((s) => s.club?.youtube_enabled ?? false)
  const showToast = useToastStore((s) => s.show)
  const [registerPosition, setRegisterPosition] = useState<PlayerPosition | null>(null)
  const [scoreOpen, setScoreOpen] = useState(false)
  const [youtubeOpen, setYoutubeOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const playerAt = (position: PlayerPosition): MatchPlayer | undefined =>
    match.players.find((p) => p.position === position)

  const winner =
    match.team_a_score !== null && match.team_b_score !== null
      ? winnerTeam(match.team_a_score, match.team_b_score)
      : null

  const isCanceled = match.status === 'canceled'

  /** 공통 액션 실행 래퍼 (오류 시 한글 토스트) */
  const run = async (action: () => Promise<void>, successMessage?: string) => {
    setBusy(true)
    try {
      await action()
      if (successMessage) showToast(successMessage, 'success')
      onChanged()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = (position: PlayerPosition) => {
    const isConfirmed = match.status === 'confirmed'
    const message = isConfirmed
      ? '확정된 경기에서 이 참가자를 제외할까요?\n제외 후 빈 자리에 다른 선수를 등록할 수 있습니다.'
      : '이 참가자를 자리에서 제외할까요?'
    if (!window.confirm(message)) return
    void run(() => removePlayer(match.id, position), '참가자가 제외되었습니다.')
  }

  const handleCancel = () => {
    if (!window.confirm('이 경기를 취소할까요? 취소된 경기는 집계에 포함되지 않습니다.')) return
    void run(() => cancelMatch(match.id), '경기가 취소되었습니다.')
  }

  const handleDelete = () => {
    if (!window.confirm('이 경기를 완전히 삭제할까요? 참가자와 스코어 기록이 모두 사라지며 되돌릴 수 없습니다.'))
      return
    void run(() => deleteMatch(match.id), '경기가 삭제되었습니다.')
  }

  /** 슬롯 1칸 렌더링 (이름 가운데 정렬, 제외 버튼은 오른쪽에 겹침) */
  const renderSlot = (position: PlayerPosition) => {
    const player = playerAt(position)
    const canFillEmpty =
      !isCanceled &&
      (match.status === 'open' || match.status === 'ready' || isAdminOrSub(profile))

    if (!player) {
      return (
        <button
          key={position}
          type="button"
          disabled={!canFillEmpty || busy}
          onClick={() => setRegisterPosition(position)}
          className="flex min-h-11 w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 px-1 text-sm font-medium text-gray-400 active:bg-gray-50 disabled:opacity-40"
        >
          + 빈 자리
        </button>
      )
    }

    const removable =
      !isCanceled &&
      profile !== null &&
      canRemovePlayer(profile, match, player.user_id, player.registered_by)

    return (
      <div key={position} className="relative flex min-h-11 w-full items-center justify-center rounded-xl bg-white/70">
        <PlayerNameButton
          userId={player.user_id}
          name={player.profile?.name ?? '(알 수 없음)'}
          awardLevel={player.profile?.award_level}
          affiliation={player.profile?.is_guest ? player.profile?.affiliation : null}
          className="w-full items-center justify-center text-center no-underline"
        />
        {player.profile?.is_guest && (
          <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">
            G
          </span>
        )}
        {removable && (
          <button
            type="button"
            onClick={() => handleRemove(position)}
            aria-label={`${player.profile?.name ?? ''} 제외`}
            className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 active:bg-gray-200"
          >
            ×
          </button>
        )}
      </div>
    )
  }

  /** 팀 점수 표시 (A팀은 이름 오른쪽, B팀은 이름 왼쪽에 배치됨) */
  const renderScore = (team: TeamSide) => {
    const score = team === 'A' ? match.team_a_score : match.team_b_score
    const isWinner = winner === team
    const isLoser = winner !== null && winner !== team
    return (
      <div className="flex flex-col items-center">
        <span
          className={`text-4xl font-extrabold tabular-nums ${
            score === null
              ? 'text-gray-300'
              : isWinner
                ? 'text-green-700'
                : isLoser
                  ? 'text-gray-500'
                  : 'text-gray-800'
          }`}
        >
          {score ?? '-'}
        </span>
        {isWinner && (
          <span className="text-xs font-bold text-green-700" aria-label="승리">
            🏆 승
          </span>
        )}
        {isLoser && (
          <span className="text-xs font-bold text-gray-500" aria-label="패배">
            패
          </span>
        )}
      </div>
    )
  }

  return (
    <article
      className={`rounded-2xl border-2 p-3 shadow-sm ${STATUS_CARD_STYLES[match.status]}`}
    >
      {/* 헤더: 경기 번호 + 상태 + 삭제/취소 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-700">#{index}</span>
          <StatusBadge status={match.status} />
        </div>
        <div className="flex items-center gap-1">
          {profile && canCancelMatch(profile, match) && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="min-h-9 rounded-lg px-2 text-sm text-gray-400 underline active:text-red-600"
            >
              취소
            </button>
          )}
          {profile && canDeleteMatch(profile, match) && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="min-h-9 rounded-lg px-2 text-sm text-red-400 underline active:text-red-600"
            >
              삭제
            </button>
          )}
        </div>
      </div>

      {/* 팀 편성 + 점수: A팀 이름 | A점수 : B점수 | B팀 이름 */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-x-2">
        <div className="flex flex-col gap-1.5">
          <p className="text-center text-xs font-bold text-gray-500">A팀</p>
          {TEAM_POSITIONS.A.map(renderSlot)}
        </div>

        {renderScore('A')}
        <span className="text-xl font-bold text-gray-300">:</span>
        {renderScore('B')}

        <div className="flex flex-col gap-1.5">
          <p className="text-center text-xs font-bold text-gray-500">B팀</p>
          {TEAM_POSITIONS.B.map(renderSlot)}
        </div>
      </div>

      {/* 액션 버튼 */}
      {!isCanceled && profile && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {match.status === 'ready' && isParticipant(profile.id, match) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => startMatch(match.id))}
              className="h-11 flex-1 rounded-xl border-2 border-green-700 font-bold text-green-700 active:bg-green-50 disabled:opacity-50"
            >
              경기 시작
            </button>
          )}

          {canSubmitScore(profile, match) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setScoreOpen(true)}
              className="h-11 flex-1 rounded-xl bg-green-700 font-bold text-white active:bg-green-800 disabled:opacity-50"
            >
              {match.status === 'submitted' ? '스코어 수정' : '스코어 입력'}
            </button>
          )}

          {canConfirmScore(profile, match) && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => confirmScore(match.id, match.version), '스코어가 확정되었습니다.')
              }
              className="h-11 flex-1 rounded-xl bg-orange-500 font-bold text-white active:bg-orange-600 disabled:opacity-50"
            >
              최종 확인
            </button>
          )}
        </div>
      )}

      {/* 확정 대기 안내 */}
      {match.status === 'submitted' && !canConfirmScore(profile, match) && (
        <p className="mt-2 text-center text-sm text-orange-600">
          상대 팀 참가자의 최종 확인을 기다리고 있습니다.
        </p>
      )}

      {/* 유튜브 */}
      {!isCanceled && youtubeEnabled && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {match.youtube_video_id ? (
            <a
              href={youtubeWatchUrl(match.youtube_video_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-red-600 px-3 text-sm font-bold text-white active:bg-red-700"
            >
              ▶ 영상 보기
            </a>
          ) : (
            <span className="text-xs text-gray-400">영상 미연결</span>
          )}
          {profile && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setYoutubeOpen(true)}
              className="h-10 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700 active:bg-gray-50 disabled:opacity-50"
            >
              {match.youtube_video_id ? '유튜브 변경' : '유튜브 연결'}
            </button>
          )}
        </div>
      )}

      {/* 다이얼로그 */}
      {registerPosition && (
        <RegisterSlotDialog
          match={match}
          position={registerPosition}
          onClose={() => setRegisterPosition(null)}
          onChanged={onChanged}
        />
      )}
      {scoreOpen && (
        <ScoreDialog match={match} onClose={() => setScoreOpen(false)} onChanged={onChanged} />
      )}
      {youtubeOpen && (
        <YoutubeLinkDialog
          match={match}
          dayMatches={dayMatches ?? [match]}
          onClose={() => setYoutubeOpen(false)}
          onChanged={onChanged}
        />
      )}
    </article>
  )
}
