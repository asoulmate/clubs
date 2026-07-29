import { useState } from 'react'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import { downloadCsv } from '../../utils/csv'
import { toErrorMessage } from '../../utils/errors'
import { addDaysToDateString, todayKst } from '../../utils/kst'
import {
  buildAbsencesCsv,
  buildAllMatchesMetaCsv,
  buildBetsCsv,
  buildConfirmedMatchesCsv,
  buildMatchPlayersCsv,
  buildMembersCsv,
  fetchExportAbsences,
  fetchExportBets,
  fetchExportMatches,
} from '../../services/exportService'
import { Spinner } from '../common/Spinner'

type ExportKind =
  | 'confirmed_flat'
  | 'match_players'
  | 'matches_meta'
  | 'members'
  | 'absences'
  | 'bets'
  | 'all'

const DATASETS: { kind: Exclude<ExportKind, 'all'>; title: string; desc: string }[] = [
  {
    kind: 'confirmed_flat',
    title: '확정 경기 (분석용)',
    desc: '확정된 경기만 · 한 줄에 A/B팀 선수·점수·승패. AI 분석에 가장 적합',
  },
  {
    kind: 'match_players',
    title: '확정 경기 참가자',
    desc: '확정 경기 기준 참가자별 1행 (WIN/LOSS)',
  },
  {
    kind: 'matches_meta',
    title: '전체 경기 목록',
    desc: '기간 내 모든 상태(모집·취소 등) 메타데이터',
  },
  {
    kind: 'members',
    title: '클럽 멤버',
    desc: '가입 상태·역할·입상·게스트 여부 (기간 무관)',
  },
  {
    kind: 'absences',
    title: '무단 결석',
    desc: '기간 내 무단 결석 기록',
  },
  {
    kind: 'bets',
    title: '배팅',
    desc: '기간 내 경기에 걸린 배팅·정산 결과',
  },
]

/** 관리자 - AI/분석용 raw CSV 내보내기 */
export function ExportTab() {
  const club = useClubStore((s) => s.club)
  const showToast = useToastStore((s) => s.show)
  const today = todayKst()
  const [fromDate, setFromDate] = useState(() => addDaysToDateString(today, -365))
  const [toDate, setToDate] = useState(today)
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const slug = club?.slug ?? 'club'
  const stamp = today.replaceAll('-', '')

  const run = async (kind: ExportKind) => {
    if (!club?.id) {
      showToast('클럽 정보가 없습니다.', 'error')
      return
    }
    if (fromDate > toDate) {
      showToast('시작일이 종료일보다 늦을 수 없습니다.', 'error')
      return
    }

    setBusy(kind)
    try {
      const kinds: Exclude<ExportKind, 'all'>[] =
        kind === 'all' ? DATASETS.map((d) => d.kind) : [kind]

      let matchesCache: Awaited<ReturnType<typeof fetchExportMatches>> | null = null
      const needMatches = kinds.some((k) =>
        ['confirmed_flat', 'match_players', 'matches_meta'].includes(k),
      )
      if (needMatches) {
        matchesCache = await fetchExportMatches(club.id, fromDate, toDate)
      }

      for (const k of kinds) {
        const prefix = `${slug}_${fromDate}_${toDate}_${stamp}`
        if (k === 'confirmed_flat') {
          const rows = buildConfirmedMatchesCsv(matchesCache!)
          downloadCsv(`${prefix}_confirmed_matches.csv`, rows)
          if (rows.length === 0) showToast('확정된 경기가 없어 빈 CSV를 저장했습니다.', 'info')
        } else if (k === 'match_players') {
          downloadCsv(`${prefix}_match_players.csv`, buildMatchPlayersCsv(matchesCache!))
        } else if (k === 'matches_meta') {
          downloadCsv(`${prefix}_matches_all.csv`, buildAllMatchesMetaCsv(matchesCache!))
        } else if (k === 'members') {
          downloadCsv(`${slug}_members_${stamp}.csv`, await buildMembersCsv(club.id))
        } else if (k === 'absences') {
          const abs = await fetchExportAbsences(club.id, fromDate, toDate)
          downloadCsv(`${prefix}_absences.csv`, buildAbsencesCsv(abs))
        } else if (k === 'bets') {
          const bets = await fetchExportBets(club.id, fromDate, toDate)
          downloadCsv(`${prefix}_bets.csv`, buildBetsCsv(bets))
        }
        // 브라우저가 연속 다운로드를 막을 수 있어 짧게 대기
        if (kinds.length > 1) await new Promise((r) => setTimeout(r, 350))
      }

      showToast(
        kind === 'all' ? '분석용 CSV를 모두 저장했습니다.' : 'CSV를 저장했습니다.',
        'success',
      )
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const inputClass =
    'h-11 w-full rounded-xl border border-gray-300 px-3 text-base focus:border-green-600 focus:outline-none'

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold">내보내기 기간</h2>
        <p className="mt-1 text-xs text-gray-500">
          확정 경기·결석·배팅은 이 기간을 기준으로 합니다. 멤버 목록은 기간과 무관합니다.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">시작일</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">종료일</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('all')}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
        >
          {busy === 'all' ? <Spinner small /> : null}
          {busy === 'all' ? '내보내는 중…' : '분석용 CSV 일괄 다운로드'}
        </button>
      </section>

      <ul className="flex flex-col gap-2">
        {DATASETS.map((d) => (
          <li key={d.kind} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-gray-900">{d.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{d.desc}</p>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(d.kind)}
                className="h-10 shrink-0 rounded-xl border-2 border-green-700 px-3 text-sm font-bold text-green-800 active:bg-green-50 disabled:opacity-50"
              >
                {busy === d.kind ? '…' : 'CSV'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="px-1 text-xs leading-relaxed text-gray-400">
        UTF-8(BOM) CSV입니다. Excel에서 한글이 깨지면 데이터 가져오기로 UTF-8을 선택하세요.
        확정되지 않은 경기·취소 경기는 「확정 경기」파일에 포함되지 않습니다.
      </p>
    </div>
  )
}
