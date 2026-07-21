<#
.SYNOPSIS
  Install the Stage 0 toolchain on Windows.

.DESCRIPTION
  Terraform, AWS CLI and dbmate. Idempotent — skips anything already
  present. Does NOT install a local PostgreSQL server; psql is only
  needed to run seeds and verification against a provisioned database,
  and CI already proves the schema applies.

      .\scripts\bootstrap-windows.ps1

  Be patient: the AWS CLI MSI is ~30 MB and regularly takes 8-10 minutes
  to download and install. It looks stalled and is not.

  Do NOT pass --scope user to the AWS CLI install. It publishes only a
  machine-scope MSI, so a user-scope request fails immediately with
  "No applicable installer found". The default machine-scope install
  works from an ordinary shell provided the account is a local admin.

  winget modifies PATH for NEW shells only, so open a fresh terminal
  afterwards — or use the absolute paths this script prints.

  Terraform does not require the AWS CLI: the provider reads credentials
  directly, and `terraform output -raw database_url` returns the
  connection string. The CLI is for `aws configure` and Secrets Manager.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Test-Tool {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# PATH is not refreshed inside the shell winget was launched from, so
# Get-Command gives a false negative right after an install. Ask winget
# what it has registered instead.
function Test-WingetPackage {
    param([string]$Id)
    winget list --id $Id -e --accept-source-agreements 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Install-WingetPackage {
    param([string]$Id, [string]$Tool)

    if ((Test-WingetPackage $Id) -or (Test-Tool $Tool)) {
        Write-Host "  $Tool already installed - skipping" -ForegroundColor DarkGray
        return
    }

    Write-Host "  installing $Id ..." -ForegroundColor Cyan
    # AWS CLI in particular can take several minutes.
    winget install --id $Id -e --silent `
        --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null

    # winget uses a non-zero code for "already installed" and for several
    # benign outcomes, so a failure here is only real if the tool is still
    # missing afterwards.
    if (-not ((Test-WingetPackage $Id) -or (Test-Tool $Tool))) {
        Write-Host "  WARNING: $Tool did not install (winget exit $LASTEXITCODE)" -ForegroundColor Yellow
    }
}

Write-Host "`nStage 0 toolchain" -ForegroundColor White
Write-Host "-----------------"

if (-not (Test-Tool 'winget')) {
    throw "winget not found. Install 'App Installer' from the Microsoft Store first."
}

Install-WingetPackage -Id 'Hashicorp.Terraform' -Tool 'terraform'

Write-Host "  (the AWS CLI step can take 8-10 minutes - it is not stuck)" -ForegroundColor DarkGray
Install-WingetPackage -Id 'Amazon.AWSCLI' -Tool 'aws'

# dbmate ships as a single binary with no installer.
$linkDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
$dbmate  = Join-Path $linkDir 'dbmate.exe'

if (Test-Path $dbmate) {
    Write-Host "  dbmate already installed - skipping" -ForegroundColor DarkGray
} else {
    Write-Host "  installing dbmate ..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $linkDir | Out-Null
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://github.com/amacneil/dbmate/releases/latest/download/dbmate-windows-amd64.exe' `
        -OutFile $dbmate
}

Write-Host "`nInstalled:" -ForegroundColor White
foreach ($pair in @(
    @{ Tool = 'terraform'; Id = 'Hashicorp.Terraform' },
    @{ Tool = 'aws';       Id = 'Amazon.AWSCLI' }
)) {
    $cmd = Get-Command $pair.Tool -ErrorAction SilentlyContinue
    if ($cmd) {
        Write-Host ("  {0,-10} {1}" -f $pair.Tool, $cmd.Source)
    } elseif (Test-WingetPackage $pair.Id) {
        Write-Host ("  {0,-10} installed - open a new terminal for PATH" -f $pair.Tool)
    } else {
        Write-Host ("  {0,-10} MISSING" -f $pair.Tool) -ForegroundColor Yellow
    }
}
Write-Host ("  {0,-10} {1}" -f 'dbmate', $dbmate)

Write-Host @"

Next
----
1. Open a NEW terminal so PATH changes take effect.

2. Configure AWS with your own credentials:

       aws configure

   Enter your access key, secret, and region eu-west-1. Do not paste
   credentials into a chat or commit them - aws configure writes them to
   %USERPROFILE%\.aws\credentials, which is the only place they belong.

3. Confirm it works:

       aws sts get-caller-identity

4. Then follow docs/STAGE-0.md to plan and apply.
"@ -ForegroundColor White

# A native command's exit code otherwise leaks out as the script's own.
# Terraform and dbmate must be present; a missing AWS CLI is expected
# when running unelevated and is reported above rather than failing here.
$fatal = -not ((Test-WingetPackage 'Hashicorp.Terraform') -or (Test-Tool 'terraform'))
if (-not (Test-Path $dbmate)) { $fatal = $true }
exit ([int]$fatal)
