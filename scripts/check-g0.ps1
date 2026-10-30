$ErrorActionPreference = 'Stop'

function Write-CheckResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,

        [Parameter(Mandatory = $true)]
        [bool]$IsReady
    )

    $status = if ($IsReady) { 'READY' } else { 'NOT SET' }
    Write-Output ("{0}: {1}" -f $Label, $status)
}

function Read-EnvironmentKeys {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $configuredKeys = @{}

    if (-not (Test-Path -LiteralPath $Path)) {
        return $configuredKeys
    }

    foreach ($line in Get-Content -LiteralPath $Path -Encoding utf8) {
        if ($line -notmatch '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
            continue
        }

        $key = $matches[1]
        $value = $matches[2].Trim()
        $configuredKeys[$key] = $value.Length -gt 0
    }

    return $configuredKeys
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectRoot '.env.local'
$environmentKeys = Read-EnvironmentKeys -Path $environmentPath

$requiredEnvironmentKeys = @(
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_KAKAO_MAP_JS_KEY',
    'VITE_EMAIL_OTP_LENGTH'
)

Push-Location $projectRoot

try {
    Write-Output 'WalkLab G0 connection status'
    Write-Output '----------------------'

    $gitUserName = git config user.name
    $gitUserEmail = git config user.email
    $gitRemotes = @(git remote)

    Write-CheckResult -Label 'Git user name' -IsReady ([bool]$gitUserName)
    Write-CheckResult -Label 'Git user email' -IsReady ([bool]$gitUserEmail)
    Write-CheckResult -Label 'Git remote' -IsReady ($gitRemotes.Count -gt 0)

    foreach ($key in $requiredEnvironmentKeys) {
        $isConfigured = $environmentKeys.ContainsKey($key) -and $environmentKeys[$key]
        Write-CheckResult -Label $key -IsReady $isConfigured
    }

    $supabaseLinkPath = Join-Path $projectRoot 'supabase/.temp/project-ref'
    $vercelLinkPath = Join-Path $projectRoot '.vercel/project.json'

    Write-CheckResult -Label 'Supabase remote project link' -IsReady (
        Test-Path -LiteralPath $supabaseLinkPath
    )
    Write-CheckResult -Label 'Vercel project link' -IsReady (
        Test-Path -LiteralPath $vercelLinkPath
    )

    Write-Output ''
    Write-Output 'This script never prints environment values or authentication tokens.'
}
finally {
    Pop-Location
}
