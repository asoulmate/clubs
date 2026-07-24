import { useState } from 'react'
import { DateNavigator } from '../components/common/DateNavigator'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { CreateMatchDialog } from '../components/match/CreateMatchDialog'
import { MatchCard } from '../components/match/MatchCard'
import { useMatchesByDate } from '../hooks/useMatchesByDate'
import { todayKst } from '../utils/kst'

/**
 * 오늘의 경기 페이지 (메인)
 *  - 기본 날짜: 한국 시간 기준 오늘
 *  - Realtime으로 경기 생성/참가자/스코어 변경이 실시간 반영됨
 */
export function MatchesPage() {
  const [date, setDate] = useState(() => todayKst())
  const { matches, loading, error, refresh } = useMatchesByDate(date)
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <DateNavigator date={date} onChange={setDate} />

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
            <MatchCard key={match.id} match={match} index={i + 1} onChanged={() => void refresh()} />
          ))}
        </div>
      )}

      {/* 신규 경기 생성 버튼 (모바일 하단 내비게이션 위에 고정) */}
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
