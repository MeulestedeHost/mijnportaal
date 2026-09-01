# Pusht de huidige branch naar GitHub (origin)
# Gebruik: .\git-push-online.ps1
Set-Location $PSScriptRoot

$branch = git branch --show-current
if (-not $branch) {
    Write-Host "Kan huidige branch niet bepalen." -ForegroundColor Red
    exit 1
}

Write-Host "Pushen van branch '$branch' naar origin..." -ForegroundColor Cyan
git push -u origin $branch
