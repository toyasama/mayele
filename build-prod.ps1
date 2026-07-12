#!/usr/bin/env pwsh

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host "=== $Name ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Write-Host "$Name echoue." -ForegroundColor Red
        exit 1
    }
}

function Assert-NoMatches {
    param(
        [string]$Name,
        [string]$Pattern,
        [string[]]$Paths
    )

    Write-Host "=== $Name ===" -ForegroundColor Cyan
    & rg -n $Pattern @Paths
    if ($LASTEXITCODE -eq 0) {
        Write-Host "$Name echoue: motif interdit detecte." -ForegroundColor Red
        exit 1
    }
    if ($LASTEXITCODE -ne 1) {
        Write-Host "$Name echoue: scan impossible." -ForegroundColor Red
        exit 1
    }
}

Write-Host "=== Mayele Maths - Verification production ===" -ForegroundColor Cyan

Assert-NoMatches `
    -Name "Scan legacy applicatif" `
    -Pattern '@clerk/react/legacy|legacy-match|responsive-legacy|tempoFallback|\x{00C3}|\x{00E2}\x{20AC}\x{2122}|\x{00C3}\x{0192}|\?\?tre|\?\?fini' `
    -Paths @("client/src", "server/src", "client/e2e")

Assert-NoMatches `
    -Name "Scan logs E2E bruts" `
    -Pattern "console\\.log|REST legacy|route REST legacy|routes REST legacy" `
    -Paths @("client/e2e")

Push-Location server
try {
    Invoke-Step "Audit serveur" { npm audit --audit-level=moderate }
    Invoke-Step "Typecheck serveur" { npm run typecheck }
    Invoke-Step "Tests serveur" { npm run test }
    Invoke-Step "Build serveur" { npm run build }
}
finally {
    Pop-Location
}

Push-Location client
try {
    Invoke-Step "Audit frontend" { npm audit --audit-level=moderate }
    Invoke-Step "Lint frontend" { npm run lint }
    Invoke-Step "Tests frontend" { npm run test }
    Invoke-Step "Build frontend" { npm run build }
    Invoke-Step "E2E frontend" { npm run test:e2e }
    Invoke-Step "E2E responsive frontend" { npm run test:responsive }
}
finally {
    Pop-Location
}

if (!(Test-Path "Dockerfile")) {
    Write-Host "Dockerfile API introuvable." -ForegroundColor Red
    exit 1
}

if (!(Test-Path "client/vercel.json")) {
    Write-Host "client/vercel.json introuvable." -ForegroundColor Red
    exit 1
}

Write-Host "Verification production terminee." -ForegroundColor Green
