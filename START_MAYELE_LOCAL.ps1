$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machinePath;$userPath"

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
    $npmPath = $npmCommand.Source
} else {
    $fallbackNpm = 'C:\Program Files\nodejs\npm.cmd'
    if (Test-Path $fallbackNpm) {
        $npmPath = $fallbackNpm
    } else {
        Write-Host 'Node.js / npm est introuvable. Redémarrez VS Code ou réinstallez Node.js LTS.' -ForegroundColor Red
        exit 1
    }
}

$serverCommand = "`$env:Path = '$machinePath;$userPath'; Set-Location '$root\server'; & '$npmPath' run dev"
$clientCommand = "`$env:Path = '$machinePath;$userPath'; Set-Location '$root\client'; & '$npmPath' run dev"

Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $serverCommand
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $clientCommand

Write-Host 'Mayele Maths démarre dans deux fenêtres PowerShell.' -ForegroundColor Green
Write-Host 'Ouvrez ensuite http://localhost:5173 dans votre navigateur.' -ForegroundColor Cyan
Write-Host 'Le chemin Node.js a été rechargé automatiquement.' -ForegroundColor DarkGray
