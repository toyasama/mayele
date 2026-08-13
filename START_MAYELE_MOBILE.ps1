param(
    [switch]$Tunnel,
    [switch]$Clear,
    [switch]$SkipInstall,
    [switch]$SkipServer,
    [switch]$CheckOnly,
    [ValidateSet('Auto', 'ExpoGo', 'DevClient')]
    [string]$Mode = 'Auto',
    [int]$ApiPort = 4000,
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $repoRoot 'server'
$mobileDir = Join-Path $repoRoot 'mobile'
$serverEnv = Join-Path $serverDir '.env.local'
$mobileEnv = Join-Path $mobileDir '.env.local'
$serverJob = $null
$serverPid = $null
$startedServer = $false

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "OK   $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Resolve-NpmPath {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    }

    if (-not $npmCommand) {
        throw 'Node.js / npm est introuvable. Installe Node.js LTS puis relance le script.'
    }

    return $npmCommand.Source
}

function Resolve-LanIpv4 {
    $configurations = @(
        Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object {
                $_.NetAdapter.Status -eq 'Up' -and
                $_.IPv4Address -and
                $_.IPv4DefaultGateway
            }
    )

    $preferred = $configurations |
        Where-Object { $_.InterfaceAlias -match 'Wi-Fi|Wireless|WLAN' } |
        Select-Object -First 1

    if (-not $preferred) {
        $preferred = $configurations |
            Where-Object { $_.InterfaceAlias -notmatch 'WSL|Hyper-V|vEthernet|Docker|Loopback' } |
            Select-Object -First 1
    }

    if (-not $preferred) {
        $preferred = $configurations | Select-Object -First 1
    }

    if (-not $preferred) {
        throw "Aucune adresse IPv4 de reseau local n'a ete detectee. Connecte le PC au Wi-Fi."
    }

    $address = @($preferred.IPv4Address) |
        ForEach-Object { $_.IPAddress } |
        Where-Object { $_ -and $_ -notmatch '^127\.' -and $_ -notmatch '^169\.254\.' } |
        Select-Object -First 1

    if (-not $address) {
        throw "Aucune adresse IPv4 utilisable n'a ete trouvee sur $($preferred.InterfaceAlias)."
    }

    return @{
        Address = $address
        Interface = $preferred.InterfaceAlias
    }
}

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Name
    )

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Set-MobileEnvValue {
    param(
        [string]$Path,
        [string]$Name,
        [string]$Value
    )

    $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
    $updated = New-Object System.Collections.Generic.List[string]
    $replaced = $false

    foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=") {
            if (-not $replaced) {
                $updated.Add("$Name=$Value")
                $replaced = $true
            }
            continue
        }

        $updated.Add($line)
    }

    if (-not $replaced) {
        $updated.Add("$Name=$Value")
    }

    [System.IO.File]::WriteAllLines($Path, $updated, [System.Text.UTF8Encoding]::new($false))
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
            throw "npm $($Arguments -join ' ') a echoue dans $WorkingDirectory."
        }
    }
    finally {
        Pop-Location
    }
}

function Test-ApiHealth {
    param([string]$Url)

    try {
        $response = Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 4
        return $response.status -eq 'ok'
    }
    catch {
        return $false
    }
}

function Get-ListeningProcessId {
    param([int]$Port)

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($listener) {
        return [int]$listener.OwningProcess
    }

    return $null
}

function Get-ExpoSdkMajor {
    param([string]$PackageJsonPath)

    $package = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
    $version = [string]$package.dependencies.expo
    $match = [regex]::Match($version, '(\d+)')
    if (-not $match.Success) {
        throw "Version Expo illisible dans $PackageJsonPath : $version"
    }

    return [int]$match.Groups[1].Value
}

Write-Step 'Verification du projet'
if (-not (Test-Path -LiteralPath $serverDir)) {
    throw "Dossier serveur introuvable: $serverDir"
}
if (-not (Test-Path -LiteralPath $mobileDir)) {
    throw "Dossier mobile introuvable: $mobileDir"
}
if (-not (Test-Path -LiteralPath $serverEnv)) {
    throw "Configuration serveur manquante: $serverEnv"
}

$script:npmPath = Resolve-NpmPath
Write-Ok "npm: $script:npmPath"

$expoSdkMajor = Get-ExpoSdkMajor -PackageJsonPath (Join-Path $mobileDir 'package.json')
$effectiveMode = $Mode
if ($effectiveMode -eq 'Auto') {
    $effectiveMode = if ($expoSdkMajor -eq 54) { 'ExpoGo' } else { 'DevClient' }
}

if ($effectiveMode -eq 'ExpoGo' -and $expoSdkMajor -ne 54) {
    throw "Expo Go sur iPhone prend actuellement en charge le SDK 54, mais ce projet utilise le SDK $expoSdkMajor. Utilise -Mode DevClient ou migre completement le projet vers SDK 54."
}

Write-Ok "Expo SDK $expoSdkMajor - mode $effectiveMode"

Write-Step 'Detection du reseau local'
$network = Resolve-LanIpv4
$apiBaseUrl = "http://$($network.Address):$ApiPort/api"
$realtimeBaseUrl = "http://$($network.Address):$ApiPort"
$serverClerkKey = Get-EnvValue -Path $serverEnv -Name 'CLERK_PUBLISHABLE_KEY'
if (-not $serverClerkKey -or $serverClerkKey -notmatch '^pk_(test|live)_') {
    throw 'CLERK_PUBLISHABLE_KEY manque ou est invalide dans server/.env.local.'
}
Set-MobileEnvValue -Path $mobileEnv -Name 'EXPO_PUBLIC_API_URL' -Value $apiBaseUrl
Set-MobileEnvValue -Path $mobileEnv -Name 'EXPO_PUBLIC_REALTIME_URL' -Value $realtimeBaseUrl
Set-MobileEnvValue -Path $mobileEnv -Name 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY' -Value $serverClerkKey
Write-Ok "Reseau: $($network.Interface) ($($network.Address))"
Write-Ok "API mobile: $apiBaseUrl"
Write-Ok "Temps reel mobile: $realtimeBaseUrl"
Write-Ok 'Environnement Clerk mobile aligne sur le serveur local'

if (-not $SkipInstall) {
    Write-Step 'Verification des dependances'
    if (-not (Test-Path -LiteralPath (Join-Path $serverDir 'node_modules'))) {
        Invoke-Npm -WorkingDirectory $serverDir -Arguments @('install')
    }
    else {
        Write-Ok 'Dependances serveur presentes'
    }

    if (-not (Test-Path -LiteralPath (Join-Path $mobileDir 'node_modules'))) {
        Invoke-Npm -WorkingDirectory $mobileDir -Arguments @('install')
    }
    else {
        Write-Ok 'Dependances mobile presentes'
    }
}

if ($CheckOnly) {
    Write-Host ''
    Write-Ok 'Configuration mobile validee. Aucun serveur ne sera lance.'
    exit 0
}

try {
    Write-Step 'Demarrage de API Mayele'
    $existingPid = Get-ListeningProcessId -Port $ApiPort

    if ($existingPid) {
        Write-Warn "Le port $ApiPort est deja utilise (PID $existingPid). Verification de API existante."
    }
    elseif ($SkipServer) {
        Write-Warn 'Demarrage du serveur ignore avec -SkipServer.'
    }
    else {
        $serverJob = Start-Job -Name "MayeleMobileApi-$PID" -ArgumentList $serverDir, $script:npmPath, $ApiPort -ScriptBlock {
            param($WorkingDirectory, $NpmPath, $Port)
            Set-Location -LiteralPath $WorkingDirectory
            $env:NODE_ENV = 'development'
            $env:PORT = [string]$Port
            & $NpmPath run dev
            if ($LASTEXITCODE -ne 0) {
                throw "Le serveur Mayele a quitte avec le code $LASTEXITCODE."
            }
        }
        $startedServer = $true
        Write-Ok 'API lancee en arriere-plan'
    }

    $healthUrl = "$apiBaseUrl/health"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline -and -not (Test-ApiHealth -Url $healthUrl)) {
        if ($serverJob -and $serverJob.State -in @('Completed', 'Failed', 'Stopped')) {
            break
        }
        Start-Sleep -Seconds 1
    }

    if (-not (Test-ApiHealth -Url $healthUrl)) {
        if ($serverJob) {
            $jobOutput = Receive-Job -Job $serverJob -Keep 2>&1 | Out-String
            if ($jobOutput) {
                Write-Host $jobOutput -ForegroundColor DarkGray
            }
        }
        throw "API indisponible sur $healthUrl. Verifie le pare-feu Windows et server/.env.local."
    }

    if ($startedServer) {
        $serverPid = Get-ListeningProcessId -Port $ApiPort
    }
    Write-Ok "API prete: $healthUrl"

    Write-Step 'Demarrage de Expo'
    if ($effectiveMode -eq 'ExpoGo') {
        Write-Host "Ouvre Expo Go sur l'iPhone, puis utilise Scanner un QR code dans Expo Go." -ForegroundColor White
    }
    else {
        Write-Host "Ouvre la development build Mayele sur l'iPhone, puis scanne le QR code." -ForegroundColor White
    }
    Write-Host 'Le PC et iPhone doivent etre sur le meme Wi-Fi.' -ForegroundColor DarkGray
    Write-Host "Mode actif : $effectiveMode. Ne scanne pas un QR Expo Go avec la development build, ni inversement." -ForegroundColor DarkGray
    Write-Host 'Arrete Expo avec Ctrl+C.' -ForegroundColor DarkGray
    Write-Host ''

    $expoScript = if ($effectiveMode -eq 'ExpoGo') {
        if ($Tunnel) { 'start:go:tunnel' } elseif ($Clear) { 'start:go:clear' } else { 'start:go' }
    }
    else {
        if ($Tunnel) { 'start:tunnel' } elseif ($Clear) { 'start:clear' } else { 'start' }
    }

    if ($Tunnel) {
        Write-Warn 'Le tunnel concerne Expo seulement; API Mayele reste accessible par le Wi-Fi local.'
    }

    Invoke-Npm -WorkingDirectory $mobileDir -Arguments @('run', $expoScript)
}
finally {
    if ($startedServer -and $serverPid) {
        Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
    }

    if ($serverJob) {
        Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
        Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue
    }

    if ($startedServer) {
        Write-Host ''
        Write-Ok 'API de developpement arretee'
    }
}
