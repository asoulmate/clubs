$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceDirectory = Join-Path $repositoryRoot 'supabase'
$localRoot = Join-Path $repositoryRoot '.local-supabase'
$localSupabaseDirectory = Join-Path $localRoot 'supabase'

if (Test-Path -LiteralPath $localRoot) {
  $resolvedLocalRoot = (Resolve-Path -LiteralPath $localRoot).Path
  $expectedPrefix = $repositoryRoot.TrimEnd('\') + '\'
  if (-not $resolvedLocalRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace local Supabase directory outside the repository: $resolvedLocalRoot"
  }
  Remove-Item -LiteralPath $resolvedLocalRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $localRoot | Out-Null
Copy-Item -LiteralPath $sourceDirectory -Destination $localSupabaseDirectory -Recurse

$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$windowsKorean = [System.Text.Encoding]::GetEncoding(949)

$localConfigPath = Join-Path $localSupabaseDirectory 'config.toml'
$localConfig = [System.IO.File]::ReadAllText($localConfigPath, $strictUtf8)
$localConfig = $localConfig.Replace(
  'auto_expose_new_tables = false',
  'auto_expose_new_tables = true'
)
[System.IO.File]::WriteAllText($localConfigPath, $localConfig, $utf8WithoutBom)

Get-ChildItem -LiteralPath (Join-Path $localSupabaseDirectory 'migrations') -Filter '*.sql' |
  ForEach-Object {
    $migrationFile = $_
    $bytes = [System.IO.File]::ReadAllBytes($migrationFile.FullName)
try {
      $null = $strictUtf8.GetString($bytes)
    } catch {
      $normalized = $windowsKorean.GetString($bytes)
      [System.IO.File]::WriteAllText($migrationFile.FullName, $normalized, $utf8WithoutBom)
    }
  }

$seedPath = Join-Path $localSupabaseDirectory 'seed.sql'
if (-not (Test-Path -LiteralPath $seedPath)) {
  [System.IO.File]::WriteAllText($seedPath, "-- Local fixtures are created by the integration test harness.`n", $utf8WithoutBom)
}

Write-Output $localRoot
