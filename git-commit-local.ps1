# Commit alle lokale wijzigingen (alleen lokaal, pusht niets naar GitHub)
# Gebruik: .\git-commit-local.ps1 "Commit-bericht"
param(
    [string]$Message
)

Set-Location $PSScriptRoot

git add -A

$status = git status --porcelain
if (-not $status) {
    Write-Host "Geen wijzigingen om te committen." -ForegroundColor Yellow
    exit 0
}

if (-not $Message) {
    $Message = Read-Host "Commit-bericht"
}

if (-not $Message) {
    Write-Host "Geen bericht opgegeven, commit geannuleerd." -ForegroundColor Red
    exit 1
}

git commit -m $Message
