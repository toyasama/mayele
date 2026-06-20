#!/usr/bin/env pwsh

Write-Host "=== Mayele Maths v2 - Verification production ===" -ForegroundColor Cyan

Push-Location server
npm run typecheck
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Typecheck serveur echoue." -ForegroundColor Red
    exit 1
}

npm run test
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Tests serveur echoues." -ForegroundColor Red
    exit 1
}

npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Build serveur echoue." -ForegroundColor Red
    exit 1
}
Pop-Location

Push-Location client
npm run lint
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Lint frontend echoue." -ForegroundColor Red
    exit 1
}

npm run test
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Tests frontend echoues." -ForegroundColor Red
    exit 1
}

npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Build frontend echoue." -ForegroundColor Red
    exit 1
}
Pop-Location

if (!(Test-Path "Dockerfile")) {
    Write-Host "Dockerfile API introuvable." -ForegroundColor Red
    exit 1
}

if (!(Test-Path "client/vercel.json")) {
    Write-Host "client/vercel.json introuvable." -ForegroundColor Red
    exit 1
}

Write-Host "Verification production terminee." -ForegroundColor Green
