#!/usr/bin/env pwsh

Write-Host "=== Mayele Maths - Vérification production ===" -ForegroundColor Cyan

Push-Location client
npm run lint
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Lint frontend échoué." -ForegroundColor Red
    exit 1
}

npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Build frontend échoué." -ForegroundColor Red
    exit 1
}
Pop-Location

Push-Location server
npm install --omit=dev
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Installation serveur échouée." -ForegroundColor Red
    exit 1
}
Pop-Location

if (!(Test-Path "client/dist/index.html")) {
    Write-Host "client/dist/index.html est introuvable." -ForegroundColor Red
    exit 1
}

if (!(Test-Path "Dockerfile")) {
    Write-Host "Dockerfile introuvable." -ForegroundColor Red
    exit 1
}

Write-Host "Vérification terminée." -ForegroundColor Green
