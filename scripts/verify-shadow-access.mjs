import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

assert(url, 'SUPABASE_URL is required')
assert(anonKey, 'SUPABASE_ANON_KEY is required')
assert(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required')
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):54321$/, 'verification must target local Supabase')

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
const service = createClient(url, serviceRoleKey, options)
const ordinary = createClient(url, anonKey, options)

function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function expectDenied(operation, label) {
  const result = await operation()
  assert(result.error, `${label}: expected an authorization error`)
}

const club = must(
  await service.from('clubs').select('id').eq('slug', 'morning-star').single(),
  'load fixture club',
)
const pool = must(
  await service.from('rating_pools').select('id').eq('discipline', 'doubles').limit(1).single(),
  'load doubles pool',
)
const run = must(
  await service
    .from('rating_runs')
    .select('id')
    .eq('pool_id', pool.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single(),
  'load latest rating run',
)

const coreBefore = must(
  await service
    .from('matches')
    .select('id,club_id,match_date,status,team_a_score,team_b_score,match_type')
    .order('id'),
  'load core matches before denied calls',
)

must(
  await ordinary.auth.signInWithPassword({
    email: 'local-user-a3@example.test',
    password: 'LocalPass123!',
  }),
  'sign in ordinary fixture user',
)

await expectDenied(() => ordinary.rpc('list_shadow_rating_pools_v1'), 'ordinary pool list')
await expectDenied(
  () => ordinary.rpc('get_shadow_rating_summary_v1', { p_club_id: club.id, p_pool_id: pool.id }),
  'ordinary rating summary',
)
await expectDenied(
  () => ordinary.rpc('get_shadow_rating_exclusions_v1', { p_run_id: run.id }),
  'ordinary rating exclusions',
)
await expectDenied(
  () => ordinary.rpc('run_shadow_team_elo_v1', { p_pool_id: pool.id, p_cutoff_at: null }),
  'ordinary rating calculation',
)

const coreAfter = must(
  await service
    .from('matches')
    .select('id,club_id,match_date,status,team_a_score,team_b_score,match_type')
    .order('id'),
  'load core matches after denied calls',
)
assert.deepEqual(coreAfter, coreBefore, 'denied Shadow RPC calls changed existing match data')

console.log(
  JSON.stringify({
    status: 'pass',
    ordinaryShadowRpcDenied: 4,
    existingMatchesUnchanged: coreAfter.length,
  }),
)
