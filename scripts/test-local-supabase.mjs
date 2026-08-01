import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

assert(url, 'SUPABASE_URL is required')
assert(anonKey, 'SUPABASE_ANON_KEY is required')
assert(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required')
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):54321$/, 'tests must target local Supabase')

const clientOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
}
const service = createClient(url, serviceRoleKey, clientOptions)

function userClient() {
  return createClient(url, anonKey, clientOptions)
}

function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function expectFailure(operation, label) {
  const result = await operation()
  assert(result.error, `${label}: expected failure`)
  return result.error
}

async function createConfirmedUser(email, name, password = 'LocalPass123!') {
  const result = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, award_level: 'none', club_slug: 'morning-star' },
  })
  const user = must(result, `create ${email}`).user
  assert(user?.id, `create ${email}: missing id`)
  return { id: user.id, email, password, name }
}

async function signIn(account) {
  const client = userClient()
  const data = must(
    await client.auth.signInWithPassword({ email: account.email, password: account.password }),
    `sign in ${account.email}`,
  )
  assert.equal(data.user.id, account.id)
  return client
}

async function setMembership(clubId, userId, role = 'user', status = 'active') {
  must(
    await service.from('club_members').upsert(
      { club_id: clubId, user_id: userId, role, status },
      { onConflict: 'club_id,user_id' },
    ),
    `set membership ${userId}`,
  )
}

const clubA = must(
  await service.from('clubs').select('id,name,slug').eq('slug', 'morning-star').single(),
  'load club A',
)
const clubB = must(
  await service
    .from('clubs')
    .insert({ name: 'Local Test Club B', slug: 'local-test-b' })
    .select('id,name,slug')
    .single(),
  'create club B',
)

const signupEmail = 'local-signup@example.test'
const signupPassword = 'LocalPass123!'
const signupClient = userClient()
const signupData = must(
  await signupClient.auth.signUp({
    email: signupEmail,
    password: signupPassword,
    options: {
      data: { name: 'Signup Player', award_level: 'none', club_slug: 'morning-star' },
    },
  }),
  'public signup',
)
assert(signupData.user?.id, 'public signup did not create a user')
const userA1 = {
  id: signupData.user.id,
  email: signupEmail,
  password: signupPassword,
  name: 'Signup Player',
}
must(await signupClient.auth.signOut(), 'sign out signup user')

const [adminA, userA2, userA3, adminB, userB, platformAdmin, twin1, twin2, missingIdentity] =
  await Promise.all([
    createConfirmedUser('local-admin-a@example.test', 'Admin A'),
    createConfirmedUser('local-user-a2@example.test', 'Player A2'),
    createConfirmedUser('local-user-a3@example.test', 'Player A3'),
    createConfirmedUser('local-admin-b@example.test', 'Admin B'),
    createConfirmedUser('local-user-b@example.test', 'Player B'),
    createConfirmedUser('local-platform@example.test', 'Platform Admin'),
    createConfirmedUser('local-twin-1@example.test', 'Same Name'),
    createConfirmedUser('local-twin-2@example.test', 'Same Name'),
    createConfirmedUser('local-missing-id@example.test', 'Missing Identity'),
  ])

const accounts = [
  userA1,
  adminA,
  userA2,
  userA3,
  adminB,
  userB,
  platformAdmin,
  twin1,
  twin2,
  missingIdentity,
]
must(
  await service.from('profiles').update({ is_active: true }).in('id', accounts.map((x) => x.id)),
  'activate fixture profiles',
)
for (const account of [userA1, userA2, userA3, twin1, twin2, missingIdentity]) {
  await setMembership(clubA.id, account.id)
}
await setMembership(clubA.id, adminA.id, 'admin')
must(await service.from('club_members').delete().eq('user_id', adminB.id), 'remove admin B from club A')
must(await service.from('club_members').delete().eq('user_id', userB.id), 'remove user B from club A')
await setMembership(clubB.id, adminB.id, 'admin')
await setMembership(clubB.id, userB.id)
must(
  await service.from('profiles').update({ is_platform_admin: true }).eq('id', platformAdmin.id),
  'grant local platform admin',
)
must(
  await service
    .from('app_settings')
    .update({ value: true })
    .eq('key', 'security_scoped_admin_rpc_enabled'),
  'enable scoped RPC locally',
)

const [adminAClient, adminBClient, userA1Client, userA2Client, platformClient] = await Promise.all([
  signIn(adminA),
  signIn(adminB),
  signIn(userA1),
  signIn(userA2),
  signIn(platformAdmin),
])

must(
  await service
    .from('app_settings')
    .update({ value: false })
    .eq('key', 'security_scoped_admin_rpc_enabled'),
  'disable scoped RPC for legacy reset guard test',
)
await expectFailure(
  () =>
    adminAClient.rpc('admin_reset_user_password', {
      p_user_id: platformAdmin.id,
    }),
  'club admin resetting platform admin through legacy RPC',
)
const platformPasswordCheckClient = userClient()
must(
  await platformPasswordCheckClient.auth.signInWithPassword({
    email: platformAdmin.email,
    password: platformAdmin.password,
  }),
  'platform admin password remains unchanged',
)
must(await platformPasswordCheckClient.auth.signOut(), 'sign out platform password check')
must(
  await service
    .from('app_settings')
    .update({ value: true })
    .eq('key', 'security_scoped_admin_rpc_enabled'),
  'restore scoped RPC after legacy reset guard test',
)

const initialIdentities = must(
  await service.from('profiles').select('id,global_player_id').in('id', accounts.map((x) => x.id)),
  'load automatic identities',
)
assert.equal(initialIdentities.length, accounts.length)
assert(initialIdentities.every((row) => row.global_player_id), 'every new profile needs an identity')
assert.equal(
  new Set(initialIdentities.map((row) => row.global_player_id)).size,
  initialIdentities.length,
  'new profiles must receive independent identities',
)
const twinRows = initialIdentities.filter((row) => row.id === twin1.id || row.id === twin2.id)
assert.notEqual(twinRows[0].global_player_id, twinRows[1].global_player_id, 'same-name profiles auto-merged')
const twin1OriginalIdentity = twinRows.find((row) => row.id === twin1.id).global_player_id
const twin2Identity = twinRows.find((row) => row.id === twin2.id).global_player_id
must(
  await platformClient.rpc('merge_global_players_v2', {
    p_source_global_player_id: twin1OriginalIdentity,
    p_target_global_player_id: twin2Identity,
    p_reason: 'local merge audit test',
  }),
  'merge identities',
)
let twin1Profile = must(
  await service.from('profiles').select('global_player_id').eq('id', twin1.id).single(),
  'load merged twin profile',
)
assert.equal(twin1Profile.global_player_id, twin2Identity)
const mergedSource = must(
  await service
    .from('global_players')
    .select('status,merged_into_id')
    .eq('id', twin1OriginalIdentity)
    .single(),
  'load merged source identity',
)
assert.deepEqual(mergedSource, { status: 'merged', merged_into_id: twin2Identity })
const splitIdentity = must(
  await platformClient.rpc('split_profile_identity_v2', {
    p_profile_id: twin1.id,
    p_reason: 'local split audit test',
  }),
  'split profile identity',
)
twin1Profile = must(
  await service.from('profiles').select('global_player_id').eq('id', twin1.id).single(),
  'load split twin profile',
)
assert.equal(twin1Profile.global_player_id, splitIdentity)
assert.notEqual(splitIdentity, twin2Identity)
const rejectedClaim = must(
  await service
    .from('player_identity_claims')
    .insert({
      claim_type: 'duplicate_merge',
      source_profile_id: twin1.id,
      target_profile_id: twin2.id,
      source_global_player_id: splitIdentity,
      target_global_player_id: twin2Identity,
      evidence: { source: 'local-test' },
      requested_by: platformAdmin.id,
    })
    .select('id')
    .single(),
  'create review claim',
)
must(
  await platformClient.rpc('review_identity_claim_v2', {
    p_claim_id: rejectedClaim.id,
    p_approve: false,
    p_reason: 'local rejection audit test',
  }),
  'reject identity claim',
)
const reviewedClaim = must(
  await service
    .from('player_identity_claims')
    .select('status,reviewed_by,review_reason')
    .eq('id', rejectedClaim.id)
    .single(),
  'load reviewed claim',
)
assert.equal(reviewedClaim.status, 'rejected')
assert.equal(reviewedClaim.reviewed_by, platformAdmin.id)
const identityEvents = must(
  await service
    .from('player_identity_events')
    .select('event_type')
    .in('event_type', ['merged', 'split', 'claim_rejected']),
  'load identity audit events',
)
for (const eventType of ['merged', 'split', 'claim_rejected']) {
  assert(identityEvents.some((event) => event.event_type === eventType), `missing ${eventType} event`)
}

const protectedUpdate = await userA1Client
  .from('profiles')
  .update({ role: 'admin', is_active: false, is_guest: true, is_platform_admin: true })
  .eq('id', userA1.id)
assert(protectedUpdate.error, 'protected profile update should be rejected')
const protectedProfile = must(
  await service
    .from('profiles')
    .select('role,is_active,is_guest,is_platform_admin')
    .eq('id', userA1.id)
    .single(),
  'verify protected profile',
)
assert.deepEqual(protectedProfile, {
  role: 'user',
  is_active: true,
  is_guest: false,
  is_platform_admin: false,
})

await expectFailure(
  () =>
    adminBClient.rpc('create_match_lineup', {
      p_match_date: '2026-07-01',
      p_club_id: clubA.id,
      p_a1: adminA.id,
      p_a2: userA1.id,
      p_b1: userA2.id,
      p_b2: userA3.id,
      p_match_type: 'doubles',
    }),
  'cross-club match creation',
)
await expectFailure(
  () =>
    userA1Client.rpc('get_player_recent_matches', {
      p_user_id: userA1.id,
      p_limit: 10,
      p_club_id: null,
    }),
  'NULL club statistics',
)

const matchId = must(
  await adminAClient.rpc('create_match_lineup', {
    p_match_date: '2026-07-02',
    p_club_id: clubA.id,
    p_a1: adminA.id,
    p_a2: userA1.id,
    p_b1: userA2.id,
    p_b2: userA3.id,
    p_match_type: 'doubles',
  }),
  'create normal doubles match',
)
let match = must(
  await service.from('matches').select('id,status,version').eq('id', matchId).single(),
  'load created match',
)
await expectFailure(
  () =>
    adminAClient.rpc('internal_add_player', {
      p_match_id: matchId,
      p_user_id: userB.id,
      p_position: 'A1',
    }),
  'direct internal helper execution',
)
must(
  await adminAClient.rpc('submit_score', {
    p_match_id: matchId,
    p_team_a: 6,
    p_team_b: 3,
    p_expected_version: match.version,
  }),
  'submit score',
)
match = must(
  await service.from('matches').select('id,status,version').eq('id', matchId).single(),
  'load submitted match',
)
assert.equal(match.status, 'submitted')
must(
  await userA2Client.rpc('confirm_score', {
    p_match_id: matchId,
    p_expected_version: match.version,
  }),
  'confirm score',
)
match = must(
  await service.from('matches').select('id,status,version').eq('id', matchId).single(),
  'load confirmed match',
)
assert.equal(match.status, 'confirmed')

await expectFailure(
  () =>
    adminBClient.rpc('admin_reset_user_password_v2', {
      p_club_id: clubA.id,
      p_user_id: userA2.id,
      p_reason: 'cross-club test',
    }),
  'cross-club password reset',
)
must(
  await adminAClient.rpc('admin_reset_user_password_v2', {
    p_club_id: clubA.id,
    p_user_id: userA1.id,
    p_reason: 'local allowed reset test',
  }),
  'allowed password reset',
)
await expectFailure(
  () => userClient().auth.signInWithPassword({ email: userA1.email, password: userA1.password }),
  'old password after reset',
)
const resetLoginClient = userClient()
must(
  await resetLoginClient.auth.signInWithPassword({ email: userA1.email, password: '123456' }),
  '123456 after allowed reset',
)
must(await resetLoginClient.auth.signOut({ scope: 'global' }), 'sign out reset-password session')
await setMembership(clubB.id, userA3.id)
await expectFailure(
  () =>
    adminAClient.rpc('admin_reset_user_password_v2', {
      p_club_id: clubA.id,
      p_user_id: userA3.id,
      p_reason: 'multi-club denial test',
    }),
  'non-platform multi-club password reset',
)

const canceledMatchId = must(
  await adminAClient.rpc('create_match_lineup', {
    p_match_date: '2026-07-03',
    p_club_id: clubA.id,
    p_a1: adminA.id,
    p_a2: userA1.id,
    p_b1: userA2.id,
    p_b2: userA3.id,
    p_match_type: 'doubles',
  }),
  'create cancel candidate',
)
must(
  await adminAClient.rpc('cancel_match', {
    p_match_id: canceledMatchId,
    p_reason: 'local exclusion test',
  }),
  'cancel match',
)

must(
  await service.from('profiles').update({ global_player_id: null }).eq('id', missingIdentity.id),
  'clear one local identity for exclusion test',
)
const missingIdentityMatch = must(
  await service
    .from('matches')
    .insert({
      club_id: clubA.id,
      match_date: '2026-07-04',
      created_by: adminA.id,
      status: 'confirmed',
      team_a_score: 6,
      team_b_score: 4,
      confirmed_by: adminA.id,
      confirmed_at: new Date().toISOString(),
      match_type: 'doubles',
    })
    .select('id')
    .single(),
  'create missing-identity match',
)
must(
  await service.from('match_players').insert([
    { match_id: missingIdentityMatch.id, user_id: twin1.id, position: 'A1', registered_by: adminA.id },
    { match_id: missingIdentityMatch.id, user_id: twin2.id, position: 'A2', registered_by: adminA.id },
    { match_id: missingIdentityMatch.id, user_id: userA2.id, position: 'B1', registered_by: adminA.id },
    { match_id: missingIdentityMatch.id, user_id: missingIdentity.id, position: 'B2', registered_by: adminA.id },
  ]),
  'add missing-identity match players',
)
must(
  await service.from('matches').insert({
    club_id: clubA.id,
    match_date: '2026-07-05',
    created_by: adminA.id,
    status: 'confirmed',
    team_a_score: 6,
    team_b_score: 0,
    confirmed_by: adminA.id,
    confirmed_at: new Date().toISOString(),
    match_type: 'doubles',
  }),
  'create invalid participant match',
)

const coreBefore = {
  profiles: must(
    await service.from('profiles').select('id,name,global_player_id,is_active').order('id'),
    'snapshot profiles',
  ),
  matches: must(
    await service
      .from('matches')
      .select('id,club_id,status,team_a_score,team_b_score,version')
      .order('id'),
    'snapshot matches',
  ),
  players: must(
    await service.from('match_players').select('match_id,user_id,position').order('match_id').order('position'),
    'snapshot match players',
  ),
}

const pool = must(
  await service
    .from('rating_pools')
    .update({ enabled: true })
    .eq('scope_type', 'global')
    .eq('discipline', 'doubles')
    .select('id')
    .single(),
  'enable local doubles shadow pool',
)
const cutoff = '2035-01-01T00:00:00.000Z'
const runId = must(
  await platformClient.rpc('run_shadow_team_elo_v1', {
    p_pool_id: pool.id,
    p_cutoff_at: cutoff,
  }),
  'run shadow rating',
)
const firstRatings = must(
  await service
    .from('player_ratings')
    .select('global_player_id,rating,uncertainty,games_played,provisional,as_of_run_id')
    .eq('pool_id', pool.id)
    .order('global_player_id'),
  'load first ratings',
)
assert.equal(firstRatings.length, 4, 'one valid doubles match should rate four players')
const repeatedRunId = must(
  await platformClient.rpc('run_shadow_team_elo_v1', {
    p_pool_id: pool.id,
    p_cutoff_at: cutoff,
  }),
  'rerun shadow rating',
)
assert.equal(repeatedRunId, runId, 'identical input should reuse the completed run')
const repeatedRatings = must(
  await service
    .from('player_ratings')
    .select('global_player_id,rating,uncertainty,games_played,provisional,as_of_run_id')
    .eq('pool_id', pool.id)
    .order('global_player_id'),
  'load repeated ratings',
)
assert.deepEqual(repeatedRatings, firstRatings, 'identical input changed ratings')

const exclusions = must(
  await service
    .from('rating_run_matches')
    .select('exclusion_reason')
    .eq('run_id', runId)
    .eq('included', false),
  'load rating exclusions',
)
const exclusionReasons = new Set(exclusions.map((row) => row.exclusion_reason))
for (const reason of ['canceled', 'invalid_participant_count', 'missing_identity_mapping']) {
  assert(exclusionReasons.has(reason), `missing rating exclusion reason: ${reason}`)
}
const summary = must(
  await platformClient.rpc('get_shadow_rating_summary_v1', {
    p_club_id: clubA.id,
    p_pool_id: pool.id,
  }),
  'load shadow rating admin summary',
)
assert.equal(summary.length, 4)
assert(summary.every((row) => row.run_id === runId && row.model_version === '1.0.0'))

const coreAfter = {
  profiles: must(
    await service.from('profiles').select('id,name,global_player_id,is_active').order('id'),
    'verify profiles after rating',
  ),
  matches: must(
    await service
      .from('matches')
      .select('id,club_id,status,team_a_score,team_b_score,version')
      .order('id'),
    'verify matches after rating',
  ),
  players: must(
    await service.from('match_players').select('match_id,user_id,position').order('match_id').order('position'),
    'verify match players after rating',
  ),
}
assert.deepEqual(coreAfter, coreBefore, 'shadow rating mutated existing profile or match data')

const audit = must(
  await service
    .from('security_audit_events')
    .select('action,actor_user_id,target_user_id,metadata')
    .eq('action', 'password_reset')
    .eq('target_user_id', userA1.id)
    .single(),
  'load reset audit',
)
assert.equal(audit.actor_user_id, adminA.id)
assert(!JSON.stringify(audit.metadata).includes('123456'), 'audit metadata contains a password')

console.log(
  JSON.stringify(
    {
      users: accounts.length,
      clubs: 2,
      confirmedMatchId: matchId,
      ratingRunId: runId,
      ratingRows: firstRatings.length,
      exclusionReasons: [...exclusionReasons].sort(),
      missingIdentityProfileId: missingIdentity.id,
      resetTargetEmail: userA1.email,
    },
    null,
    2,
  ),
)
