import { supabase } from '../lib/supabase'
import type { IdentityClaimRow } from '../types/domain'

export async function listPendingIdentityClaims(): Promise<IdentityClaimRow[]> {
  const { data, error } = await supabase.rpc('list_pending_identity_claims_v2')
  if (error) throw error
  return (data ?? []) as IdentityClaimRow[]
}

export async function reviewIdentityClaim(
  claimId: string,
  approve: boolean,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('review_identity_claim_v2', {
    p_claim_id: claimId,
    p_approve: approve,
    p_reason: reason,
  })
  if (error) throw error
}
