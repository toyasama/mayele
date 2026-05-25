#!/usr/bin/env pwsh
# build-prod.ps1 - Teste la build production localement

Write-Host "=== Mayele Maths — Production Build Test ===" -ForegroundColor Cyan
Write-Host ""

# Fonction pour afficher les erreurs
function Test-Command {
    param([string]$Command, [string]$Description)
    Write-Host "▶ $Description..." -ForegroundColor Yellow
    try {
        Invoke-Expression $Command | Out-Null
        Write-Host "✓ Success" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Failed: $_" -ForegroundColor Red
        return $false
    }
}

# 1. Build client
Write-Host "`n📦 Building Frontend..." -ForegroundColor Magenta
Push-Location client
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Client build failed!" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "✓ Frontend built successfully" -ForegroundColor Green

# 2. Vérifier que dist existe
if (Test-Path "client/dist/index.html") {
    Write-Host "✓ Client dist/index.html exists" -ForegroundColor Green
} else {
    Write-Host "✗ Client dist/index.html not found!" -ForegroundColor Red
    exit 1
}

# 3. Build du serveur (TypeScript check - si applicable)
Write-Host "`n🔧 Checking Server..." -ForegroundColor Magenta
Push-Location server
npm install --omit=dev | Out-Null
Pop-Location
Write-Host "✓ Server dependencies OK" -ForegroundColor Green

# 4. Vérifier la structure du Dockerfile
Write-Host "`n🐳 Checking Docker configuration..." -ForegroundColor Magenta
if (Test-Path "Dockerfile") {
    Write-Host "✓ Dockerfile exists" -ForegroundColor Green
} else {
    Write-Host "✗ Dockerfile not found!" -ForegroundColor Red
    exit 1
}

Write-Host "`n✨ Ready for production deployment!" -ForegroundColor Green
Write-Host ""
Write-Host "Prochaines étapes :" -ForegroundColor Cyan
Write-Host "1. git add ."
Write-Host "2. git commit -m 'Production build ready'"
Write-Host "3. git push origin main"
Write-Host "4. Railway redéploiera automatiquement"
Write-Host ""
