$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repositoryRoot

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$statusText = npm.cmd exec supabase -- --workdir .local-supabase status -o json 2>$null
$statusExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($statusExitCode -ne 0) { throw 'Unable to read local Supabase status.' }
$status = ($statusText -join "`n") | ConvertFrom-Json

$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
Get-Content -Raw 'supabase\tests\local_service_role_fixture_access.sql' |
  & $docker exec -i supabase_db_morning-star-gpt psql -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Unable to grant local fixture access.' }

$env:SUPABASE_URL = $status.API_URL
$env:SUPABASE_ANON_KEY = $status.ANON_KEY
$env:SUPABASE_SERVICE_ROLE_KEY = $status.SERVICE_ROLE_KEY

try {
  node scripts/test-local-supabase.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Local Supabase integration tests failed.' }
  node scripts/test-shadow-rating-fuzz.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Shadow rating fuzz tests failed.' }
  node scripts/verify-shadow-access.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Shadow access verification failed.' }

  $backfillSql = Get-Content -Raw 'supabase\migrations\42_global_player_backfill.sql'
  ($backfillSql + "`n" + $backfillSql) |
    & $docker exec -i supabase_db_morning-star-gpt psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Identity backfill idempotence test failed.' }

  Get-Content -Raw 'supabase\tests\local_post_integration_assertions.sql' |
    & $docker exec -i supabase_db_morning-star-gpt psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Local database post-integration assertions failed.' }

  Get-Content -Raw 'supabase\checks\38_security_phase1_verify.sql' |
    & $docker exec -i supabase_db_morning-star-gpt psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Security phase 1 verification failed.' }

  Get-Content -Raw 'supabase\checks\global_rating_post_apply_verify.sql' |
    & $docker exec -i supabase_db_morning-star-gpt psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Global rating post-apply verification failed.' }
} finally {
  Remove-Item Env:SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
