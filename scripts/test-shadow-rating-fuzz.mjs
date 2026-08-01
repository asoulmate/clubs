import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
assert.match(url ?? '', /^http:\/\/(127\.0\.0\.1|localhost):54321$/)

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
const service = createClient(url, serviceRoleKey, options)
const platform = createClient(url, anonKey, options)

function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

let state = 380044
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return state / 2 ** 32
}

function chooseFour(players) {
  const pool = [...players]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]]
  }
  return pool.slice(0, 4)
}

const club = must(
  await service.from('clubs').select('id').eq('slug', 'morning-star').single(),
  'load fuzz club',
)
const memberships = must(
  await service
    .from('club_members')
    .select('user_id')
    .eq('club_id', club.id)
    .eq('status', 'active'),
  'load fuzz memberships',
)
const profiles = must(
  await service
    .from('profiles')
    .select('id,name,global_player_id')
    .in('id', memberships.map((row) => row.user_id))
    .not('global_player_id', 'is', null)
    .order('name')
    .order('id'),
  'load fuzz players',
)
assert(profiles.length >= 6, 'fuzz test needs at least six mapped active players')

const positions = ['A1', 'A2', 'B1', 'B2']
let validMatches = 0
let canceledMatches = 0
let invalidMatches = 0
for (let index = 0; index < 60; index += 1) {
  const selected = chooseFour(profiles)
  const invalid = index % 15 === 0
  const canceled = !invalid && index % 10 === 0
  const teamAScore = Math.floor(random() * 7)
  let teamBScore = Math.floor(random() * 7)
  if (teamAScore === teamBScore) teamBScore = (teamBScore + 1) % 7
  const date = new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10)
  const status = canceled ? 'canceled' : 'confirmed'
  const match = must(
    await service
      .from('matches')
      .insert({
        club_id: club.id,
        match_date: date,
        created_by: selected[0].id,
        status,
        team_a_score: teamAScore,
        team_b_score: teamBScore,
        confirmed_by: status === 'confirmed' ? selected[0].id : null,
        confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
        match_type: 'doubles',
      })
      .select('id')
      .single(),
    `create fuzz match ${index}`,
  )
  const playerCount = invalid ? 3 : 4
  must(
    await service.from('match_players').insert(
      selected.slice(0, playerCount).map((player, playerIndex) => ({
        match_id: match.id,
        user_id: player.id,
        position: positions[playerIndex],
        registered_by: selected[0].id,
      })),
    ),
    `create fuzz players ${index}`,
  )
  if (invalid) invalidMatches += 1
  else if (canceled) canceledMatches += 1
  else validMatches += 1
}

must(
  await platform.auth.signInWithPassword({
    email: 'local-platform@example.test',
    password: 'LocalPass123!',
  }),
  'sign in fuzz platform admin',
)
const pool = must(
  await service
    .from('rating_pools')
    .select('id')
    .eq('scope_type', 'global')
    .eq('discipline', 'doubles')
    .single(),
  'load fuzz rating pool',
)
const coreBefore = {
  matches: must(
    await service
      .from('matches')
      .select('id,status,team_a_score,team_b_score,version')
      .order('id'),
    'snapshot fuzz matches',
  ),
  players: must(
    await service.from('match_players').select('match_id,user_id,position').order('match_id').order('position'),
    'snapshot fuzz match players',
  ),
}
const cutoff = '2038-01-01T00:00:00.000Z'
const runId = must(
  await platform.rpc('run_shadow_team_elo_v1', { p_pool_id: pool.id, p_cutoff_at: cutoff }),
  'run fuzz rating',
)
const run = must(
  await service
    .from('rating_runs')
    .select('included_match_count,excluded_match_count,input_hash,identity_mapping_hash')
    .eq('id', runId)
    .single(),
  'load fuzz run',
)
assert(run.input_hash && run.identity_mapping_hash)
assert(run.included_match_count >= validMatches)
assert(run.excluded_match_count >= canceledMatches + invalidMatches)
const ratings = must(
  await service
    .from('player_ratings')
    .select('global_player_id,rating,uncertainty,games_played,provisional,as_of_run_id')
    .eq('pool_id', pool.id)
    .order('global_player_id'),
  'load fuzz ratings',
)
assert(ratings.length >= 6)
assert(ratings.every((row) => Number.isFinite(Number(row.rating)) && row.games_played > 0))
const ratingTotal = ratings.reduce((sum, row) => sum + Number(row.rating), 0)
assert(Math.abs(ratingTotal - ratings.length * 1500) < 0.001, 'Team Elo should remain zero-sum')

const repeatedRunId = must(
  await platform.rpc('run_shadow_team_elo_v1', { p_pool_id: pool.id, p_cutoff_at: cutoff }),
  'repeat fuzz rating',
)
assert.equal(repeatedRunId, runId)
const repeatedRatings = must(
  await service
    .from('player_ratings')
    .select('global_player_id,rating,uncertainty,games_played,provisional,as_of_run_id')
    .eq('pool_id', pool.id)
    .order('global_player_id'),
  'load repeated fuzz ratings',
)
assert.deepEqual(repeatedRatings, ratings)
const coreAfter = {
  matches: must(
    await service
      .from('matches')
      .select('id,status,team_a_score,team_b_score,version')
      .order('id'),
    'verify fuzz matches',
  ),
  players: must(
    await service.from('match_players').select('match_id,user_id,position').order('match_id').order('position'),
    'verify fuzz match players',
  ),
}
assert.deepEqual(coreAfter, coreBefore, 'fuzz rating mutated existing match data')

console.log(
  JSON.stringify({
    seed: 380044,
    generatedMatches: 60,
    validMatches,
    canceledMatches,
    invalidMatches,
    runId,
    ratingRows: ratings.length,
    includedMatchCount: run.included_match_count,
    excludedMatchCount: run.excluded_match_count,
  }),
)
