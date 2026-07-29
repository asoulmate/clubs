import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useClubStore } from '../../stores/clubStore'
import { useToastStore } from '../../stores/toastStore'
import { downloadCsv } from '../../utils/csv'
import { toErrorMessage } from '../../utils/errors'
import { todayKst } from '../../utils/kst'
import { isAdminOrSub } from '../../utils/permissions'
import {
  buildMatchesCsv,
  buildMembersCsv,
  fetchEarliestMatchDate,
  fetchExportAbsences,
  fetchExportBets,
  fetchExportMatches,
} from '../../services/exportService'
import { Spinner } from '../common/Spinner'

type ExportKind = 'matches' | 'members' | 'all'

const DATASETS: { kind: Exclude<ExportKind, 'all'>; title: string; desc: string }[] = [
  {
    kind: 'matches',
    title: '경기 통합',
    desc: '한 줄=한 경기. 상태·선수·점수·승패·배팅 요약(건수·금액·상세). 확정만 쓰려면 status=confirmed 필터',
  },
  {
    kind: 'members',
    title: '멤버 통합',
    desc: '한 줄=한 멤버. 역할·입상·게스트 + 기간 내 무단결석 횟수·날짜',
  },
]

/** 관리자·서브 관리자 - AI/분석용 raw CSV 내보내기 */
export function ExportTab() {
  const club = useClubStore((s) => s.club)
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const today = todayKst()
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [rangeReady, setRangeReady] = useState(false)
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const canExport = isAdminOrSub(profile)
  const slug = club?.slug ?? 'club'
  const stamp = today.replaceAll('-', '')

  useEffect(() => {
    if (!club?.id) {
      setFromDate(today)
      setToDate(today)
      setRangeReady(true)
      return
    }
    let stale = false
    setRangeReady(false)
    void fetchEarliestMatchDate(club.id)
      .then((earliest) => {
        if (stale) return
        setFromDate(earliest && earliest <= today ? earliest : today)
        setToDate(today)
      })
      .catch((err) => {
        if (stale) return
        showToast(toErrorMessage(err), 'error')
        setFromDate(today)
        setToDate(today)
      })
      .finally(() => {
        if (!stale) setRangeReady(true)
      })
    return () => {
      stale = true
    }
  }, [club?.id, showToast, today])

  const run = async (kind: ExportKind) => {
    if (!canExport) {
      showToast('데이터 내보내기는 관리자 또는 서브 관리자만 가능합니다.', 'error')
      return
    }
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
      const prefix = `${slug}_${fromDate}_${toDate}_${stamp}`

      let matchesCache: Awaited<ReturnType<typeof fetchExportMatches>> | null = null
      let betsCache: Awaited<ReturnType<typeof fetchExportBets>> | null = null
      let absCache: Awaited<ReturnType<typeof fetchExportAbsences>> | null = null

      if (kinds.includes('matches')) {
        ;[matchesCache, betsCache] = await Promise.all([
          fetchExportMatches(club.id, fromDate, toDate),
          fetchExportBets(club.id, fromDate, toDate),
        ])
      }
      if (kinds.includes('members')) {
        absCache = await fetchExportAbsences(club.id, fromDate, toDate)
      }

      for (const k of kinds) {
        if (k === 'matches') {
          const rows = buildMatchesCsv(matchesCache!, betsCache ?? [])
          downloadCsv(`${prefix}_matches.csv`, rows)
          if (rows.length === 0) showToast('기간 내 경기가 없어 빈 CSV를 저장했습니다.', 'info')
        } else if (k === 'members') {
          downloadCsv(
            `${prefix}_members.csv`,
            await buildMembersCsv(club.id, absCache ?? []),
          )
        }
        if (kinds.length > 1) await new Promise((r) => setTimeout(r, 350))
      }

      showToast(
        kind === 'all' ? '경기·멤버 CSV 2개를 저장했습니다.' : 'CSV를 저장했습니다.',
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

  if (!canExport) {
    return (
      <p className="rounded-2xl bg-white py-10 text-center text-gray-500 shadow-sm">
        데이터 내보내기는 관리자 또는 서브 관리자만 이용할 수 있습니다.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold">내보내기 기간</h2>
        <p className="mt-1 text-xs text-gray-500">
          기본값은 클럽 첫 경기일~오늘입니다. 경기·결석·배팅 요약은 이 기간 기준입니다.
        </p>
        {!rangeReady ? (
          <div className="flex justify-center py-6">
            <Spinner small />
          </div>
        ) : (
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
        )}
        <button
          type="button"
          disabled={busy !== null || !rangeReady}
          onClick={() => void run('all')}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
        >
          {busy === 'all' ? <Spinner small /> : null}
          {busy === 'all' ? '내보내는 중…' : '분석용 CSV 2개 일괄 다운로드'}
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
                disabled={busy !== null || !rangeReady}
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
        UTF-8(BOM) CSV · 서브 관리자 이상. 배팅 상세는 경기 파일의 bet_detail 컬럼(이름:팀:금액:결과,
        | 구분)에 합쳐져 있습니다.
      </p>
    </div>
  )
}
