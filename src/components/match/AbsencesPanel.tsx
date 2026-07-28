import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  addUnexcusedAbsence,
  fetchAbsencesByDate,
  removeUnexcusedAbsence,
  type AbsenceRow,
} from '../../services/absenceService'
import { useAuthStore } from '../../stores/authStore'
import { useToastStore } from '../../stores/toastStore'
import type { Profile } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdminOrSub } from '../../utils/permissions'
import { PlayerNameButton } from '../players/PlayerNameButton'
import { PlayerSearchInput } from '../players/PlayerSearchInput'

interface AbsencesPanelProps {
  date: string
}

/**
 * 오늘의 경기 상단: 해당 날짜 무단 결석자 등록/표시
 * 강한 하이라이트(빨간 테두리·배경)로 눈에 띄게 표시
 */
export function AbsencesPanel({ date }: AbsencesPanelProps) {
  const profile = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const [absences, setAbsences] = useState<AbsenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setAbsences(await fetchAbsencesByDate(date))
    } catch {
      // 상단 패널 실패는 토스트로만 알림
      showToast('무단 결석 목록을 불러오지 못했습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }, [date, showToast])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Realtime: 같은 날짜 결석 변경 반영
  useEffect(() => {
    const channel = supabase
      .channel(`absences-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'unexcused_absences', filter: `absence_date=eq.${date}` },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [date, load])

  const handleAdd = async (selected: Profile) => {
    setBusy(true)
    try {
      await addUnexcusedAbsence(date, selected.id)
      showToast(`${selected.name} 님을 무단 결석으로 등록했습니다.`, 'success')
      setAdding(false)
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (row: AbsenceRow) => {
    if (!window.confirm(`${row.profile?.name ?? '해당 사용자'} 님의 무단 결석을 취소할까요?`)) return
    setBusy(true)
    try {
      await removeUnexcusedAbsence(date, row.user_id)
      showToast('무단 결석이 삭제되었습니다.', 'success')
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const canRemove = (row: AbsenceRow) =>
    isAdminOrSub(profile) || row.registered_by === profile?.id

  return (
    <section className="rounded-2xl border-2 border-red-500 bg-red-50 p-3 shadow-sm ring-2 ring-red-200">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-extrabold text-red-800">
          <span aria-hidden="true">⚠️</span>
          무단 결석
          {!loading && absences.length > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
              {absences.length}명
            </span>
          )}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding((v) => !v)}
          className="h-10 shrink-0 rounded-xl bg-red-600 px-3 text-sm font-bold text-white active:bg-red-700 disabled:opacity-50"
        >
          {adding ? '닫기' : '+ 결석 등록'}
        </button>
      </div>

      {loading ? (
        <p className="py-2 text-sm text-red-700/70">불러오는 중...</p>
      ) : absences.length === 0 ? (
        <p className="py-1 text-sm font-medium text-red-700/80">
          등록된 무단 결석자가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {absences.map((row) => (
            <li
              key={row.id}
              className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-red-300 bg-white px-3"
            >
              <div className="flex min-w-0 flex-1 items-center">
                <PlayerNameButton
                  userId={row.user_id}
                  name={row.profile?.name ?? '(알 수 없음)'}
                  awardLevel={row.profile?.award_level}
                  affiliation={row.profile?.is_guest ? row.profile?.affiliation : null}
                  affiliationClassName="text-[10px]"
                  className="min-h-0 items-start justify-center py-0 text-base font-extrabold text-red-800"
                />
              </div>
              {canRemove(row) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(row)}
                  className="h-9 shrink-0 rounded-lg px-2 text-sm font-bold text-red-600 underline active:bg-red-50"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 rounded-xl border border-red-300 bg-white p-3">
          <p className="mb-2 text-sm font-medium text-red-800">결석자 이름 검색</p>
          <PlayerSearchInput
            excludeIds={absences.map((a) => a.user_id)}
            autoFocus
            onSelect={(p) => void handleAdd(p)}
            placeholder="무단 결석자 검색"
          />
        </div>
      )}
    </section>
  )
}
