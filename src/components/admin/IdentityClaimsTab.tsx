import { useCallback, useEffect, useState } from 'react'
import {
  listPendingIdentityClaims,
  refreshGuestIdentityClaimCandidates,
  reviewIdentityClaim,
} from '../../services/identityService'
import { useToastStore } from '../../stores/toastStore'
import type { IdentityClaimRow } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { Spinner } from '../common/Spinner'

export function IdentityClaimsTab() {
  const showToast = useToastStore((s) => s.show)
  const [rows, setRows] = useState<IdentityClaimRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try { setRows(await listPendingIdentityClaims()) }
    catch (error) { showToast(toErrorMessage(error), 'error') }
    finally { setLoading(false) }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  const refreshCandidates = async () => {
    setRefreshing(true)
    try {
      const created = await refreshGuestIdentityClaimCandidates()
      showToast(`동일인 검수 후보 ${created}건을 새로 생성했습니다.`, 'success')
      await load()
    } catch (error) {
      showToast(toErrorMessage(error), 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const review = async (row: IdentityClaimRow, approve: boolean) => {
    if (
      approve &&
      !window.confirm('두 profile을 같은 글로벌 선수로 연결할까요? 기존 경기 기록은 유지됩니다.')
    ) return
    const reason = window.prompt(approve ? '병합 승인 사유를 입력하세요.' : '거절 사유를 입력하세요.')?.trim()
    if (!reason) return
    try {
      await reviewIdentityClaim(row.claim_id, approve, reason)
      showToast(
        approve
          ? '동일인 연결을 승인했습니다. 다음 레이팅 실행부터 통합 반영됩니다.'
          : '동일인 후보를 거절했습니다.',
        'success',
      )
      await load()
    } catch (error) { showToast(toErrorMessage(error), 'error') }
  }

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">동명 정보는 참고 근거일 뿐 자동 병합되지 않습니다.</p>
      <button
        type="button"
        disabled={refreshing}
        onClick={() => void refreshCandidates()}
        className="h-11 rounded-xl bg-green-700 px-4 font-bold text-white disabled:opacity-50"
      >
        {refreshing ? '후보 확인 중…' : '게스트 동일인 후보 새로 찾기'}
      </button>
      {rows.map((row) => (
        <div key={row.claim_id} className="rounded-xl bg-white p-4 shadow-sm">
          <p className="font-bold">게스트 동일인 검수</p>
          {(['source', 'target'] as const).map((side) => {
            const value = row.evidence[side]
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null
            const profile = value as Record<string, unknown>
            const clubs = Array.isArray(profile.clubs)
              ? profile.clubs
                  .map((club) =>
                    club && typeof club === 'object' && 'name' in club
                      ? String((club as { name: unknown }).name)
                      : '',
                  )
                  .filter(Boolean)
                  .join(', ')
              : ''
            return (
              <div key={side} className="mt-2 rounded-lg bg-gray-50 p-3 text-sm">
                <p className="font-bold">
                  {side === 'source' ? '연결할 게스트' : '기준 선수'}: {String(profile.name ?? '-')}
                </p>
                <p className="text-gray-600">
                  입상: {String(profile.award_level ?? '-')} · 소속: {String(profile.affiliation ?? '-')} · 출생연도: {String(profile.birth_year ?? '미입력')}
                </p>
                <p className="text-gray-600">
                  클럽: {clubs || '-'} · 확정 경기: {String(profile.confirmed_matches ?? 0)}
                </p>
              </div>
            )
          })}
          <p className="mt-1 break-all font-mono text-xs text-gray-500">{row.source_global_player_id} → {row.target_global_player_id}</p>
          <p className="mt-1 text-xs text-gray-500">{new Date(row.requested_at).toLocaleString('ko-KR')}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void review(row, true)} className="h-10 rounded-lg bg-green-700 px-4 font-bold text-white">승인</button>
            <button type="button" onClick={() => void review(row, false)} className="h-10 rounded-lg bg-red-50 px-4 font-bold text-red-700">거절</button>
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="py-10 text-center text-gray-500">대기 중인 claim이 없습니다.</p>}
    </div>
  )
}
