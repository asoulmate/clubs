import { useCallback, useEffect, useState } from 'react'
import { Dialog } from '../common/Dialog'
import { Spinner } from '../common/Spinner'
import {
  TOURNAMENT_PLACEMENT_LABELS,
  TOURNAMENT_PLACEMENT_OPTIONS,
} from '../../constants/labels'
import {
  createTournamentEntry,
  deleteTournamentEntry,
  fetchTournamentEntriesForUser,
  formatTournamentMonth,
  monthInputValue,
  updateTournamentEntry,
} from '../../services/tournamentService'
import { useAuthStore } from '../../stores/authStore'
import { useToastStore } from '../../stores/toastStore'
import type { TournamentEntry, TournamentPlacement } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { isAdminOrSub } from '../../utils/permissions'
import { todayKst } from '../../utils/kst'

const PLACEMENT_STYLE: Record<TournamentPlacement, string> = {
  champion: 'bg-amber-100 text-amber-900',
  runner_up: 'bg-slate-100 text-slate-800',
  third: 'bg-orange-50 text-orange-800',
  none: 'bg-gray-100 text-gray-600',
}

interface FormState {
  tournamentMonth: string
  tournamentName: string
  placement: TournamentPlacement
  maxParticipants: string
  notes: string
}

function emptyForm(): FormState {
  return {
    tournamentMonth: todayKst().slice(0, 7),
    tournamentName: '',
    placement: 'none',
    maxParticipants: '',
    notes: '',
  }
}

function formFromEntry(entry: TournamentEntry): FormState {
  return {
    tournamentMonth: monthInputValue(entry.tournament_month),
    tournamentName: entry.tournament_name,
    placement: entry.placement,
    maxParticipants: entry.max_participants != null ? String(entry.max_participants) : '',
    notes: entry.notes ?? '',
  }
}

interface TournamentEntriesSectionProps {
  clubId: string
  userId: string
}

/** 내 기록 · 회원 상세: 대회 참가 현황 입력·목록 */
export function TournamentEntriesSection({ clubId, userId }: TournamentEntriesSectionProps) {
  const me = useAuthStore((s) => s.profile)
  const showToast = useToastStore((s) => s.show)
  const canEdit = Boolean(me && (me.id === userId || isAdminOrSub(me)))

  const [entries, setEntries] = useState<TournamentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TournamentEntry | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchTournamentEntriesForUser(clubId, userId)
      setEntries(rows)
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [clubId, userId, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  const openEdit = (entry: TournamentEntry) => {
    setEditing(entry)
    setForm(formFromEntry(entry))
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!me) return
    const name = form.tournamentName.trim()
    if (!name) {
      showToast('대회명을 입력해주세요.', 'error')
      return
    }
    if (!form.tournamentMonth) {
      showToast('대회일을 선택해주세요.', 'error')
      return
    }

    let maxParticipants: number | null = null
    if (form.maxParticipants.trim()) {
      const n = Number(form.maxParticipants)
      if (!Number.isInteger(n) || n < 1) {
        showToast('최대 참가 인원은 1 이상의 정수로 입력해주세요.', 'error')
        return
      }
      maxParticipants = n
    }

    setSaving(true)
    try {
      const input = {
        tournamentMonth: form.tournamentMonth,
        tournamentName: name,
        placement: form.placement,
        maxParticipants,
        notes: form.notes.trim() || null,
      }
      if (editing) {
        await updateTournamentEntry(editing.id, input)
        showToast('대회 참가 기록을 수정했습니다.', 'success')
      } else {
        await createTournamentEntry(clubId, userId, input, me.id)
        showToast('대회 참가 기록을 추가했습니다.', 'success')
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entry: TournamentEntry) => {
    if (!window.confirm(`「${entry.tournament_name}」 기록을 삭제할까요?`)) return
    try {
      await deleteTournamentEntry(entry.id)
      showToast('삭제했습니다.', 'success')
      await load()
    } catch (err) {
      showToast(toErrorMessage(err), 'error')
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">대회 참가 현황</h2>
        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="h-9 rounded-lg bg-green-700 px-3 text-sm font-bold text-white"
          >
            + 추가
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        대회일(연·월), 대회명, 입상 결과, 대회 규모(선택), 비고를 기록합니다.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
          등록된 대회 참가 기록이 없습니다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-start justify-between gap-3 border-b border-gray-50 px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{e.tournament_name}</p>
                <p className="text-xs text-gray-500">
                  {formatTournamentMonth(e.tournament_month)}
                  {e.max_participants != null ? ` · 최대 ${e.max_participants}명` : ''}
                </p>
                {e.notes ? <p className="mt-1 text-xs text-gray-400">{e.notes}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${PLACEMENT_STYLE[e.placement]}`}
                >
                  {TOURNAMENT_PLACEMENT_LABELS[e.placement]}
                </span>
                {canEdit && (
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="font-semibold text-green-700"
                      onClick={() => openEdit(e)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="font-semibold text-red-600"
                      onClick={() => void handleDelete(e)}
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        title={editing ? '대회 참가 수정' : '대회 참가 추가'}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">대회일 (연-월)</span>
            <input
              type="month"
              value={form.tournamentMonth}
              onChange={(ev) => setForm((f) => ({ ...f, tournamentMonth: ev.target.value }))}
              className="h-11 rounded-xl border border-gray-200 px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">대회명</span>
            <input
              type="text"
              value={form.tournamentName}
              maxLength={120}
              onChange={(ev) => setForm((f) => ({ ...f, tournamentName: ev.target.value }))}
              placeholder="예: ○○시 신인부 대회"
              className="h-11 rounded-xl border border-gray-200 px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">입상 유형</span>
            <select
              value={form.placement}
              onChange={(ev) =>
                setForm((f) => ({
                  ...f,
                  placement: ev.target.value as TournamentPlacement,
                }))
              }
              className="h-11 rounded-xl border border-gray-200 px-3 text-sm"
            >
              {TOURNAMENT_PLACEMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">
              최대 참가 인원 <span className="font-normal text-gray-400">(선택)</span>
            </span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.maxParticipants}
              onChange={(ev) => setForm((f) => ({ ...f, maxParticipants: ev.target.value }))}
              placeholder="예: 32"
              className="h-11 rounded-xl border border-gray-200 px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-600">
              비고 <span className="font-normal text-gray-400">(선택)</span>
            </span>
            <textarea
              value={form.notes}
              maxLength={500}
              rows={3}
              onChange={(ev) => setForm((f) => ({ ...f, notes: ev.target.value }))}
              placeholder="종목, 비고 등"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="mt-1 h-12 w-full rounded-xl bg-green-700 font-bold text-white disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </Dialog>
    </section>
  )
}
