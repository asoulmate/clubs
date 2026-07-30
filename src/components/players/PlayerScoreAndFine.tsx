import type { MatchFineRecord } from '../../types/domain'
import type { ScoredPlayer } from '../../utils/drawScore'
import { formatDateKorean, todayKst } from '../../utils/kst'

function signed(value: number, digits = 1): string {
  const text = value.toFixed(digits)
  return value > 0 ? `+${text}` : text
}

/** 내 기록: 편성에 사용하는 개인 스코어와 계산 근거 */
export function PlayerScoreSection({ scored }: { scored: ScoredPlayer }) {
  const inner = 8 * scored.winFactor + 4 * scored.pointFactor + 3 * scored.form

  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">개인 스코어</h2>
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">추첨 편성 기준 점수</p>
            <p className="text-xs text-gray-400">클럽 확정 경기 전체 + 최근 5경기 반영</p>
          </div>
          <p className="text-3xl font-extrabold tabular-nums text-green-800">
            {scored.score.toFixed(1)}
          </p>
        </div>

        <details className="mt-3 border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-sm font-bold text-green-800">
            산출근거·계산식 보기
          </summary>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p className="rounded-xl bg-green-50 px-3 py-2 font-semibold text-green-900">
              S = 입상 기본점수 + r × (8W + 4G + 3F)
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">입상 기본</p>
                <p className="font-bold tabular-nums">{scored.awardBase}점</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">신뢰도 r</p>
                <p className="font-bold tabular-nums">
                  {scored.reliability.toFixed(3)}
                </p>
                <p className="text-gray-400">{scored.matchesPlayed}경기 기준</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">승률 지수 W</p>
                <p className="font-bold tabular-nums">{signed(scored.winFactor, 3)}</p>
                <p className="text-gray-400">
                  보정 승률 {(scored.adjustedWinRate * 100).toFixed(1)}%
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">득실 지수 G</p>
                <p className="font-bold tabular-nums">{signed(scored.pointFactor, 3)}</p>
                <p className="text-gray-400">
                  경기당 {signed(scored.pointDiffPerMatch, 2)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">최근 폼 F</p>
                <p className="font-bold tabular-nums">{signed(scored.form, 3)}</p>
                <p className="text-gray-400">최근 {scored.recentFormMatches}경기</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">성적 보정</p>
                <p className="font-bold tabular-nums">
                  {signed(scored.performanceAdjustment)}점
                </p>
              </div>
            </div>

            <p className="text-xs leading-5 text-gray-500">
              현재 계산(표시값 기준): {scored.awardBase} + {scored.reliability.toFixed(3)} × (
              {inner.toFixed(3)}) ≈ <strong>{scored.score.toFixed(1)}</strong>
              <br />
              W는 소수 경기 과대평가를 막도록 보정한 승률, G는 경기당 득실, F는 최근
              5경기 폼입니다. 경기 수가 적으면 r이 작아 성적 반영폭이 줄어듭니다.
            </p>
          </div>
        </details>
      </div>
    </section>
  )
}

/** 내 기록: 개인 벌금 누적과 최근 부과 내역 */
export function PlayerFineSection({ records }: { records: MatchFineRecord[] }) {
  const total = records.reduce((sum, row) => sum + Number(row.amount), 0)
  const currentMonth = todayKst().slice(0, 7)
  const monthTotal = records
    .filter((row) => row.match_date.startsWith(currentMonth))
    .reduce((sum, row) => sum + Number(row.amount), 0)

  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">벌금 기록</h2>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums text-red-700">
            {total.toLocaleString('ko-KR')}원
          </p>
          <p className="text-xs text-gray-500">전체 누적</p>
        </div>
        <div className="rounded-xl bg-white py-3 text-center shadow-sm">
          <p className="text-lg font-extrabold tabular-nums text-red-700">
            {monthTotal.toLocaleString('ko-KR')}원
          </p>
          <p className="text-xs text-gray-500">이번 달</p>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
          부과된 벌금이 없습니다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {records.map((row) => (
            <div
              key={`${row.match_id}-${row.user_id}`}
              className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-3 last:border-b-0"
            >
              <div>
                <p className="text-sm font-semibold">
                  {formatDateKorean(row.match_date)} · {row.fine_reason}
                </p>
                <p className="text-xs text-gray-400">
                  경기 결과 {row.team_a_score}:{row.team_b_score}
                </p>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-red-700">
                {Number(row.amount).toLocaleString('ko-KR')}원
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

