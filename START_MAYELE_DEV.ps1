param(
    [switch]$FullCheck,
    [switch]$SkipInstall,
    [switch]$NoBrowser,
    [int]$ApiPort = 4000,
    [int]$ClientPort = 5173,
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $root 'server'
$clientDir = Join-Path $root 'client'
$serverEnv = Join-Path $serverDir '.env.local'
$clientEnv = Join-Path $clientDir '.env.local'

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Stop-WithMessage {
    param([string]$Message)
    Write-Host "ERR $Message" -ForegroundColor Red
    exit 1
}

function Quote-PowerShell {
    param([string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Assert-EnvFile {
    param(
        [string]$Path,
        [string[]]$RequiredKeys
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        Stop-WithMessage "Fichier env manquant: $Path"
    }

    $missing = @()
    foreach ($key in $RequiredKeys) {
        $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
        if (-not (Select-String -Path $Path -Pattern $pattern -Quiet)) {
            $missing += $key
        }
    }

    if ($missing.Count -gt 0) {
        Stop-WithMessage "$Path ne contient pas: $($missing -join ', ')"
    }

    Write-Ok "Env present: $Path"
}

function Invoke-Npm {
    param(
        [string]$WorkingDirectory,
        [string[]]$Arguments
    )

    Push-Location $WorkingDirectory
    try {
        & $script:npmPath @Arguments
        if ($LASTEXITCODE -ne 0) {
            Stop-WithMessage "Commande npm en echec dans $WorkingDirectory : npm $($Arguments -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Test-ListeningPort {
    param([int]$Port)

    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
        return [bool]$connection
    }
    catch {
        return $false
    }
}

function Start-DevWindow {
    param(
        [string]$Title,
        [string]$WorkingDirectory,
        [string[]]$NpmArguments,
        [hashtable]$ExtraEnv = @{}
    )

    $commands = @()
    $commands += '$Host.UI.RawUI.WindowTitle = ' + (Quote-PowerShell $Title)
    $commands += '$env:Path = ' + (Quote-PowerShell $env:Path)

    foreach ($key in $ExtraEnv.Keys) {
        $commands += '$env:' + $key + ' = ' + (Quote-PowerShell ([string]$ExtraEnv[$key]))
    }

    $commands += 'Set-Location -LiteralPath ' + (Quote-PowerShell $WorkingDirectory)
    $npmArgs = ($NpmArguments | ForEach-Object { Quote-PowerShell $_ }) -join ' '
    $commands += '& ' + (Quote-PowerShell $script:npmPath) + ' ' + $npmArgs
    $command = $commands -join '; '

    Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command
}

function Invoke-DevHttp {
    param(
        [string]$Url,
        [string]$Method = 'GET',
        [hashtable]$Headers = @{}
    )

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Url -Headers $Headers -TimeoutSec 5
        return @{
            StatusCode = [int]$response.StatusCode
            Headers = $response.Headers
            Content = $response.Content
        }
    }
    catch {
        $response = $_.Exception.Response
        if ($response) {
            return @{
                StatusCode = [int]$response.StatusCode
                Headers = $response.Headers
                Content = ''
            }
        }

        return $null
    }
}

function Wait-ForStatus {
    param(
        [string]$Name,
        [string]$Url,
        [int[]]$ExpectedStatus
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastStatus = 'no response'

    while ((Get-Date) -lt $deadline) {
        $result = Invoke-DevHttp -Url $Url
        if ($result) {
            $lastStatus = $result.StatusCode
            if ($ExpectedStatus -contains $result.StatusCode) {
                Write-Ok "$Name ($($result.StatusCode))"
                return $result
            }
        }

        Start-Sleep -Seconds 1
    }

    Stop-WithMessage "$Name non disponible: $Url (dernier statut: $lastStatus)"
}

Write-Step 'Verification Node/npm'
$machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machinePath;$userPath;$env:Path"

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
    $fallbackNpm = 'C:\Program Files\nodejs\npm.cmd'
    if (Test-Path -LiteralPath $fallbackNpm) {
        $script:npmPath = $fallbackNpm
    }
    else {
        Stop-WithMessage 'Node.js / npm est introuvable. Installe Node.js LTS ou redemarre VS Code.'
    }
}
else {
    $script:npmPath = $npmCommand.Source
}
Write-Ok "npm trouve: $script:npmPath"

Write-Step 'Verification des fichiers env locaux'
Assert-EnvFile -Path $serverEnv -RequiredKeys @(
    'DATABASE_URL',
    'DIRECT_URL',
    'CLERK_SECRET_KEY',
    'CLERK_PUBLISHABLE_KEY',
    'CORS_ORIGINS'
)
Assert-EnvFile -Path $clientEnv -RequiredKeys @(
    'VITE_API_URL',
    'VITE_CLERK_PUBLISHABLE_KEY'
)

$corsLine = Select-String -Path $serverEnv -Pattern '^\s*CORS_ORIGINS\s*=' | Select-Object -First 1
if ($corsLine -and $corsLine.Line -notlike "*http://localhost:$ClientPort*") {
    Write-Warn "CORS_ORIGINS devrait contenir http://localhost:$ClientPort pour le dev local."
}

$apiLine = Select-String -Path $clientEnv -Pattern '^\s*VITE_API_URL\s*=' | Select-Object -First 1
if ($apiLine -and $apiLine.Line -notlike "*http://localhost:$ApiPort/api*") {
    Write-Warn "VITE_API_URL devrait pointer vers http://localhost:$ApiPort/api pour le dev local."
}

if (-not $SkipInstall) {
    Write-Step 'Installation des dependances si necessaire'
    if (-not (Test-Path -LiteralPath (Join-Path $serverDir 'node_modules'))) {
        Invoke-Npm -WorkingDirectory $serverDir -Arguments @('install')
    }
    else {
        Write-Ok 'server/node_modules existe'
    }

    if (-not (Test-Path -LiteralPath (Join-Path $clientDir 'node_modules'))) {
        Invoke-Npm -WorkingDirectory $clientDir -Arguments @('install')
    }
    else {
        Write-Ok 'client/node_modules existe'
    }
}

Write-Step 'Generation Prisma'
Invoke-Npm -WorkingDirectory $serverDir -Arguments @('run', 'prisma:generate')

if ($FullCheck) {
    Write-Step 'Checks complets'
    Invoke-Npm -WorkingDirectory $serverDir -Arguments @('run', 'typecheck')
    Invoke-Npm -WorkingDirectory $serverDir -Arguments @('run', 'test')
    Invoke-Npm -WorkingDirectory $clientDir -Arguments @('run', 'lint')
    Invoke-Npm -WorkingDirectory $clientDir -Arguments @('run', 'test')
    Invoke-Npm -WorkingDirectory $clientDir -Arguments @('run', 'build')
}

Write-Step 'Demarrage des serveurs dev'
if (Test-ListeningPort -Port $ApiPort) {
    Write-Warn "Le port API $ApiPort est deja utilise. Le script va tester le serveur existant."
}
else {
    Start-DevWindow -Title 'Mayele API dev' -WorkingDirectory $serverDir -NpmArguments @('run', 'dev') -ExtraEnv @{
        NODE_ENV = 'development'
        PORT = [string]$ApiPort
    }
    Write-Ok "API lancee sur http://localhost:$ApiPort"
}

if (Test-ListeningPort -Port $ClientPort) {
    Write-Warn "Le port frontend $ClientPort est deja utilise. Le script va tester le serveur existant."
}
else {
    Start-DevWindow -Title 'Mayele Front dev' -WorkingDirectory $clientDir -NpmArguments @('run', 'dev', '--', '--port', [string]$ClientPort, '--strictPort')
    Write-Ok "Frontend lance sur http://localhost:$ClientPort"
}

Write-Step 'Smoke tests HTTP'
$apiBase = "http://localhost:$ApiPort"
$frontOrigin = "http://localhost:$ClientPort"

Wait-ForStatus -Name 'API health' -Url "$apiBase/api/health" -ExpectedStatus @(200) | Out-Null
Wait-ForStatus -Name 'API ready avec DB' -Url "$apiBase/api/ready" -ExpectedStatus @(200) | Out-Null
Wait-ForStatus -Name 'Frontend Vite' -Url $frontOrigin -ExpectedStatus @(200) | Out-Null

$preflight = Invoke-DevHttp -Method 'OPTIONS' -Url "$apiBase/api/dashboard" -Headers @{
    Origin = $frontOrigin
    'Access-Control-Request-Method' = 'GET'
    'Access-Control-Request-Headers' = 'authorization,content-type'
}
if (-not $preflight -or $preflight.StatusCode -ne 204) {
    $status = if ($preflight) { $preflight.StatusCode } else { 'no response' }
    Stop-WithMessage "CORS preflight invalide sur /api/dashboard (statut: $status)"
}

$allowOrigin = $preflight.Headers['Access-Control-Allow-Origin']
if ($allowOrigin -ne $frontOrigin) {
    Stop-WithMessage "CORS invalide: Access-Control-Allow-Origin devrait etre $frontOrigin"
}
Write-Ok 'CORS dashboard OK'

$privateRoute = Invoke-DevHttp -Url "$apiBase/api/dashboard" -Headers @{
    Origin = $frontOrigin
}
if (-not $privateRoute -or $privateRoute.StatusCode -ne 401) {
    $status = if ($privateRoute) { $privateRoute.StatusCode } else { 'no response' }
    Stop-WithMessage "Protection auth inattendue sur /api/dashboard sans token (statut: $status)"
}
Write-Ok 'Route privee protegee (401 sans token)'

if (-not $NoBrowser) {
    Start-Process $frontOrigin
}

Write-Host ''
Write-Host 'Mayele dev est pret.' -ForegroundColor Green
Write-Host "Frontend : $frontOrigin" -ForegroundColor Cyan
Write-Host "API      : $apiBase/api" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Laisse les deux fenetres PowerShell ouvertes pendant le dev.' -ForegroundColor DarkGray
Write-Host 'Pour lancer les tests complets la prochaine fois: .\START_MAYELE_DEV.ps1 -FullCheck' -ForegroundColor DarkGray
