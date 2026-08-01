import { useCallback, useEffect, useState } from 'react'
import { listPendingIdentityClaims, reviewIdentityClaim } from '../../services/identityService'
import { useToastStore } from '../../stores/toastStore'
import type { IdentityClaimRow } from '../../types/domain'
import { toErrorMessage } from '../../utils/errors'
import { Spinner } from '../common/Spinner'

export function IdentityClaimsTab() {
  const showToast = useToastStore((s) => s.show)
  const [rows, setRows] = useState<IdentityClaimRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setRows(await listPendingIdentityClaims()) }
    catch (error) { showToast(toErrorMessage(error), 'error') }
    finally { setLoading(false) }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  const review = async (row: IdentityClaimRow, approve: boolean) => {
    const reason = window.prompt(approve ? '병합 승인 사유를 입력하세요.' : '거절 사유를 입력하세요.')?.trim()
    if (!reason) return
    try {
      await reviewIdentityClaim(row.claim_id, approve, reason)
      showToast(approve ? 'Identity claim을 승인했습니다.' : 'Identity claim을 거절했습니다.', 'success')
      await load()
    } catch (error) { showToast(toErrorMessage(error), 'error') }
  }

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">동명 정보는 참고 근거일 뿐 자동 병합되지 않습니다.</p>
      {rows.map((row) => (
        <div key={row.claim_id} className="rounded-xl bg-white p-4 shadow-sm">
          <p className="font-bold">{row.claim_type}</p>
          <p className="mt-1 break-all font-mono text-xs text-gray-500">{row.source_global_player_id} → {row.target_global_player_id}</p>
          <p className="mt-1 text-xs text-gray-500">{new Date(row.requested_at).toLocaleString('ko-KR')}</p>
          <pre className="mt-2 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(row.evidence, null, 2)}</pre>
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
