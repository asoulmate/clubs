import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const migrations = [
  'supabase/migrations/38_security_baseline_foundation.sql',
  'supabase/migrations/39_security_scoped_rpc_foundation.sql',
  'supabase/migrations/40_security_match_scope.sql',
  'supabase/migrations/41_global_player_identity.sql',
  'supabase/migrations/42_global_player_backfill.sql',
  'supabase/migrations/43_shadow_rating_schema.sql',
  'supabase/migrations/44_shadow_rating_engine.sql',
]

for (const file of migrations) {
  const sql = read(file)
  assert.match(sql, /\bbegin\s*;/i, `${file}: transaction BEGIN missing`)
  assert.match(sql, /\bcommit\s*;/i, `${file}: transaction COMMIT missing`)
  assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, `${file}: unbalanced dollar quote`)
  const definerCount = (sql.match(/security definer/gi) ?? []).length
  const searchPathCount = (sql.match(/set search_path\s*=/gi) ?? []).length
  assert.ok(searchPathCount >= definerCount, `${file}: SECURITY DEFINER without fixed search_path`)
}

const security = read(migrations[1])
for (const contract of [
  'admin_update_user(',
  'admin_reset_user_password(',
  'admin_update_user_v2(',
  'admin_reset_user_password_v2(',
  'admin_withdraw_club_member_v2(',
  'self_withdraw_club_v2(',
]) {
  assert.ok(security.includes(contract), `security RPC contract missing: ${contract}`)
}
assert.match(security, /crypt\('123456'/, '123456 compatibility flow missing')
assert.doesNotMatch(security, /metadata[\s\S]{0,120}123456/i, 'password must not be audit metadata')
assert.match(security, /v_active_clubs\s*<>\s*1/, 'multi-club password reset guard missing')
assert.match(security, /status\s*=\s*'withdrawn'/, 'withdrawn membership transition missing')
assert.match(security, /club_members\.status in \('rejected', 'withdrawn'\)/i, 'withdrawn rejoin path missing')
assert.match(security, /security_scoped_admin_rpc_enabled'[\s\S]{0,80}'false'::jsonb/i, 'security DB cutover flag must default OFF')

const matchScope = read(migrations[2])
for (const fn of ['register_player', 'remove_player', 'start_match', 'submit_score', 'confirm_score', 'cancel_match', 'link_match_youtube', 'unlink_match_youtube']) {
  assert.match(matchScope, new RegExp(`function public\\.${fn}\\b`, 'i'), `scoped match function missing: ${fn}`)
}
assert.ok((matchScope.match(/assert_club_member\(v_match\.club_id\)/g) ?? []).length >= 8, 'target-club assertions missing')
assert.match(matchScope, /if p_club_id is null then raise exception '클럽을 지정해야 합니다.'/i, 'NULL club guard missing')

const identity = read(migrations[3])
for (const table of ['global_players', 'player_aliases', 'player_external_ids', 'player_identity_claims', 'player_identity_events']) {
  assert.match(identity, new RegExp(`create table public\\.${table}\\b`, 'i'), `identity table missing: ${table}`)
}
assert.match(identity, /global_identity_guest_claim_enabled'[\s\S]{0,80}'false'::jsonb/i, 'guest claim DB flag must default OFF')
assert.match(identity, /if not v_claim_enabled then[\s\S]*transfer_profile_refs/i, 'legacy guest path must be behind OFF branch')
assert.match(identity, /update public\.profiles set global_player_id/i, 'mapping-based merge missing')

const backfill = read(migrations[4])
assert.match(backfill, /where global_player_id is null/i, 'idempotent unlinked filter missing')
assert.match(backfill, /if v_before <> v_after/i, 'protected row-count assertion missing')
assert.match(backfill, /mapping_checksum/i, 'backfill mapping checksum missing')
assert.doesNotMatch(backfill, /delete from public\.(profiles|club_members|match_players|tournament_entries|match_bets)/i, 'backfill deletes protected rows')

const ratingSchema = read(migrations[5])
for (const table of ['rating_models', 'rating_model_versions', 'rating_pools', 'rating_runs', 'rating_run_matches', 'player_ratings', 'player_rating_history']) {
  assert.match(ratingSchema, new RegExp(`create table public\\.${table}\\b`, 'i'), `rating table missing: ${table}`)
}
assert.doesNotMatch(ratingSchema, /alter table public\.profiles[\s\S]{0,80}\brating\b/i, 'rating column must not be added to profiles')

const ratingEngine = read(migrations[6])
assert.match(ratingEngine, /order by p\.match_date, p\.created_at, p\.id/i, 'deterministic input ordering missing')
assert.match(ratingEngine, /v_input_hash/i, 'input hash missing')
assert.match(ratingEngine, /player_rating_history/i, 'before/after history missing')
assert.match(ratingEngine, /missing_identity_mapping/i, 'identity exclusion reason missing')
assert.match(ratingEngine, /invalid_participant_count/i, 'participant exclusion reason missing')
assert.match(ratingEngine, /if not v_pool\.enabled/i, 'shadow calculation DB flag must default OFF')

const envExample = read('.env.example')
for (const flag of [
  'VITE_FEATURE_SCOPED_ADMIN_RPC',
  'VITE_FEATURE_IDENTITY_CLAIMS',
  'VITE_FEATURE_GUEST_CLAIM_CANDIDATES',
  'VITE_FEATURE_SHADOW_RATING_CALCULATION',
  'VITE_FEATURE_SHADOW_RATING_ADMIN',
]) {
  assert.match(envExample, new RegExp(`${flag}=false`), `${flag} must default OFF`)
}

const routes = read('src/App.tsx')
for (const route of [
  'path="/c/:clubSlug"',
  'path="results"',
  'path="players/:userId"',
  'path="settings"',
  'path="admin"',
  'path="/platform"',
]) {
  assert.ok(routes.includes(route), `existing route contract missing: ${route}`)
}

function calculate(matches, discipline) {
  const state = new Map()
  const initial = 1500
  const k = 32
  const expectedPlayers = discipline === 'singles' ? 2 : 4
  for (const match of matches.filter((row) => row.discipline === discipline)) {
    assert.equal(match.teamA.length + match.teamB.length, expectedPlayers)
    const get = (id) => state.get(id) ?? { rating: initial, games: 0 }
    const avg = (ids) => ids.reduce((sum, id) => sum + get(id).rating, 0) / ids.length
    const expectedA = 1 / (1 + 10 ** ((avg(match.teamB) - avg(match.teamA)) / 400))
    const actualA = match.scoreA === match.scoreB ? 0.5 : match.scoreA > match.scoreB ? 1 : 0
    const delta = Number((k * (actualA - expectedA)).toFixed(6))
    for (const id of match.teamA) state.set(id, { rating: Number((get(id).rating + delta).toFixed(6)), games: get(id).games + 1 })
    for (const id of match.teamB) state.set(id, { rating: Number((get(id).rating - delta).toFixed(6)), games: get(id).games + 1 })
  }
  return [...state].sort(([a], [b]) => a.localeCompare(b))
}

const fixtures = [
  { discipline: 'doubles', teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 6, scoreB: 3 },
  { discipline: 'singles', teamA: ['a'], teamB: ['c'], scoreA: 4, scoreB: 6 },
  { discipline: 'doubles', teamA: ['a', 'c'], teamB: ['b', 'd'], scoreA: 5, scoreB: 5 },
]
assert.deepEqual(calculate(fixtures, 'doubles'), calculate(fixtures, 'doubles'), 'rating must be deterministic')
assert.ok(calculate(fixtures, 'singles').every(([id]) => ['a', 'c'].includes(id)), 'singles pool leaked doubles players')
assert.equal(calculate(fixtures, 'doubles').length, 4, 'doubles pool participant separation failed')

console.log('global-rating static and deterministic contract tests: PASS')
