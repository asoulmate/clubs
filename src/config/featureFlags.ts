function enabled(value: string | boolean | undefined): boolean {
  return String(value ?? '').toLowerCase() === 'true'
}

/** All foundation features are opt-in. Missing environment values are OFF. */
export const featureFlags = Object.freeze({
  scopedAdminRpc: enabled(import.meta.env.VITE_FEATURE_SCOPED_ADMIN_RPC),
  identityClaims: enabled(import.meta.env.VITE_FEATURE_IDENTITY_CLAIMS),
  guestClaimCandidates: enabled(import.meta.env.VITE_FEATURE_GUEST_CLAIM_CANDIDATES),
  shadowRatingCalculation: enabled(import.meta.env.VITE_FEATURE_SHADOW_RATING_CALCULATION),
  shadowRatingAdmin: enabled(import.meta.env.VITE_FEATURE_SHADOW_RATING_ADMIN),
})
