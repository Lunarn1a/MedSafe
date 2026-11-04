param([int]$Port = 8000, [switch]$Check)

$ErrorActionPreference = 'Stop'
$backendDirectory = $PSScriptRoot
$environmentDirectory = Join-Path $backendDirectory '.venv'
$environmentPython = Join-Path $environmentDirectory 'Scripts\python.exe'
$launcherPath = Join-Path (Split-Path (Split-Path $backendDirectory -Parent) -Parent) 'run.py'
$selectedCommand = $environmentPython
$selectedArguments = @()

if (-not (Test-Path -LiteralPath $environmentPython)) {
    $candidates = @(
        @{ Program = 'py'; Arguments = @('-3.13') },
        @{ Program = 'py'; Arguments = @('-3.12') },
        @{ Program = 'python3.13'; Arguments = @() },
        @{ Program = 'python3.12'; Arguments = @() },
        @{ Program = 'python'; Arguments = @() },
        @{ Program = 'python3'; Arguments = @() }
    )
    $selectedCommand = $null
    foreach ($candidate in $candidates) {
        $resolved = Get-Command $candidate.Program -ErrorAction SilentlyContinue
        if (-not $resolved) { continue }
        $candidateArguments = $candidate.Arguments
        try {
            $version = & $resolved.Source @candidateArguments -c 'import sys; print(str(sys.version_info.major) + chr(46) + str(sys.version_info.minor))' 2>$null
        } catch { continue }
        if ($LASTEXITCODE -eq 0 -and $version -in @('3.12', '3.13')) {
            $selectedCommand = $resolved.Source
            $selectedArguments = $candidateArguments
            break
        }
    }
    if (-not $selectedCommand) {
        throw 'Install Python 3.13 (or 3.12), then run this script again. The exported packages do not support Python 3.14.'
    }
}

$launcherArguments = @($launcherPath, '--port', $Port)
if ($Check) { $launcherArguments += '--check' }
& $selectedCommand @selectedArguments @launcherArguments
exit $LASTEXITCODE
